// Playtest tuning patches (Sep 2026 feedback round).
//
// Same exact-match discipline as events-build.mjs: every replacement must hit
// its target exactly once, so a source edit that moves the target fails the
// build instead of silently dropping a feature.
//
//   1. Heat, not approvals. The card, the list and the poster show the public
//      interest total (on the list + maybe + interested + waitlist) and the
//      seats left when the host published a cap.
//   2. The map is for what is hot. Only events above HEAT_MIN — plus the
//      featured host event — get an airship, a venue marker and a chip; the
//      rest stay in the side panel and in search.
//   3. The featured event flies its own oversized ship at the spawn point.
//   4. Covers appear when you fly close, not from across the bay.
//   5. Harbor holding pattern spreads much wider so unplaced events read as a
//      fleet rather than one blob.
//   6. "Claim & build the space" is gone.
export const FEATURED_EVENT = 'hgyN4UiBL4s3vA0ATTbr';   // Seedance × Chrona, the host's own event
export const HEAT_MIN = 30;                              // below this an event has no presence on the map

export function wireTuning(html) {
  const once = (from, to) => {
    if (html.split(from).length !== 2) throw new Error('Tuning patch target changed: ' + from.slice(0, 78));
    html = html.replace(from, to);
  };

  // ---- 1. heat instead of approved-RSVP ------------------------------------
  // rsvpCount stays the on-the-list number (geometry, guest birds, leaderboard
  // ties); heatCount is what a player reads.
  once('  const rsvpTotalDisplay = list =>', `  const heatOf = (ev) => {
    if (!ev) return 0;
    if (Number.isFinite(ev.heatCount)) return ev.heatCount;
    if (ev.rsvp == null) return 0;
    return rsvpCount(ev) + (ev.interested | 0) + (ev.maybe | 0) + (ev.waitlisted | 0);
  };
  const heatKnown = (ev) => ev && (Number.isFinite(ev.heatCount) || ev.rsvp != null);
  const heatTotal = (list) => list.reduce((sum, e) => sum + heatOf(e), 0);
  const heatDisplay = (ev) => (ev.flagship ? heatTotal(state.events) : heatKnown(ev) ? heatOf(ev) : '—');
  // "N interested" reads as heat; the breakdown stays available on the card.
  const heatBreakdown = (ev) => {
    if (!heatKnown(ev)) return '';
    const parts = [];
    const list = rsvpCount(ev); if (list) parts.push(list + (ev.attendanceKind === 'approved' ? ' on the list' : ' going'));
    if (ev.maybe) parts.push(ev.maybe + ' maybe');
    if (ev.interested) parts.push(ev.interested + ' interested');
    if (ev.waitlisted) parts.push(ev.waitlisted + ' waitlisted');
    return parts.join(' · ');
  };
  const rsvpTotalDisplay = list =>`);

  // Ranking follows heat too, so the fleet and the cruise pick genuinely busy events.
  once('  const heat = (ev) => rsvpCount(ev) + (ev.status === \'waitlist\' || ev.status === \'full\' ? 0.5 : 0);',
    '  const heat = (ev) => (ev.featured ? 1e6 : 0) + (Number.isFinite(ev.heatCount) ? ev.heatCount : rsvpCount(ev) + (ev.interested | 0) + (ev.maybe | 0) + (ev.waitlisted | 0)) + (ev.status === \'waitlist\' || ev.status === \'full\' ? 0.5 : 0);');

  // Card headline: heat + seats left, with the breakdown underneath.
  once('<p class="tw-reg"><b>${rsvpDisplay(ev)}</b> RSVPs${st.leftText ? ` <span class="tw-dim">· ${esc(st.leftText)}</span>` : \'\'}',
    '<p class="tw-reg"><b>${heatDisplay(ev)}</b> interested${st.leftText ? ` <span class="tw-dim">· ${esc(st.leftText)}</span>` : \'\'}');
  once('${ev.cobuilders.length ? ` · ${ev.cobuilders.length} builder${ev.cobuilders.length > 1 ? \'s\' : \'\'}` : \'\'}</p>',
    '</p>${heatBreakdown(ev) ? `<p class="tw-heat-detail">${esc(heatBreakdown(ev))}</p>` : \'\'}');

  // List rows.
  once('<span class="tw-sub tw-going"><strong>${rsvpDisplay(ev)}</strong> RSVPs',
    '<span class="tw-sub tw-going"><strong>${heatDisplay(ev)}</strong> interested');

  // Poster block: the big number and its label.
  once("const num = `${rsvpDisplay(ev)}`; g.fillText(num, x, H - 92);",
    "const num = `${heatDisplay(ev)}`; g.fillText(num, x, H - 92);");
  once("g.fillText('RSVPS', x + nw + 10, H - 94);",
    "g.fillText('INTERESTED', x + nw + 10, H - 94);");

  // Nav chip while flying.
  once("`${t.active ? `Cruise ${t.i + 1}/${t.queue.length} → ` : '→ '}${dest(ev)} · ${rsvpDisplay(ev)} RSVPs · ${tail}`",
    "`${t.active ? `Cruise ${t.i + 1}/${t.queue.length} → ` : '→ '}${dest(ev)} · ${heatDisplay(ev)} interested · ${tail}`");

  // ---- 2 & 3. who gets a ship ----------------------------------------------
  once("  function normalizeEvent(raw, i) {",
    `  const FEATURED_EVENT = ${JSON.stringify(FEATURED_EVENT)};
  function normalizeEvent(raw, i) {`);
  once("    if (!CATS[ev.category] || ev.category === 'unclaimed') ev.category = guessCategory(ev); return ev;",
    `    ev.featured = !!FEATURED_EVENT && \`\${ev.url || ''}\${ev.sourceUrl || ''}\${ev.id || ''}\`.includes(FEATURED_EVENT);
    if (!CATS[ev.category] || ev.category === 'unclaimed') ev.category = guessCategory(ev); return ev;`);

  // The fleet is "everything hot enough", not a fixed top-N; quiet events keep
  // their listing but leave the sky and the streets empty.
  const rank = `state.events.slice().sort((a, b) => heat(b) - heat(a)).forEach((ev, i) => { ev.rank = i; ev.wantsVehicle = i < CFG.fleet; });`;
  const rankNew = `state.events.slice().sort((a, b) => heat(b) - heat(a)).forEach((ev, i) => {
      ev.rank = i;
      // Three tiers: the host's own ship, an airship for anything genuinely
      // busy, and a roof marker for every event whose address is known — those
      // are spread across real buildings, so they never crowd one spot.
      ev.wantsVehicle = ev.featured || heatOf(ev) > CFG.heatMin;
      ev.onMap = ev.wantsVehicle || ev.claimed;
    });`;
  if (html.split(rank).length !== 3) throw new Error('Tuning patch target changed: fleet ranking (expected twice)');
  html = html.replaceAll(rank, rankNew);

  // Placement order matters: the host's own ship first, then buildings for real
  // addresses, then a spread across the district for neighbourhood-only events,
  // and the harbour for everything with no location at all.
  once("    for (const ev of state.events) {\n      if (ev.claimed) {",
    `    for (const ev of state.events) {
      if (ev.featured) {
        const p = GEO.Hn(CFG.featured.lng, CFG.featured.lat, 0); ev.venueKey = 'featured';
        ev.world = V3(p.x, 0, p.z); ev.ground = c.sampleTerrain(CFG.featured.lng, CFG.featured.lat) || 0;
        ev.roof = ev.ground; ev.shipY = CFG.featured.y; ev.anchorY = ev.ground + 8;
        continue;
      }
      // A neighbourhood centroid is not an address: fan these out over the
      // district on a golden-angle spiral so no two share a rooftop.
      if (ev.approxLocation) {
        const seed = hash(ev.id), a = seed * 2.399963229, r = 130 + (seed % 89) * 7.4;
        const p = GEO.Hn(+ev.lng, +ev.lat, 0);
        const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
        ev.venueKey = 'approx:' + ev.id; ev.world = V3(x, 0, z);
        ev.ground = c.sampleTerrain(+ev.lng, +ev.lat) || 0;
        const roof = roofHeightAt(x, z, 24);
        ev.roof = Number.isFinite(roof) && roof > ev.ground + 2 ? roof : ev.ground + 4;
        ev.shipY = ev.wantsVehicle ? ev.roof + CFG.shipAltitude : ev.roof + 40;
        ev.anchorY = ev.roof + 12;
        continue;
      }
      if (ev.claimed) {`);

  // Stacking at one address is capped: after four events the ring widens
  // instead of climbing out of the sky.
  once("const ang = n * 2.1, off = n ? 34 : 0;", "const ang = n * 2.1, off = n ? 34 + Math.floor(n / 6) * 22 : 0;");
  once("ev.shipY = ev.wantsVehicle ? ev.roof + CFG.shipAltitude + n * 26 : ev.roof + 36 + n * 9;",
    "ev.shipY = ev.wantsVehicle ? ev.roof + CFG.shipAltitude + Math.min(n, 4) * 26 : ev.roof + 36 + Math.min(n, 4) * 9;");

  // Only events that will actually be drawn take a harbour slot, so the grid
  // stays the size of the visible fleet.
  once("const slots = new Map(); let harborIndex = 0; const unclaimed = state.events.filter((e) => !e.claimed).length;",
    "const slots = new Map(); let harborIndex = 0; const unclaimed = Math.max(1, state.events.filter((e) => !e.claimed && !e.approxLocation && !e.featured && e.onMap).length);");

  // An approximate location is never presented as a verified address.
  once("ev.claimed = ev.lat != null && ev.lng != null && Number.isFinite(+ev.lat) && Number.isFinite(+ev.lng);",
    "ev.claimed = !ev.approxLocation && ev.lat != null && ev.lng != null && Number.isFinite(+ev.lat) && Number.isFinite(+ev.lng);");

  // A wider, sparser holding pattern: the grid step grows with the fleet size.
  once("const cols = Math.ceil(Math.sqrt(unclaimed)); const lng = CFG.harbor.lng + (unclaimed <= 24 ? k - (unclaimed - 1) / 2 : k % cols - (cols - 1) / 2) * 0.00125, lat = CFG.harbor.lat + (unclaimed <= 24 ? k % 2 : Math.floor(k / cols) - (Math.ceil(unclaimed / cols) - 1) / 2) * 0.0009;",
    "const cols = Math.max(1, Math.ceil(Math.sqrt(unclaimed))); const stepLng = 0.0034, stepLat = 0.0026; const lng = CFG.harbor.lng + (k % cols - (cols - 1) / 2) * stepLng, lat = CFG.harbor.lat + (Math.floor(k / cols) - (Math.ceil(unclaimed / cols) - 1) / 2) * stepLat;");

  // Only mapped events take up space in the world, the chip layer and the clusters.
  once("    for (const ev of state.events) {\n      ev.posterCanvas = null; ev.tex = null;",
    "    for (const ev of state.events) {\n      if (!ev.onMap) { ev.ship = null; ev.venueGroup = null; continue; }\n      ev.posterCanvas = null; ev.tex = null;");
  once("  function buildChips() {", "  function buildChips() {\n    // chips follow the fleet: quiet events stay in the panel only");
  once("    const vg = new Map(); for (const ev of state.events) { if (!vg.has(ev.venueKey)) vg.set(ev.venueKey, []); vg.get(ev.venueKey).push(ev); }",
    "    const vg = new Map(); for (const ev of state.events) { if (!ev.onMap) continue; if (!vg.has(ev.venueKey)) vg.set(ev.venueKey, []); vg.get(ev.venueKey).push(ev); }");
  once("    for (const ev of state.events) { const k = ev.claimed ? (ev.neighborhood || ev.venue || 'Downtown') : 'Harbor · unclaimed'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(ev); }",
    "    for (const ev of state.events) { if (!ev.onMap) continue; const k = ev.claimed ? (ev.neighborhood || ev.venue || 'Downtown') : 'Harbor · unclaimed'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(ev); }");
  once("    if (state.events.length) { const xs = state.events.map((e) => e.world.x), zs = state.events.map((e) => e.world.z);",
    "    const fenced = state.events.filter((e) => e.onMap && e.world);\n    if (fenced.length) { const xs = fenced.map((e) => e.world.x), zs = fenced.map((e) => e.world.z);");

  // Guards: everything that assumes an event owns a ship or a chip.
  once("  function refreshChip(ev) {", "  function refreshChip(ev) {\n    if (!ev || !ev.chip) return;");
  once("  function moveShip(ev) {", "  function moveShip(ev) {\n    if (!ev.ship) return;");
  once("  function rebuildVenue(ev) { ROOT.remove(ev.venueGroup);", "  function rebuildVenue(ev) { if (!ev.onMap) return; ROOT.remove(ev.venueGroup);");
  once("      if (ev.venueChip && ev.venueChip._show) { hide(ev.chip); continue; }",
    "      if (!ev.onMap || !ev.chip) continue;\n      if (ev.venueChip && ev.venueChip._show) { hide(ev.chip); continue; }");
  once("  function buildVenueChips() {", "  function buildVenueChips() {\n    // one chip per building among the mapped events");
  once("      const q = state.events.filter((e) => e.claimed).sort((a, b) => heat(b) - heat(a)); if (!q.length) return;",
    "      const q = state.events.filter((e) => e.onMap && e.ship).sort((a, b) => heat(b) - heat(a)); if (!q.length) return;");
  once("  function look(ev) { lookAt(", "  function look(ev) { if (!ev.ship) return; lookAt(");
  once("    start(ev) { this.ev = ev;", "    start(ev) { if (!ev || !ev.world) return; this.ev = ev;");

  // Honest wording for the three location tiers.
  once("`${esc([ev.venue, ev.address, ev.neighborhood].filter(Boolean).join(' · '))} <em>Map location unverified.</em> Harbor placement is a game placeholder.`",
    "`${esc([ev.venue, ev.address, ev.neighborhood].filter(Boolean).join(' · '))} ${ev.approxLocation ? '<em>District only — the exact address is not public yet.</em> The airship flies over the neighbourhood.' : '<em>No public address yet.</em> It waits in the harbour until someone shares one.'}`");

  // ---- 6. the co-build entry point goes away -------------------------------
  once('        <button type="button" data-act="cobuild">${cob ? \'Edit the space\' : \'Claim & build the space\'}</button>\n', '');

  // ---- 4. covers only when you are close -----------------------------------
  return applyCoverProximity(html);
}

