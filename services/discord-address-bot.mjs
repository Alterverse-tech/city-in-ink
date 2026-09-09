// SF Tech Week City ↔ Discord address bot. No dependencies: Node 22's global
// fetch and WebSocket talk to the Discord gateway directly.
//
// What it does
//   · Someone posts an address in the Discord channel — either "!address
//     <event link or id> <address>" or just an event link and an address in one
//     message — and the bot files it with the address service.
//   · The bot posts a review card in the moderator channel with Approve /
//     Reject buttons. Only members holding INK_DISCORD_MODERATOR_ROLE may press
//     them; the press is answered in place, so the thread reads as a log.
//   · Approving publishes the address to /addresses.json, which the city merges
//     on its next refresh — the airship leaves the harbour for the roof.
//   · A claim made inside the city arrives through the same queue, so the bot
//     announces it in the moderator channel for the same one-click review.
//
// Environment
//   DISCORD_BOT_TOKEN          bot token (Developer Portal → Bot → Reset Token)
//   INK_DISCORD_CHANNEL_ID     channel the bot listens to for addresses
//   INK_DISCORD_REVIEW_CHANNEL channel the review cards go to (defaults to the above)
//   INK_DISCORD_MODERATOR_ROLE role id allowed to approve (optional; server
//                              Manage Server permission always qualifies)
//   INK_ADDRESS_URL            http://127.0.0.1:8139
//   INK_ADDRESS_TOKEN          shared secret, same value as the service
//
// The bot needs the MESSAGE CONTENT intent (Developer Portal → Bot →
// Privileged Gateway Intents) and, in the channel, View Channel + Send Messages.
const TOKEN = process.env.DISCORD_BOT_TOKEN;
// Channels and roles can be named rather than pasted as ids: the bot resolves
// them against the guild at startup, which is one less thing to copy out of
// Discord's developer mode and one less thing to get wrong.
const GUILD_ID = process.env.INK_DISCORD_GUILD_ID || '';
const CHANNEL_NAME = process.env.INK_DISCORD_CHANNEL_NAME || '';
const REVIEW_NAME = process.env.INK_DISCORD_REVIEW_CHANNEL_NAME || '';
const MOD_ROLE_NAME = process.env.INK_DISCORD_MODERATOR_ROLE_NAME || '';
let LISTEN_CHANNEL = process.env.INK_DISCORD_CHANNEL_ID || '';
let REVIEW_CHANNEL = process.env.INK_DISCORD_REVIEW_CHANNEL || LISTEN_CHANNEL;
let MOD_ROLE = process.env.INK_DISCORD_MODERATOR_ROLE || '';
const SERVICE = (process.env.INK_ADDRESS_URL || 'http://127.0.0.1:8139').replace(/\/$/, '');
const SERVICE_TOKEN = process.env.INK_ADDRESS_TOKEN || '';
const API = 'https://discord.com/api/v10';
const MANAGE_GUILD = 1n << 5n;

if (!TOKEN || (!LISTEN_CHANNEL && !(GUILD_ID && CHANNEL_NAME))) {
  console.error('Set DISCORD_BOT_TOKEN, and either INK_DISCORD_CHANNEL_ID or INK_DISCORD_GUILD_ID + INK_DISCORD_CHANNEL_NAME.');
  process.exit(1);
}

