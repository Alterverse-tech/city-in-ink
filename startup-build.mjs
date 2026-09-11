// Keep the original gameplay source unchanged. A missing or slow optional model
// must not sit between the city being ready and the player entering it.
function scheduleOptionalAirship() {
  let request, stopped = false;
  const cancel = () => { stopped = true; request?.abort(); };
  addEventListener('pagehide', cancel, { once: true });
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (stopped) return;
    request = new AbortController();
    const timer = setTimeout(() => request.abort(), 30000);
    void (async () => {
      let applied = false;
      try {
        const model = await loadGLB(CFG.airshipModel, { signal: request.signal });
        if (request.signal.aborted) return;
        state.shipModel = model; applied = true;
        // Existing ships were deliberately built with their procedural fallback.
        // Rebuild only after successful loading, without changing player state.
        buildWorld();
        log('airship model loaded from', CFG.airshipModel);
      } catch (error) {
        state.shipModel = null;
        if (applied) {
          try { buildWorld(); }
          catch (fallbackError) { console.warn('[TW] optional airship fallback failed', fallbackError); }
        }
      } finally {
        clearTimeout(timer);
        removeEventListener('pagehide', cancel);
      }
    })();
  }));
}

export function wireStartup(html) {
  const once = (from, to) => {
    if (html.split(from).length !== 2) throw new Error('Startup patch target changed: ' + from.slice(0, 80));
    html = html.replace(from, to);
  };
  once("    try { state.shipModel = await loadGLB(CFG.airshipModel); log('airship model loaded from', CFG.airshipModel); } catch (e) { state.shipModel = null; }",
    '    state.shipModel = null;');
  once('  async function loadGLB(url) {\n    const r = await fetch(url);',
    "  async function loadGLB(url, { signal } = {}) {\n    const r = await fetch(url, { signal, priority: 'low' });");
  once('  /* ---------------------------------------------------------------- boot */',
    scheduleOptionalAirship.toString() + '\n\n  /* ---------------------------------------------------------------- boot */');
  // Scheduling after ready prevents both the request and model decoding from
  // competing with the first visible scene. Baseline events retain their existing
  // short bounded read; the larger feed already refreshes in the background.
  once("    // Player entry happens before ready; no name or avatar chooser interrupts it.",
    "    scheduleOptionalAirship();");
  return html;
}
