// MYRA Mirror — service worker. Holds the member token, talks to /api/mirror,
// caches a page's ranking for ten minutes so a revisit reorders instantly,
// and keeps the per-tab "lifted N pieces" count for the badge and popup.

// Production by default: this is what the store build ships with. Chloe's
// unpacked dev copy points at her dev server through the popup's advanced
// field, once, on her machine only.
importScripts('browser-api.js')
const { api: ext, onMessage } = globalThis.__myraBrowser
const DEFAULTS = { apiBase: 'https://www.myraassistant.co.uk', token: null, member: null, disabledHosts: [] }
const RANK_TTL_MS = 10 * 60_000
const rankCache = new Map() // `${host}|${hash}` → { at, data }
const picksCache = new Map() // same key → { at, data } — the panel reopens instantly
// The styling job runs HERE, not in the page: she can walk on to the next
// product, or the next site, and the panel keeps building on the right.
let styleJob = null // { id, product, mode, status, looks, hero, error, startedAt }
// Everything she has had styled, newest first, so the panel is a place to
// come back to rather than one answer that sits there until it is closed.
const HISTORY_MAX = 20
let styleHistory = null // [{ id, product, mode, looks, hero, at }]

// 0.4.2: once, move a dev-server copy onto the live site. The dev server was
// slow enough (~30s+) that stylings were cut off before they landed. The
// popup's advanced field can still point it back.
;(async () => {
  const st = await ext.storage.local.get(['apiBase', 'apiBaseLive042'])
  if (st?.apiBaseLive042) return
  if (/localhost|127\.0\.0\.1/i.test(st?.apiBase || '')) await ext.storage.local.set({ apiBase: DEFAULTS.apiBase })
  await ext.storage.local.set({ apiBaseLive042: true })
})().catch(() => {})

async function loadHistory() {
  if (styleHistory) return styleHistory
  const stored = await ext.storage.local.get('styleHistory')
  styleHistory = Array.isArray(stored?.styleHistory) ? stored.styleHistory : []
  return styleHistory
}

/** A finished styling joins the history (replacing itself if it is already there). */
async function remember(job) {
  if (!job || !(job.looks || []).length) return
  const list = await loadHistory()
  const entry = { id: job.id, product: job.product, mode: job.mode, looks: job.looks, hero: job.hero || null, at: job.startedAt || Date.now() }
  styleHistory = [entry, ...list.filter((h) => h.id !== job.id)].slice(0, HISTORY_MAX)
  try { await ext.storage.local.set({ styleHistory }) } catch {}
}
const tabStats = new Map() // tabId → { host, lifted, total, member, ms }

async function cfg() {
  const stored = await ext.storage.local.get(null)
  return { ...DEFAULTS, ...stored }
}

function hashKeys(products) {
  const s = products.map((p) => p.key).sort().join(',')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return String(h)
}

// ── WHEN MYRA CANNOT BE REACHED ─────────────────────────────────────────────
// 0.4.6: a fetch that threw (the address is wrong, the dev server is off, she
// is offline) used to surface as a bare "Failed to fetch" and a rank that
// quietly did nothing; a token the site had stopped accepting cleared itself
// just as quietly. The last failure is kept per address so the badge and the
// popup can say so, and it is forgotten the moment a call to that address
// comes back 200. `kind` is 'offline' (no answer at all) or 'auth' (401).
let apiFailures = null // { [apiBase]: { kind, at, message } }
async function loadFailures() {
  if (apiFailures) return apiFailures
  const stored = await ext.storage.local.get('apiFailures')
  apiFailures = stored?.apiFailures && typeof stored.apiFailures === 'object' ? stored.apiFailures : {}
  return apiFailures
}
async function noteFailure(apiBase, kind, message) {
  const all = await loadFailures()
  const was = all[apiBase]
  all[apiBase] = { kind, at: Date.now(), message: String(message || '').slice(0, 200) }
  if (!was || was.kind !== kind) { try { await ext.storage.local.set({ apiFailures: all }) } catch {} }
}
async function clearFailure(apiBase) {
  const all = await loadFailures()
  if (!all[apiBase]) return
  delete all[apiBase]
  try { await ext.storage.local.set({ apiFailures: all }) } catch {}
}
/** The failure standing against the address in use, or null. */
async function currentFailure(c) {
  const all = await loadFailures()
  return all[c.apiBase] || null
}

