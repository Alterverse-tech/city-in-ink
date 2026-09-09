// Game-owned public calendar service; static uploading does not run this process.
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { createEventCache } from './event-cache.mjs';
import { fetchTechWeekEvents } from './tech-week-source.mjs';
const port = Number(process.env.INK_CALENDAR_PORT || 8138);
const cache = await createEventCache({ file: resolve(process.env.INK_CALENDAR_DATA || '.cache', 'tech-week-events.json'), fetchEvents: fetchTechWeekEvents });
const server = createServer((req,res) => {
  if (!['GET','HEAD'].includes(req.method) || req.url.split('?')[0] !== '/events.json') { res.writeHead(404); res.end(); return; }
  res.writeHead(200, {'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'});
  res.end(req.method === 'HEAD' ? undefined : JSON.stringify(cache.snapshot()));
});
server.listen(port,'127.0.0.1',()=>cache.start());
const stop = () => { cache.stop(); server.close(); };
process.on('SIGINT',stop); process.on('SIGTERM',stop);
