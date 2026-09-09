// The saved snapshot in data/ is the archive: every field, plus per-field
// provenance (fieldSources) and crawl bookkeeping. The game reads a fraction of
// it, and the rest is dead weight on every player's first load — provenance
// alone is half the file. Builds serve this slimmed copy; data/ stays complete.
import { readFile, writeFile } from 'node:fs/promises';

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
