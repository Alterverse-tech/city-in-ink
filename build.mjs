import { readFile, writeFile } from 'node:fs/promises';
import { wireEventFeed } from './events-build.mjs';
import { wireTuning, wireTuningConfig } from './tuning-build.mjs';
import { pathToFileURL } from 'node:url';

// Product name. The original file still says "City in Ink"; every build renames
// the user-visible strings through wireBrand() so the source parts stay intact.
export const GAME_NAME = 'SF TECH WEEK CITY';

// The supplied single-file game stays intact; only its startup gets a module import.
export function renderGame(source) {
const marker = '<script>(()=>{var G1=Object.create;';
if (source.split(marker).length !== 2) throw new Error('Expected the original game startup exactly once.');
return wireTuning(wireEventFeed(wireDialogs(wireBrand(wireTuningConfig(source)))))
  .replace(marker, '<script type="module">\nimport "./events-sync.js";\nimport "./multiplayer.js";\nimport "./gull-cluster-route.mjs";\nimport "./city-extras.mjs";\n(()=>{var G1=Object.create;')
  // The city's capture-phase shortcuts must also ignore the account shadow DOM.
  .replace("if (e.target instanceof HTMLElement && e.target.closest('input,textarea,select')) return; const k = e.key.toLowerCase();",
    "if (e.composedPath().some(n => n instanceof HTMLElement && (n.matches('input,textarea,select') || n.id === 'sfnet'))) return; const k = e.key.toLowerCase();")
  .replace('</head>', '  <link rel="stylesheet" href="./multiplayer.css">\n  <link rel="stylesheet" href="./events-sync.css">\n</head>');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
const source = await readFile(new URL('./city-original.html', import.meta.url), 'utf8');
const html = renderGame(source);
await writeFile(new URL('./index.html', import.meta.url), html);
console.log('Built index.html with the original city and Chrona multiplayer.');
}

// Rename: "SF Tech Week 2026 — City in Ink" → GAME_NAME wherever a player can read it.
// Comments, CSS ids and the a16z "TECH WEEK" brand link are left alone.
function wireBrand(html) {
  const patches = [
    // Browser tab / share title
    ['<title>SF TECH WEEK 2026 — CITY IN INK · every event is an airship</title>',
      `<title>${GAME_NAME} · every event is an airship</title>`],
    // Top-left masthead: the name on one display line, the tagline beneath it.
    ['<h1><span>TECH WEEK</span><small>SF · CITY IN INK</small></h1>',
      `<h1 class="tw-name"><span>${GAME_NAME}</span><small>every event is an airship</small></h1>`],
    ['.tw-masthead h1 span{font-size:clamp(34px,5.4vw,78px)}',
      '.tw-masthead h1 span{font-size:clamp(34px,5.4vw,78px)}.tw-masthead h1.tw-name span{font-size:clamp(28px,3.9vw,58px);letter-spacing:.01em}'],
    // Loading overlay of the base city ("SAN FRANCISCO / CITY IN INK")
    ['(0,G.jsx)("span",{children:"SAN FRANCISCO"}),(0,G.jsx)("small",{children:"CITY IN INK"})',
      `(0,G.jsx)("span",{children:"SAN FRANCISCO"}),(0,G.jsx)("small",{children:${JSON.stringify(GAME_NAME)}})`],
    // Flagship airship title and the calendar export identity
    ["title: 'SF Tech Week 2026 — the city in ink'", "title: 'SF Tech Week 2026 — SF Tech Week City'"],
    ["'PRODID:-//SF Tech Week x City in Ink//EN'", "'PRODID:-//SF Tech Week City//EN'"],
  ];
  for (const [from, to] of patches) {
    if (html.split(from).length !== 2) throw new Error('Brand patch target changed: ' + from.slice(0, 70));
    html = html.replace(from, to);
  }
  return html;
}

// Hosted frames may disable native form submission. Dialog actions are local UI.
function wireDialogs(html) {
  const from = "  let modalSubmit = null;\n  function openModal(html, cta, onSubmit, cancelLabel) {\n    const m = $('#tw-modal'); m.hidden = false; modalSubmit = onSubmit;\n    m.innerHTML = `<form class=\"tw-dialog\" novalidate>${html}<div class=\"tw-actions\"><button type=\"submit\" class=\"primary\">${esc(cta)}</button><button type=\"button\" data-act=\"cancel\">${esc(cancelLabel || 'Cancel')}</button></div></form>`;\n    $('form', m).addEventListener('submit', async (e) => { e.preventDefault(); const ok = await modalSubmit(); if (ok) closeModal(); });\n    $('[data-act=cancel]', m).addEventListener('click', closeModal);\n    setTimeout(() => { const f = m.querySelector('[autofocus]') || m.querySelector('input,select'); f && f.focus(); }, 30);\n  }\n";
  const to = "  function openModal(html, cta, onSubmit, cancelLabel) {\n    const m = $('#tw-modal'); m.hidden = false;\n    m.innerHTML = `<div class=\"tw-dialog\" role=\"dialog\" aria-modal=\"true\" aria-label=\"${esc(cta)}\">${html}<div class=\"tw-actions\"><button type=\"button\" class=\"primary\">${esc(cta)}</button><button type=\"button\" data-act=\"cancel\">${esc(cancelLabel || 'Cancel')}</button></div></div>`;\n    const dialog = m.firstElementChild, primary = $('.primary', dialog);\n    let busy = false;\n    const run = async (e) => {\n      e.preventDefault();\n      if (busy) return;\n      busy = true; primary.disabled = true;\n      try {\n        const ok = await onSubmit();\n        if (ok && m.firstElementChild === dialog) closeModal();\n      } catch (error) {\n        console.error('City dialog action failed', error);\n        toast('Unable to complete this action. Please try again.');\n      } finally { busy = false; primary.disabled = false; }\n    };\n    primary.addEventListener('click', run);\n    dialog.addEventListener('keydown', (e) => {\n      if (e.key === 'Enter' && !e.isComposing && e.target.matches('input')) {\n        e.stopPropagation(); void run(e);\n      }\n    });\n    $('[data-act=cancel]', m).addEventListener('click', closeModal);\n    setTimeout(() => {\n      if (m.firstElementChild !== dialog) return;\n      const f = dialog.querySelector('[autofocus]') || dialog.querySelector('input,select');\n      if (f) f.focus();\n    }, 30);\n  }\n";
  if (html.split(from).length !== 2) throw new Error('Expected the original dialog handler exactly once.');
  return html.replace(from, to);
}
