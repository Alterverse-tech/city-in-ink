// Narrow patches to the original single-file game; the supplied file stays intact.
export function wireEventFeed(html) {
  function once(from, to) {
    if (html.split(from).length !== 2) throw new Error('Event feed patch target changed: ' + from.slice(0, 70));
    html = html.replace(from, to);
  }
  const start = html.indexOf('    async events() {');
  const end = html.indexOf('    async rsvp(ev, user)', start);
  if (start < 0 || end < start) throw new Error('Original event backend not found');
  html = html.slice(0, start) + '    async events() { return window.__sfEventFeed.read(SEED); },\n' + html.slice(end);
  once("setInterval(() => refreshEvents().catch(() => {}), 15 * 60 * 1000)",
    "setInterval(() => refreshEvents().catch(() => {}), 60 * 1000)");
  once('const data = await backend.events(); state.source = data.source; const all = data.list.map(normalizeEvent);',
    'const data = await backend.events(); state.officialFeed = !!data.official; state.source = data.source; const all = data.list.map(normalizeEvent);');
  once('let changed = false, structural = false;\n    for (const raw of data.list)',
    'let changed = false, structural = false;\n    if (data.official && !state.officialFeed) { nav.stop(true); state.events = []; state.past = []; state.selected = null; state.officialFeed = true; changed = structural = true; }\n    for (const raw of data.list)');
  // New events have no world position yet. Ranking may also promote a quiet
  // event onto the map, so decide placement before building spatial metadata.
  // placeEvents() already calls computeMeta(); rebuild a structural change once.
  once('  function computeMeta() {', '  function computeMeta(rankOnly = false) {');
  once('    if (state.events.length) { const xs = state.events.map((e) => e.world.x), zs = state.events.map((e) => e.world.z);',
    '    if (rankOnly) return;\n    if (state.events.length) { const xs = state.events.map((e) => e.world.x), zs = state.events.map((e) => e.world.z);');
  once('    if (changed) { computeMeta(); if (state.events.some((e) => e.wantsVehicle !== !!e.hasVehicle)) structural = true; }\n    if (structural) { placeEvents(); buildWorld(); } else if (changed) for (const ev of state.events) { posterTexture(ev); refreshChip(ev); }',
    `    if (changed && !structural) {
      computeMeta(true);
      if (state.events.some((e) => e.wantsVehicle !== !!e.hasVehicle || !!e.onMap !== !!e.world)) structural = true;
    }
    if (structural) { placeEvents(); buildWorld(); }
    else if (changed) { computeMeta(); for (const ev of state.events) { posterTexture(ev); refreshChip(ev); } }`);
  once('  function regStatus(ev) {', `  const rsvpTotalDisplay = list => list.some(e => e.rsvp == null) ? '—' : list.reduce((sum, e) => sum + rsvpCount(e), 0);
  const rsvpDisplay = ev => ev.flagship ? rsvpTotalDisplay(state.events) : ev.rsvp == null ? '—' : rsvpCount(ev);
  function regStatus(ev) {
    if (ev.status === 'unknown') return { key: 'unknown', left: null, label: 'View registration', cls: 'warn', open: true, short: '', leftText: '' };`);
  // Unknown attendance is not zero. Keep numeric counts for internal geometry,
  // but never present invented numbers as official RSVPs or available seats.
  html = html.replaceAll('${rsvpCount(ev)}', '${rsvpDisplay(ev)}')
    .replaceAll('${rsvpCount(e)}', '${rsvpDisplay(e)}')
    .replaceAll('<b>${n}</b> RSVPs', '<b>${rsvpDisplay(ev)}</b> RSVPs')
    .replaceAll('${vg.members.reduce((a, e) => a + rsvpCount(e), 0)} RSVPs', '${rsvpTotalDisplay(vg.members)} RSVPs')
    .replaceAll('${r.rsvps} RSVPs', '${rsvpTotalDisplay(r.v.members)} RSVPs')
    .replaceAll('${state.flagship.userData.ev.rsvp} RSVPs', '${rsvpTotalDisplay(state.events)} RSVPs');
  once("ev.claimed = Number.isFinite(+ev.lat) && Number.isFinite(+ev.lng);",
    "ev.claimed = ev.lat != null && ev.lng != null && Number.isFinite(+ev.lat) && Number.isFinite(+ev.lng);");
  once('const rsvpCount = (ev) => (ev.rsvp | 0) + (state.user.rsvps.has(ev.id) ? 1 : 0);',
    "const rsvpCount = (ev) => (ev.rsvp | 0) + (!ev.sourceUrl && state.user.rsvps.has(ev.id) ? 1 : 0);");
  once('const left = cap ? Math.max(0, cap - n) : null;',
    'const left = ev.remainingCapacity != null ? ev.remainingCapacity : cap && ev.rsvp != null ? Math.max(0, cap - n) : null;');
  once('    ev.endDate = ev.end ?',
    '    ev.endKnown = !!ev.end && Number.isFinite(Date.parse(ev.end)) && Date.parse(ev.end) > ev.startDate.getTime();\n    ev.endDate = ev.end ?');
  once('const isPast = (ev) => ev.endDate.getTime() < nowMs();',
    'const isPast = (ev) => ev.endKnown && ev.endDate.getTime() < nowMs();');
  once('`DTEND:${icsStamp(ev.endDate)}`,',
    '...(ev.endKnown ? [`DTEND:${icsStamp(ev.endDate)}`] : []),');
  once('${icsStamp(ev.startDate)}/${icsStamp(ev.endDate)}',
    '${icsStamp(ev.startDate)}/${icsStamp(ev.endKnown ? ev.endDate : ev.startDate)}');
  html = html.replaceAll("ev.claimed && ev.address ? `${ev.address}, San Francisco, CA` : 'TBA'", "ev.address || 'TBA'");
  once("'endDate', 'dayKey', 'status', 'capacity', 'rsvp'",
    "'endDate', 'endKnown', 'dayKey', 'status', 'capacity', 'remainingCapacity', 'sourceUrl', 'fieldSources', 'rsvp'");
  once("'<em>No address yet.</em> This airship waits in the harbor until a citizen claims a venue for it.'",
    "`${esc([ev.venue, ev.address, ev.neighborhood].filter(Boolean).join(' · '))} <em>Map location unverified.</em> Harbor placement is a game placeholder.`");
  once("const lng = CFG.harbor.lng + (k - (unclaimed - 1) / 2) * 0.00125, lat = CFG.harbor.lat + (k % 2) * 0.0006;",
    "const cols = Math.ceil(Math.sqrt(unclaimed)); const lng = CFG.harbor.lng + (unclaimed <= 24 ? k - (unclaimed - 1) / 2 : k % cols - (cols - 1) / 2) * 0.00125, lat = CFG.harbor.lat + (unclaimed <= 24 ? k % 2 : Math.floor(k / cols) - (Math.ceil(unclaimed / cols) - 1) / 2) * 0.0009;");
  // Hosted img-src permits blob URLs, while connect-src grants only these
  // game's explicit public image origins. Keep the standalone loading path.
  once('if (!ev.image || ev.coverImg || ev.coverFailed) return;',
    'if (!ev.image || ev.coverImg || ev.coverFailed || ev.coverPending || (window.__SF_HOST_READY__ && !ev.wantsVehicle && state.selected !== ev)) return;');
  once('im.onerror = () => { ev.coverFailed = true; }; im.src = ev.image;',
    `im.onerror = () => { ev.coverFailed = true; ev.coverPending = false; };
    if (window.__SF_HOST_READY__) {
      ev.coverPending = true;
      window.__sfEventFeed.coverUrl(ev.image).then(url => { ev.coverUrl = url; im.src = url; }).catch(im.onerror);
    } else im.src = ev.image;`);
  once("const card = $('#tw-card'); if (!ev) { card.hidden = true; return; }",
    "const card = $('#tw-card'); if (!ev) { card.hidden = true; return; }\n    if(window.__SF_HOST_READY__) loadCover(ev);");
  once('ev.image ? esc(ev.image) : posterUrl',
    'ev.coverUrl ? esc(ev.coverUrl) : !window.__SF_HOST_READY__ && ev.image ? esc(ev.image) : posterUrl');
  const navNeedle = /ev\.claimed \? `<a class=[^`]*<\/a>` : '<button[^']*Claim address<\/button>'/;
  const navReplacement = `(() => {
    const hasLocation = Boolean((ev.address && ev.claimed) || (typeof ev.lat === 'number' && Number.isFinite(ev.lat) && typeof ev.lng === 'number' && Number.isFinite(ev.lng)));
    const navBtn = '<button type="button" data-act="navigate" class="tw-btn" title="' + (hasLocation ? 'Open Google Maps' : 'No address found. Opening map search.') + '">Navigate ↗</button>';
    const claimBtn = ev.claimed && !ev.doorWithheld ? '' : '<button type="button" data-act="claim">Claim address</button>';
    return navBtn + claimBtn;
  })()`;
  const navMatch = html.match(navNeedle);
  if (!navMatch) {
    throw new Error('Events UI navigate button pattern not found.');
  }
  html = html.replace(navMatch[0], navReplacement);

  // A listing with no registration link sends people to the Discord instead of
  // a dead RSVP button: the venue supplements carry no public sign-up page.
  once("<button type=\"button\" data-act=\"rsvp\" class=\"${going ? 'done' : 'primary'}\" ${st.open || going ? '' : 'disabled'}>${going ? 'Going ✓' : st.open ? `RSVP${via ? ' on ' + via : ''} ↗` : st.label}</button>",
    "${ev.url || ev.sourceUrl ? `<button type=\"button\" data-act=\"rsvp\" class=\"${going ? 'done' : 'primary'}\" ${st.open || going ? '' : 'disabled'}>${going ? 'Going ✓' : st.open ? `RSVP${via ? ' on ' + via : ''} ↗` : st.label}</button>` : `<a class=\"tw-btn\" href=\"https://discord.gg/GPPgjHE7GF\" target=\"_blank\" rel=\"noopener\" title=\"No public registration link — ask in the Discord\">Details in the Discord ↗</a>`}");

  const onClickRsvp = `    if (b.dataset.act === 'rsvp') { doRsvp(ev); return; }
    if (b.dataset.act === 'claim') { openClaim(ev); return; }`;
  const onClickNavigate = `    if (b.dataset.act === 'rsvp') { doRsvp(ev); return; }
    if (b.dataset.act === 'navigate') {
      const hasLocation = Boolean((ev.address && ev.claimed) || (typeof ev.lat === 'number' && Number.isFinite(ev.lat) && typeof ev.lng === 'number' && Number.isFinite(ev.lng)));
      const fallbackQuery = [ev.title, ev.name, ev.venue, 'San Francisco Tech Week'].filter(Boolean).join(' ').trim();
      const navUrl = hasLocation
        ? mapsUrl(ev)
        : 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(fallbackQuery || 'SF Tech Week');
      window.open(navUrl, '_blank', 'noopener');
      return;
    }
    if (b.dataset.act === 'claim') { openClaim(ev); return; }`;
  if (html.indexOf(onClickRsvp) < 0) {
    throw new Error('Events UI card click handler pattern not found.');
  }
  html = html.replace(onClickRsvp, onClickNavigate);

  return html;
}