async function api(path, init = {}) {
  const c = await cfg()
  if (!c.token) return { status: 401, json: { error: 'not connected' }, kind: 'auth' }
  let res
  try {
    res = await fetch(`${c.apiBase.replace(/\/+$/, '')}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.token}`, ...(init.headers || {}) },
    })
  } catch (e) {
    const message = String(e?.message || e)
    await noteFailure(c.apiBase, 'offline', message)
    return { status: 0, json: { error: message }, kind: 'offline' }
  }
  if (res.status === 401) {
    await ext.storage.local.set({ token: null, member: null })
    await noteFailure(c.apiBase, 'auth', 'token rejected')
  } else if (res.status === 200) {
    await clearFailure(c.apiBase)
  }
  let json = null
  try { json = await res.json() } catch {}
  return { status: res.status, json, kind: res.status === 401 ? 'auth' : res.status === 200 ? null : 'server' }
}

// Chrome puts an idle service worker to sleep after ~30s, and a pending fetch
// does not count as activity — a styling that took longer (the dev server's
// quick pass alone is ~30s) was cut off mid-request: the job sat on "loading"
// forever and never reached her history. Any extension API call resets the
// idle clock, so while a job is building, make one every 20s.
let keepAwake = null
function holdAwake(on) {
  if (on && !keepAwake) keepAwake = setInterval(() => { Promise.resolve(ext.runtime.getPlatformInfo()).catch(() => {}) }, 20_000)
  if (!on && keepAwake) { clearInterval(keepAwake); keepAwake = null }
}

async function saveJob() {
  holdAwake(styleJob?.status === 'loading' || styleJob?.status === 'partial')
  try { await ext.storage.local.set({ styleJob }) } catch {}
  // Every open tab redraws from the job it is told about.
  try {
    const tabs = await ext.tabs.query({})
    for (const t of tabs) {
      if (t.id == null) continue
      Promise.resolve(ext.tabs.sendMessage(t.id, { type: 'styleUpdate', job: styleJob })).catch(() => {})
    }
  } catch {}
}

// Safari only: hand the token to the native side, which writes it into the
// app group the share sheet reads. Everywhere else this rejects and we move
// on — the share sheet is an iOS affordance.
function shareTokenWithApp(token, apiBase) {
  try {
    const rt = globalThis.browser?.runtime || ext.runtime
    if (typeof rt?.sendNativeMessage !== 'function') return
    Promise.resolve(rt.sendNativeMessage({ type: 'mirrorToken', token: token || null, apiBase: apiBase || null })).catch(() => {})
  } catch {}
}

