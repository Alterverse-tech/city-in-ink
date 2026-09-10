// Keep the imported game's event bindings intact while simplifying its HUD.
// These styles ship in the document head so removed controls never flash on load.
export function wireGameUi(html) {
  const replaceOnce = (from, to) => {
    if (html.split(from).length !== 2) throw new Error('Game UI patch target changed: ' + from.slice(0, 80));
    html = html.replace(from, to);
  };

  replaceOnce(
    '<button type="button" class="tw-view" id="tw-view">Beak cam · V</button>',
    `<div class="tw-flight-shortcuts" role="group" aria-label="Flight shortcuts">
        <span class="tw-boost-hint"><kbd>Shift</kbd><span>Boost</span></span>
        <button type="button" class="tw-view" id="tw-view" title="Switch camera view (V)">Beak cam · V</button>
      </div>`,
  );
  // Shift is now beside the camera shortcut; keep the other movement instructions.
  replaceOnce('Space/C Up/Down · Shift Boost · U Hide UI', 'Space/C Up/Down · U Hide UI');
  replaceOnce('Space / C Up/Down \\xB7 Shift Boost \\xB7 Drag to look around', 'Space / C Up/Down \\xB7 Drag to look around');

  replaceOnce(
    '<div class="tw-band" style="background:${cat.color}"><span>${esc(fmt.when(ev))}</span><span>${esc(cat.label)}</span></div>\n      <button type="button" class="tw-x" data-act="close" aria-label="Close">×</button>',
    `<div class="tw-card-heading" style="background:\${cat.color}"><div class="tw-band"><span>\${esc(fmt.when(ev))}</span><span>\${esc(cat.label)}</span></div><button type="button" class="tw-x" data-act="close" aria-label="Close"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button></div>`,
  );

  replaceOnce(": ev.wantsVehicle ? 'Fly to the ship' : 'Fly there'", ": 'Fly there'");
  // Keep a single in-game navigation action and a direct venue-help link.
  replaceOnce("(() => {\n    const hasLocation = Boolean(ev.address || ev.venue || ev.locationText || ev.neighborhood || (typeof ev.lat === 'number' && Number.isFinite(ev.lat) && typeof ev.lng === 'number' && Number.isFinite(ev.lng)));\n    const navBtn = '<button type=\"button\" data-act=\"navigate\" class=\"tw-btn\" title=\"' + (hasLocation ? 'Open Google Maps' : 'No address found. Opening map search.') + '\">Navigate ↗</button>';\n    const claimBtn = ev.claimed ? '' : `<a class=\"tw-btn\" href=\"${\"https://discord.gg/GPPgjHE7GF\"}\" target=\"_blank\" rel=\"noopener\" title=\"Ask in the Discord — someone there usually knows the venue\">Find the venue ↗</a>`;\n    return navBtn + claimBtn;\n  })()", "ev.claimed ? '' : `<a class=\"tw-btn\" href=\"https://discord.gg/TDGbD8ENAG\" target=\"_blank\" rel=\"noopener\" title=\"Ask in the Discord — someone there usually knows the venue\">Find the venue ↗</a>`");
  replaceOnce("        <a class=\"tw-btn\" href=\"${esc(gcalUrl(ev))}\" target=\"_blank\" rel=\"noopener\" title=\"Google Calendar\">Calendar ↗</a>\n", '');

  replaceOnce('</head>', `<style id="tw-game-ui">
html .scene-host canvas:focus-visible { outline: none; }
.tw-masthead, #tw-pause, #tw-who, #tw-who-list, #tw-discord,
.tw-sortrow, #tw-cruise, .gull-telemetry, .mode-dock, .view-dock, .landmark-card { display: none !important; }

.city-shell .tw-card {
  left: 24px; bottom: 24px; width: min(352px, calc(100vw - 48px));
  max-height: calc(100dvh - 48px); overflow-y: auto;
}
.tw-card-heading { display: grid; grid-template-columns: minmax(0, 1fr) 36px; align-items: stretch; position: sticky; top: 0; z-index: 1; }
.tw-card-heading .tw-band { align-items: center; gap: 10px; padding: 9px 12px; min-height: 36px; box-sizing: border-box; }
.tw-card-heading .tw-band span { min-width: 0; line-height: 1.3; }
.tw-card-heading .tw-band span:last-child { text-align: right; }
.tw-card-heading .tw-x { position: static; display: grid; place-items: center; width: 36px; min-height: 36px; padding: 0; }
.tw-card-heading .tw-x:hover { background: #0002; }
.tw-card-heading .tw-x:focus-visible { outline: 2px solid currentColor; outline-offset: -4px; }

.tw-flight-shortcuts {
  display: none; position: absolute; top: 22px; right: 28px; z-index: 9;
  align-items: stretch; gap: 8px;
}
.city-shell.is-flying .tw-flight-shortcuts { display: flex; }
.tw-flight-shortcuts .tw-view {
  position: static; margin: 0; min-height: 32px;
}
.tw-boost-hint {
  display: inline-flex; align-items: center; gap: 8px; padding: 8px 11px;
  border: 1px solid var(--line); background: var(--panel); color: var(--ink);
  backdrop-filter: blur(12px); font: 700 10px/1 ui-monospace, monospace;
  letter-spacing: .08em; text-transform: uppercase;
}
.tw-boost-hint kbd { font: inherit; }
.tw-boost-hint > span { opacity: .7; }
.city-shell .tw-panel { top: 124px !important; max-height: calc(100vh - 244px) !important; }
@media (max-width: 760px) {
  .city-shell .tw-card { left: 14px; bottom: 14px; width: calc(100vw - 28px); max-height: calc(100dvh - 28px); }
  .tw-flight-shortcuts { top: auto; right: 14px; bottom: 220px; }
  .city-shell .tw-panel { top: 120px !important; max-height: calc(100dvh - 340px) !important; }
}
@media (pointer: coarse) {
  .tw-boost-hint { display: none; }
  .tw-flight-shortcuts .tw-view { min-height: 44px; }
}
</style>
</head>`);
  return html;
}
