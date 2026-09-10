// The saved snapshot in data/ is the archive: every field, plus per-field
// provenance (fieldSources) and crawl bookkeeping. The game reads a fraction of
// it, and the rest is dead weight on every player's first load — provenance
// alone is half the file. Builds serve this slimmed copy; data/ stays complete.
import { readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const DROP = ['fieldSources', 'imageUsage', 'calendarUrl', 'calendarId', 'locationVisibility', 'source', 'sourceLabel', 'acquisition'];

export function slimFeed(feed) {
  const events = feed.events.map(event => {
    const out = {};
    for (const [key, value] of Object.entries(event)) {
      if (DROP.includes(key)) continue;
      if (value == null || value === '' || (Array.isArray(value) && !value.length)) continue;
      out[key] = value;
    }
    return out;
  });
  const { failures, acquisition, ...rest } = feed;
  return { ...rest, events, slim: true };
}

// Rewrite a copied feed in place (used by the local and hosted builds).
export async function slimFeedFile(path) {
  const before = await readFile(path, 'utf8');
  const after = JSON.stringify(slimFeed(JSON.parse(before)));
  await writeFile(path, after);
  return { before: before.length, after: after.length };
}

// A snapshot over the importer's per-file text limit ships as ordered raw text
// parts of one JSON document (data/<base>.parts.json lists them). Join them in
// order; a partial set is not a smaller snapshot.
export async function readFeedText(dir, base) {
  const manifestUrl = new URL(`${base}.parts.json`, dir);
  let manifest = null;
  try { manifest = JSON.parse(await readFile(manifestUrl, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!manifest) return { text: await readFile(new URL(`${base}.json`, dir), 'utf8'), manifest: null };
  if (!Array.isArray(manifest.parts) || !manifest.parts.length) throw new Error('Snapshot part manifest is empty');
  const texts = await Promise.all(manifest.parts.map(name => {
    if (!/^[\w.-]+$/.test(name)) throw new Error('Unexpected snapshot part name');
    return readFile(new URL(name, dir), 'utf8');
  }));
  return { text: texts.join(''), manifest, manifestUrl };
}

export const FEED_PART_BYTES = 200 * 1024;

// Each fetched part is decoded separately. Count bytes, not UTF-16 characters,
// and move a cut back to the start of a code point so Chinese/emoji survive it.
export function splitUtf8(text, maxBytes = FEED_PART_BYTES) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 4) throw new Error('UTF-8 part size must be at least four bytes');
  const bytes = Buffer.from(text), parts = [];
  for (let start = 0; start < bytes.length;) {
    let end = Math.min(start + maxBytes, bytes.length);
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    parts.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
  }
  return parts;
}

// Only the copied hosted/local build data is rewritten. Small parallel parts
// avoid putting an entire event snapshot behind a single slow response; the
// JSON payload and its ordered reconstruction remain exactly the same.
export async function slimFeedParts(dir, base) {
  const { text, manifest, manifestUrl } = await readFeedText(dir, base);
  const slim = slimFeed(JSON.parse(text)), after = JSON.stringify(slim);
  const beforeBytes = Buffer.byteLength(text), afterBytes = Buffer.byteLength(after);
  if (!manifest && afterBytes <= FEED_PART_BYTES) {
    await writeFile(new URL(`${base}.json`, dir), after);
    return { before: beforeBytes, after: afterBytes, parts: 0 };
  }
  const contents = splitUtf8(after);
  const parts = contents.map((_, index) => `${base}.part-${String(index).padStart(3, '0')}.json`);
  await Promise.all(parts.map((name, index) => writeFile(new URL(name, dir), contents[index])));
  await writeFile(manifestUrl || new URL(`${base}.parts.json`, dir), JSON.stringify({
    ...manifest,
    file: `${base}.json`, parts, bytes: afterBytes, events: slim.events.length,
    sha256: createHash('sha256').update(after).digest('hex'),
    note: 'Parts are ordered raw UTF-8 slices of one JSON document, each at most 200 KiB. Join every part before parsing.',
  }, null, 2) + '\n');
  // Do not ship stale fallback data or leftover parts after a smaller rebuild.
  await Promise.all([`${base}.json`, ...(manifest?.parts || []).filter(name => !parts.includes(name))]
    .map(name => rm(new URL(name, dir), { force: true })));
  return { before: beforeBytes, after: afterBytes, parts: parts.length };
}