const handlers = {
  async state({ host }) {
    const c = await cfg()
    return { enabled: !c.disabledHosts.includes(host), connected: !!c.token, member: c.member, apiBase: c.apiBase, failure: await currentFailure(c) }
  },

  async rank({ host, products, scan }) {
    const key = `${host}|${hashKeys(products)}`
    const hit = rankCache.get(key)
    if (hit && Date.now() - hit.at < RANK_TTL_MS) return { ...hit.data, cached: true }
    const { status, json, kind } = await api('/api/mirror/rank', { method: 'POST', body: JSON.stringify({ host, products, scan: scan === true }) })
    // Never connected at all: quiet, as before — the popup says "Connect".
    // A token the site turned away, or an address that does not answer, is
    // named so the page can say "tap to reconnect".
    if (status === 401 && !(await currentFailure(await cfg()))) return { error: 'not connected' }
    if (status !== 200 || !json) return { error: json?.error || `rank failed (${status})`, kind: kind || 'server' }
    rankCache.set(key, { at: Date.now(), data: json })
    return json
  },

  /**
   * Her top picks for this page — the gaps in her wardrobe and her taste, each
   * piece with a look around it. Expensive to build, so it is asked for when
   * she opens the panel, never on page load, and the answer is cached like a
   * ranking so reopening it is instant.
   */
  async picks({ host, products }) {
    const c = await cfg()
    if (!c.token) return { error: 'Connect MYRA first' }
    const key = `${host}|${hashKeys(products)}`
    const hit = picksCache.get(key)
    if (hit && Date.now() - hit.at < RANK_TTL_MS) return hit.data
    const { status, json } = await api('/api/mirror/picks', { method: 'POST', body: JSON.stringify({ host, products }) })
    if (status !== 200 || !json) return { error: json?.error || `picks failed (${status})` }
    picksCache.set(key, { at: Date.now(), data: json })
    return json
  },

  async setToken({ token, member, apiBase }) {
    if (apiBase) await ext.storage.local.set({ apiBase })
    await ext.storage.local.set({ token, member: member || null })
    const { status, json } = await api('/api/mirror/me')
    if (status !== 200) return { ok: false, error: 'token rejected' }
    await ext.storage.local.set({ member: json.name })
    rankCache.clear()
    shareTokenWithApp(token, apiBase)
    // Every shop page already open ranks itself again, so a "can't be
    // reached" line clears without her reloading the page.
    try {
      const tabs = await ext.tabs.query({})
      for (const t of tabs) { if (t.id != null) Promise.resolve(ext.tabs.sendMessage(t.id, { type: 'rerun' })).catch(() => {}) }
    } catch {}
    return { ok: true, member: json.name }
  },

  // Only our own content scripts can ask; the token then travels by postMessage
  // straight into the MYRA pop-out frame, never through the brand page's DOM.
  /** Which build is actually running — the page compares it with its own. */
  async version() {
    try { return { version: ext.runtime.getManifest().version } } catch { return { version: null } }
  },

  async token() {
    const c = await cfg()
    return { token: c.token, apiBase: c.apiBase }
  },

  async me() {
    const { status, json } = await api('/api/mirror/me')
    return status === 200 ? json : { connected: false }
  },

  async disconnect() {
    await ext.storage.local.set({ token: null, member: null })
    await clearFailure((await cfg()).apiBase)
    rankCache.clear()
    shareTokenWithApp(null, null)
    return { ok: true }
  },

  async setApiBase({ apiBase }) {
    await ext.storage.local.set({ apiBase })
    rankCache.clear()
    return { ok: true }
  },

  async toggleHost({ host, enabled }) {
    const c = await cfg()
    const set = new Set(c.disabledHosts)
    enabled ? set.delete(host) : set.add(host)
    await ext.storage.local.set({ disabledHosts: [...set] })
    return { enabled }
  },

  /**
   * Her Vinted purchases, read in her own signed-in tab and sent to MYRA.
   * She asks for it from the popup; MYRA never holds her Vinted password and
   * nothing is written back to Vinted.
   */
  async vintedImport({ tabId }) {
    const c = await cfg()
    if (!c.token) return { error: 'Connect MYRA first' }
    let res
    try {
      res = await ext.tabs.sendMessage(tabId, { type: 'readVintedOrders' })
    } catch {
      return { error: 'Open your Vinted orders page in this tab, then try again' }
    }
    if (!res?.ok) return { error: res?.error || 'Could not read this page' }
    if (!res.orders.length) return { error: 'No orders on this page — open My orders / Purchases on Vinted' }
    const { status, json } = await api('/api/mirror/vinted-purchases', {
      method: 'POST',
      body: JSON.stringify({ url: res.url, orders: res.orders }),
    })
    if (status !== 200 || !json) return { error: json?.error || `MYRA refused the list (${status})` }
    return json
  },

  /**
   * WHAT DO I WEAR WITH THIS — start building looks around a piece. Returns at
   * once; the work carries on in the service worker and every tab is told when
   * it lands, so leaving the page does not stop it.
   */
  async styleStart({ product, mode }) {
    const c = await cfg()
    if (!c.token) return { error: 'Connect MYRA first' }
    const id = `${Date.now()}`
    styleJob = { id, product, mode: mode === 'wardrobe' ? 'wardrobe' : 'inspiration', status: 'loading', looks: [], startedAt: Date.now() }
    await saveJob()
    // Two passes: what MYRA composed (seconds), then the same looks after its
    // eye has been over them. She sees something quickly and it sharpens.
    api('/api/mirror/style', { method: 'POST', body: JSON.stringify({ ...product, mode: styleJob.mode, quick: true }) })
      .then(async ({ status, json }) => {
        if (!styleJob || styleJob.id !== id || styleJob.status !== 'loading') return
        if (status === 200 && json && !json.error && (json.looks || []).length) {
          styleJob = { ...styleJob, status: 'partial', looks: json.looks, hero: json.hero || null }
          await saveJob()
        }
      }).catch(() => {})

    const body = JSON.stringify({ ...product, mode: styleJob.mode })
    api('/api/mirror/style', { method: 'POST', body }).then(async ({ status, json }) => {
      if (!styleJob || styleJob.id !== id) return // she asked for something else since
      if (status !== 200 || !json || json.error) {
        styleJob = { ...styleJob, status: 'error', dismissed: false, error: json?.error || `MYRA could not style this (${status})` }
      } else {
        styleJob = { ...styleJob, status: 'done', dismissed: false, looks: json.looks || [], hero: json.hero || null, hidden: json.hidden || 0 }
      }
      await remember(styleJob)
      await saveJob()
    }).catch(async (e) => {
      if (!styleJob || styleJob.id !== id) return
      styleJob = { ...styleJob, status: 'error', error: String(e?.message || e) }
      await saveJob()
    })
    return { job: styleJob }
  },

  /** What the panel should be showing right now — asked by every page as it loads. */
  async styleJob() {
    if (!styleJob) {
      const stored = await ext.storage.local.get('styleJob')
      styleJob = stored?.styleJob ?? null
      // A job left loading by a restarted worker is not coming back.
      if (styleJob?.status === 'loading' && Date.now() - (styleJob.startedAt || 0) > 3 * 60_000) {
        styleJob = { ...styleJob, status: 'error', error: 'That took too long — ask again' }
      }
    }
    return { job: styleJob }
  },

  async styleClose() {
    // Closed while still building: the work carries on and lands in her
    // history; the dot lights once when it is done, not before.
    if (styleJob && styleJob.status === 'loading') {
      styleJob = { ...styleJob, dismissed: true }
      await saveJob()
      return { ok: true, pending: true }
    }
    styleJob = null
    await saveJob()
    return { ok: true }
  },

  /** Everything she has had styled, newest first — the panel's home. */
  async styleHistory() {
    const list = await loadHistory()
    return { items: list.map((h) => ({ id: h.id, product: h.product, mode: h.mode, at: h.at, looks: (h.looks || []).length })) }
  },

  /** Open one from the history: it becomes the job the panel shows. */
  async styleOpen({ id }) {
    const list = await loadHistory()
    const h = list.find((x) => x.id === id)
    if (!h) return { error: 'That one is gone from your history' }
    styleJob = { id: h.id, product: h.product, mode: h.mode, status: 'done', looks: h.looks, hero: h.hero, startedAt: h.at }
    await saveJob()
    return { job: styleJob }
  },

  async styleForget({ id }) {
    const list = await loadHistory()
    styleHistory = list.filter((x) => x.id !== id)
    try { await ext.storage.local.set({ styleHistory }) } catch {}
    if (styleJob?.id === id) { styleJob = null; await saveJob() }
    return { ok: true }
  },

  /** SAVE THIS LOOK TO MYRA — the piece and the look around it, into the app. */
  async keepLook({ product, look }) {
    const { status, json } = await api('/api/mirror/keep-look', { method: 'POST', body: JSON.stringify({ product, look }) })
    if (status !== 200 || !json || (json.error && !json.saved)) return { error: json?.error || `Could not keep this look (${status})` }
    return { ok: true, ...json }
  },

  /** ADD TO MIRROR FAVOURITES — her saved pieces, the same list as /me. */
  async saveProduct({ product }) {
    const { status, json } = await api('/api/mirror/save', { method: 'POST', body: JSON.stringify({ product }) })
    if (status !== 200 || !json || json.error) return { error: json?.error || `Could not save (${status})` }
    return { ok: true, ...json }
  },

  /** "MYRA cannot read this shop — learn it?" Passed on for Chloe to look at. */
  async requestSite({ host, url, title, reason }) {
    const c = await cfg()
    if (!c.token) return { error: 'Connect MYRA first' }
    const { status, json } = await api('/api/mirror/site-request', {
      method: 'POST',
      body: JSON.stringify({ host, url, title, reason }),
    })
    if (status !== 200 || !json || json.error) return { error: json?.error || `Could not pass it on (${status})` }
    return json
  },

  /** A piece she stayed on. Quiet: FOR YOU carries on from it without her saving anything. */
  async viewedProduct({ product, dwellMs }) {
    const { status, json } = await api('/api/mirror/viewed', { method: 'POST', body: JSON.stringify({ product, dwell_ms: dwellMs }) })
    return status === 200 ? json : { error: json?.error || `(${status})` }
  },

  /** What she typed into a shop's search. */
  async searched({ host, query }) {
    const { status, json } = await api('/api/mirror/viewed', { method: 'POST', body: JSON.stringify({ host, query }) })
    return status === 200 ? json : { error: json?.error || `(${status})` }
  },

  /** Where a shop stands with MYRA: watched, being read, set aside, or turned away. */
  async siteStatus({ host }) {
    const c = await cfg()
    if (!c.token) return { error: 'Connect MYRA first' }
    const { status, json } = await api(`/api/mirror/site-request?host=${encodeURIComponent(host)}`)
    if (status !== 200 || !json || json.error) return { error: json?.error || `Could not check (${status})` }
    return json
  },

  /** A SCAN IN CHROME feeding one grid page of a mirror-fed brand — queued, never ranked. */
  async scanFeed({ host, products }) {
    const { status, json } = await api('/api/mirror/scan-feed', { method: 'POST', body: JSON.stringify({ host, products }) })
    return status === 200 ? json : { error: json?.error || `feed failed (${status})` }
  },

  /** Brand Watch asking for a page to open BEHIND her, so she stays where she is. */
  async openTab({ url }, sender) {
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) return { error: 'bad url' }
    const tab = await ext.tabs.create({ url, active: false, ...(sender?.tab?.index != null ? { index: sender.tab.index + 1 } : {}) })
    return { tabId: tab?.id ?? null }
  },

  /** The badge's "tap to reconnect": the live connect page, in front of her. */
  async openConnect() {
    const tab = await ext.tabs.create({ url: `${DEFAULTS.apiBase}/mirror/connect`, active: true })
    return { tabId: tab?.id ?? null }
  },

  /** A SCAN IN CHROME reporting what it has read — the Brand Watch card follows it. */
  async scanProgress({ watchedBrandId, seen, queued, pages, done, error }) {
    const { status, json } = await api('/api/mirror/scan-progress', { method: 'POST', body: JSON.stringify({ watchedBrandId, seen, queued, pages, done, error }) })
    return status === 200 ? json : { error: json?.error || `progress failed (${status})` }
  },

  async pageStats(msg, sender) {
    const tabId = sender?.tab?.id
    if (tabId == null) return { ok: false }
    tabStats.set(tabId, { host: msg.host, lifted: msg.lifted, total: msg.total, member: msg.member, ms: msg.ms })
    try {
      await ext.action.setBadgeBackgroundColor({ tabId, color: '#141414' })
      await ext.action.setBadgeText({ tabId, text: msg.lifted > 0 ? String(msg.lifted) : '' })
    } catch {}
    return { ok: true }
  },

  async getStats({ tabId }) {
    return tabStats.get(tabId) || null
  },
}

onMessage((msg, sender) => {
  const fn = handlers[msg?.type]
  if (!fn) return { error: `unknown message ${msg?.type}` }
  return fn(msg, sender)
})

ext.tabs.onRemoved.addListener((tabId) => tabStats.delete(tabId))
