/**
 * chrona-connect-ui — an optional, self-contained account and friends panel.
 *
 * Everything renders inside a shadow root, so the game's CSS cannot reach in
 * and this cannot reach out. It is built entirely on the public surface of
 * `chrona-connect.js`: a game that wants its own art can delete this file and
 * lose nothing but the markup.
 *
 *   import { createChronaConnect } from './chrona-connect.js'
 *   import { mountChronaUI } from './chrona-connect-ui.js'
 *
 *   const chrona = createChronaConnect()
 *   mountChronaUI(chrona)          // floating pill, top-right
 *   mountChronaUI(chrona, { container: myElement, floating: false })
 */

const STYLE = `
:host {
  --cc-bg: #10131a;
  --cc-panel: #171b24;
  --cc-line: rgba(255,255,255,.10);
  --cc-text: #eef1f6;
  --cc-muted: #9aa4b5;
  --cc-accent: #6ea8fe;
  --cc-danger: #ff8080;
  --cc-ok: #7ee2a8;
  --cc-radius: 14px;
  --cc-font: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, "PingFang SC", "Microsoft YaHei", sans-serif;
  all: initial;
  font-family: var(--cc-font);
  color: var(--cc-text);
}
* { box-sizing: border-box; }
/* Author rules beat the UA stylesheet regardless of specificity, so a
   class like .stack{display:grid} would otherwise defeat [hidden]. */
[hidden] { display: none !important; }
button, input, textarea { font: inherit; color: inherit; }

.pill {
  position: fixed; top: 14px; right: 14px; z-index: 2147483000;
  display: inline-flex; align-items: center; gap: 8px;
  max-width: 220px; padding: 8px 14px;
  border: 1px solid var(--cc-line); border-radius: 999px;
  background: rgba(16,19,26,.82); backdrop-filter: blur(10px);
  color: var(--cc-text); font-size: 13px; font-weight: 600;
  cursor: pointer; transition: border-color .15s, transform .15s;
}
.pill:hover { border-color: rgba(255,255,255,.24); }
.pill:active { transform: scale(.98); }
.pill[data-inline] { position: static; }
.pill .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--cc-muted); flex: 0 0 auto; }
.pill[data-signed-in] .dot { background: var(--cc-ok); }
.pill .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pill .count {
  padding: 1px 7px; border-radius: 999px; font-size: 11px;
  background: rgba(110,168,254,.16); color: var(--cc-accent);
}

.scrim {
  position: fixed; inset: 0; z-index: 2147483001;
  display: grid; place-items: center; padding: 18px;
  background: rgba(6,8,12,.62); backdrop-filter: blur(3px);
}
.scrim[hidden] { display: none; }

.panel {
  width: min(420px, 100%); max-height: min(86vh, 720px); overflow: auto;
  padding: 22px; border: 1px solid var(--cc-line); border-radius: var(--cc-radius);
  background: var(--cc-panel); box-shadow: 0 24px 70px rgba(0,0,0,.55);
}
.head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 6px; }
h2 { margin: 0; font-size: 17px; font-weight: 650; letter-spacing: -.01em; }
.intro { margin: 0 0 16px; font-size: 13px; line-height: 1.5; color: var(--cc-muted); }
.x {
  flex: 0 0 auto; width: 30px; height: 30px; border: 0; border-radius: 8px;
  background: rgba(255,255,255,.06); cursor: pointer; font-size: 17px; line-height: 1;
}
.x:hover { background: rgba(255,255,255,.12); }

.stack { display: grid; gap: 9px; }
.provider {
  display: flex; align-items: center; gap: 10px; width: 100%;
  padding: 11px 14px; border: 1px solid var(--cc-line); border-radius: 10px;
  background: rgba(255,255,255,.03); cursor: pointer; font-size: 14px; font-weight: 500;
  text-align: left; transition: background .15s, border-color .15s;
}
.provider:hover:not(:disabled) { background: rgba(255,255,255,.07); border-color: rgba(255,255,255,.2); }
.provider:disabled { opacity: .45; cursor: not-allowed; }
.provider svg { flex: 0 0 auto; }

.divider { display: flex; align-items: center; gap: 10px; margin: 16px 0; color: var(--cc-muted); font-size: 11px; text-transform: uppercase; letter-spacing: .09em; }
.divider::before, .divider::after { content: ""; flex: 1; height: 1px; background: var(--cc-line); }

label { display: block; margin-bottom: 6px; font-size: 12px; color: var(--cc-muted); }
input, textarea {
  width: 100%; padding: 10px 12px; border: 1px solid var(--cc-line); border-radius: 10px;
  background: rgba(0,0,0,.28); font-size: 14px;
}
input:focus, textarea:focus { outline: 2px solid var(--cc-accent); outline-offset: 1px; }
textarea { resize: vertical; min-height: 66px; }
input[data-otp] { letter-spacing: .34em; text-align: center; font-size: 19px; }

.btn {
  width: 100%; padding: 11px 14px; border: 1px solid transparent; border-radius: 10px;
  background: var(--cc-accent); color: #0b1220; font-size: 14px; font-weight: 620; cursor: pointer;
}
.btn:disabled { opacity: .5; cursor: not-allowed; }
.btn.quiet { background: rgba(255,255,255,.05); border-color: var(--cc-line); color: var(--cc-text); font-weight: 500; }
.btn.danger { background: transparent; border-color: rgba(255,128,128,.34); color: var(--cc-danger); font-weight: 500; }
.link { border: 0; background: none; padding: 4px 0; color: var(--cc-accent); font-size: 13px; cursor: pointer; text-decoration: underline; }

.msg { margin: 12px 0 0; font-size: 12.5px; line-height: 1.5; min-height: 1em; }
.msg.status { color: var(--cc-muted); }
.msg.error { color: var(--cc-danger); }
.msg:empty { margin: 0; min-height: 0; }

.identity { display: flex; align-items: center; gap: 11px; margin-bottom: 16px; }
.identity .who { min-width: 0; }
.identity .name { font-size: 15px; font-weight: 620; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.identity .sub { font-size: 12px; color: var(--cc-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.avatar {
  flex: 0 0 auto; display: grid; place-items: center; overflow: hidden;
  width: 40px; height: 40px; border-radius: 50%;
  background: linear-gradient(140deg, #2b3446, #1b2130); font-size: 15px; font-weight: 650;
}
.avatar img { width: 100%; height: 100%; object-fit: cover; }

.section { margin-top: 20px; padding-top: 18px; border-top: 1px solid var(--cc-line); }
.section-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
h3 { margin: 0; font-size: 13px; font-weight: 620; text-transform: uppercase; letter-spacing: .07em; color: var(--cc-muted); }
.section-head .btn { width: auto; padding: 6px 11px; font-size: 12px; }

.friends { list-style: none; margin: 0; padding: 0; display: grid; gap: 7px; }
.friend { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 10px; background: rgba(255,255,255,.03); }
.friend .who { flex: 1; min-width: 0; }
.friend .name { font-size: 13.5px; font-weight: 560; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.friend .handle { font-size: 11.5px; color: var(--cc-muted); }
.friend .avatar { width: 30px; height: 30px; font-size: 12px; }
.tag { padding: 2px 7px; border-radius: 999px; font-size: 10.5px; font-weight: 600; background: rgba(255,255,255,.07); color: var(--cc-muted); }
.tag[data-source="x"] { background: rgba(255,255,255,.11); color: #e8ecf3; }
.tag[data-source="discord"] { background: rgba(88,101,242,.2); color: #aab4ff; }
.empty { margin: 0; font-size: 12.5px; line-height: 1.55; color: var(--cc-muted); }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
`

