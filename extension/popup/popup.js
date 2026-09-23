const send = (msg) => new Promise((r) => chrome.runtime.sendMessage(msg, r))
const $ = (id) => document.getElementById(id)

async function render() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  let host = ''
  try { host = new URL(tab?.url || '').host } catch {}
  const site = host.replace(/^www\./, '')
  const state = await send({ type: 'state', host })
  const base = (state?.apiBase || 'http://localhost:3000').replace(/\/+$/, '')
  $('apiBase').value = state?.apiBase || ''
  $('disconnected').hidden = !!state?.connected
  $('connected').hidden = !state?.connected
  if (!state?.connected) return

  const first = (state.member || '').split(' ')[0]
  $('title').textContent = first ? `Hi ${first}` : 'Shops, in your taste'
  $('who').textContent = state.member ? `Signed in as ${state.member}` : ''
  $('hostLabel').textContent = site || 'This page'
  $('toggle').checked = !!state.enabled
  $('sizesLink').href = `${base}/me/profile`

  // What she's taught MYRA, as plain chips (no jargon, no "similar brands").
  send({ type: 'me' }).then((me) => {
    const c = me?.signals || {}
    const n = (v, one, many) => `${v} ${v === 1 ? one : many}`
    const chips = [
      c.named && n(c.named, 'favourite brand', 'favourite brands'),
      c.wardrobe && n(c.wardrobe, 'piece you own', 'pieces you own'),
      c.shopped && n(c.shopped, 'purchase', 'purchases'),
      c.liked && n(c.liked, 'like', 'likes'),
    ].filter(Boolean)
    $('knows').innerHTML = ''
    for (const t of chips) { const el = document.createElement('span'); el.className = 'chip'; el.textContent = t; $('knows').appendChild(el) }
    $('knowsCard').hidden = !chips.length
    const sz = me?.sizes
    $('sizesCard').hidden = !!sz?.hasProfile
    $('sizesLine').hidden = !sz?.hasProfile
    if (sz?.hasProfile) $('sizesLine').textContent = `Sizes: ${sz.summary}. Pieces not in your size sit lower.`
  })

  // Her own Vinted orders page: offer to send the purchases to MYRA.
  $('vintedBox').hidden = !/(^|\.)vinted\.(co\.uk|com)$/i.test(host)

  const stats = tab?.id != null ? await send({ type: 'getStats', tabId: tab.id }) : null
  const picks = $('picks'); picks.innerHTML = ''
  if (!state.enabled) {
    $('statusBig').textContent = 'Paused on this shop'
    $('statusSmall').textContent = 'Turn it on below to see this page in your order.'
  } else if (stats && stats.host === host) {
    if (stats.lifted > 0) {
      $('statusBig').textContent = `${stats.lifted} ${stats.lifted === 1 ? 'piece' : 'pieces'} moved to the top for you`
      $('statusSmall').textContent = `Out of ${stats.total} on this page. Your best matches:`
      for (const t of (stats.top || []).slice(0, 4)) {
        const li = document.createElement('li')
        const left = document.createElement('span'); left.textContent = [t.brand, t.title].filter(Boolean).join(' — ')
        const right = document.createElement('strong'); right.textContent = `${t.confidence}% match`; right.title = `${t.why || ''}${t.fit || ''}`
        li.append(left, right); picks.appendChild(li)
      }
    } else {
      $('statusBig').textContent = 'Nothing here to move up yet'
      $('statusSmall').textContent = `MYRA looked at ${stats.total} pieces on this page and none stood out for you.`
    }
  } else {
    $('statusBig').textContent = 'Nothing to sort on this page'
    $('statusSmall').textContent = 'Open a shop\u2019s product page, like New In or Dresses, and your picks jump to the top.'
  }
}

$('connect').addEventListener('click', async () => {
  const state = await send({ type: 'state', host: '' })
  chrome.tabs.create({ url: `${(state?.apiBase || 'http://localhost:3000').replace(/\/+$/, '')}/mirror/connect` })
})
$('vinted').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (tab?.id == null) return
  $('vinted').disabled = true
  $('vintedNote').textContent = 'Reading your orders…'
  const r = await send({ type: 'vintedImport', tabId: tab.id })
  $('vinted').disabled = false
  $('vintedNote').textContent = r?.error
    ? r.error
    : `Added ${r.added} new ${r.added === 1 ? 'piece' : 'pieces'} (${r.merged} MYRA already had). See them in your dressing room.`
})
$('disconnect').addEventListener('click', async () => { await send({ type: 'disconnect' }); render() })
$('toggle').addEventListener('change', async (e) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  let host = ''
  try { host = new URL(tab?.url || '').host } catch {}
  await send({ type: 'toggleHost', host, enabled: e.target.checked })
  if (tab?.id != null) { try { await chrome.tabs.sendMessage(tab.id, { type: e.target.checked ? 'rerun' : 'restore' }) } catch {} }
  render()
})
$('apiBase').addEventListener('change', async (e) => { await send({ type: 'setApiBase', apiBase: e.target.value.trim() }); render() })

render()
