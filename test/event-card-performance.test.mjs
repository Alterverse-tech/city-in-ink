import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { renderGame } from '../build.mjs';

const manifest = JSON.parse(await readFile(new URL('../source/manifest.json', import.meta.url)));
const source = (await Promise.all(manifest.parts.map(name => readFile(new URL('../source/' + name, import.meta.url), 'utf8')))).join('');
const html = renderGame(source);
const section = (from, to) => html.slice(html.indexOf(from), html.indexOf(to, html.indexOf(from)));
const selectSource = section('  function select(ev, opts)', '  function lookAt(');
const cardSource = section('  function renderCard(ev)', '  function editorHtml(ev)');
const coverSource = section('  function loadCover(ev)', '  function bannerMaterial(');
const unexpected = message => () => { throw new Error(message); };
function classes() {
  const active = new Set(); let writes = 0;
  return { toggle(name, value) { writes++; if (value) active.add(name); else active.delete(name); },
    add(name) { writes++; active.add(name); }, has: name => active.has(name), get writes() { return writes; } };
}

test('automatic card switches touch only the previous and next rows/chips, without rebuilding 1,000 list rows', () => {
  const events = Array.from({ length: 1000 }, (_, i) => ({ id: 'event-' + i, chip: { classList: classes() } }));
  const rows = new Map(events.map(ev => [ev.id, { classList: classes() }]));
  const previous = events[11], next = events[789], state = { events, selected: previous };
  Object.defineProperty(state, 'venues', { get: unexpected('Selection scanned every venue') });
  previous.chip.classList.add('active'); rows.get(previous.id).classList.add('active');
  let drawn;
  const context = { state, eventListRows: rows, TW: {},
    document: { documentElement: { classList: classes() } }, c: { freeFlightEnabled: true },
    refreshChip: unexpected('Selection refreshed event text/LOD'),
    renderList: unexpected('Selection sorted and rebuilt the feed'), renderCard: ev => { drawn = ev; } };
  runInNewContext(selectSource + '\nselect(state.events[789], {cardSource:"nearby"});', context);
  assert.equal(drawn, next); assert.equal(state.selected, next);
  assert.equal(previous.chip.classList.has('active'), false); assert.equal(rows.get(previous.id).classList.has('active'), false);
  assert.equal(next.chip.classList.has('active'), true); assert.equal(rows.get(next.id).classList.has('active'), true);
  assert.equal(events.filter(ev => ev.chip.classList.writes).length, 2);
  assert.equal([...rows.values()].filter(row => row.classList.writes).length, 2);
});

test('selection clears the old venue choice and highlights the new choice while keeping other venues untouched', () => {
  const buttons = ['old', 'new', 'other'].map(id => ({ dataset: { id }, classList: classes() }));
  buttons[0].classList.add('active');
  const venue = { el: { classList: classes(), querySelectorAll: () => buttons } };
  const old = { id: 'old', venueChip: venue }, next = { id: 'new', venueChip: venue };
  const context = { state: { selected: old }, TW: {}, eventListRows: new Map(),
    document: { documentElement: { classList: classes() } }, c: { freeFlightEnabled: true }, renderCard() {} };
  runInNewContext(selectSource + '\nglobalThis.select = select;', context);
  context.select(next);
  assert.equal(buttons[0].classList.has('active'), false); assert.equal(buttons[1].classList.has('active'), true);
  assert.equal(buttons[2].classList.has('active'), false); assert.equal(venue.open, true);
  assert.equal(buttons[1].classList.writes, 1, 'a shared venue is traversed only once');
});

function cardHarness({ hosted = true, source = true } = {}) {
  let writes = 0, copies = 0, generated = 0, poster;
  const makeCanvas = () => ({ className: '', setAttribute() {},
    getContext: () => ({ drawImage: () => { copies++; } }),
    toDataURL: unexpected('Card synchronously encoded a JPEG') });
  const cachedCanvas = { width: 800, height: 450, toDataURL: unexpected('Cached canvas was JPEG-encoded') };
  const card = { dataset: {}, classList: classes(), hidden: false,
    querySelector: () => poster, contains: node => node === poster,
    set innerHTML(value) {
      writes++;
      if (value.includes('<img class="tw-poster"')) poster = {
        handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; },
        replaceWith(next) { poster = next; },
      };
      else poster = makeCanvas();
    },
  };
  const ev = { id: 'event', title: 'An event', image: source ? 'https://images.example/cover.jpg' : '',
    coverUrl: hosted && source ? 'blob:cover' : '', posterCanvas: cachedCanvas, url: 'https://partiful.com/e/event', rsvp: 1 };
  const context = { state: { selected: ev, user: { rsvps: new Set(), cobuilds: new Set() } },
    window: { __SF_HOST_READY__: hosted }, TW: {}, $: () => card, c: { freeFlightEnabled: true },
    document: { createElement: makeCanvas }, nav: {},
    loadCover() {}, catOf: () => ({ color: '#c6583c', label: 'Founders' }),
    regStatus: () => ({ leftText: '', short: '', open: true }), speakersOf: () => [], hostsOf: () => ['Host'],
    rsvpCount: ev => ev.rsvp, rsvpDisplay: ev => ev.rsvp, rsvpHost: () => 'Partiful',
    fmt: { when: () => 'Fri Oct 9 · 6:00 PM' }, tagOnly: () => false, esc: value => String(value ?? ''),
    drawPoster() { generated++; return cachedCanvas; },
  };
  runInNewContext(cardSource + '\nglobalThis.renderCard = renderCard;', context);
  return { ev, context, card, render: context.renderCard,
    get counts() { return { writes, copies, generated }; }, get poster() { return poster; } };
}

