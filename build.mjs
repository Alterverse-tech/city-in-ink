import { readFile, writeFile } from 'node:fs/promises';
import { wireEventFeed } from './events-build.mjs';
import { wireTuning, wireTuningConfig } from './tuning-build.mjs';
import { wireGameUi } from './ui-build.mjs';
import { wireHoverFlight } from './flight-build.mjs';
import { wirePersistentEventCards } from './event-card-build.mjs';
import { wirePlayerStart } from './player-start-build.mjs';
import { wireVenueLabels } from './venue-label-build.mjs';
import { pathToFileURL } from 'node:url';

// Product name. The original file still says "City in Ink"; every build renames
// the user-visible strings through wireBrand() so the source parts stay intact.
export const GAME_NAME = 'SF TECH WEEK CITY';

// The supplied single-file game stays intact; only its startup gets a module import.
export function renderGame(source) {
const marker = '<script>(()=>{var G1=Object.create;';
if (source.split(marker).length !== 2) throw new Error('Expected the original game startup exactly once.');
if (source.split('window.__sfCity=c,window.render_game_to_text').length !== 2) throw new Error('Expected the city time installation point exactly once.');
return wireVenueLabels(wirePlayerStart(wirePersistentEventCards(wireHoverFlight(wireGameUi(wireBootProgress(wireTuning(wireEventFeed(wireDialogs(wireBrand(wireTuningConfig(source)))))))))))
  .replace(marker, '<script type="module">\nimport "./city-time.mjs";\nimport "./event-card.mjs";\nimport "./events-sync.js";\nimport "./multiplayer.js";\nimport "./gull-cluster-route.mjs";\nimport "./city-extras.mjs";\n(()=>{var G1=Object.create;')
  .replace('window.__sfCity=c,window.render_game_to_text', 'window.__sfCity=c,window.__sfInstallCityTime?.(c),window.render_game_to_text')
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

// The city's geometry is inlined in this page, so the browser must download the
// whole ~23 MB document before a single line of the game runs — which is a
// blank screen for as long as that takes. The asset map streams in as one
// <script> element, so its text length is a real download progress signal: this
// overlay reads it while the rest of the document is still arriving, then hands
// over to the game's own loading screen. Nothing here blocks the game.
export function wireBootProgress(html) {
  const open = '<script id="sf-city-assets" type="application/json">';
  const start = html.indexOf(open);
  const end = html.indexOf('</script>', start);
  if (start < 0 || end < 0) throw new Error('Boot progress: asset map not found');
  const total = end - (start + open.length);

  const overlay = `<div id="tw-boot" role="status" aria-live="polite">
    <div class="tw-boot-inner">
      <span class="tw-boot-name">SF TECH WEEK CITY</span>
      <span class="tw-boot-sub">Loading San Francisco</span>
      <div class="tw-boot-track"><i id="tw-boot-bar"></i></div>
      <span class="tw-boot-pct" id="tw-boot-pct">0%</span>
    </div>
  </div>
  <style>
    #tw-boot { position: fixed; inset: 0; z-index: 999; display: grid; place-items: center;
      background: #f6ecd8; color: #34262f; font-family: ui-monospace, Menlo, Consolas, monospace;
      transition: opacity .45s ease; }
    #tw-boot.done { opacity: 0; pointer-events: none; }
    /* Once the document is here the game can be used; the strip keeps saying
       what is still happening without standing in front of it. */
    #tw-boot.strip { inset: auto 0 0 0; height: 44px; background: #f6ecd8ee; border-top: 1px solid #34262f33;
      display: flex; align-items: center; justify-content: center; pointer-events: none; }
    #tw-boot.strip .tw-boot-name, #tw-boot.strip .tw-boot-pct { display: none; }
    #tw-boot.strip .tw-boot-inner { grid-auto-flow: column; gap: 14px; width: min(520px, 84vw); align-items: center; }
    #tw-boot.strip .tw-boot-sub { white-space: nowrap; opacity: .8; }
    #tw-boot.strip .tw-boot-track { position: relative; overflow: hidden; }
    #tw-boot.strip #tw-boot-bar { width: 38% !important; animation: tw-boot-slide 1.4s ease-in-out infinite alternate; }
    @keyframes tw-boot-slide { from { transform: translateX(-40%); } to { transform: translateX(200%); } }
    .tw-boot-inner { display: grid; gap: 10px; justify-items: center; width: min(420px, 76vw); }
    .tw-boot-name { font: 700 clamp(20px, 3.4vw, 34px)/1.1 Georgia, serif; letter-spacing: .04em; }
    .tw-boot-sub { font-size: 12px; letter-spacing: .12em; text-transform: uppercase; opacity: .6; }
    .tw-boot-track { width: 100%; height: 3px; background: #34262f22; overflow: hidden; }
    #tw-boot-bar { display: block; height: 100%; width: 0; background: #c6583c; transition: width .25s ease; }
    .tw-boot-pct { font-size: 12px; opacity: .6; font-variant-numeric: tabular-nums; }
  </style>
  <script>(() => {
    const TOTAL = ${total};
    const bar = document.getElementById('tw-boot-bar'), pct = document.getElementById('tw-boot-pct');
    const boot = document.getElementById('tw-boot');
    let done = false;
    const set = (value) => { const v = Math.max(0, Math.min(100, Math.round(value))); bar.style.width = v + '%'; pct.textContent = v + '%'; };
    const sub = boot.querySelector('.tw-boot-sub');
    let stripped = false;
    const strip = () => {
      if (stripped || done) return; stripped = true;
      // The document is here, so the game is usable; get out of its way and
      // keep reporting. No invented percentage for this phase — the city is
      // being built and there is no honest number for that.
      boot.classList.add('strip');
      sub.textContent = 'Building the city';
    };
    const tick = () => {
      if (done) return;
      const node = document.getElementById('sf-city-assets');
      const arrived = node ? Math.min(1, node.textContent.length / TOTAL) : 0;
      if (window.TW && window.TW.state && window.TW.state.ready) return finish();
      if (!stripped) set(arrived * 100);
      requestAnimationFrame(tick);
    };
    const finish = () => {
      if (done) return; done = true;
      boot.classList.add('done');
      setTimeout(() => boot.remove(), 500);
    };
    document.addEventListener('DOMContentLoaded', () => setTimeout(strip, 250));
    // Never sit there forever if something goes wrong upstream.
    setTimeout(finish, 90000);
    requestAnimationFrame(tick);
  })();</script>
`;
  return html.replace('<body>\n  <div id="root"></div>', '<body>\n  <div id="root"></div>\n' + overlay);
}
