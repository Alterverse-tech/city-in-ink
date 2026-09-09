// Single-file hosted build: serve the city geometry and the saved event
// snapshot from the page itself. Replaces the original inline asset shim.
//
// The <script id="sf-city-assets"> map holds, per URL path, either
//   "<base64 gzip>"                              the original raw bytes, gzipped;
//   {t:"dzv", n, c, o, s?, b:"<base64 gzip>"}    planar delta + zigzag varints
//                                                (n values × c components, output
//                                                typed array o, float scale s);
//   {t:"alias", to:"<other path>"}               same bytes as another entry.
// Every form decodes back to the exact typed-array bytes the game bundle
// expects, so the bundle itself stays byte-for-byte the original.
(() => {
  const holder = document.getElementById('sf-city-assets');
  const assets = JSON.parse(holder.textContent);
  holder.remove();
  const keys = Object.keys(assets);
  const nativeFetch = window.fetch.bind(window);

  const fromBase64 = text => {
    const binary = atob(text);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  };

  const OUT = { f32: Float32Array, u32: Uint32Array, u16: Uint16Array, i16: Int16Array, i8: Int8Array, u8: Uint8Array };

  function decodeDzv(meta, bytes) {
    const n = meta.n, c = meta.c, total = n * c;
    const planar = new Int32Array(total);
    let p = 0;
    for (let i = 0; i < total; i += 1) {
      let shift = 0, value = 0, byte;
      do { byte = bytes[p++]; value += (byte & 0x7f) * 2 ** shift; shift += 7; } while (byte & 0x80);
      planar[i] = (value % 2 === 0) ? value / 2 : -(value + 1) / 2; // zigzag → signed
    }
    const out = new OUT[meta.o](total);
    const scale = meta.s || 1;
    for (let k = 0; k < c; k += 1) {
      const base = k * n;
      let acc = 0;
      if (meta.o === 'f32') for (let i = 0; i < n; i += 1) { acc += planar[base + i]; out[i * c + k] = acc * scale; }
      else for (let i = 0; i < n; i += 1) { acc += planar[base + i]; out[i * c + k] = acc; }
    }
    return new Uint8Array(out.buffer);
  }

  function materialize(key) {
    let entry = assets[key];
    if (entry && entry.t === 'alias') { key = entry.to; entry = assets[key]; }
    if (entry == null) throw new Error(`Asset ${key} was already consumed`);
    const bytes = typeof entry === 'string'
      ? window.__sfGunzip(fromBase64(entry))
      : decodeDzv(entry, window.__sfGunzip(fromBase64(entry.b)));
    // Geometry is fetched once; release its text. JSON feeds are re-read by
    // the periodic refreshes, so keep those.
    if (!key.endsWith('.json')) assets[key] = null;
    return bytes;
  }

  window.fetch = (input, init) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    let pathname = href;
    try { pathname = new URL(href, window.location.href).pathname; } catch {}
    const key = keys.find(k => pathname === k || pathname.endsWith(k));
    if (!key) return nativeFetch(input, init);
    try {
      const bytes = materialize(key);
      const type = key.endsWith('.json') ? 'application/json; charset=utf-8' : 'application/octet-stream';
      return Promise.resolve(new Response(bytes, { status: 200, headers: { 'Content-Type': type } }));
    } catch (error) {
      return Promise.reject(error);
    }
  };
})();
