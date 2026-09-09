import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const UPDATE_INTERVAL_MS = 30 * 60 * 1000;

// One updater per server, never one scrape per browser. Failed refreshes keep
// the last complete feed; retry deadlines survive local server restarts.
export async function createEventCache({ file, fetchEvents, now = Date.now, onUpdate = () => {} }) {
  let saved = { events: [], fetchedAt: null, checkedAt: null, nextAttemptAt: null, error: null };
  try {
    const disk = JSON.parse(await readFile(file, 'utf8'));
    if (disk.version === 1 && Array.isArray(disk.events)) saved = disk;
  } catch { /* A missing or invalid cache is not official event data. */ }
  let timer, inFlight, stopped = false;
  const iso = value => new Date(value).toISOString();
  function snapshot() {
    return { source: 'https://www.tech-week.com/calendar/sf', events: saved.events,
      coverage: saved.coverage, publicSnapshot: saved.publicSnapshot,
      fetchedAt: saved.fetchedAt, checkedAt: saved.checkedAt, nextAttemptAt: saved.nextAttemptAt,
      updateIntervalMinutes: 30,
      status: !saved.fetchedAt ? 'unavailable' : saved.error ? 'stale' : 'fresh',
      error: saved.error,
    };
  }
  async function persist() {
    await mkdir(dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify({ version: 1, ...saved }), { mode: 0o600 });
    await rename(temporary, file);
  }
  function schedule() {
    clearTimeout(timer);
    if (stopped) return;
    const due = Date.parse(saved.nextAttemptAt) || now();
    timer = setTimeout(() => void refresh(), Math.min(2147483647, Math.max(0, due - now())));
    timer.unref?.();
  }
  async function perform() {
    if (stopped || now() < (Date.parse(saved.nextAttemptAt) || 0)) return snapshot();
    saved = { ...saved, checkedAt: iso(now()), nextAttemptAt: iso(now() + UPDATE_INTERVAL_MS) };
    try {
      // Write the deadline before the request, so restarting cannot hammer a
      // source that has just returned a challenge or rate limit.
      await persist();
      const result = await fetchEvents();
      if (!result || !Array.isArray(result.events) || !result.events.length) {
        throw new Error('The source returned no verified events; the previous cache was retained.');
      }
      const ids = new Set();
      for (const event of result.events) {
        if (!event.id || !event.title || !Number.isFinite(Date.parse(event.start)) || ids.has(event.id)) {
          throw new Error('Event data failed validation; the previous cache was retained.');
        }
        ids.add(event.id);
      }
      const next = { ...saved, events: result.events, coverage: result.coverage || { complete: false }, publicSnapshot: true, fetchedAt: iso(now()), error: null };
      const previous = saved;
      saved = next;
      try { await persist(); } catch (error) { saved = previous; throw error; }
    } catch (error) {
      const retryAt = Number(error.retryAt);
      saved = { ...saved, error: String(error.message || 'Refresh failed').slice(0, 240),
        nextAttemptAt: iso(Math.max(Date.parse(saved.nextAttemptAt), Number.isFinite(retryAt) ? retryAt : 0)) };
      await persist().catch(() => {});
    }
    onUpdate(snapshot());
    return snapshot();
  }
  function refresh() {
    if (inFlight) return inFlight;
    inFlight = perform().finally(() => { inFlight = null; schedule(); });
    return inFlight;
  }
  return { snapshot, refresh,
    start() { stopped = false; schedule(); },
    stop() { stopped = true; clearTimeout(timer); },
  };
}
