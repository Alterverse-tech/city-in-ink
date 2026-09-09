// Fail before a release rather than during one: a World-scoped Chrona publish
// credential always expires. Reads $CHRONA_CONFIG_DIR/clients.json.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.env.CHRONA_CONFIG_DIR;
if (!dir) { console.error('::error::CHRONA_CONFIG_DIR is not set'); process.exit(1); }
const clients = JSON.parse(readFileSync(join(dir, 'clients.json'), 'utf8')).clients ?? [];
const publishers = clients.filter(c => (c.scopes ?? []).includes('publish'));

const renew = 'Re-mint it with `node chrona.mjs login --world <link> --publish --force`, then update the CHRONA_CLIENTS_JSON secret.';
if (!publishers.length) {
  console.error(`::error::CHRONA_CLIENTS_JSON holds no connection with publish scope, but this workflow releases to the live World. ${renew}`);
  process.exit(1);
}

const soonest = Math.min(...publishers.map(c => c.expiresAt ?? Infinity));
if (!Number.isFinite(soonest)) { console.log('Publish credential does not expire.'); process.exit(0); }

const when = new Date(soonest).toISOString().slice(0, 10);
const days = Math.floor((soonest - Date.now()) / 86_400_000);
if (days < 0) { console.error(`::error::The Chrona publish credential expired on ${when}. ${renew}`); process.exit(1); }
console.log(`Publish credential valid for ${days} more days (until ${when}).`);
if (days <= 14) console.log(`::warning::The Chrona publish credential expires on ${when}. ${renew}`);