const ICONS = {
  google: '<svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.2a5.3 5.3 0 0 1-2.3 3.5v2.9h3.7c2.2-2 3.4-5 3.4-8.6z"/><path fill="#34A853" d="M12 24c3.1 0 5.7-1 7.6-2.8l-3.7-2.9c-1 .7-2.3 1.1-3.9 1.1-3 0-5.5-2-6.4-4.7H1.8v3a12 12 0 0 0 10.2 6.3z"/><path fill="#FBBC05" d="M5.6 14.7a7.2 7.2 0 0 1 0-4.6v-3H1.8a12 12 0 0 0 0 10.6l3.8-3z"/><path fill="#EA4335" d="M12 4.8c1.7 0 3.2.6 4.4 1.7l3.3-3.3A11.6 11.6 0 0 0 12 0 12 12 0 0 0 1.8 6.1l3.8 3C6.5 6.7 9 4.8 12 4.8z"/></svg>',
  discord: '<svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true"><path fill="#5865F2" d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.3.5c1.6.4 2.9 1 4.2 1.8a14.6 14.6 0 0 0-12.6 0A16 16 0 0 1 11 3.5L10.6 3a19.7 19.7 0 0 0-5 1.4C2.5 9 1.7 13.4 2.1 17.8a19.9 19.9 0 0 0 6 3l1.2-1.9c-.7-.2-1.3-.5-1.9-.9l.4-.3a14.2 14.2 0 0 0 12.2 0l.4.3c-.6.4-1.2.7-1.9.9l1.2 1.9c2.2-.7 4.2-1.7 6-3 .5-5.1-.8-9.5-3.4-13.4zM8.7 15.2c-1.2 0-2.1-1.1-2.1-2.4S7.5 10.4 8.7 10.4s2.2 1.1 2.1 2.4c0 1.3-.9 2.4-2.1 2.4zm6.6 0c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.2 1.1 2.1 2.4c0 1.3-.9 2.4-2.1 2.4z"/></svg>',
  x: '<svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18.2 2h3.4l-7.4 8.5L23 22h-6.8l-5.3-7-6.1 7H1.4l7.9-9.1L1 2h7l4.8 6.4L18.2 2zm-1.2 18h1.9L7.1 3.9H5.1L17 20z"/></svg>',
}

