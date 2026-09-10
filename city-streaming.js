// Incremental delivery of the original full-resolution city. Each chunk is a
// lossless subset of the original indexed triangles, with unchanged shaders.
export function decodeBuildingTile(input) {
  const bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 16 || header.getUint32(0,true) !== 0x31434653) throw new Error('Invalid city tile');
  const vertices=header.getUint32(4,true), count=header.getUint32(8,true), encoded=header.getUint32(12,true);
  if (vertices > 1000000 || count > 3000000 || count % 3 || bytes.length !== 16 + vertices*24 + encoded) throw new Error('Invalid city tile length');
  let offset=16;
  const read = length => { const value=bytes.slice(offset,offset+length).buffer; offset+=length;return value; };
  const position=read(vertices*12), normal=read(vertices*3), tone=read(vertices), facade=read(vertices*8);
  const indices=new Uint32Array(count); let previous=0;
  for(let i=0;i<count;i++) {
    let value=0, shift=0, byte;
    do { if(offset>=bytes.length || shift>28)throw new Error('Invalid city tile index');byte=bytes[offset++];value+=(byte&127)*2**shift;shift+=7;}while(byte&128);
    if(value>0xffffffff || (shift>7 && byte===0))throw new Error('Invalid city tile delta');
    previous+=value%2===0?value/2:-(value+1)/2;
    if(previous<0 || previous>=vertices)throw new Error('City tile index out of range');indices[i]=previous;
  }
  if(offset!==bytes.length)throw new Error('Trailing city tile bytes');
  return {position,normal,tone,facade,index:indices.buffer};
}

// Same max-height query as the original game, restricted to intersecting tile
// bounds instead of repeatedly scanning all 2.6 million city vertices.
export function roofHeightAtMeshes(meshes, x, z, radius) {
  let best=-Infinity;
  for(const mesh of meshes) {
    const geometry=mesh.geometry, s=mesh.scale.x || 1, lx=x/s, lz=z/s, lr=radius/s, lr2=lr*lr;
    const bounds=geometry.boundingBox;
    if(bounds && (bounds.min.x>lx+lr || bounds.max.x<lx-lr || bounds.min.z>lz+lr || bounds.max.z<lz-lr))continue;
    const positions=geometry.attributes.position.array;
    for(let i=0;i<positions.length;i+=3) {
      const dx=positions[i]-lx;if(dx>lr || dx< -lr)continue;
      const dz=positions[i+2]-lz;if(dz>lr || dz< -lr)continue;
      if(dx*dx+dz*dz<lr2)best=Math.max(best,positions[i+1]*s);
    }
  }
  return best;
}

export async function loadCityBuffers(city, urls) {
  const results = new Array(urls.length);
  let next = 0, failure;
  await Promise.all(Array.from({ length: Math.min(2, urls.length) }, async () => {
    try {
      while (next < urls.length && !city.disposed && !failure) {
        const index = next++;
        results[index] = await city.fetchBuffer(urls[index]);
      }
    } catch (error) { failure ||= error; }
  }));
  if (failure) throw failure;
  return results;
}

const pause = () => new Promise(resolve => setTimeout(resolve, 0));
export async function runTileQueue(tiles, load, { concurrency = 2, shouldStop = () => false, centre = () => null } = {}) {
  const pending=tiles.slice(), failures=[];
  await Promise.all(Array.from({length:concurrency}, async () => {
    while(pending.length && !shouldStop()) {
      const focus=centre();
      if(focus)pending.sort((a,b)=>distance(a.bounds,focus)-distance(b.bounds,focus));
      const tile=pending.shift();
      try { await load(tile); } catch(error) { failures.push({tile,error}); }
      await pause();
    }
  }));
  return failures;
}
function distance(bounds, point) {
  return Math.hypot(Math.max(bounds.minX-point.x,0,point.x-bounds.maxX),Math.max(bounds.minZ-point.z,0,point.z-bounds.maxZ));
}

