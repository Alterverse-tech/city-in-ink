// The saved snapshot in data/ is the archive: every field, plus per-field
// provenance (fieldSources) and crawl bookkeeping. The game reads a fraction of
// it, and the rest is dead weight on every player's first load — provenance
// alone is half the file. Builds serve this slimmed copy; data/ stays complete.
import { readFile, writeFile } from 'node:fs/promises';
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

// Never cut between a surrogate pair: each part is written and read back as its
// own UTF-8 document, so a split pair would decode as two replacement chars.
const safeSplit = (text, index) => {
  if (index <= 0 || index >= text.length) return index;
  const code = text.charCodeAt(index);
  return (code >= 0xDC00 && code <= 0xDFFF) ? index - 1 : index;
};

// Slim a copied snapshot in place, keeping whatever form it arrived in. The
// slimmed document is strictly smaller than the original, so re-splitting it
// across the same parts leaves every part under the limit that forced the split.
export async function slimFeedParts(dir, base) {
  const { text, manifest, manifestUrl } = await readFeedText(dir, base);
  const after = JSON.stringify(slimFeed(JSON.parse(text)));
  if (!manifest) {
    await writeFile(new URL(`${base}.json`, dir), after);
    return { before: text.length, after: after.length, parts: 0 };
  }
  const count = manifest.parts.length;
  const stride = Math.ceil(after.length / count);
  let cut = 0;
  for (const [i, name] of manifest.parts.entries()) {
    const end = i === count - 1 ? after.length : safeSplit(after, (i + 1) * stride);
    await writeFile(new URL(name, dir), after.slice(cut, end));
    cut = end;
  }
  await writeFile(manifestUrl, JSON.stringify({
    ...manifest,
    bytes: Buffer.byteLength(after),
    sha256: createHash('sha256').update(after).digest('hex'),
  }, null, 2) + '\n');
  return { before: text.length, after: after.length, parts: count };
}
