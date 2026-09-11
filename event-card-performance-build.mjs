// Changing the selected event is a highlight update, not a feed refresh. Keep
// the list's existing rows and do not JPEG-encode a canvas on the render thread.
export function wireEventCardPerformance(html) {
  const once = (from, to) => {
    if (html.split(from).length !== 2) throw new Error('Event card performance patch target changed: ' + from.slice(0, 90));
    html = html.replace(from, to);
  };
  once('  function renderList() {', '  const eventListRows = new Map();\n  function renderList() {');
  once("    $('#tw-list').querySelectorAll('li[data-id]').forEach((li) => li.addEventListener('click', () => { const ev = state.events.find((e) => e.id === li.dataset.id); select(ev, { look: !c.freeFlightEnabled }); }));",
    `    eventListRows.clear();
    $('#tw-list').querySelectorAll('li[data-id]').forEach((li) => {
      eventListRows.set(li.dataset.id, li);
      li.addEventListener('click', () => { const ev = state.events.find((e) => e.id === li.dataset.id); select(ev, { look: !c.freeFlightEnabled }); });
    });`);
  once('    state.selected = ev; document.documentElement.classList.toggle(\'tw-has-selection\', !!ev);',
    '    const previous = state.selected;\n    state.selected = ev; document.documentElement.classList.toggle(\'tw-has-selection\', !!ev);');
  once("    for (const vg of state.venues) if (vg.el) vg.el.querySelectorAll('[data-id]').forEach((b) => b.classList.toggle('active', !!ev && b.dataset.id === ev.id));\n    for (const e of state.events) refreshChip(e); renderList(); renderCard(ev);",
    `    for (const vg of new Set([previous?.venueChip, ev?.venueChip])) {
      if (vg?.el) vg.el.querySelectorAll('[data-id]').forEach((b) => b.classList.toggle('active', !!ev && b.dataset.id === ev.id));
    }
    if (previous) { previous.chip?.classList.toggle('active', false); eventListRows.get(previous.id)?.classList.toggle('active', false); }
    if (ev) { ev.chip?.classList.toggle('active', true); eventListRows.get(ev.id)?.classList.toggle('active', true); }
    renderCard(ev);`);

  once("const posterUrl = (ev.posterCanvas || drawPoster(ev)).toDataURL('image/jpeg', 0.82);",
    "const coverUrl = ev.coverUrl || (!window.__SF_HOST_READY__ && !ev.coverFailed ? ev.image : '');");
  once("    const im = new Image(); im.crossOrigin = 'anonymous';",
    "    const im = new Image(); im.crossOrigin = 'anonymous'; im.decoding = 'async'; ev.coverPending = true;");
  once('    im.onload = () => { ev.coverImg = im; posterTexture(ev); if (state.selected === ev) renderCard(ev); };',
    `    im.onload = async () => {
      try { if (im.decode) await im.decode(); } catch { ev.coverPending = false; ev.coverFailed = true; return; }
      ev.coverPending = false; ev.coverImg = im;
      posterTexture(ev); if (state.selected === ev) renderCard(ev);
    };`);
  once('    card.innerHTML = `\n      <div class="tw-card-heading"',
    '    const markup = `\n      <div class="tw-card-heading"');
  once('<img class="tw-poster" src="${ev.coverUrl ? esc(ev.coverUrl) : !window.__SF_HOST_READY__ && ev.image ? esc(ev.image) : posterUrl}" ${ev.image ? `onerror="this.onerror=null;this.src=\'${posterUrl}\'"` : \'\'} alt="">',
    '${coverUrl ? `<img class="tw-poster" src="${esc(coverUrl)}" decoding="async" width="800" height="450" alt="">` : \'<canvas class="tw-poster" width="800" height="450" aria-hidden="true"></canvas>\'}');
  once("      ${cob ? editorHtml(ev) : ''}`;\n  }\n  function editorHtml(ev)",
    `      \${cob ? editorHtml(ev) : ''}\`;
    // Cover callbacks and unchanged feed polls often request the same card.
    // Retaining it also preserves scroll position and keyboard focus.
    if (card.__eventMarkup === markup) return;
    card.__eventMarkup = markup;
    card.innerHTML = markup;
    const poster = card.querySelector('.tw-poster');
    if (!coverUrl) drawCardFallback(ev, poster);
    else poster.addEventListener('error', () => {
      // An image from a previously selected card must not replace this one.
      if (!card.contains(poster) || state.selected?.id !== ev.id) return;
      const fallback = document.createElement('canvas');
      fallback.className = 'tw-poster'; fallback.setAttribute('aria-hidden', 'true');
      drawCardFallback(ev, fallback); poster.replaceWith(fallback);
    }, { once: true });
  }
  function drawCardFallback(ev, canvas) {
    // Canvas-to-canvas copies need neither synchronous JPEG compression nor a
    // second image decode. Real covers never draw the generated poster here.
    const source = ev.posterCanvas || drawPoster(ev);
    canvas.width = source.width; canvas.height = source.height;
    canvas.getContext('2d').drawImage(source, 0, 0);
  }
  function editorHtml(ev)`);
  once('</head>', '<style id="tw-card-media-sizing">.tw-card .tw-poster { height: auto; }</style>\n</head>');
  return html;
}