test('a feed or filter refresh rebuilds the row index and clicks resolve the current event object', () => {
  const h = cardHarness(), context = h.context;
  let visible = [h.ev, { ...h.ev, id: 'second' }], nodes = [], clicked;
  const list = { set innerHTML(markup) {
    nodes = [...markup.matchAll(/<li[^>]*data-id="([^"]+)"/g)].map(match => ({
      dataset: { id: match[1] }, addEventListener(type, callback) { this[type] = callback; },
    }));
  }, querySelectorAll: () => nodes };
  const count = {}, sourceLabel = {};
  context.state.events = visible; context.state.source = 'Official events';
  context.$ = id => id === '#tw-list' ? list : id === '#tw-count' ? count : sourceLabel;
  context.visibleEvents = () => visible; context.select = ev => { clicked = ev; };
  runInNewContext(section('  const eventListRows = new Map();', '  function renderBoard()') +
    '\nglobalThis.renderList = renderList; globalThis.rows = eventListRows;', context);
  context.renderList(); assert.equal(context.rows.size, 2); assert.equal(count.textContent, 2);
  const replacement = { ...visible[1], title: 'Updated listing' }; context.state.events = [h.ev, replacement];
  nodes[1].click(); assert.equal(clicked, replacement, 'click does not capture a stale feed object');
  visible = [replacement]; context.renderList();
  assert.equal(context.rows.size, 1); assert.equal(context.rows.has('event'), false);
  assert.equal(context.rows.get('second'), nodes[0]); assert.equal(sourceLabel.textContent, 'Official events');
});

test('a real cover does no poster drawing or JPEG encoding, and unchanged callbacks preserve card DOM', () => {
  const h = cardHarness(); h.render(h.ev); const firstImage = h.poster;
  for (let i = 0; i < 30; i++) h.render(h.ev);
  assert.deepEqual(h.counts, { writes: 1, copies: 0, generated: 0 });
  assert.equal(h.poster, firstImage, 'image and focused actions are retained');
  h.ev.rsvp = 2; h.render(h.ev);
  assert.equal(h.counts.writes, 2, 'an actual RSVP change still updates the card');
  assert.equal(h.counts.copies, 0);
});

test('a generated fallback copies the existing canvas once without encoding or decoding an image', () => {
  const h = cardHarness({ source: false }); h.render(h.ev); h.render(h.ev);
  assert.deepEqual(h.counts, { writes: 1, copies: 1, generated: 0 });
  assert.equal(h.poster.width, 800); assert.equal(h.poster.height, 450);
});

test('cover errors use a canvas fallback and stale image callbacks cannot replace a newer card', () => {
  const h = cardHarness(); h.render(h.ev); const oldPoster = h.poster;
  oldPoster.handlers.error();
  assert.equal(h.poster.className, 'tw-poster'); assert.equal(h.counts.copies, 1);
  h.ev = { ...h.ev, id: 'new', title: 'A different event' }; h.context.state.selected = h.ev; h.render(h.ev);
  const newPoster = h.poster; oldPoster.handlers.error();
  assert.equal(h.poster, newPoster); assert.equal(h.counts.copies, 1);
});

test('standalone failed covers stop recreating a failed image on every card refresh', () => {
  const h = cardHarness({ hosted: false }); h.ev.coverFailed = true; h.render(h.ev);
  assert.equal(h.counts.copies, 1); assert.equal(h.poster.handlers, undefined);
});

function coverHarness() {
  let image, images = 0, draws = 0, cards = 0, release, reject;
  const decoded = new Promise((resolve, fail) => { release = resolve; reject = fail; });
  function Image() { image = this; images++; this.decode = () => decoded; }
  const ev = { id: 'one', image: 'https://images.example/one.jpg', coverNear: true };
  const context = { Image, state: { selected: ev }, window: { __SF_HOST_READY__: false },
    posterTexture() { draws++; }, renderCard() { cards++; } };
  runInNewContext(coverSource + '\nglobalThis.loadCover = loadCover;', context);
  return { ev, context, load: context.loadCover, release, reject, get image() { return image; },
    get counts() { return { images, draws, cards }; } };
}

test('cover loading awaits async decode before drawing and coalesces repeated proximity requests', async () => {
  const h = coverHarness(); h.load(h.ev); h.load(h.ev);
  assert.equal(h.counts.images, 1); assert.equal(h.image.decoding, 'async');
  const completed = h.image.onload(); assert.equal(h.counts.draws, 0);
  h.release(); await completed;
  assert.deepEqual(h.counts, { images: 1, draws: 1, cards: 1 }); assert.equal(h.ev.coverPending, false);
});

test('a decoded old cover cannot restore a previously selected card; decode failures clear pending work', async () => {
  const h = coverHarness(); h.load(h.ev); const completed = h.image.onload();
  h.context.state.selected = { id: 'two' }; h.release(); await completed;
  assert.equal(h.counts.cards, 0); assert.equal(h.counts.draws, 1);
  const bad = coverHarness(); bad.load(bad.ev); const failed = bad.image.onload();
  bad.reject(new Error('Invalid image')); await failed;
  assert.equal(bad.ev.coverPending, false); assert.equal(bad.ev.coverFailed, true); assert.equal(bad.counts.draws, 0);
});
