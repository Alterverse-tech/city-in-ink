import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { partitionBuildings } from '../city-streaming-build.mjs';
import { decodeBuildingTile, roofHeightAtMeshes, runTileQueue, loadStreamingCity, loadCityBuffers } from '../city-streaming.js';

const manifest=JSON.parse(await readFile(new URL('../source/manifest.json',import.meta.url),'utf8'));
const html=(await Promise.all(manifest.parts.map(name=>readFile(new URL('../source/'+name,import.meta.url),'utf8')))).join('');
const assets=JSON.parse(html.match(/<script id="sf-city-assets" type="application\/json">([\s\S]*?)<\/script>/)[1]);
const buffers=Object.fromEntries(['position.f32','normal.i8','tone.u8','index.u32','facade.u16'].map(name=>[name.split('.')[0],gunzipSync(Buffer.from(assets['/data/buildings-refined-'+name],'base64'))]));

test('all actual city triangles and every vertex attribute retain exact original bytes across spatial chunks',()=>{
  const originalIndices=new Uint32Array(buffers.index.buffer,buffers.index.byteOffset,buffers.index.length/4);
  const chunks=partitionBuildings(buffers),seen=new Uint8Array(originalIndices.length/3);
  let largest=0;
  for(const chunk of chunks){
    largest=Math.max(largest,chunk.compressed.length);
    const decoded=decodeBuildingTile(gunzipSync(chunk.compressed)), indices=new Uint32Array(decoded.index);
    const vertices=new Uint32Array(chunk.vertices).fill(0xffffffff);
    assert.equal(indices.length,chunk.originalOffsets.length*3);
    for(let triangle=0;triangle<chunk.originalOffsets.length;triangle++){
      const offset=chunk.originalOffsets[triangle];
      assert.equal(seen[offset/3],0,'triangle occurs exactly once');seen[offset/3]=1;
      for(let corner=0;corner<3;corner++){
        const local=indices[triangle*3+corner],original=originalIndices[offset+corner];
        if(vertices[local]===0xffffffff)vertices[local]=original;else assert.equal(vertices[local],original,'winding and shared vertex identity preserved');
      }
    }
    for(const [name,stride] of [['position',12],['normal',3],['tone',1],['facade',8]]){
      const actual=Buffer.from(decoded[name]),expected=buffers[name];
      for(let local=0;local<vertices.length;local++)assert.equal(actual.compare(expected,vertices[local]*stride,(vertices[local]+1)*stride,local*stride,(local+1)*stride),0,`${name} bytes preserved`);
    }
  }
  assert.ok(seen.every(value=>value===1),'all 1.49 million triangles delivered');
  assert.ok(largest<256*1024,'no multi-megabyte geometry request remains');
  assert.ok(chunks.length<250,'bounded number of requests');
});

test('tile decoder rejects truncated, corrupt, or unbounded metadata before allocating geometry',()=>{
  const bad=Buffer.alloc(16);bad.writeUInt32LE(0x31434653);
  assert.throws(()=>decodeBuildingTile(new Uint8Array(3)),/tile|DataView|bounds/);
  const huge=Buffer.from(bad);huge.writeUInt32LE(0xffffffff,4);assert.throws(()=>decodeBuildingTile(huge),/length/);
  const wrong=Buffer.from(bad);wrong.writeUInt32LE(3,8);assert.throws(()=>decodeBuildingTile(wrong),/index/);
  const trailing=Buffer.concat([bad,Buffer.from([0])]);assert.throws(()=>decodeBuildingTile(trailing),/length/);
});

test('roof query covers every loaded tile and preserves original scale, radius, and maximum-height semantics',()=>{
  const mesh=(points,scale=1)=>({scale:{x:scale},geometry:{attributes:{position:{array:Float32Array.from(points)}}}});
  const first=mesh([0,10,0, 20,80,20]);
  const second=mesh([3,40,0, 8,100,0]);
  assert.equal(roofHeightAtMeshes([first,second],0,0,6),40);
  assert.equal(roofHeightAtMeshes([first],0,0,6),10);
  assert.equal(roofHeightAtMeshes([first,second],0,0,9),100);
  assert.equal(roofHeightAtMeshes([mesh([2,5,0],2)],4,0,1),10);
  assert.equal(roofHeightAtMeshes([first],100,100,4),-Infinity);
});

test('streaming queue bounds concurrency, prioritizes player vicinity, and retains failures for retries',async()=>{
  const tiles=[3,1,2,0].map(x=>({id:x,bounds:{minX:x,maxX:x,minZ:0,maxZ:0}}));
  const order=[];let active=0,max=0;
  const failures=await runTileQueue(tiles,async tile=>{order.push(tile.id);max=Math.max(max,++active);await new Promise(resolve=>setTimeout(resolve,1));active--;if(tile.id===2)throw Error('retry');},{concurrency:2,centre:()=>({x:0,z:0})});
  assert.equal(max,2);assert.deepEqual(order,[0,1,2,3]);assert.deepEqual(failures.map(x=>x.tile.id),[2]);
});