// The cover gate that events-build.mjs installs is replaced with a proximity
// test: the ink stand-in is what you see from the air, and the real poster
// resolves once you fly up to the ship (or open the card).
function applyCoverProximity(html) {
  const from = 'if (!ev.image || ev.coverImg || ev.coverFailed || ev.coverPending || (window.__SF_HOST_READY__ && !ev.wantsVehicle && state.selected !== ev)) return;';
  const to = 'if (!ev.image || ev.coverImg || ev.coverFailed || ev.coverPending) return;\n    if (!ev.coverNear && state.selected !== ev) return;';
  if (html.split(from).length !== 2) throw new Error('Tuning patch target changed: cover gate (run wireTuning after wireEventFeed)');
  html = html.replace(from, to);

  // updateChips already knows every ship's distance to the camera each frame.
  const mark = 'const sel = state.selected === ev, level = p.d < near ? \'near\' : p.d < mid ? \'mid\' : \'far\';';
  if (html.split(mark).length !== 2) throw new Error('Tuning patch target changed: chip level');
  html = html.replace(mark, 'if (!ev.coverNear && p.d < CFG.posterReveal) { ev.coverNear = true; loadCover(ev); }\n      ' + mark);
  return html;
}

// CFG additions used above. Applied first so the keys exist before anything
// reads them.
export function wireTuningConfig(html) {
  const from = '    lod: { near: 900, mid: 2600 },                           // chip detail bands (metres from the camera)';
  const to = `    lod: { near: 900, mid: 2600 },                           // chip detail bands (metres from the camera)
    heatMin: ${HEAT_MIN},                                          // public interest an event needs before it appears on the map
    posterReveal: 620,                                       // metres: closer than this the real poster loads onto the banner
    featured: { lat: 37.7969, lng: -122.3931, y: 196 },      // the host's own event, parked over the spawn point`;
  if (html.split(from).length !== 2) throw new Error('Tuning patch target changed: CFG.lod');
  return html.replace(from, to);
}