/* ------------------------------------------------------------ Discord REST */
async function discord(path, { method = 'GET', body, retries = 2 } = {}) {
  const response = await fetch(API + path, {
    method,
    headers: { Authorization: `Bot ${TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'SFTechWeekCity (chrona.world, 1.0)' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 429 && retries > 0) {
    const wait = Number((await response.clone().json().catch(() => ({}))).retry_after || 1) * 1000;
    await sleep(wait + 250);
    return discord(path, { method, body, retries: retries - 1 });
  }
  if (!response.ok) throw new Error(`Discord ${method} ${path} → ${response.status} ${await response.text().catch(() => '')}`.slice(0, 300));
  return response.status === 204 ? null : response.json();
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const post = (channel, payload) => discord(`/channels/${channel}/messages`, { method: 'POST', body: payload });

/* ------------------------------------------------------- address service */
async function service(path, { method = 'GET', body } = {}) {
  const response = await fetch(SERVICE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(SERVICE_TOKEN ? { Authorization: `Bearer ${SERVICE_TOKEN}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* keep the raw text for the error */ }
  if (!response.ok) throw new Error(`address service ${response.status}: ${(parsed && parsed.error) || text}`.slice(0, 200));
  return parsed;
}


/* --------------------------------------------- names → ids, once, at startup */
const byName = (list, name) => list.find(entry => entry.name?.toLowerCase() === name.toLowerCase())
  || list.find(entry => entry.name?.toLowerCase().includes(name.toLowerCase()));

async function resolveTargets() {
  if (!GUILD_ID) return;
  if (!LISTEN_CHANNEL || (!REVIEW_CHANNEL && REVIEW_NAME) || (!MOD_ROLE && MOD_ROLE_NAME)) {
    const channels = await discord(`/guilds/${GUILD_ID}/channels`);
    if (!LISTEN_CHANNEL && CHANNEL_NAME) {
      const found = byName(channels, CHANNEL_NAME);
      if (!found) throw new Error(`no channel named ${CHANNEL_NAME} in this guild`);
      LISTEN_CHANNEL = found.id;
    }
    if (REVIEW_NAME) { const found = byName(channels, REVIEW_NAME); if (found) REVIEW_CHANNEL = found.id; }
    if (!REVIEW_CHANNEL) REVIEW_CHANNEL = LISTEN_CHANNEL;
    if (!MOD_ROLE && MOD_ROLE_NAME) {
      const roles = await discord(`/guilds/${GUILD_ID}/roles`);
      const found = byName(roles, MOD_ROLE_NAME);
      if (found) MOD_ROLE = found.id;
      else console.warn(`[bot] no role named ${MOD_ROLE_NAME}; falling back to the Manage Server permission`);
    }
  }
}

/* ------------------------------------------------------------- parsing */
const EVENT_LINK = /https?:\/\/(?:partiful\.com\/e\/[\w-]+|lu\.ma\/[\w-]+|(?:www\.)?tech-week\.com\/[^\s]+)/i;
// "123 Main St", "1 Market Street, San Francisco", "37.79, -122.40"
const COORDS = /(-?\d{2}\.\d{3,})\s*,\s*(-?\d{2,3}\.\d{3,})/;
const STREET = /\b\d{1,5}\s+[A-Za-z0-9'.\-]+(?:\s+[A-Za-z0-9'.\-]+){0,4}\s+(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Way|Ln|Lane|Pl|Place|Ct|Court|Plaza|Sq|Square|Hwy|Terrace|Alley)\b\.?/i;

function parseMessage(content) {
  const text = content.replace(/^!address\s+/i, '').trim();
  const link = (text.match(EVENT_LINK) || [])[0] || '';
  const coords = text.match(COORDS);
  const street = text.match(STREET);
  if (!link) return null;                       // an address with no event is not actionable
  if (!coords && !street) return null;
  const venue = (text.match(/(?:@|at)\s+([A-Z][\w'&.\- ]{2,48})/) || [])[1] || '';
  return {
    eventUrl: link,
    eventId: eventIdFor(link),
    address: street ? street[0].replace(/\s+/g, ' ') : '',
    lat: coords ? Number(coords[1]) : null,
    lng: coords ? Number(coords[2]) : null,
    venue: venue.trim(),
  };
}

// The game's ids for Partiful events are "partiful-<slug>"; anything else falls
// back to the URL, which the merge step also matches on.
function eventIdFor(url) {
  const partiful = url.match(/partiful\.com\/e\/([\w-]+)/i);
  return partiful ? `partiful-${partiful[1]}` : url;
}

/* --------------------------------------------------------- review cards */
function reviewCard(submission) {
  const where = submission.address || (submission.lat != null ? `${submission.lat}, ${submission.lng}` : 'unknown');
  const fields = [
    { name: 'Event', value: submission.eventUrl || submission.eventId, inline: false },
    { name: 'Address', value: where, inline: true },
    { name: 'From', value: submission.source === 'city' ? `in-world claim by ${submission.submittedBy}` : `<@${submission.discordUserId || '0'}>`, inline: true },
  ];
  if (submission.venue) fields.push({ name: 'Venue', value: submission.venue, inline: true });
  if (submission.note) fields.push({ name: 'Note', value: submission.note.slice(0, 300), inline: false });
  return {
    embeds: [{
      title: submission.eventTitle || 'Address submitted',
      description: 'Approve to place this event on its building in SF Tech Week City.',
      color: 0xc6583c,
      fields,
      footer: { text: `submission ${submission.id}` },
      timestamp: submission.createdAt,
    }],
    components: [{
      type: 1,
      components: [
        { type: 2, style: 3, label: 'Approve', custom_id: `addr:approve:${submission.id}` },
        { type: 2, style: 4, label: 'Reject', custom_id: `addr:reject:${submission.id}` },
      ],
    }],
  };
}

async function announce(submission) {
  try { await post(REVIEW_CHANNEL, reviewCard(submission)); }
  catch (error) { console.error('[bot] could not post review card:', error.message); }
}

function mayModerate(member) {
  if (!member) return false;
  if (MOD_ROLE && (member.roles || []).includes(MOD_ROLE)) return true;
  try { return (BigInt(member.permissions || '0') & MANAGE_GUILD) === MANAGE_GUILD; } catch { return false; }
}

async function respond(interaction, body) {
  await discord(`/interactions/${interaction.id}/${interaction.token}/callback`, { method: 'POST', body });
}

async function handleInteraction(interaction) {
  const id = interaction.data?.custom_id || '';
  const match = id.match(/^addr:(approve|reject):([\w-]+)$/);
  if (!match) return;
  const [, action, submissionId] = match;
  const who = interaction.member?.user || interaction.user || {};

  if (!mayModerate(interaction.member)) {
    return respond(interaction, { type: 4, data: { content: 'Only moderators can review addresses.', flags: 64 } });
  }

  try {
    const { submission } = await service(`/addresses/${submissionId}/review`, {
      method: 'POST',
      body: { decision: action === 'approve' ? 'approve' : 'reject', reviewedBy: who.username || who.id || 'moderator' },
    });
    const done = submission.status === 'approved';
    // Update the card in place: the buttons go, the outcome stays.
    await respond(interaction, {
      type: 7,
      data: {
        embeds: [{
          ...reviewCard(submission).embeds[0],
          color: done ? 0x4e8a5a : 0x8a3d29,
          description: done
            ? `Approved by ${who.username || 'a moderator'} — live in the city on the next refresh.`
            : `Rejected by ${who.username || 'a moderator'}.`,
        }],
        components: [],
      },
    });
  } catch (error) {
    console.error('[bot] review failed:', error.message);
    await respond(interaction, { type: 4, data: { content: `Could not record that: ${error.message}`, flags: 64 } });
  }
}

async function handleMessage(message) {
  if (message.author?.bot || message.channel_id !== LISTEN_CHANNEL) return;
  const parsed = parseMessage(message.content || '');
  if (!parsed) {
    if (/^!address\b/i.test(message.content || '')) {
      await post(message.channel_id, {
        content: 'Include the event link and the address, e.g. `!address https://partiful.com/e/abc123 717 Battery St` — or paste `37.7969, -122.3999` instead of a street address.',
        message_reference: { message_id: message.id, fail_if_not_exists: false },
      });
    }
    return;
  }
  try {
    const { id } = await service('/addresses', {
      method: 'POST',
      body: {
        ...parsed, source: 'discord',
        submittedBy: message.author?.username || 'discord',
        discordUserId: message.author?.id,
        discordMessageUrl: `https://discord.com/channels/${message.guild_id}/${message.channel_id}/${message.id}`,
        note: (message.content || '').slice(0, 240),
      },
    });
    const { pending } = await service('/addresses/pending');
    const submission = pending.find(s => s.id === id);
    if (submission) await announce(submission);
    await discord(`/channels/${message.channel_id}/messages/${message.id}/reactions/%E2%9C%85/@me`, { method: 'PUT' }).catch(() => {});
  } catch (error) {
    console.error('[bot] submit failed:', error.message);
    await post(message.channel_id, {
      content: `Could not file that address: ${error.message}`,
      message_reference: { message_id: message.id, fail_if_not_exists: false },
    }).catch(() => {});
  }
}

/* --------------------------------------------- watch the in-world queue */
// Claims made inside the city land in the same store with source "city"; poll
// for them so a moderator sees them without leaving Discord.
const announced = new Set();
async function pollCityClaims() {
  if (!SERVICE_TOKEN) return;
  try {
    const { pending } = await service('/addresses/pending');
    for (const submission of pending) {
      if (submission.source !== 'city' || announced.has(submission.id)) continue;
      announced.add(submission.id);
      await announce(submission);
    }
    if (announced.size > 3000) announced.clear();
  } catch (error) { console.error('[bot] poll failed:', error.message); }
}

/* ------------------------------------------------------------- gateway */
let socket = null, heartbeat = null, sequence = null, sessionId = null, resumeUrl = null, backoff = 1000;

function send(payload) { if (socket && socket.readyState === 1) socket.send(JSON.stringify(payload)); }

function connect() {
  const url = (resumeUrl || 'wss://gateway.discord.gg') + '/?v=10&encoding=json';
  socket = new WebSocket(url);

  socket.addEventListener('open', () => console.log('[bot] gateway open'));

  socket.addEventListener('message', async (event) => {
    let packet;
    try { packet = JSON.parse(event.data); } catch { return; }
    const { op, d, s, t } = packet;
    if (s !== null && s !== undefined) sequence = s;

    if (op === 10) {                                   // hello
      clearInterval(heartbeat);
      heartbeat = setInterval(() => send({ op: 1, d: sequence }), d.heartbeat_interval);
      if (sessionId) send({ op: 6, d: { token: TOKEN, session_id: sessionId, seq: sequence } });
      else send({ op: 2, d: { token: TOKEN, intents: (1 << 0) | (1 << 9) | (1 << 15), properties: { os: process.platform, browser: 'sf-tech-week-city', device: 'sf-tech-week-city' } } });
      return;
    }
    if (op === 1) return send({ op: 1, d: sequence });
    if (op === 7) return socket.close(4000, 'reconnect requested');
    if (op === 9) { sessionId = null; resumeUrl = null; await sleep(2000); return socket.close(4000, 'invalid session'); }
    if (op !== 0) return;

    if (t === 'READY') {
      sessionId = d.session_id; resumeUrl = d.resume_gateway_url; backoff = 1000;
      await resolveTargets().catch(error => console.error('[bot] could not resolve names:', error.message));
      console.log(`[bot] ready as ${d.user.username} · listening in ${LISTEN_CHANNEL} · reviews in ${REVIEW_CHANNEL}${MOD_ROLE ? ` · moderators ${MOD_ROLE}` : ''}`);
      return;
    }
    if (t === 'RESUMED') { backoff = 1000; console.log('[bot] resumed'); return; }
    try {
      if (t === 'MESSAGE_CREATE') await handleMessage(d);
      else if (t === 'INTERACTION_CREATE' && d.type === 3) await handleInteraction(d);
    } catch (error) { console.error('[bot] handler error:', error); }
  });

  socket.addEventListener('close', (event) => {
    clearInterval(heartbeat);
    // 4004 is a bad token and 4014 a missing privileged intent: retrying cannot fix either.
    if (event.code === 4004 || event.code === 4014) {
      console.error(`[bot] gateway closed ${event.code}: ${event.code === 4004 ? 'invalid bot token' : 'enable the MESSAGE CONTENT intent in the Developer Portal'}`);
      process.exit(1);
    }
    console.warn(`[bot] gateway closed (${event.code}); reconnecting in ${Math.round(backoff / 1000)}s`);
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 60_000);
  });

  socket.addEventListener('error', (event) => console.error('[bot] socket error:', event.message || event.type));
}

connect();
setInterval(pollCityClaims, 20_000);
process.on('SIGINT', () => { clearInterval(heartbeat); socket?.close(1000); process.exit(0); });