test('downtown becomes ready while a distant geometry request is still pending, then the full city completes',async()=>{
  const oldWindow=globalThis.window, oldDocument=globalThis.document, oldFetch=globalThis.fetch, oldCustomEvent=globalThis.CustomEvent;
  const tile=partitionBuildings({position:Buffer.from(new Float32Array([0,0,0,10,0,0,0,10,0]).buffer),normal:Buffer.from([0,0,127,0,0,127,0,0,127]),tone:Buffer.from([1,2,3]),facade:Buffer.alloc(24),index:Buffer.from(new Uint32Array([0,1,2]).buffer)})[0];
  let release, releaseNorth, backgroundRequested=false, northRequested=false;
  const far=new Promise(resolve=>{release=resolve;});
  const north=new Promise(resolve=>{releaseNorth=resolve;});
  const config={buildings:{streamingVersion:1,positionScale:1,renderedBuildings:2,tiles:[{id:'near',url:'./near.bin',priority:'critical',bounds:{minX:0,maxX:10,minZ:0,maxZ:10}},{id:'far',url:'./far.bin',priority:'background',bounds:{minX:100,maxX:110,minZ:0,maxZ:10}}]},terrain:{heights:'heights',landMask:'mask',nx:2,nz:2,northShorePatch:{vertices:12}},roads:{position:'roads',normal:'normal',tone:'tone',index:'index',positionScale:1,sourceFeatures:1}};
  class Mesh{constructor(geometry){this.geometry=geometry;this.isMesh=true;this.position={set(){}};this.rotation={};this.userData={};this.scale={setScalar(){}};}}
  const statuses=[],objects=[];
  const city={target:{x:0,z:0},dispose(){this.disposed=true;},onStatus:s=>statuses.push(s.phase),scene:{add:o=>objects.push(o),remove(){}},fetchBuffer:async()=>new ArrayBuffer(8),createDetailedBuildingGeometry:()=>({}),createDetailedBuildingMaterial(){},createTerrainGeometry(){},createGenericMaterial(){},geometryFromBuffers(){},buildLandmarks(){},createSolidMaterial(){},applyPalette(){},setView(){},palette:'day',async loadNorthShorePatch(){northRequested=true;await north;}};
  try{
    globalThis.document={baseURI:'https://chrona.world/version/index.html'};
    globalThis.CustomEvent=class{constructor(type,init){this.type=type;this.detail=init.detail;}};
    globalThis.window={__SF_THREE:{Mesh,PlaneGeometry:class{}},__sfGunzip:b=>gunzipSync(b),dispatchEvent(){},TW:{state:{ready:true},refreshCityGeometry(){}}};
    globalThis.fetch=async url=>{if(String(url).includes('city-manifest'))return new Response(JSON.stringify(config));if(String(url).endsWith('far.bin')){backgroundRequested=true;await far;}return new Response(tile.compressed);};
    await loadStreamingCity(city);
    assert.equal(statuses.at(-1),'ready');assert.equal(city.streaming.loaded,1);assert.equal(city.streaming.complete,false);
    await new Promise(resolve=>setTimeout(resolve,10));assert.equal(backgroundRequested,true);assert.equal(northRequested,true);assert.equal(city.streaming.loaded,1);
    release();await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(city.streaming.loaded,2,'far tiles do not wait for north-shore requests');assert.equal(city.streaming.complete,false);
    releaseNorth();await city.streaming.done;
    assert.equal(city.streaming.loaded,2);assert.equal(city.streaming.complete,true);assert.equal(city.streaming.meshes.length,2);
    city.dispose();
  }finally{city.dispose();globalThis.window=oldWindow;globalThis.document=oldDocument;globalThis.fetch=oldFetch;globalThis.CustomEvent=oldCustomEvent;}
});

test('north-shore buffer queue stays bounded and settles in-flight work before a retry can start',async()=>{
  let active=0,max=0;const order=[];
  const values=await loadCityBuffers({fetchBuffer:async url=>{order.push(url);max=Math.max(max,++active);await new Promise(r=>setTimeout(r,1));active--;return url;}},[0,1,2,3,4,5]);
  assert.equal(max,2);assert.deepEqual(values,[0,1,2,3,4,5]);
  let release, settled=false;const calls=[];
  const pending=new Promise(resolve=>{release=resolve;});
  const failed=loadCityBuffers({fetchBuffer:async url=>{calls.push(url);if(url===0)throw Error('network');await pending;return url;}},[0,1,2,3]);
  const assertion=assert.rejects(failed,/network/).then(()=>{settled=true;});
  await new Promise(r=>setTimeout(r,2));assert.equal(settled,false);assert.deepEqual(calls,[0,1]);
  release();await assertion;assert.deepEqual(calls,[0,1]);
});