const initialOf = value => Array.from(String(value || '').trim())[0]?.toLocaleUpperCase() || 'P'

/**
 * Mount the panel.
 *
 * @param chrona                a `createChronaConnect()` instance
 * @param container             where to put the trigger (default: document.body)
 * @param floating              false anchors the trigger inline instead of fixed
 * @param title / signedOutText panel copy
 * @param showFriends           hide the friends section for an account-only game
 * @returns { open, close, destroy, root }
 */
export function mountChronaUI(chrona, {
  container = document.body,
  floating = true,
  title = 'Your account',
  signedOutText = 'Sign in to bring your Chrona account, profile, and friends into this game.',
  showFriends = true,
} = {}) {
  if (!chrona?.auth) throw new TypeError('mountChronaUI requires a chrona-connect instance')

  const host = document.createElement('div')
  host.dataset.chronaConnect = 'ui'
  const root = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = STYLE
  root.append(style)

  /* ------------------------------------------------------------- structure */

  const pill = document.createElement('button')
  pill.type = 'button'
  pill.className = 'pill'
  if (!floating) pill.dataset.inline = ''
  pill.innerHTML = '<span class="dot"></span><span class="label">Sign in</span>'
  const pillLabel = pill.querySelector('.label')
  const pillCount = document.createElement('span')
  pillCount.className = 'count'
  pillCount.hidden = true
  pill.append(pillCount)

  const scrim = document.createElement('div')
  scrim.className = 'scrim'
  scrim.hidden = true
  scrim.innerHTML = `
    <div class="panel" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="head">
        <h2>${title}</h2>
        <button class="x" type="button" data-close aria-label="Close">&times;</button>
      </div>

      <div data-view="out">
        <p class="intro">${signedOutText}</p>
        <div class="stack" data-providers></div>
        <div class="divider" data-email-divider>or use an email code</div>
        <form class="stack" data-email-form>
          <div>
            <label for="cc-email">Email address</label>
            <input id="cc-email" type="email" autocomplete="email" inputmode="email" placeholder="you@example.com" required>
          </div>
          <button class="btn" type="submit">Send me a code</button>
        </form>
        <form class="stack" data-otp-form hidden>
          <div>
            <label for="cc-otp">Six-digit code</label>
            <input id="cc-otp" data-otp type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" placeholder="000000" required>
          </div>
          <button class="btn" type="submit">Verify and sign in</button>
          <button class="link" type="button" data-otp-back>Use another email</button>
        </form>
      </div>

      <div data-view="in" hidden>
        <div class="identity">
          <span class="avatar" data-avatar aria-hidden="true">P</span>
          <div class="who">
            <div class="name" data-name></div>
            <div class="sub" data-sub></div>
          </div>
        </div>
        <form class="stack" data-profile-form>
          <div>
            <label for="cc-name">Display name</label>
            <input id="cc-name" type="text" autocomplete="nickname" maxlength="24" required>
          </div>
          <div>
            <label for="cc-bio">Bio</label>
            <textarea id="cc-bio" maxlength="240" rows="3" placeholder="A short introduction"></textarea>
          </div>
          <button class="btn" type="submit">Save profile</button>
        </form>

        <div class="section" data-friends-section>
          <div class="section-head">
            <h3>People you know</h3>
            <button class="btn quiet" type="button" data-friends-refresh>Refresh</button>
          </div>
          <p class="msg status" data-friends-status></p>
          <p class="msg error" data-friends-error></p>
          <ul class="friends" data-friends hidden></ul>
          <p class="empty" data-friends-empty></p>
        </div>

        <div class="section">
          <button class="btn danger" type="button" data-sign-out>Sign out</button>
        </div>
      </div>

      <p class="msg status" data-status role="status" aria-live="polite"></p>
      <p class="msg error" data-error role="alert"></p>
    </div>`

  root.append(pill, scrim)
  container.append(host)

  const $ = selector => scrim.querySelector(selector)
  const panel = $('.panel')
  const viewOut = $('[data-view="out"]')
  const viewIn = $('[data-view="in"]')
  const providerStack = $('[data-providers]')
  const emailDivider = $('[data-email-divider]')
  const emailForm = $('[data-email-form]')
  const emailInput = $('#cc-email')
  const otpForm = $('[data-otp-form]')
  const otpInput = $('#cc-otp')
  const profileForm = $('[data-profile-form]')
  const nameInput = $('#cc-name')
  const bioInput = $('#cc-bio')
  const statusText = $('[data-status]')
  const errorText = $('[data-error]')
  const avatar = $('[data-avatar]')
  const nameLabel = $('[data-name]')
  const subLabel = $('[data-sub]')
  const friendsSection = $('[data-friends-section]')
  const friendsList = $('[data-friends]')
  const friendsEmpty = $('[data-friends-empty]')
  const friendsStatus = $('[data-friends-status]')
  const friendsError = $('[data-friends-error]')
  const friendsRefresh = $('[data-friends-refresh]')

  const providerButtons = new Map()
  for (const [id, label] of [['google', 'Continue with Google'], ['discord', 'Continue with Discord'], ['x', 'Continue with X']]) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'provider'
    button.dataset.provider = id
    button.innerHTML = `${ICONS[id]}<span>${label}</span>`
    button.addEventListener('click', () => { void chrona.auth.signInWithProvider(id) })
    providerStack.append(button)
    providerButtons.set(id, button)
  }

  friendsSection.hidden = !showFriends || !chrona.friends

  /* ---------------------------------------------------------------- render */

  let open = false
  let lastFocus = null
  let signedIn = false
  let profileDirty = false
  let lastRenderedUserId = ''
  let playerActed = false
  let surfacedRedirectError = false

  function renderAccount(state) {
    signedIn = !!state.userId
    viewOut.hidden = signedIn
    viewIn.hidden = !signedIn
    statusText.textContent = state.status || ''
    errorText.textContent = state.error || ''

    for (const button of providerButtons.values()) button.disabled = state.busy
    emailInput.disabled = state.busy
    otpInput.disabled = state.busy

    pill.toggleAttribute('data-signed-in', signedIn)
    pillLabel.textContent = signedIn ? state.profile.displayName : 'Sign in'
    pill.setAttribute('aria-label', signedIn
      ? `Open the account panel for ${state.profile.displayName}`
      : 'Sign in or create an account')

    if (!signedIn) {
      if (state.lastEmail && !emailInput.value) emailInput.value = state.lastEmail
      lastRenderedUserId = ''
      // A sign-in that failed on the way back from a provider produces an error
      // with nothing on screen to show it. Open once, before the player has
      // touched anything, so the reason is not silently lost.
      if (state.error && !open && !playerActed && !surfacedRedirectError) {
        surfacedRedirectError = true
        openPanel({ byPlayer: false })
      }
      return
    }

    nameLabel.textContent = state.profile.displayName
    subLabel.textContent = state.providerLabel
      ? `${state.providerLabel} · ${state.user?.email || state.userId}`
      : (state.user?.email || state.userId)
    avatar.textContent = initialOf(state.profile.displayName)

    // Never overwrite half-typed edits; refill only when the account changes.
    if (state.userId !== lastRenderedUserId || !profileDirty) {
      nameInput.value = state.profile.displayName
      bioInput.value = state.profile.bio
      profileDirty = false
    }
    lastRenderedUserId = state.userId
  }

  function friendElement(friend) {
    const item = document.createElement('li')
    item.className = 'friend'

    const face = document.createElement('span')
    face.className = 'avatar'
    face.setAttribute('aria-hidden', 'true')
    face.textContent = initialOf(friend.displayName)
    if (friend.avatarUrl) {
      const image = document.createElement('img')
      image.alt = ''
      image.loading = 'lazy'
      image.referrerPolicy = 'no-referrer'
      image.src = friend.avatarUrl
      image.addEventListener('error', () => image.remove(), { once: true })
      face.append(image)
    }

    const who = document.createElement('div')
    who.className = 'who'
    const name = document.createElement('div')
    name.className = 'name'
    name.textContent = friend.displayName
    who.append(name)
    if (friend.xUsername) {
      const handle = document.createElement('div')
      handle.className = 'handle'
      handle.textContent = `@${friend.xUsername}`
      who.append(handle)
    }

    item.append(face, who)
    for (const source of friend.sources) {
      const tag = document.createElement('span')
      tag.className = 'tag'
      tag.dataset.source = source
      tag.textContent = source === 'x' ? 'X' : 'Discord'
      item.append(tag)
    }
    return item
  }

  function renderFriends(state) {
    if (!showFriends || !chrona.friends) return
    friendsStatus.textContent = state.status || ''
    friendsError.textContent = state.error || ''
    friendsRefresh.disabled = state.state === 'loading' || state.syncing
    friendsRefresh.textContent = state.canRetryLink
      ? 'Retry connection'
      : (state.state === 'loading' ? 'Refreshing…' : 'Refresh')

    const show = state.friends.length > 0 && !state.sourcesRequired
    friendsList.hidden = !show
    friendsEmpty.hidden = show
    friendsList.replaceChildren(...(show ? state.friends.map(friendElement) : []))
    if (!show) {
      friendsEmpty.textContent = state.sourcesRequired
        ? 'Sign in with X or Discord to connect a friend source. People you already know will appear here.'
        : state.state === 'loading'
          ? 'Looking for people you know…'
          : 'No people you know have been found yet.'
    }

    pillCount.hidden = !signedIn || !state.count
    pillCount.textContent = String(state.count)
  }

  /* -------------------------------------------------------------- behaviour */

  const focusable = () => [...panel.querySelectorAll('button, input, textarea, [href]')]
    .filter(node => !node.disabled && node.offsetParent !== null)

  function openPanel({ byPlayer = true } = {}) {
    if (byPlayer) playerActed = true
    if (open) return
    open = true
    lastFocus = document.activeElement
    scrim.hidden = false
    // Deliberately does not clear messages: a failed sign-in redirect leaves an
    // error behind, and this is the moment the player finally reads it.
    if (signedIn && chrona.friends) void chrona.friends.refresh()
    requestAnimationFrame(() => (signedIn ? nameInput : emailInput).focus({ preventScroll: true }))
  }

  function closePanel() {
    if (!open) return
    open = false
    scrim.hidden = true
    if (lastFocus?.isConnected) lastFocus.focus({ preventScroll: true })
    lastFocus = null
  }

  pill.addEventListener('click', () => { playerActed = true; return open ? closePanel() : openPanel() })
  scrim.addEventListener('click', event => { if (event.target === scrim) closePanel() })
  $('[data-close]').addEventListener('click', closePanel)

  // A game usually owns the keyboard, so key handling stays inside the panel.
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closePanel()
      return
    }
    if (event.key !== 'Tab') return
    const nodes = focusable()
    if (nodes.length < 2) return
    const first = nodes[0]
    const last = nodes[nodes.length - 1]
    const active = root.activeElement
    if (event.shiftKey && active === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  })
  // Movement keys typed into the panel must not also drive the player.
  panel.addEventListener('keyup', event => event.stopPropagation())
  panel.addEventListener('keypress', event => event.stopPropagation())

  emailForm.addEventListener('submit', async event => {
    event.preventDefault()
    if (await chrona.auth.sendEmailCode(emailInput.value)) {
      emailForm.hidden = true
      emailDivider.hidden = true
      otpForm.hidden = false
      otpInput.value = ''
      otpInput.focus()
    }
  })

  otpForm.addEventListener('submit', async event => {
    event.preventDefault()
    if (await chrona.auth.verifyEmailCode(emailInput.value, otpInput.value)) {
      otpForm.hidden = true
      emailForm.hidden = false
      emailDivider.hidden = false
    }
  })

  $('[data-otp-back]').addEventListener('click', () => {
    otpForm.hidden = true
    emailForm.hidden = false
    emailDivider.hidden = false
    emailInput.focus()
  })

  for (const field of [nameInput, bioInput]) {
    field.addEventListener('input', () => { profileDirty = true })
  }

  profileForm.addEventListener('submit', async event => {
    event.preventDefault()
    if (await chrona.auth.saveProfile({ displayName: nameInput.value, bio: bioInput.value })) {
      profileDirty = false
    }
  })

  $('[data-sign-out]').addEventListener('click', () => { void chrona.auth.signOut() })

  friendsRefresh?.addEventListener('click', () => {
    const state = chrona.friends?.snapshot()
    if (state?.canRetryLink) void chrona.friends.retryLink()
    else void chrona.friends?.refresh()
  })

  const unsubscribeAuth = chrona.auth.subscribe(renderAccount)
  const unsubscribeFriends = chrona.friends?.subscribe(renderFriends) || (() => {})

  // Show only the providers this deployment actually has enabled.
  void chrona.auth.enabledProviders()
    .then(enabled => {
      for (const [id, button] of providerButtons) button.hidden = !enabled[id]
      const allHidden = [...providerButtons.values()].every(button => button.hidden)
      providerStack.hidden = allHidden
      emailDivider.hidden = allHidden || !otpForm.hidden
      emailForm.hidden = !enabled.email
    })
    .catch(() => {})

  return Object.freeze({
    root,
    open: openPanel,
    close: closePanel,
    get isOpen() { return open },
    destroy() {
      unsubscribeAuth()
      unsubscribeFriends()
      host.remove()
    },
  })
}

export default mountChronaUI
