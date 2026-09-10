import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { gzipSync, gunzipSync } from 'node:zlib';
import { cityDecodeWorkerMain, installCityDecoder, injectCityDecoder } from '../city-decode.mjs';
import { decodeCityIndices } from '../city-assets-build.mjs';

test('worker inflates geometry and restores indices without changing a byte', async () => {
  for (const [original, metadata, expected] of [
    [Buffer.from([0, 127, 255, 33, 19, 0]), undefined, Buffer.from([0, 127, 255, 33, 19, 0])],
    [Buffer.from([0, 4, 1, 8]), { codec: 'u32-dzv', count: 4 }, Buffer.from(new Uint32Array([0, 2, 1, 5]).buffer)],
  ]) {
    const compressed = gzipSync(original);
    let result;
    const self = { postMessage: (data, transfer) => { result = data; assert.equal(transfer[0], data.buffer); } };
    const context = { self, Blob, DecompressionStream, Response, Uint8Array, decodeCityIndices };
    vm.runInNewContext(`(${cityDecodeWorkerMain.toString()})(decodeCityIndices)`, context);
    await self.onmessage({ data: { id: 4, buffer: compressed, metadata } });
    assert.equal(result.id, 4);
    assert.equal(result.error, undefined);
    assert.deepEqual(Buffer.from(result.buffer), expected);
  }
});

test('corrupt gzip produces an explicit worker error instead of an unresolved request', async () => {
  let result;
  const self = { postMessage: data => { result = data; } };
  vm.runInNewContext(`(${cityDecodeWorkerMain.toString()})(decodeCityIndices)`, {
    self, Blob, DecompressionStream, Response, Uint8Array, decodeCityIndices,
  });
  await self.onmessage({ data: { id: 9, buffer: new Uint8Array([3, 4]) } });
  assert.equal(result.id, 9);
  assert.equal(typeof result.error, 'string');
});

function client(Worker) {
  const window = { __sfGunzip: value => new Uint8Array(gunzipSync(value)), addEventListener() {} };
  vm.runInNewContext(`(${installCityDecoder.toString()})(workerMain, decodeCityIndices)`, {
    window, Worker, DecompressionStream, Blob, Uint8Array, Error, Map,
    URL: { createObjectURL: () => 'blob:decoder', revokeObjectURL() {} },
    setTimeout, clearTimeout, workerMain: cityDecodeWorkerMain, decodeCityIndices,
  });
  return window.__sfDecodeCityAsset;
}

test('unsupported or blocked workers fall back to the original decoder', async () => {
  const original = Buffer.from('city geometry');
  for (const Worker of [undefined, class { constructor() { throw new Error('CSP'); } }]) {
    assert.deepEqual(Buffer.from(await client(Worker)(gzipSync(original))), original);
  }
});

test('worker transfer does not detach cached gzip and failed worker jobs all settle', async () => {
  let instance;
  class MockWorker {
    constructor() { instance = this; }
    terminate() {}
    postMessage(data, transfers) {
      this.messages ||= [];
      this.messages.push(structuredClone(data, { transfer: transfers }));
    }
  }
  const decode = client(MockWorker), original = Buffer.from('reusable city asset'), compressed = new Uint8Array(gzipSync(original));
  const first = decode(compressed), second = decode(compressed);
  assert.ok(compressed.byteLength > 0);
  assert.equal(instance.messages.length, 2);
  instance.onerror({ preventDefault() {} });
  assert.deepEqual(Buffer.from(await first), original);
  assert.deepEqual(Buffer.from(await second), original);
  assert.deepEqual(Buffer.from(await decode(compressed)), original);
});

test('worker response resolves the right job and insertion keeps the asset map intact', async () => {
  class MockWorker {
    terminate() {}
    postMessage({ id }) { queueMicrotask(() => this.onmessage({ data: { id, buffer: Uint8Array.from([1, 2, 3]).buffer } })); }
  }
  assert.deepEqual(Buffer.from(await client(MockWorker)(new Uint8Array([7]))), Buffer.from([1, 2, 3]));
  const source = '<head><script id="sf-city-assets" type="application/json">{}</script></head>';
  const html = injectCityDecoder(source, decodeCityIndices);
  assert.ok(html.indexOf('__sfDecodeCityAsset') < html.indexOf('id="sf-city-assets"'));
  assert.ok(html.endsWith('type="application/json">{}</script></head>'));
  assert.throws(() => injectCityDecoder('<head></head>', decodeCityIndices));
});
