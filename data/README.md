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

## Crawl history

`tech-week-fetch-history.json` is the append-only public log used by the data
report. Each record includes the UTC start/completion time, the displayed
Beijing-time timestamp, collection stage, result, counts and any error or
retention note. The current log includes the 48-event first snapshot, the
1,546-event paginated inventory, public-detail enrichment, and the latest
30-minute refresh attempt blocked by the site's HTTP 429/Vercel verification.

When a new snapshot is collected, append its result to this file and run
`node build-data-report.mjs`; the report embeds the log and also links to the
standalone JSON. A failed or blocked attempt must be recorded with its reason
and must not be represented as an empty successful snapshot.

## Registration-page resolution and coordinates

`tech-week-resolved-links.json` maps each calendar ID to the public registration
page that the official `/go/event/` redirect leads to. Links are followed one at
a time through the local Firecrawl service (`scripts/resolve-go-links.mjs`); a
restricted response is recorded on the entry, pauses the run for a minute and is
never retried automatically (`--retry-failed` reruns unresolved entries,
`--skip-known` skips rows whose Partiful page was already read). The Partiful
page reached through the redirect is stored in the gitignored `.cache` and read
by `scripts/enrich-tech-week.mjs`, so the enriched snapshot gains end times,
excerpts, statuses, visible counts, capacity and public locations for those
events. Previously exported event IDs are kept stable across rebuilds.

`tech-week-geocode.json` holds OpenStreetMap Nominatim results for publicly
displayed street addresses only (`scripts/geocode-public-addresses.mjs`, one
request per second). Coarse matches such as a city or road centre are not used.
Coordinates are approximate geocodes of the public address, not official venue
coordinates; events without a public street address keep no coordinates.

## Automated refresh

`scripts/refresh-tech-week.sh` runs the whole cycle in order: calendar pages,
official redirect links, cache pruning, merge, geocoding, verification, one
fetch-history record, dashboard rebuild and publication. It refuses to start
when the local Firecrawl service is unreachable, so a local prerequisite being
down is never logged as a site-wide block. A run that collects nothing new
appends no history record; a failed calendar crawl is recorded as blocked and
the previously published snapshot is kept.

```
sh scripts/refresh-tech-week.sh               # collect, rebuild, publish
sh scripts/refresh-tech-week.sh --no-publish  # local rebuild only
sh scripts/refresh-tech-week.sh --links-only  # skip the calendar page crawl
```

`scripts/cron-refresh.sh` is the scheduled-run wrapper. It starts Colima and the
Firecrawl containers if needed, waits for the service, then runs the refresh and
appends to `~/Library/Logs/tech-week-refresh.log`. It is installed in the user
crontab to run daily at 09:00 local time. `scripts/publish-data-report.sh`
uploads the built page and the public JSON files to the studio host through a
staging directory, keeping the previous page in `.previous/`.

The individual steps, if you need to run one on its own:

```
node scripts/prune-tech-week-cache.mjs
node scripts/enrich-tech-week.mjs
node scripts/geocode-public-addresses.mjs
node scripts/enrich-tech-week.mjs
node scripts/check-tech-week-data.mjs
node scripts/record-fetch-history.mjs '{"stage":"...","status":"success",...}'
node build-data-report.mjs
```
