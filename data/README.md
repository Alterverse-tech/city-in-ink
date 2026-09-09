# Initial Tech Week public snapshot

`tech-week-first.json` holds 48 independently read public calendar entries for
October 5, 2026, from 00:00 through 12:30 Pacific time. It is a **partial first
snapshot**, not the complete week and not the result of a successful scheduled
scraper run. Retrieval time and coverage are recorded in the JSON.

The existing local Node backend serves this file from disk. `events-sync.js`
uses it only while `/events.json` has no successful official cache. Any successful
backend cache takes priority. The snapshot is not deleted on scraper errors and
does not require restarting the server or changing the ongoing updater.

31 entries expose a neighborhood. Four registration destinations were confirmed
from official link redirects; other destinations remain unknown. No precise
coordinates, attendee counts, capacity, speakers, cover images or end times were
invented. Missing locations use the game's existing harbor placeholders. The
original game's default duration remains a presentation fallback, not a sourced
end time; do not treat calendar exports as verified event durations yet.

Source: https://www.tech-week.com/calendar/sf
