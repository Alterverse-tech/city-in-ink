// Integrate at the original closure so clicks, Escape, feed refreshes and
// asynchronous poster/RSVP callbacks all agree about the displayed event.
export function wirePersistentEventCards(html) {
  const once = (from, to) => {
    if (html.split(from).length !== 2) throw new Error('Event card patch target changed: ' + from.slice(0, 90));
    html = html.replace(from, to);
  };
  once('  function select(ev, opts) {\n    state.selected = ev;',
    `  function select(ev, opts) {
    ev = TW.eventCards ? TW.eventCards.resolve(ev) : ev;
    TW.eventCards?.selected(ev, opts?.cardSource || 'manual');
    state.selected = ev;`);
  once("const card = $('#tw-card'); if (!ev) { card.hidden = true; return; }",
    `const card = $('#tw-card');
    if (TW.eventCards) {
      if (ev && state.selected && ev.id !== state.selected.id) return;
      const current = TW.eventCards.resolve(state.selected || ev);
      if (current !== state.selected) { select(current, { cardSource: 'restore' }); return; }
      ev = current;
    }
    if (!ev) { card.hidden = true; return; }
    card.dataset.eventId = ev.id;
    card.classList.toggle('tw-featured-card', !!ev.featured);`);
  once('if (changed) { renderList(); renderBoard(); if (state.selected) renderCard(state.selected);',
    'if (changed) { renderList(); renderBoard(); if (TW.eventCards) TW.eventCards.restore(); else if (state.selected) renderCard(state.selected);');
  once('state.ready = true; updateClock();',
    'TW.eventCards = window.__sfInstallEventCards?.(TW, c);\n    state.ready = true; updateClock();\n    TW.eventCards?.restore();');
  once('</head>', `<style id="tw-persistent-card">
.tw-featured-card .tw-card-heading { grid-template-columns: minmax(0, 1fr); }
.tw-featured-card .tw-x { display: none; }
.city-shell.ui-hidden #tw-card { visibility: visible !important; pointer-events: auto !important; }
</style>\n</head>`);
  return html;
}
