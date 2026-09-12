// Startup cost inside the Tech Week layer that the original file pays without
// needing to. Same exact-match rule as every other patch: a moved target fails
// the build rather than silently shipping the slow path.
export function wireLayerPerformance(html) {
  const once = (from, to) => {
    if (html.split(from).length !== 2) throw new Error('Layer performance patch target changed: ' + from.slice(0, 90));
    html = html.replace(from, to);
  };

  // Every date the layer prints goes through dtf(), which built a fresh
  // Intl.DateTimeFormat per call. Constructing one costs about a millisecond,
  // and a feed refresh asks for the same half-dozen formats thousands of times
  // (normalizeEvent, the list, the chips, the clock): it was the single largest
  // JavaScript cost between "downtown ready" and the player entering the city.
  // The options are a handful of literals, so the formatters are cached by key.
  once("  const dtf = (opts) => new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: CFG.tz }, opts));",
    `  const dtfCache = new Map();
  const dtf = (opts) => {
    const key = JSON.stringify(opts);
    let format = dtfCache.get(key);
    if (!format) { format = new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: CFG.tz }, opts)); dtfCache.set(key, format); }
    return format;
  };`);
  return html;
}
