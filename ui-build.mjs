// Keep the imported game's event bindings intact while simplifying its HUD.
// These styles ship in the document head so removed controls never flash on load.
import { DISCORD_INVITE } from './tuning-build.mjs';

// Shared by the base controls and the capture-phase event-navigation shortcuts.
// A camera/card button may retain focus after a click; typing movement keys
// there should return to the bird, while editing and native activation stay UI.
function flightKeyBlocked(event) {
  const key = event.key.toLowerCase();
  if (event.defaultPrevented || event.isComposing || event.metaKey || event.altKey ||
    (event.ctrlKey && key !== 'control')) return true;
  if (document.querySelector('dialog[open], #tw-modal:not([hidden]), [aria-modal="true"]:not([hidden])')) return true;
  const path = event.composedPath ? event.composedPath() : [event.target];
  if (path.some(node => node instanceof HTMLElement && (node.isContentEditable ||
    node.closest('input,textarea,select,[role="dialog"],[role="menu"],[role="tablist"],#sfnet')))) return true;
  return (key === ' ' || key === 'spacebar' || key === 'enter') && path.some(node =>
    node instanceof HTMLElement && node.closest('button,a,[role="button"]'));
}

export function wireGameUi(html) {
  const replaceOnce = (from, to) => {
    if (html.split(from).length !== 2) throw new Error('Game UI patch target changed: ' + from.slice(0, 80));
    html = html.replace(from, to);
  };

  replaceOnce('this.onKeyDown=e=>{if(e.key.toLowerCase()===',
    `this.flightKeyBlocked=${flightKeyBlocked.toString()};this.onKeyDown=e=>{if(this.flightKeyBlocked(e))return;if(e.key.toLowerCase()===`);
  replaceOnce('let a=e.key.toLowerCase(),n=e.target;if(n instanceof HTMLElement&&n.closest("button, a, input, textarea, select"))return;if(this.freeFlightEnabled)',
    'let a=e.key.toLowerCase();if(this.freeFlightEnabled)');
  replaceOnce('e.preventDefault(),this.flightInput[o]=!0;return',
    'e.preventDefault(),this.focusScene(),this.flightInput[o]=!0;return');
  replaceOnce("if (e.target instanceof HTMLElement && e.target.closest('input,textarea,select')) return; const k = e.key.toLowerCase();",
    "if (c?.flightKeyBlocked?.(e)) return; const k = e.key.toLowerCase();");
  // Flight is now the only game mode. Escape may dismiss UI or stop a route,
  // but must not enter the old explore mode whose launch control is hidden.
  replaceOnce('J.key==="Escape"&&(m||v?(h(!1),y(!1)):d?p(!1):c&&f(!1))',
    'J.key==="Escape"&&(m||v?(h(!1),y(!1)):(window.TW?.nav?.stop(true),t.current?.clearFlightInput(),c&&f(!1)))');

  // Public-address status should never stamp over the event artwork.
  replaceOnce(
    "    if (!ev.claimed) { g.save(); g.translate(cw / 2, H * 0.62); g.rotate(-0.2); g.strokeStyle = 'rgba(246,236,216,.9)'; g.lineWidth = 5; g.strokeRect(-150, -28, 300, 56); g.fillStyle = 'rgba(246,236,216,.9)'; g.font = '700 30px ui-monospace, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('UNCLAIMED', 0, 1); g.restore(); }\n",
    '',
  );

  // Keep the camera button in the DOM for the imported game's bindings; its
  // visible shortcut is removed below. Shift and V still work from the keyboard.
  replaceOnce('Space/C Up/Down · Shift Boost · U Hide UI', 'Space/C Up/Down · U Hide UI');
  replaceOnce('Space / C Up/Down \\xB7 Shift Boost \\xB7 Drag to look around', 'Space / C Up/Down \\xB7 Drag to look around');

  replaceOnce(
    '<div class="tw-band" style="background:${cat.color}"><span>${esc(fmt.when(ev))}</span><span>${esc(cat.label)}</span></div>\n      <button type="button" class="tw-x" data-act="close" aria-label="Close">×</button>',
    `<div class="tw-card-heading" style="background:\${cat.color}"><div class="tw-band"><span>\${esc(fmt.when(ev))}</span><span>\${esc(cat.label)}</span></div><button type="button" class="tw-x" data-act="close" aria-label="Close"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button></div>`,
  );

  replaceOnce(": ev.wantsVehicle ? 'Fly to the ship' : 'Fly there'", ": 'Fly there'");
  // Keep a single in-game navigation action and a direct venue-help link.
  replaceOnce("(() => {\n    const hasLocation = Boolean(ev.address || ev.venue || ev.locationText || ev.neighborhood || (typeof ev.lat === 'number' && Number.isFinite(ev.lat) && typeof ev.lng === 'number' && Number.isFinite(ev.lng)));\n    const navBtn = '<button type=\"button\" data-act=\"navigate\" class=\"tw-btn\" title=\"' + (hasLocation ? 'Open Google Maps' : 'No address found. Opening map search.') + '\">Navigate ↗</button>';\n    const claimBtn = ev.claimed ? '' : `<a class=\"tw-btn\" href=\"${" + JSON.stringify(DISCORD_INVITE) + "}\" target=\"_blank\" rel=\"noopener\" title=\"Ask in the Discord — someone there usually knows the venue\">Find the venue ↗</a>`;\n    return navBtn + claimBtn;\n  })()", "ev.claimed && !ev.doorWithheld ? '' : `<a class=\"tw-btn\" href=\"" + DISCORD_INVITE + "\" target=\"_blank\" rel=\"noopener\" title=\"Ask in the Discord — someone there usually knows the venue\">Find the venue ↗</a>`");
  replaceOnce("        <a class=\"tw-btn\" href=\"${esc(gcalUrl(ev))}\" target=\"_blank\" rel=\"noopener\" title=\"Google Calendar\">Calendar ↗</a>\n", '');

  replaceOnce('</head>', `<style id="tw-game-ui">
html .scene-host canvas:focus-visible { outline: none; }
.tw-masthead, #tw-pause, #tw-who, #tw-who-list, #tw-discord,
.tw-sortrow, #tw-view, #tw-cruise, .gull-telemetry, .mode-dock, .view-dock, .landmark-card { display: none !important; }

.city-shell {
  --tw-hud-inset: 24px;
  --tw-panel-height: max(min(360px, calc(100dvh - 124px)), calc(100dvh - 244px));
  --tw-panel-width: min(322px, calc(100vw - 48px));
}
.city-shell .tw-card {
  left: var(--tw-hud-inset); bottom: var(--tw-hud-inset); width: min(352px, calc(100vw - 48px));
  max-height: calc(100dvh - 48px); overflow-y: auto;
}
.tw-card-heading { display: grid; grid-template-columns: minmax(0, 1fr) 36px; align-items: stretch; position: sticky; top: 0; z-index: 1; }
.tw-card-heading .tw-band { align-items: center; gap: 10px; padding: 9px 12px; min-height: 36px; box-sizing: border-box; }
.tw-card-heading .tw-band span { min-width: 0; line-height: 1.3; }
.tw-card-heading .tw-band span:last-child { text-align: right; }
.tw-card-heading .tw-x { position: static; display: grid; place-items: center; width: 36px; min-height: 36px; padding: 0; }
.tw-card-heading .tw-x:hover { background: #0002; }
.tw-card-heading .tw-x:focus-visible { outline: 2px solid currentColor; outline-offset: -4px; }

/* Both event surfaces share one bottom inset. The address search stays above
   the right panel without moving React-owned nodes or measuring every frame. */
.city-shell .tw-panel {
  top: auto !important; right: var(--tw-hud-inset); bottom: var(--tw-hud-inset);
  width: var(--tw-panel-width); height: var(--tw-panel-height);
  max-height: var(--tw-panel-height) !important; box-sizing: border-box;
}
.city-shell .address-search {
  top: auto; right: var(--tw-hud-inset);
  bottom: calc(var(--tw-hud-inset) + var(--tw-panel-height) + 10px);
  width: var(--tw-panel-width); box-sizing: border-box;
}
.city-shell .tw-panel .tw-tabs { flex-shrink: 0; }
.city-shell .tw-panel .tw-pane.active { flex: 1; }
.city-shell .corner-tools {
  top: var(--tw-hud-inset); right: var(--tw-hud-inset); bottom: auto;
  grid-auto-flow: column;
}
@media (max-width: 760px) {
  .city-shell { --tw-hud-inset: 14px; --tw-panel-width: min(322px, calc(100vw - 28px)); }
  .city-shell .tw-card { width: calc(100vw - 28px); max-height: calc(100dvh - 28px); }
  .city-shell .tw-panel.open, .city-shell:has(.tw-panel.open) .address-search { z-index: 10; }
  .city-shell .corner-tools { right: 110px; }
  .city-shell.is-flying .corner-tools { opacity: 1; pointer-events: auto; }
  /* On phones the existing Events toggle reveals the bottom-aligned panel. */
  .city-shell:not(:has(.tw-panel.open)) .address-search { top: 66px; bottom: auto; }
}
</style>
</head>`);
  return html;
}
