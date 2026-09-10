import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { performance } from 'node:perf_hooks';
import { gunzipSync } from 'node:zlib';
import { partitionBuildings } from '../city-streaming-build.mjs';
import { decodeBuildingTile } from '../city-streaming.js';
const extras=await readFile(new URL('../city-extras.mjs',import.meta.url),'utf8');

test('a late full calendar fence refreshes collision/signage bounds after the map finished streaming',()=>{
  const start=extras.indexOf("  let signature = '';\n  const fenceSignature");
  const end=extras.indexOf('  return root;',start);
  const timeouts=new Map(),intervals=new Map(),calls=[];let next=0;
  const state={fence:{minX:0,maxX:100,minZ:0,maxZ:100},venues:[]};
  const TW={state,rebuildWorld(){}};
  const context={TW,city:{streaming:{revision:131},dispose(){this.disposed=true;}},DOWNTOWN:{lng:0,lat:0},SIGN_START_DELAY:900,index:null,plan(){},window:{addEventListener(){},removeEventListener(){},__sfGeo:{Hn:()=>({x:0,z:0})}},console,
    buildWallIndex(city,bounds,done){calls.push(bounds);done({near(){return[];}});},
    setTimeout(fn,ms){const id=++next;timeouts.set(id,{fn,ms});return id;},clearTimeout(id){timeouts.delete(id);},
    setInterval(fn,ms){const id=++next;intervals.set(id,{fn,ms});return id;},clearInterval(id){intervals.delete(id);}};
  runInNewContext(extras.slice(start,end),context);
  const tick=()=>{const [id,job]=timeouts.entries().next().value;timeouts.delete(id);job.fn();};
  tick();assert.equal(calls.length,1);assert.equal(calls[0].maxX,300);
  state.fence={minX:-500,maxX:2200,minZ:-500,maxZ:1000};
  // This interval stays alive after 120 seconds, even if the full feed was slow.
  assert.equal(intervals.size,1);intervals.values().next().value.fn();
  tick();assert.equal(calls.length,2);assert.equal(calls[1].maxX,2400);
  context.city.dispose();assert.equal(intervals.size,0);assert.equal(timeouts.size,0);
});

test('all completed spatial tiles produce the same roof collision grid and wall count as the original one-mesh city',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../source/manifest.json',import.meta.url),'utf8'));
  const source=(await Promise.all(manifest.parts.map(name=>readFile(new URL('../source/'+name,import.meta.url),'utf8')))).join('');
  const assets=JSON.parse(source.match(/<script id="sf-city-assets" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  const buffers=Object.fromEntries(['position.f32','normal.i8','tone.u8','index.u32','facade.u16'].map(name=>[name.split('.')[0],gunzipSync(Buffer.from(assets['/data/buildings-refined-'+name],'base64'))]));
  const mesh=(position,index)=>({isMesh:true,name:'Refined DataSF footprints',position:{lengthSq:()=>0},rotation:{y:0},scale:{x:1},geometry:{attributes:{position:{array:new Float32Array(position.buffer,position.byteOffset||0,position.byteLength/4)}},index:{array:new Uint32Array(index.buffer,index.byteOffset||0,index.byteLength/4)}}});
  const original=[mesh(buffers.position,buffers.index)];
  const split=partitionBuildings(buffers).map(chunk=>{const d=decodeBuildingTile(gunzipSync(chunk.compressed));return mesh(new Uint8Array(d.position),new Uint8Array(d.index));});
  const from=extras.indexOf('const WALL_CELL ='),to=extras.indexOf('// Distance from a point',from);
  const bounds={minX:600,maxX:2600,minZ:-700,maxZ:1400};
  const build=meshes=>new Promise(resolve=>{const scope={window:{},performance,setTimeout,console};runInNewContext(extras.slice(from,to)+';globalThis.build=buildWallIndex;',scope);scope.build({scene:{traverse:cb=>meshes.forEach(cb)}},bounds,resolve);});
  const before=await build(original),after=await build(split);
  assert.equal(after.count,before.count);
  for(let x=bounds.minX;x<=bounds.maxX;x+=8)for(let z=bounds.minZ;z<=bounds.maxZ;z+=8)assert.equal(after.roofAt(x,z),before.roofAt(x,z),`roof collision ${x},${z}`);
});
