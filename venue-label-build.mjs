// Streaming geometry and non-structural event refreshes rebuild spatial metadata
// without rebuilding the whole chip layer. Retire its old venue DOM first.
export function wireVenueLabels(html) {
  const once = (from, to) => {
    if (html.split(from).length !== 2) throw new Error('Venue label patch target changed: ' + from.slice(0, 80));
    html = html.replace(from, to);
  };
  once('    state.venues = [...vg.entries()].map(',
    '    for (const previous of state.venues || []) previous.el?.remove();\n    state.venues = [...vg.entries()].map(');
  once("el.className = 'tw-chip ' + cls; el.innerHTML = html; chipLayer.appendChild(el);",
    "el.className = 'tw-chip ' + cls; el.style.display = 'none'; el.innerHTML = html; chipLayer.appendChild(el);");
  once("el.className = 'tw-chip tw-chip-venue' + (vg.open ? ' open' : '');",
    "el.className = 'tw-chip tw-chip-venue' + (vg.open ? ' open' : ''); el.style.display = 'none';");
  once("    const proj = (pos, dy) => { v.copy(pos); v.y += dy; const d = v.distanceTo(cam.position); v.project(cam); if (v.z > 1 || v.x < -1.15 || v.x > 1.15 || v.y < -1.15 || v.y > 1.15) return null; return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H, d }; };",
    `    const proj = (pos, dy) => {
      if (!pos || ![pos.x, pos.y, pos.z, dy, W, H].every(Number.isFinite) || W <= 0 || H <= 0) return null;
      v.copy(pos); v.y += dy; const d = v.distanceTo(cam.position); v.project(cam);
      if (![v.x, v.y, v.z, d].every(Number.isFinite) || v.z < -1 || v.z > 1 || v.x < -1.15 || v.x > 1.15 || v.y < -1.15 || v.y > 1.15) return null;
      return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H, d };
    };`);
  once("    const hide = (el) => { if (el.style.display !== 'none') el.style.display = 'none'; };",
    "    const hide = (el) => { if (el && el.style.display !== 'none') el.style.display = 'none'; };");
  once("    const place = (el, p) => { el.style.display = ''; el.style.transform = `translate(-50%,-100%) translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px)`; el.style.opacity = p.d < 1800 ? 1 : p.d > 9000 ? 0.5 : (1 - ((p.d - 1800) / 7200) * 0.5).toFixed(2); };",
    "    const place = (el, p) => { if (!el || !p || ![p.x, p.y, p.d].every(Number.isFinite)) { hide(el); return; } el.style.transform = `translate(-50%,-100%) translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px)`; el.style.opacity = p.d < 1800 ? 1 : p.d > 9000 ? 0.5 : (1 - ((p.d - 1800) / 7200) * 0.5).toFixed(2); el.style.display = ''; };");
  return html;
}
