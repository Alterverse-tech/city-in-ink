import { createHostedConnect } from './chrona/chrona-host.js';

const chrona = createHostedConnect({ hostOrigin: 'https://chrona.world' });
await chrona.ready;
window.__SF_HOST_CLIENT__ = chrona;
// The original game's preferences remain account/World-scoped in the host.
// Session storage remains ephemeral to this game frame, never platform auth storage.
const memory = new Map();
const session = { getItem: key => memory.get(String(key)) ?? null,
  setItem: (key,value) => memory.set(String(key),String(value)), removeItem: key => memory.delete(String(key)),
  clear: () => memory.clear(), key: i => [...memory.keys()][i] ?? null, get length() { return memory.size; } };
Object.defineProperty(window, 'localStorage', { value: chrona.storage, configurable: true });
Object.defineProperty(window, 'sessionStorage', { value: session, configurable: true });
