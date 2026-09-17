const send = (msg) => new Promise((r) => chrome.runtime.sendMessage(msg, r))
const $ = (id) => document.getElementById(id)

async function render() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  let host = ''
  try { host = new URL(tab?.url || '').host } catch {}
  const state = await send({ type: 'state', host })
  $('apiBase').value = state?.apiBase || ''
  $('disconnected').hidden = !!state?.connected
  $('connected').hidden = !state?.connected
  if (!state?.connected) return
  $('who').textContent = state.member ? `Connected as ${state.member}` : 'Connected'
  send({ type: 'me' }).then((me) => {
    const c = me?.signals
    if (!c) return
    const parts = [c.named && `${c.named} named`, c.wardrobe && `${c.wardrobe} in your wardrobe`, c.shopped && `${c.shopped} shopped`, c.liked && `${c.liked} liked`, c.learned && `${c.learned} learned`, c.similar && `${c.similar} similar`].filter(Boolean)
    $('basis').textContent = parts.length ? `Ranking from ${parts.join(' · ')} brands.` : ''
    const sz = me?.sizes
    $('sizes').textContent = sz?.hasProfile ? `Your sizes: ${sz.summary}.` : 'Add your sizes in MYRA and pieces that won\u2019t fit sink.'
  })
  // Her own Vinted orders page: offer to send the purchases to MYRA.
  $('vintedBox').hidden = !/(^|\.)vinted\.(co\.uk|com)$/i.test(host)
  $('hostLabel').textContent = host ? `On ${host.replace(/^www\./, '')}` : 'On this site'
  $('toggle').checked = !!state.enabled
  const stats = tab?.id != null ? await send({ type: 'getStats', tabId: tab.id }) : null
  if (stats && stats.host === host) {
    $('stats').textContent = stats.lifted > 0
      ? `${stats.lifted} of ${stats.total} pieces lifted to the top for you${stats.ms ? ` in ${stats.ms} ms` : ''}.`
      : `${stats.total} pieces seen — nothing here to lift yet.`
    const picks = $('picks'); picks.innerHTML = ''
    for (const t of stats.top || []) {
      const li = document.createElement('li')
      li.style.cssText = 'display:flex;gap:10px;justify-content:space-between;padding:6px 0;border-top:1px solid rgba(20,20,20,.1)'
      const left = document.createElement('span'); left.textContent = `${t.brand || ''} — ${t.title}`.slice(0, 60)
      const right = document.createElement('strong'); right.textContent = `${t.confidence}%`; right.title = `${t.why}${t.fit}`
      li.append(left, right); picks.appendChild(li)
    }
  } else {
    $('stats').textContent = state.enabled ? 'No product grid on this page.' : 'Off for this site.'
    $('picks').innerHTML = ''
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
    : `${r.added} new, ${r.merged} matched what MYRA already had. Review them in your dressing room.`
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
