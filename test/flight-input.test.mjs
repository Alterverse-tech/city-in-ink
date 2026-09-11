import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { renderGame } from '../build.mjs';

const manifest = JSON.parse(await readFile(new URL('../source/manifest.json', import.meta.url)));
const html = renderGame((await Promise.all(manifest.parts.map(part =>
  readFile(new URL('../source/' + part, import.meta.url), 'utf8')))).join(''));
const keyStart = html.indexOf('this.flightKeyBlocked='), keyEnd = html.indexOf('this.onResize=', keyStart);
assert.ok(keyStart > 0 && keyEnd > keyStart);
const captureStart = html.indexOf("  window.addEventListener('keydown', (e) => {\n    if (c?.flightKeyBlocked?.(e))");
const captureEnd = html.indexOf('\n  }, true);', captureStart) + '\n  }, true);'.length;
assert.ok(captureStart > 0 && captureEnd > captureStart);

// Execute the actual built base callbacks and TW capture handler in event order.
// The DOM stand-in supplies only selector/focus behavior used by these callbacks.
class Element {
  constructor(selector, parent = null) { this.selector = selector; this.parent = parent; }
  closest(selectors) {
    return selectors.split(',').some(selector => selector.trim() === this.selector)
      ? this : this.parent?.closest(selectors) || null;
  }
}
function fixture() {
  const document = { hidden: false, modal: false, querySelector() { return this.modal ? {} : null; } };
  const listeners = {};
  const window = { addEventListener(type, fn) { listeners[type] = fn; } };
  const inputs = () => ({ forward: false, backward: false, left: false, right: false, up: false, down: false, boost: false });
  const game = { freeFlightEnabled: true, flightInput: inputs(), focusCount: 0,
    focusScene() { this.focusCount++; },
    clearFlightInput() { this.flightInput = inputs(); }, setCinematicTour() {},
    toggleFullscreen() { throw new Error('Unexpected fullscreen shortcut'); },
    flightActionForKey(key) { return ({ w: 'forward', s: 'backward', a: 'left', d: 'right', ' ': 'up', c: 'down', control: 'down', shift: 'boost' })[key]; },
  };
  const nav = { phase: 'idle', tour: { active: false }, stops: 0,
    stop() { this.stops++; this.phase = 'idle'; game.clearFlightInput(); } };
  const scope = { HTMLElement: Element, document, window, c: game, nav, state: { view: 'chase' }, setView() {},
    FLIGHT_KEYS: /^(w|a|s|d|c|b|shift|control| |spacebar|arrowup|arrowdown|arrowleft|arrowright)$/ };
  vm.runInNewContext('(function(){' + html.slice(keyStart, keyEnd) + '})', scope).call(game);
  vm.runInNewContext(html.slice(captureStart, captureEnd), scope);
  const press = (key, target = new Element('canvas'), extra = {}) => {
    const event = { key, target, prevented: false, preventDefault() { this.prevented = true; this.defaultPrevented = true; }, ...extra };
    listeners.keydown(event); game.onKeyDown(event); return event;
  };
  return { game, nav, document, window, press };
}

test('camera/card button focus accepts movement and explicit navigation yields to the same key', () => {
  for (const target of [new Element('button'), new Element('span', new Element('a'))]) {
    const { game, nav, press } = fixture();
    nav.phase = 'travel'; game.flightInput.backward = true;
    const event = press('w', target);
    assert.equal(nav.phase, 'idle'); assert.equal(nav.stops, 1);
    assert.equal(game.flightInput.forward, true); assert.equal(game.flightInput.backward, false);
    assert.equal(game.focusCount, 1, 'accepted flight input gives subsequent keys to the canvas');
    assert.equal(event.prevented, true);
    game.onKeyUp({ key: 'w', target }); assert.equal(game.flightInput.forward, false);
  }
});

test('Space/Enter retain button activation while canvas Space and Control still fly vertically', () => {
  const { game, nav, press } = fixture();
  nav.phase = 'travel';
  for (const key of [' ', 'spacebar', 'Enter']) {
    const event = press(key, new Element('button'));
    assert.equal(event.prevented, false); assert.equal(game.focusCount, 0);
    assert.equal(game.flightInput.up, false); assert.equal(nav.phase, 'travel');
  }
  press(' '); assert.equal(game.flightInput.up, true);
  game.onKeyUp({ key: ' ' }); assert.equal(game.flightInput.up, false);
  press('Control', undefined, { ctrlKey: true }); assert.equal(game.flightInput.down, true);
});

test('editing, account shadow DOM, dialogs and browser shortcuts cannot move or cancel a route', () => {
  for (const target of [new Element('input'), new Element('textarea'), new Element('select'),
    Object.assign(new Element('div'), { isContentEditable: true }),
    new Element('button', new Element('[role="dialog"]')), new Element('#sfnet')]) {
    const { game, nav, press } = fixture(); nav.phase = 'travel';
    const event = press('w', new Element('host'), { composedPath: () => [target, new Element('host')] });
    assert.equal(event.prevented, false); assert.equal(game.flightInput.forward, false); assert.equal(nav.phase, 'travel');
  }
  for (const extra of [{ isComposing: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { defaultPrevented: true }]) {
    const { game, nav, press } = fixture(); nav.phase = 'travel';
    press('w', undefined, extra); assert.equal(game.flightInput.forward, false); assert.equal(nav.phase, 'travel');
  }
  const { game, nav, document, press } = fixture(); nav.phase = 'travel'; document.modal = true;
  press('w'); assert.equal(game.flightInput.forward, false); assert.equal(nav.phase, 'travel');
});

test('blur/visibility still release keys, and flight resumes on fresh input', () => {
  const { game, document, press } = fixture();
  press('w'); game.onWindowBlur(); assert.equal(game.flightInput.forward, false);
  press('w'); assert.equal(game.flightInput.forward, true);
  document.hidden = true; game.onVisibilityChange(); assert.equal(game.flightInput.forward, false);
  document.hidden = false; press('w'); assert.equal(game.flightInput.forward, true);
});

test('Escape closes base panels or stops navigation while keeping the only flight mode active', () => {
  const callback = html.match(/let N=(J=>\{J\.key==="Escape"[\s\S]*?\});return window\.addEventListener/)[1];
  for (const panel of [false, true]) {
    const { game, nav, window } = fixture(); nav.phase = 'travel'; game.flightInput.forward = true;
    const closed = []; window.TW = { nav };
    const escape = vm.runInNewContext('(' + callback + ')', {
      window, m: panel, v: false, d: true, c: false, t: { current: game },
      h: value => closed.push(value), y: value => closed.push(value),
      p() { throw new Error('Escape must not disable flight'); }, f() {},
    });
    escape({ key: 'Escape' });
    assert.equal(game.freeFlightEnabled, true);
    if (panel) assert.deepEqual(closed, [false, false]);
    else { assert.equal(nav.phase, 'idle'); assert.equal(game.flightInput.forward, false); }
  }
});
