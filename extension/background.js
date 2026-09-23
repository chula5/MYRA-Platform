// MYRA Mirror — service worker. Holds the member token, talks to /api/mirror,
// caches a page's ranking for ten minutes so a revisit reorders instantly,
// and keeps the per-tab "lifted N pieces" count for the badge and popup.

const DEFAULTS = { apiBase: 'http://localhost:3000', token: null, member: null, disabledHosts: [] }
const RANK_TTL_MS = 10 * 60_000
const rankCache = new Map() // `${host}|${hash}` → { at, data }
// The styling job runs HERE, not in the page: she can walk on to the next
// product, or the next site, and the panel keeps building on the right.
let styleJob = null // { id, product, mode, status, looks, hero, error, startedAt }
const tabStats = new Map() // tabId → { host, lifted, total, member, ms }

async function cfg() {
  const stored = await chrome.storage.local.get(null)
  return { ...DEFAULTS, ...stored }
}

function hashKeys(products) {
  const s = products.map((p) => p.key).sort().join(',')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return String(h)
}

async function api(path, init = {}) {
  const c = await cfg()
  if (!c.token) return { status: 401, json: { error: 'not connected' } }
  const res = await fetch(`${c.apiBase.replace(/\/+$/, '')}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.token}`, ...(init.headers || {}) },
  })
  if (res.status === 401) await chrome.storage.local.set({ token: null, member: null })
  let json = null
  try { json = await res.json() } catch {}
  return { status: res.status, json }
}

async function saveJob() {
  try { await chrome.storage.local.set({ styleJob }) } catch {}
  // Every open tab redraws from the job it is told about.
  try {
    const tabs = await chrome.tabs.query({})
    for (const t of tabs) {
      if (t.id == null) continue
      chrome.tabs.sendMessage(t.id, { type: 'styleUpdate', job: styleJob }).catch?.(() => {})
    }
  } catch {}
}

const handlers = {
  async state({ host }) {
    const c = await cfg()
    return { enabled: !c.disabledHosts.includes(host), connected: !!c.token, member: c.member, apiBase: c.apiBase }
  },

  async rank({ host, products }) {
    const key = `${host}|${hashKeys(products)}`
    const hit = rankCache.get(key)
    if (hit && Date.now() - hit.at < RANK_TTL_MS) return { ...hit.data, cached: true }
    const { status, json } = await api('/api/mirror/rank', { method: 'POST', body: JSON.stringify({ host, products }) })
    if (status !== 200 || !json) return { error: json?.error || `rank failed (${status})` }
    rankCache.set(key, { at: Date.now(), data: json })
    return json
  },

  async setToken({ token, member, apiBase }) {
    if (apiBase) await chrome.storage.local.set({ apiBase })
    await chrome.storage.local.set({ token, member: member || null })
    const { status, json } = await api('/api/mirror/me')
    if (status !== 200) return { ok: false, error: 'token rejected' }
    await chrome.storage.local.set({ member: json.name })
    rankCache.clear()
    return { ok: true, member: json.name }
  },

  // Only our own content scripts can ask; the token then travels by postMessage
  // straight into the MYRA pop-out frame, never through the brand page's DOM.
  /** Which build is actually running — the page compares it with its own. */
  async version() {
    try { return { version: chrome.runtime.getManifest().version } } catch { return { version: null } }
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
    await chrome.storage.local.set({ token: null, member: null })
    rankCache.clear()
    return { ok: true }
  },

  async setApiBase({ apiBase }) {
    await chrome.storage.local.set({ apiBase })
    rankCache.clear()
    return { ok: true }
  },

  async toggleHost({ host, enabled }) {
    const c = await cfg()
    const set = new Set(c.disabledHosts)
    enabled ? set.delete(host) : set.add(host)
    await chrome.storage.local.set({ disabledHosts: [...set] })
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
      res = await chrome.tabs.sendMessage(tabId, { type: 'readVintedOrders' })
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
        styleJob = { ...styleJob, status: 'error', error: json?.error || `MYRA could not style this (${status})` }
      } else {
        styleJob = { ...styleJob, status: 'done', looks: json.looks || [], hero: json.hero || null, hidden: json.hidden || 0 }
      }
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
      const stored = await chrome.storage.local.get('styleJob')
      styleJob = stored?.styleJob ?? null
      // A job left loading by a restarted worker is not coming back.
      if (styleJob?.status === 'loading' && Date.now() - (styleJob.startedAt || 0) > 3 * 60_000) {
        styleJob = { ...styleJob, status: 'error', error: 'That took too long — ask again' }
      }
    }
    return { job: styleJob }
  },

  async styleClose() {
    styleJob = null
    await saveJob()
    return { ok: true }
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

  async pageStats(msg, sender) {
    const tabId = sender?.tab?.id
    if (tabId == null) return { ok: false }
    tabStats.set(tabId, { host: msg.host, lifted: msg.lifted, total: msg.total, member: msg.member, ms: msg.ms })
    try {
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#141414' })
      await chrome.action.setBadgeText({ tabId, text: msg.lifted > 0 ? String(msg.lifted) : '' })
    } catch {}
    return { ok: true }
  },

  async getStats({ tabId }) {
    return tabStats.get(tabId) || null
  },
}

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  const fn = handlers[msg?.type]
  if (!fn) { respond({ error: `unknown message ${msg?.type}` }); return false }
  fn(msg, sender).then(respond, (e) => respond({ error: String(e?.message || e) }))
  return true
})

chrome.tabs.onRemoved.addListener((tabId) => tabStats.delete(tabId))