export async function loadStreamingCity(city) {
  try {
    const response=await fetch('/data/city-manifest.json');
    if(!response.ok)throw new Error(`Manifest ${response.status}`);
    const manifest=await response.json(), T=window.__SF_THREE;
    if(manifest.buildings.streamingVersion!==1 || !Array.isArray(manifest.buildings.tiles))throw new Error('Missing city tiles');
    const streaming={loaded:0,total:manifest.buildings.tiles.length,complete:false,failures:[],meshes:[],roofMeshes:[],revision:0};
    city.streaming=streaming;
    const loaded=new Set(), pending=new Map(), controllers=new Set();
    let refreshTimer=null;
    const refreshGeometry=()=>{
      if(refreshTimer!==null || city.disposed)return;
      refreshTimer=setTimeout(()=>{refreshTimer=null;if(city.disposed)return;
        if(window.TW?.state?.ready)window.TW.refreshCityGeometry?.();else refreshGeometry();
      },1200);
    };
    const originalDispose=city.dispose.bind(city);
    city.dispose=()=>{clearTimeout(refreshTimer);for(const controller of controllers)controller.abort();originalDispose();};
    const loadTile=tile=>{
      if(loaded.has(tile.id))return Promise.resolve();
      if(pending.has(tile.id))return pending.get(tile.id);
      const work=(async()=>{
        const controller=new AbortController(); controllers.add(controller);
        const timeout=setTimeout(()=>controller.abort(),45000);
        try {
          const options={signal:controller.signal,cache:'default',priority:tile.priority==='critical'?'high':'low'};
          const r=window.__sfFetchCityAsset?await window.__sfFetchCityAsset(tile.url,options):await fetch(new URL(tile.url,window.__CHRONA_ASSET_BASE__||document.baseURI),options);
          if(!r.ok)throw new Error(`City tile ${r.status}`);
          const compressed=new Uint8Array(await r.arrayBuffer());
          const raw=window.__sfDecodeCityAsset?await window.__sfDecodeCityAsset(compressed):window.__sfGunzip(compressed);
          const buffers=decodeBuildingTile(raw);
          if(city.disposed)return;
          const geometry=city.createDetailedBuildingGeometry(buffers.position,buffers.normal,buffers.tone,buffers.index,buffers.facade);
          const mesh=new T.Mesh(geometry,city.createDetailedBuildingMaterial());
          mesh.name='Refined DataSF footprints, courtyard roofs and facade materials / '+tile.id;
          mesh.userData.cityTile=tile.id;mesh.scale.setScalar(manifest.buildings.positionScale);city.scene.add(mesh);
          loaded.add(tile.id);streaming.meshes.push(mesh);streaming.roofMeshes.push(mesh);streaming.loaded=loaded.size;streaming.revision++;
          refreshGeometry();
          window.dispatchEvent(new CustomEvent('sf-city-geometry-updated',{detail:{city,revision:streaming.revision,complete:streaming.loaded===streaming.total}}));
        } finally {clearTimeout(timeout);controllers.delete(controller);}
      })().finally(()=>pending.delete(tile.id));
      pending.set(tile.id,work);return work;
    };
    const retryTile=async tile=>{for(let attempt=0;attempt<3;attempt++){try{return await loadTile(tile);}catch(error){streaming.lastError={asset:tile.id,message:String(error.message||error)};if(city.disposed || attempt===2)throw error;await new Promise(resolve=>setTimeout(resolve,400*(attempt+1)));}}};
    city.onStatus({phase:'loading',progress:22,message:'Loading downtown'});
    const critical=manifest.buildings.tiles.filter(tile=>tile.priority==='critical');
    const terrainAndRoads=Promise.all([manifest.terrain.heights,manifest.terrain.landMask,manifest.roads.position,manifest.roads.normal,manifest.roads.tone,manifest.roads.index].map(url=>city.fetchBuffer(url)));
    const criticalWork=runTileQueue(critical,retryTile,{concurrency:3,shouldStop:()=>city.disposed});
    const roofPoints = (async () => {
      const reference = manifest.buildings.roofPoints;
      if (!reference) return;
      const response = window.__sfFetchCityAsset ? await window.__sfFetchCityAsset(reference.url) : await fetch(new URL(reference.url, document.baseURI));
      if (!response.ok) throw new Error('City survey points could not load');
      const compressed = new Uint8Array(await response.arrayBuffer());
      const raw = window.__sfDecodeCityAsset ? await window.__sfDecodeCityAsset(compressed) : window.__sfGunzip(compressed);
      if (raw.byteLength % 12) throw new Error('Invalid city survey points');
      streaming.roofMeshes.push({ scale: {x:manifest.buildings.positionScale}, geometry: { attributes: { position: { array: new Float32Array(raw.buffer,raw.byteOffset,raw.byteLength/4) } } } });
    })();
    const [buffers,criticalFailures]=await Promise.all([terrainAndRoads,criticalWork,roofPoints]);
    if(city.disposed)return;
    if(criticalFailures.length)throw criticalFailures[0].error;
    const [heights,mask,roadPosition,roadNormal,roadTone,roadIndex]=buffers;
    city.terrain={manifest:manifest.terrain,heights:new Int16Array(heights),mask:new Uint8Array(mask)};
    const terrain=new T.Mesh(city.createTerrainGeometry(manifest.terrain,city.terrain.heights,city.terrain.mask),city.createGenericMaterial());
    terrain.name='DataSF elevation terrain';city.scene.add(terrain);
    const roads=new T.Mesh(city.geometryFromBuffers(roadPosition,roadNormal,roadTone,roadIndex),city.createGenericMaterial());
    roads.name='DataSF active street centerlines';roads.scale.setScalar(manifest.roads.positionScale);roads.renderOrder=2;city.scene.add(roads);
    city.onStatus({phase:'loading',progress:78,message:'Sculpting the landmarks'});city.buildLandmarks();
    const water=new T.Mesh(new T.PlaneGeometry(24000,20000),city.createSolidMaterial('water','#72aab7'));
    water.rotation.x=-Math.PI/2;water.position.set(-1600,.7,-1200);water.name='San Francisco Bay';water.renderOrder=-2;city.scene.add(water);
    if(city.fallback){city.scene.remove(city.fallback);city.fallback.traverse(mesh=>{if(mesh.isMesh)mesh.geometry.dispose();});city.fallback=undefined;}
    city.stats={buildings:manifest.buildings.renderedBuildings,streets:manifest.roads.sourceFeatures,terrainVertices:manifest.terrain.nx*manifest.terrain.nz};
    city.applyPalette(city.palette);if(!city.freeFlightEnabled)city.setView('downtown',false);
    city.onStatus({phase:'ready',progress:100,message:'Downtown ready',stats:city.stats});
    // Event UI can start immediately. Far geometry streams with limited
    // concurrency; moving/flying the camera reprioritizes the remaining queue.
    const background=async()=>{
      await pause();
      // North-shore scenery must never hold the surrounding city queue hostage.
      // Its six buffers use a separate queue of two; together with two building
      // workers, at most four background geometry requests are active.
      streaming.northShore = manifest.terrain.northShorePatch ? 'loading' : 'absent';
      const north = (async () => {
        if (!manifest.terrain.northShorePatch) return;
        while (!city.disposed) {
          try {
            await city.loadNorthShorePatch(manifest.terrain.northShorePatch);
            if (city.disposed) return;
            city.stats.terrainVertices += manifest.terrain.northShorePatch.vertices || 0;
            streaming.northShore = 'ready'; refreshGeometry(); return;
          } catch (error) {
            streaming.northShore = 'retrying';
            streaming.lastError = { asset: 'north-shore', message: String(error.message || error) };
            console.warn('[city] north shore will retry', error);
            await new Promise(resolve => setTimeout(resolve,10000));
          }
        }
      })();
      const buildings = (async () => {
        const rest=manifest.buildings.tiles.filter(tile=>!loaded.has(tile.id));
        const centre=()=>city.freeFlightEnabled&&city.flightCharacter?city.flightCharacter.position:city.target;
        let failures=await runTileQueue(rest,retryTile,{concurrency:2,shouldStop:()=>city.disposed,centre});
        while(failures.length && !city.disposed){streaming.failures=failures.map(({tile})=>tile.id);await new Promise(resolve=>setTimeout(resolve,10000));failures=await runTileQueue(failures.map(x=>x.tile),retryTile,{concurrency:2,shouldStop:()=>city.disposed,centre});}
        streaming.failures=[];
      })();
      await Promise.all([north, buildings]);
      streaming.complete=!city.disposed && loaded.size===streaming.total && ['ready','absent'].includes(streaming.northShore);
      window.dispatchEvent(new CustomEvent('sf-city-geometry-updated',{detail:{city,revision:streaming.revision,complete:streaming.complete}}));
    };
    streaming.done=background().catch(error=>console.warn('[city] background geometry',error));
  }catch(error){console.error(error);if(!city.disposed)city.onStatus({phase:'error',progress:100,message:'City data could not load. Please reload to retry.'});}
}
if(typeof window!=='undefined'){window.__sfLoadStreamingCity=loadStreamingCity;window.__sfRoofHeightAtMeshes=roofHeightAtMeshes;window.__sfLoadCityBuffers=loadCityBuffers;}
