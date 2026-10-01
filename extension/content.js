// MYRA Mirror — reorder the brand's own grid into her order. Nothing is
// restyled, no link is rewritten, no cookie is touched: CSS `order` on the
// grid's children (DOM order as a fallback for non-flex grids), plus one
// small MYRA mark on a piece that was lifted. Turning the extension off for a
// site puts every tile back where the brand had it.

;(async () => {
  const { api: ext, onMessage, sendMessage } = globalThis.__myraBrowser
  const M = window.__myraMirror
  if (!M || window.top !== window) return
  const send = sendMessage
  const TOUCH_DEVICE = typeof matchMedia === 'function' && matchMedia('(hover: none), (pointer: coarse)').matches

  const state = await send({ type: 'state', host: location.host })
  if (!state || !state.connected || !state.enabled) return
  // Not every page is a shop. On a search engine or a social feed there is
  // nothing to rank, nothing to save and nothing to say: no pill, no badge,
  // no panel, and nothing sent home. A styling job that lands while she is
  // here simply waits for the next shop. MYRA follows her round shops, not
  // round the internet.
  const NON_SHOP_HOST = /(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|search\.(yahoo|aol)\.[a-z.]+|yandex\.[a-z.]+|ecosia\.org|baidu\.com|qwant\.com|startpage\.com|brave\.com|perplexity\.ai|chatgpt\.com|openai\.com|claude\.ai|reddit\.com|pinterest\.[a-z.]+|youtube\.com|instagram\.com|tiktok\.com|facebook\.com)$/i
  if (NON_SHOP_HOST.test(location.host.replace(/^www\./i, '').toLowerCase())) return
  const vinted = M.isVinted()
  const shopify = M.isShopify()
  // Everything else is read from the page itself (adapters.genericGrids).
  const generic = !vinted && !shopify

  const LIFT_MIN = 0.6 // named / core-family and above earn the mark
  const WHY = {
    named: 'one of your brands', wardrobe: 'in your wardrobe', shopped: 'you shop them', liked: 'you liked them',
    learned: 'learned from your decisions', similar: 'close to your brands', baseline: '', input_only: 'input only',
  }
  const FIT = { yes: ' · in your size', no: ' · not your size', sold_out: ' · sold out in your size', unknown: '' }

  let running = false, lastSig = '', lastLifted = 0, lastTotal = 0
  const touched = new Set()
  const productOf = new Map() // tile el → { key, url, title, brand, type, price, image, available }

  // ── WHAT DO I WEAR WITH THIS ──────────────────────────────────────────────
  // On hover a piece offers two things: MYRA's answer to "what do I wear with
  // this?" and a place to keep it. The answer builds in a panel on the right
  // that survives her walking on to the next page — the work runs in the
  // extension, not in this tab.
  const API = state.apiBase.replace(/\/+$/, '')
  const FONT = '-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif'
  let menu = null

  function closeMenu() { menu?.remove(); menu = null }
  const onKey = (e) => { if (e.key === 'Escape') { closeMenu(); closePanel(); closePicks() } }
  document.addEventListener('keydown', onKey)
  document.addEventListener('click', (e) => { if (menu && !menu.contains(e.target)) closeMenu() }, true)

  function openMenu(anchor, product) {
    closeMenu()
    const r = anchor.getBoundingClientRect()
    menu = document.createElement('div')
    menu.className = 'myra-mirror-menu'
    menu.style.cssText = `position:fixed;z-index:2147483647;left:${Math.min(r.left, window.innerWidth - 260)}px;top:${Math.min(r.bottom + 8, window.innerHeight - 140)}px;width:248px;background:#fff;border-radius:18px;box-shadow:0 18px 50px rgba(0,0,0,.22);padding:10px;font:500 14px/1.35 ${FONT};color:#2B2B2B;`
    const opt = (label, hint, mode) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.style.cssText = 'display:block;width:100%;text-align:left;border:0;background:#F4F4F2;border-radius:14px;padding:11px 14px;margin:6px 0;cursor:pointer;font:inherit;color:inherit;'
      b.innerHTML = `<span style="display:block;font-weight:600">${label}</span><span style="display:block;opacity:.62;font-size:12.5px">${hint}</span>`
      b.addEventListener('mouseenter', () => { b.style.background = '#E9E9E6' })
      b.addEventListener('mouseleave', () => { b.style.background = '#F4F4F2' })
      b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); closeMenu(); startStyling(product, mode) })
      return b
    }
    menu.append(
      opt('Style with my wardrobe', 'Built around pieces you own', 'wardrobe'),
      opt('Style with new pieces', 'From the brands MYRA knows', 'inspiration'),
    )
    document.body.appendChild(menu)
  }

  // A stale service worker answers "unknown message": the page has the new
  // code and the extension's own background does not. Say what to do.
  let loadedVersion = null
  try { loadedVersion = ext.runtime.getManifest().version } catch { /* not available in some contexts */ }
  const RELOAD_NOTE = `Reload MYRA Mirror at chrome://extensions — the page is version ${loadedVersion ?? '?'} and its background is older.`
  const friendly = (e) => (/unknown message/i.test(String(e ?? '')) ? RELOAD_NOTE : e)

  async function startStyling(product, mode) {
    openPanel({ status: 'loading', product, mode })
    const r = await send({ type: 'styleStart', product, mode })
    if (!r?.error) { if (r?.job) renderPanel(r.job) ; return }
    // An extension whose background is older than this page does not know
    // styleStart. Rather than stop, ask MYRA from here — the answer is the
    // same, it just does not survive leaving the page.
    if (/unknown message/i.test(String(r.error))) return styleFromPage(product, mode)
    renderPanel({ status: 'error', product, mode, error: friendly(r.error) })
  }

  /**
   * The fallback path: this page talks to MYRA itself. The token is read from
   * chrome.storage directly — the same store the worker keeps it in — so a
   * background of any age cannot stand between her and an answer.
   */
  async function creds() {
    try {
      const st = await ext.storage.local.get(['token', 'apiBase'])
      if (st?.token) return { token: st.token, apiBase: st.apiBase }
    } catch { /* an older Chrome, or storage denied: ask the worker instead */ }
    const t = await send({ type: 'token' })
    return t?.token ? t : null
  }

  /** Keep a piece. Through the worker when it knows how, else straight to MYRA. */
  async function savePiece(product) {
    const r = await send({ type: 'saveProduct', product })
    if (r && !r.error) return r
    if (r && !/unknown message/i.test(String(r.error))) return r
    const t = await creds()
    if (!t?.token) return { error: `Connect MYRA first · ${RELOAD_NOTE}` }
    try {
      const res = await fetch(`${(t.apiBase || API).replace(/\/+$/, '')}/api/mirror/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t.token}` },
        body: JSON.stringify({ product }),
      })
      return await res.json()
    } catch (err) { return { error: String(err?.message || err) } }
  }

  async function styleFromPage(product, mode) {
    const t = await creds()
    if (!t?.token) { renderPanel({ status: 'error', product, mode, error: `Connect MYRA first · ${RELOAD_NOTE}` }); return }
    const base = (t.apiBase || API).replace(/\/+$/, '')
    const ask = async (quick) => {
      const res = await fetch(`${base}/api/mirror/style`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t.token}` },
        body: JSON.stringify({ ...product, mode, quick }),
      })
      return res.json()
    }
    try {
      const quick = await ask(true).catch(() => null)
      if (quick && !quick.error && (quick.looks || []).length) {
        renderPanel({ status: 'partial', product, mode, looks: quick.looks })
      }
      const full = await ask(false)
      if (full?.error || !(full?.looks || []).length) {
        renderPanel({ status: 'error', product, mode, error: `${full?.error || 'MYRA could not style this'} · ${RELOAD_NOTE}` })
        return
      }
      renderPanel({ status: 'done', product, mode, looks: full.looks, note: RELOAD_NOTE })
    } catch (err) {
      renderPanel({ status: 'error', product, mode, error: `${err?.message || err} · ${RELOAD_NOTE}` })
    }
  }

  // ── The panel on the right ────────────────────────────────────────────────
  let panel = null
  function closePanel() {
    panel?.remove(); panel = null
    void send({ type: 'styleClose' })
    maybePicksBadge()
  }
  function openPanel(job) {
    closePicks()
    // Opening the panel answers the dot: whatever was waiting is now in view.
    jobWaiting = false
    badgeMark()
    if (!panel) {
      panel = document.createElement('div')
      panel.className = 'myra-mirror-panel'
      panel.style.cssText = `position:fixed;z-index:2147483646;top:12px;right:12px;bottom:12px;width:min(420px,calc(100vw - 24px));background:linear-gradient(160deg,#F7F7F9 0%,#E9E9EC 55%,#DEDEE2 100%);border-radius:24px;box-shadow:0 24px 60px rgba(0,0,0,.26);overflow:hidden auto;font:400 14px/1.4 ${FONT};color:#2B2B2B;transform:translateX(24px);opacity:0;transition:transform .28s ease,opacity .28s ease;`
      document.body.appendChild(panel)
      // Slides in from the edge, like her dressing room panel.
      requestAnimationFrame(() => { panel.style.transform = 'translateX(0)'; panel.style.opacity = '1' })
    }
    renderPanel(job)
  }

  const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

  let panelJob = null
  function renderPanel(job) {
    if (!job) { panel?.remove(); panel = null; panelJob = null; return }
    panelJob = job
    if (!panel) openPanel(job)
    if (!panel) return
    const modeLabel = job.mode === 'wardrobe' ? 'with your wardrobe' : 'with new pieces'
    const head = `
      <div style="position:sticky;top:0;background:rgba(247,247,249,.92);backdrop-filter:blur(8px);padding:18px 18px 12px;display:flex;gap:12px;align-items:flex-start;">
        <img src="${esc(ext.runtime.getURL('icons/mirror.png'))}" alt="" style="width:26px;height:auto;flex:0 0 auto;margin-top:2px">
        <div style="flex:1;min-width:0">
          <div style="font-size:11.5px;letter-spacing:.2em;text-transform:uppercase;opacity:.5">MYRA <span style="opacity:.55">${esc(loadedVersion ?? '?')}</span></div>
          <div style="font-size:19px;font-weight:600;line-height:1.2;margin-top:3px;letter-spacing:.01em">What to wear with this</div>
          <div style="font-size:13px;opacity:.6;margin-top:3px">${esc(job.product?.title || '')} — ${esc(modeLabel)}</div>
        </div>
        <button type="button" data-myra="close" aria-label="Close" style="flex:0 0 auto;width:34px;height:34px;border-radius:50%;border:0;background:#EFEFED;font-size:18px;cursor:pointer;color:#2B2B2B">×</button>
      </div>`

    let body = ''
    if (job.status === 'partial') {
      const looks = job.looks || []
      body = `<div style="padding:4px 14px 20px">
        <div style="font-size:12.5px;letter-spacing:.06em;opacity:.62;padding:0 4px 10px">First thoughts — MYRA is checking them now…</div>
        ${looks.map((l, i) => lookCard(l, i, job.hero?.item_id)).join('')}
      </div>`
    } else if (job.status === 'loading') {
      body = `<div style="padding:6px 18px 20px">
        <div style="font-size:14px;opacity:.7;margin-bottom:12px">MYRA is building outfits… this keeps going if you carry on browsing.</div>
        ${[0, 1, 2].map(() => `<div style="height:86px;border-radius:16px;background:linear-gradient(90deg,#EFEFED,#F7F7F5,#EFEFED);background-size:200% 100%;animation:myraShimmer 1.4s infinite;margin-bottom:10px"></div>`).join('')}
      </div>
      <style>@keyframes myraShimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}</style>`
    } else if (job.status === 'error') {
      body = `<div style="padding:6px 18px 20px;font-size:14px;color:#9B3A3A">${esc(job.error || 'MYRA could not style this')}</div>`
    } else {
      const looks = job.looks || []
      body = (job.note ? `<div style="padding:0 18px 10px;font-size:12.5px;opacity:.6">${esc(job.note)}</div>` : '') + (looks.length
        ? `<div style="padding:4px 14px 20px">${looks.map((l, i) => lookCard(l, i, job.hero?.item_id)).join('')}</div>`
        : `<div style="padding:6px 18px 20px;font-size:14px;opacity:.7">Nothing MYRA would put with it yet${job.mode === 'wardrobe' ? ' from your own pieces' : ''}.</div>`)
    }
    panel.innerHTML = head + body
    panel.querySelector('[data-myra="close"]')?.addEventListener('click', closePanel)
    panel.querySelectorAll('[data-myra-keep]').forEach((b) => b.addEventListener('click', keepFromPanel))
  }

  /** ♥ on a piece inside a look — the same save as a heart on a tile. */
  async function keepFromPanel(e) {
    e.preventDefault(); e.stopPropagation()
    const btn = e.currentTarget
    const [li, pi] = (btn.dataset.myraKeep || '').split(':').map(Number)
    const piece = panelJob?.looks?.[li]?.items?.[pi]
    if (!piece?.url) { btn.title = 'MYRA has no link for this piece'; return }
    btn.disabled = true
    btn.textContent = '…'
    const r = await savePiece({
      url: piece.url,
      title: piece.product_name || piece.brand || 'Piece',
      brand: piece.brand || null,
      price: typeof piece.price_gbp === 'number' ? piece.price_gbp : null,
      image: piece.image_url || null,
    })
    btn.disabled = false
    btn.textContent = '♥'
    if (r?.error) { btn.title = r.error; btn.style.color = '#9B3A3A'; return }
    btn.style.background = '#141414'
    btn.style.color = '#F7F6F3'
    btn.title = 'In your saved pieces — MYRA watches its stock'
  }

  /**
   * One outfit, drawn the way MYRA draws it: her composed picture when the look
   * has one, otherwise the pieces laid out three across on stone — the same
   * card as the dressing room, not a row of thumbnails. The piece she is
   * standing in front of is ringed; her own things are marked; anything she
   * does not own can be kept with one heart.
   */
  function lookCard(look, i, heroId) {
    const pieces = (look.items || []).slice(0, 9)
    const own = pieces.filter((p) => p.owned).length
    const body = look.image_url
      ? `<div style="position:relative;aspect-ratio:3/4;background:#E4E2DD;overflow:hidden">
           <img src="${esc(look.image_url)}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">
         </div>`
      : `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;padding:4px;background:#E4E2DD">
          ${pieces.map((p, j) => `
            <a href="${esc(p.url || '#')}" ${p.url ? 'target="_blank" rel="noreferrer"' : ''} style="position:relative;display:block;aspect-ratio:3/4;background:#fff;overflow:hidden;text-decoration:none;color:inherit${heroId && p.item_id === heroId ? ';box-shadow:inset 0 0 0 2px #2B2B2B' : ''}">
              ${p.image_url ? `<img src="${esc(p.image_url)}" alt="${esc(p.product_name || '')}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain">` : ''}
              ${p.owned
                ? '<span style="position:absolute;top:5px;left:5px;background:#141414;color:#fff;border-radius:999px;padding:2px 8px;font-size:11px;letter-spacing:.02em">Yours</span>'
                : `<button type="button" data-myra-keep="${i}:${j}" title="Keep this in MYRA" aria-label="Keep this in MYRA" style="position:absolute;top:5px;right:5px;width:26px;height:26px;border:0;border-radius:50%;background:rgba(255,255,255,.94);color:#2B2B2B;font-size:13px;line-height:26px;padding:0;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.16)">♥</button>`}
              <span style="position:absolute;left:0;right:0;bottom:0;padding:5px 6px;font-size:11px;line-height:1.2;color:#2B2B2B;background:linear-gradient(transparent,rgba(255,255,255,.92) 38%);max-height:34px;overflow:hidden">${esc(p.brand || p.product_name || '')}</span>
            </a>`).join('')}
         </div>`
    return `<div style="background:rgba(255,255,255,.85);border-radius:18px;overflow:hidden;margin-bottom:12px;box-shadow:0 2px 14px rgba(43,43,43,.08)">
      ${body}
      <div style="padding:11px 14px 12px">
        <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;opacity:.5">${esc(look.occasion_label || `Look ${i + 1}`)}${own ? ` · ${own} of your own` : ''}</div>
        ${look.why ? `<div style="font-size:13.5px;opacity:.72;margin-top:5px;line-height:1.35">${esc(look.why)}</div>` : ''}
      </div>
    </div>`
  }


  // ── TOP PICKS ON THIS PAGE ────────────────────────────────────────────────
  // She walks into a shop with one question — is there anything here for me?
  // A small MYRA mark in the top-right corner answers when she taps it: at
  // most three pieces from the page she is on, each labelled with why it is
  // there (a gap in her wardrobe, or simply her taste) and shown ON, in one
  // look built from what she owns and what MYRA carries together. The work is
  // asked for here, never on page load — composing a piece MYRA has never seen
  // means reading its picture first.
  let picksBadge = null, picksPanel = null, picksJob = null, pageProducts = [], pageHasPicks = false

  const SLOT_NOUN = { outerwear: 'outerwear', top: 'tops', bottom: 'bottoms', dress: 'dresses', shoe: 'shoes', bag: 'bags', jewellery: 'jewellery', accessory: 'accessories' }
  const REASON = {
    gap: { label: 'FILLS A GAP', bg: '#C4A882', color: '#141414' },
    taste: { label: 'YOUR TASTE', bg: '#141414', color: '#F7F6F3' },
  }

  function hidePicksBadge() { picksBadge?.remove(); picksBadge = null }
  function closePicks() { hidePicksBadge(); picksPanel?.remove(); picksPanel = null; picksJob = null }

  // No corner badge of its own any more. That this page has pieces worth
  // picking from is recorded here and becomes one of the things the edge
  // badge's dot stands for — the same bar as before (the bar the picks
  // themselves are held to), just no element of its own.
  function maybePicksBadge() {
    picksWorth = pageHasPicks && pageProducts.length >= 2 && pageProducts.some((p) => p.image && p.url && p.title)
    badgeMark()
  }

  /**
   * One panel at a time on the right: opening the picks closes the styling
   * panel, as the styling panel closes this. The picks are hers to keep
   * reading while the page changes underneath — they are for the page she
   * asked on.
   */
  async function openPicks() {
    closePanel()
    hidePicksBadge()
    picksPanel = document.createElement('div')
    picksPanel.className = 'myra-mirror-picks-panel'
    picksPanel.style.cssText = `position:fixed;z-index:2147483646;top:12px;right:12px;bottom:12px;width:min(420px,calc(100vw - 24px));background:linear-gradient(160deg,#F7F7F9 0%,#E9E9EC 55%,#DEDEE2 100%);border-radius:24px;box-shadow:0 24px 60px rgba(0,0,0,.26);overflow:hidden auto;font:400 14px/1.4 ${FONT};color:#2B2B2B;transform:translateX(24px);opacity:0;transition:transform .28s ease,opacity .28s ease;`
    document.body.appendChild(picksPanel)
    requestAnimationFrame(() => { if (picksPanel) { picksPanel.style.transform = 'translateX(0)'; picksPanel.style.opacity = '1' } })
    renderPicks({ status: 'loading' })
    let r = await send({ type: 'picks', host: location.host, products: pageProducts })
    // A background older than this page, or a worker that did not answer: ask
    // MYRA from here — same answer, it just does not survive leaving the page.
    if (!r || /unknown message/i.test(String(r.error))) r = await picksFromPage()
    if (!r || r.error) { renderPicks({ status: 'error', error: friendly(r?.error || 'MYRA did not answer') }); return }
    renderPicks(r)
  }

  async function picksFromPage() {
    const t = await creds()
    if (!t?.token) return { error: `Connect MYRA first · ${RELOAD_NOTE}` }
    try {
      const res = await fetch(`${(t.apiBase || API).replace(/\/+$/, '')}/api/mirror/picks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t.token}` },
        body: JSON.stringify({ host: location.host, products: pageProducts }),
      })
      return await res.json()
    } catch (err) { return { error: String(err?.message || err) } }
  }

  function renderPicks(job) {
    picksJob = job
    if (!picksPanel) return
    const gaps = (job.gaps || [])
    const head = `
      <div style="position:sticky;top:0;background:rgba(247,247,249,.92);backdrop-filter:blur(8px);padding:18px 18px 12px;display:flex;gap:12px;align-items:flex-start;z-index:2">
        <img src="${esc(ext.runtime.getURL('icons/mirror.png'))}" alt="" style="width:26px;height:auto;flex:0 0 auto;margin-top:2px">
        <div style="flex:1;min-width:0">
          <div style="font-size:11.5px;letter-spacing:.2em;text-transform:uppercase;opacity:.5">MYRA <span style="opacity:.55">${esc(loadedVersion ?? '?')}</span></div>
          <div style="font-size:19px;font-weight:600;line-height:1.2;margin-top:3px;letter-spacing:.01em">Your top picks here</div>
          <div style="font-size:13px;opacity:.6;margin-top:3px">From this page — for your wardrobe and your taste</div>
        </div>
        <button type="button" data-myra="close" aria-label="Close" style="flex:0 0 auto;width:34px;height:34px;border-radius:50%;border:0;background:#EFEFED;font-size:18px;cursor:pointer;color:#2B2B2B">×</button>
      </div>`

    let body = ''
    if (job.status === 'loading') {
      body = `<div style="padding:6px 18px 20px">
        <div style="font-size:14px;opacity:.7;margin-bottom:12px">MYRA is picking from this page and building the looks… this keeps going if you carry on browsing.</div>
        ${[0, 1, 2].map(() => `<div style="height:86px;border-radius:16px;background:linear-gradient(90deg,#EFEFED,#F7F7F5,#EFEFED);background-size:200% 100%;animation:myraShimmer 1.4s infinite;margin-bottom:10px"></div>`).join('')}
      </div>
      <style>@keyframes myraShimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}</style>`
    } else if (job.status === 'error') {
      body = `<div style="padding:6px 18px 20px;font-size:14px;color:#9B3A3A">${esc(job.error || 'MYRA could not pick from this page')}</div>`
    } else {
      const picks = job.picks || []
      body = (gaps.length
        ? `<div style="padding:2px 18px 8px;font-size:12px;opacity:.62">Your wardrobe is thin in ${gaps.map((g) => SLOT_NOUN[g.slot] || g.slot).slice(0, 3).join(' · ')} — where this page can help, the pick says so.</div>`
        : '') + (picks.length
        ? `<div style="padding:4px 14px 20px">${picks.map(pickCard).join('')}</div>`
        : `<div style="padding:6px 18px 20px;font-size:14px;opacity:.7">${esc(job.error || 'Nothing here MYRA would put in front of you yet.')}</div>`)
    }
    picksPanel.innerHTML = head + body
    picksPanel.querySelector('[data-myra="close"]')?.addEventListener('click', () => { closePicks(); maybePicksBadge() })
    picksPanel.querySelectorAll('[data-myra-keep]').forEach((b) => b.addEventListener('click', keepFromPicks))
  }

  /** One pick: why it is here, the piece itself, and one look around it. */
  function pickCard(pick, i) {
    const r = REASON[pick.reason] || REASON.taste
    return `<div style="background:rgba(255,255,255,.85);border-radius:18px;overflow:hidden;margin-bottom:14px;box-shadow:0 2px 14px rgba(43,43,43,.08)">
      <div style="padding:12px 14px 10px;display:flex;gap:12px;align-items:flex-start">
        ${pick.image ? `<img src="${esc(pick.image)}" alt="" style="width:54px;height:72px;object-fit:contain;background:#fff;border-radius:6px;flex:0 0 auto">` : ''}
        <a href="${esc(pick.url)}" target="_blank" rel="noreferrer" style="flex:1;min-width:0;text-decoration:none;color:inherit">
          <span style="display:inline-block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;font-weight:600;background:${r.bg};color:${r.color};border-radius:999px;padding:4px 10px">${r.label}</span>
          <span style="display:block;font-size:14.5px;font-weight:600;margin-top:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(pick.title)}</span>
          <span style="display:block;font-size:12.5px;opacity:.62;margin-top:2px">${esc(pick.brand || '')}${pick.price ? ` · £${Math.round(pick.price)}` : ''}</span>
          ${pick.note ? `<span style="display:block;font-size:12.5px;opacity:.75;margin-top:4px;font-style:italic">${esc(pick.note)}</span>` : ''}
          <span style="display:block;font-size:11px;letter-spacing:.1em;text-transform:uppercase;opacity:.5;margin-top:6px">View the piece →</span>
        </a>
      </div>
      ${pick.look
        ? lookCard(pick.look, i, pick.hero_item_id)
        : `<div style="padding:0 14px 12px;font-size:12.5px;opacity:.6">${esc(pick.lookError || 'No look for this one yet')}</div>`}
    </div>`
  }

  /** ♥ on a piece inside a pick's look — the same save as a heart on a tile. */
  async function keepFromPicks(e) {
    e.preventDefault(); e.stopPropagation()
    const btn = e.currentTarget
    const [pi, ii] = (btn.dataset.myraKeep || '').split(':').map(Number)
    const piece = picksJob?.picks?.[pi]?.look?.items?.[ii]
    if (!piece?.url) { btn.title = 'MYRA has no link for this piece'; return }
    btn.disabled = true
    btn.textContent = '…'
    const r = await savePiece({
      url: piece.url,
      title: piece.product_name || piece.brand || 'Piece',
      brand: piece.brand || null,
      price: typeof piece.price_gbp === 'number' ? piece.price_gbp : null,
      image: piece.image_url || null,
    })
    btn.disabled = false
    btn.textContent = '♥'
    if (r?.error) { btn.title = r.error; btn.style.color = '#9B3A3A'; return }
    btn.style.background = '#141414'
    btn.style.color = '#F7F6F3'
    btn.title = 'In your saved pieces — MYRA watches its stock'
  }


  // ── THE BADGE ON THE EDGE ───────────────────────────────────────────────
  // Nothing opens on its own any more: not the card over a tile, not the
  // panel when a styling lands, not a corner badge when the page has picks.
  // This one small disc, midway down the right edge, is the only thing MYRA
  // puts on a page unasked — quiet, out of the way, always in the same
  // place. A dot on it means something is waiting for her: a finished
  // styling, or picks this page can offer. Everything else is one click
  // away, and a second click puts it away again.
  let badge = null, badgeDot = null, jobWaiting = false, picksWorth = false

  function badgeMark() {
    if (!badgeDot) return
    badgeDot.style.display = jobWaiting || picksWorth ? 'block' : 'none'
  }

  function makeBadge() {
    if (badge || !document.body) return
    badge = document.createElement('button')
    badge.type = 'button'
    badge.className = 'myra-mirror-badge'
    badge.title = 'MYRA — open what is waiting here'
    badge.setAttribute('aria-label', 'Open MYRA')
    badge.style.cssText = `position:fixed;z-index:2147483645;right:0;top:50%;transform:translateY(-50%);width:38px;height:38px;border:0;border-radius:19px 0 0 19px;background:rgba(255,255,255,.96);cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0 6px 0 10px;box-shadow:-3px 4px 18px rgba(0,0,0,.18);font:400 14px/1.4 ${FONT};color:#2B2B2B;`
    badge.innerHTML = `<img src="${ext.runtime.getURL('icons/mirror.png')}" alt="" style="width:20px;height:20px;object-fit:contain"><span class="myra-mirror-badge-dot" style="position:absolute;top:4px;left:6px;width:8px;height:8px;border-radius:50%;background:#141414;box-shadow:0 0 0 2px rgba(255,255,255,.9);display:none"></span>`
    badgeDot = badge.querySelector('.myra-mirror-badge-dot')
    badge.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); badgeClick() })
    document.body.appendChild(badge)
    badgeMark()
  }

  /**
   * The one door in. What a click opens depends on what there is to open, in
   * the order she would want it: the styling she asked for first, then this
   * page's own piece, then MYRA's picks from this page, then simply the
   * first piece the page has. Clicking while what it opened is showing
   * closes it again — nothing is ever stuck on screen.
   */
  async function badgeClick() {
    if (panel) { closePanel(); return }
    if (picksPanel) { closePicks(); return }
    if (pill) { hidePiece(); return }
    const waiting = await send({ type: 'styleJob' })
    if (waiting?.job) { openPanel(waiting.job); return }
    if (pagePiece) { showPiece(pagePiece, 'badge'); return }
    if (pageHasPicks) { openPicks(); return }
    if (pageProducts.length) { showPiece(pageProducts[0], 'badge'); return }
  }

  if (document.body) makeBadge()
  else document.addEventListener('DOMContentLoaded', makeBadge, { once: true })


  // ── A SHOP MYRA CANNOT READ ───────────────────────────────────────────────
  // Rather than sit silent on a shop it does not speak, the mirror says so and
  // offers to pass it on. Once a day per shop, and never again once she has
  // asked for it.
  const OFFER_KEY = `myra:mirror:asked:${location.host}`
  function askedRecently() {
    try {
      const at = Number(localStorage.getItem(OFFER_KEY) || 0)
      return at && Date.now() - at < 24 * 3600_000
    } catch { return false }
  }
  function rememberAsked() { try { localStorage.setItem(OFFER_KEY, String(Date.now())) } catch {} }

  function offerSite(reason) {
    if (askedRecently() || document.querySelector('.myra-mirror-offer')) return
    const box = document.createElement('div')
    box.className = 'myra-mirror-offer'
    box.style.cssText = `position:fixed;z-index:2147483646;right:16px;bottom:16px;width:min(330px,calc(100vw - 32px));background:linear-gradient(160deg,#F7F7F9 0%,#E9E9EC 100%);border-radius:22px;box-shadow:0 20px 50px rgba(0,0,0,.24);padding:16px 18px;font:400 14px/1.4 ${FONT};color:#2B2B2B;`
    box.innerHTML = `
      <div style="display:flex;gap:11px;align-items:flex-start">
        <img src="${ext.runtime.getURL('icons/mirror.png')}" alt="" style="width:24px;height:auto;margin-top:1px">
        <div style="flex:1;min-width:0">
          <div style="font-size:11.5px;letter-spacing:.2em;text-transform:uppercase;opacity:.5">MYRA</div>
          <div style="font-size:15px;font-weight:600;margin-top:3px">MYRA can’t read this shop yet</div>
          <div style="font-size:13px;opacity:.68;margin-top:4px">Ask for it and she’ll learn ${esc(location.host.replace(/^www\./, ''))} — you’ll hear back when it’s in.</div>
          <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
            <button data-myra="ask" style="border:0;border-radius:999px;background:#141414;color:#F7F6F3;padding:9px 15px;font:500 12.5px/1 ${FONT};letter-spacing:.08em;text-transform:uppercase;cursor:pointer">Ask for this shop</button>
            <button data-myra="not-now" style="border:0;border-radius:999px;background:#fff;color:#55534E;padding:9px 15px;font:500 12.5px/1 ${FONT};letter-spacing:.08em;text-transform:uppercase;cursor:pointer">Not now</button>
          </div>
          <div data-myra="said" style="font-size:13px;margin-top:10px;display:none"></div>
        </div>
        <button data-myra="close" aria-label="Close" style="border:0;background:transparent;font-size:17px;line-height:1;color:#55534E;cursor:pointer">×</button>
      </div>`
    const close = () => { rememberAsked(); box.remove() }
    box.querySelector('[data-myra="close"]').addEventListener('click', close)
    box.querySelector('[data-myra="not-now"]').addEventListener('click', close)
    box.querySelector('[data-myra="ask"]').addEventListener('click', async (e) => {
      const btn = e.currentTarget
      btn.disabled = true
      btn.textContent = 'Asking…'
      const r = await send({ type: 'requestSite', host: location.host, url: location.href, title: document.title, reason })
      const said = box.querySelector('[data-myra="said"]')
      said.style.display = 'block'
      said.textContent = r?.error ? friendly(r.error) : r?.message || (r?.again ? 'Already on her list — she knows you want it.' : 'Passed on to MYRA. She’ll take a look.')
      btn.remove()
      rememberAsked()
      // MYRA reads the shop after answering; stay long enough to say what it decided.
      let tries = 0
      const follow = async () => {
        if (!r || r.error || r.status !== 'assessing' || ++tries > 20) { setTimeout(() => box.remove(), 5000); return }
        const again = await send({ type: 'siteStatus', host: location.host })
        if (again?.message) said.textContent = again.message
        if (again?.status === 'assessing') setTimeout(follow, 4000); else setTimeout(() => box.remove(), 6000)
      }
      setTimeout(follow, 4000)
    })
    document.body.appendChild(box)
  }


  // ── THE PIECE SHE IS LOOKING AT ───────────────────────────────────────────
  // One card at the bottom of the screen, and it follows her: the piece whose
  // page she is on, or — in a grid — whichever tile is under the cursor. It is
  // rebuilt for each piece rather than left where it was, because a shop that
  // never reloads the page (a listing that turns into a product, a product
  // that turns into the next one) would otherwise leave her reading the last
  // piece's name over this piece's picture.
  let pill = null, pillFor = null, pillFrom = null, pillRevert = null

  function hidePiece() { pill?.remove(); pill = null; pillFor = null; pillFrom = null }

  function showPiece(product, from = 'page') {
    if (!product?.title) return
    const key = product.url || product.title
    // Already showing this piece: only note where the cursor now is, so
    // leaving a tile knows whether to go back to her own page's piece.
    if (pill && pillFor === key) { pillFrom = from; return }
    if (!pill) {
      pill = document.createElement('div')
      pill.className = 'myra-mirror-product'
      pill.style.cssText = `position:fixed;z-index:2147483646;right:16px;bottom:16px;width:min(330px,calc(100vw - 32px));background:linear-gradient(160deg,#F7F7F9 0%,#E9E9EC 100%);border-radius:22px;box-shadow:0 20px 50px rgba(0,0,0,.24);padding:15px 17px;font:400 14px/1.4 ${FONT};color:#2B2B2B;`
      document.body.appendChild(pill)
    }
    pillFor = key
    pillFrom = from
    pill.innerHTML = `
      <div style="display:flex;gap:11px;align-items:flex-start">
        ${product.image ? `<img src="${esc(product.image)}" alt="" style="width:46px;height:61px;object-fit:contain;background:#fff;border-radius:6px;flex:0 0 auto">` : `<img src="${ext.runtime.getURL('icons/mirror.png')}" alt="" style="width:22px;height:auto;margin-top:2px">`}
        <div style="flex:1;min-width:0">
          <div style="font-size:11.5px;letter-spacing:.2em;text-transform:uppercase;opacity:.5">MYRA</div>
          <div style="font-size:14.5px;font-weight:600;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(product.title)}</div>
          <div style="font-size:12.5px;opacity:.62;margin-top:2px">${esc(product.brand || '')}${product.price ? ` · £${Math.round(product.price)}` : ''}</div>
          <div style="display:flex;gap:8px;margin-top:11px;flex-wrap:wrap">
            <button data-myra="save" style="border:0;border-radius:999px;background:#141414;color:#F7F6F3;padding:9px 14px;font:500 12px/1 ${FONT};letter-spacing:.08em;text-transform:uppercase;cursor:pointer">♥ Save to MYRA</button>
            <button data-myra="style" style="border:0;border-radius:999px;background:#fff;color:#2B2B2B;padding:9px 14px;font:500 12px/1 ${FONT};letter-spacing:.08em;text-transform:uppercase;cursor:pointer">What do I wear with this?</button>
          </div>
          <div data-myra="said" style="font-size:12.5px;margin-top:9px;display:none;opacity:.75"></div>
        </div>
        <button data-myra="close" aria-label="Close" style="border:0;background:transparent;font-size:17px;line-height:1;color:#55534E;cursor:pointer">×</button>
      </div>`
    const said = pill.querySelector('[data-myra="said"]')
    const say = (t) => { said.style.display = 'block'; said.textContent = t }
    pill.querySelector('[data-myra="close"]').addEventListener('click', () => { hidePiece(); pillOff = true })
    pill.querySelector('[data-myra="save"]').addEventListener('click', async (e) => {
      const b = e.currentTarget
      b.disabled = true
      say('Saving…')
      const r = await savePiece(product)
      if (r?.error) { say(friendly(r.error)); b.disabled = false; return }
      b.textContent = '♥ Saved'
      say('In your saved pieces — MYRA watches its stock and will tell you if it starts to go.')
    })
    pill.querySelector('[data-myra="style"]').addEventListener('click', (e) => openMenu(e.currentTarget, product))
  }

  // Closed once, closed until she opens a new page.
  let pillOff = false

  /** The cursor has left the grid: her own page's piece comes back. */
  function revertPiece(pageProduct) {
    clearTimeout(pillRevert)
    pillRevert = setTimeout(() => {
      if (pillFrom !== 'hover') return
      if (pageProduct) showPiece(pageProduct, 'page')
    }, 400)
  }

  function tileImage(tile) {
    // A tile whose picture has not loaded yet holds a 1×1 placeholder.
    const imgs = [...tile.querySelectorAll('img')]
      .filter((img) => !/^data:/i.test(img.currentSrc || img.src || ''))
      .map((img) => ({ img, area: (img.naturalWidth || img.width) * (img.naturalHeight || img.height) })).sort((a, b) => b.area - a.area)
    const img = imgs[0]?.img
    if (!img) return null
    const src = img.currentSrc || img.src
    try { return new URL(src, location.href).href } catch { return null }
  }

  /** The two things a piece offers on hover: MYRA's answer, and somewhere to keep it. */
  function styleButton(tile, product) {
    if (tile.querySelector(':scope > .myra-mirror-actions')) return
    if (getComputedStyle(tile).position === 'static') { tile.dataset.myraPos = '1'; tile.style.position = 'relative' }
    const wrap = document.createElement('div')
    wrap.className = 'myra-mirror-actions'
    wrap.style.cssText = `position:absolute;left:10px;right:10px;bottom:10px;display:flex;gap:6px;align-items:center;justify-content:space-between;z-index:6;opacity:${TOUCH_DEVICE ? 1 : 0};transition:opacity .15s;font:500 13px/1 ${FONT};`

    const ask = document.createElement('button')
    ask.type = 'button'
    ask.className = 'myra-mirror-ask'
    ask.innerHTML = `<img src="${ext.runtime.getURL('icons/mirror.png')}" alt="" style="width:18px;height:18px;object-fit:contain;filter:invert(1)"><span>What do I wear with this?</span>`
    ask.style.cssText = 'flex:1 1 auto;min-width:0;display:flex;align-items:center;justify-content:center;gap:8px;border:0;border-radius:999px;background:rgba(20,20,20,.92);color:#F7F6F3;padding:9px 12px;cursor:pointer;font:500 12.5px/1 ' + FONT + ';letter-spacing:.08em;text-transform:uppercase;white-space:nowrap;overflow:hidden;-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);'
    ask.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation()
      openMenu(ask, { ...product, image: product.image || tileImage(tile) })
    })

    const fav = document.createElement('button')
    fav.type = 'button'
    fav.className = 'myra-mirror-fav'
    fav.title = 'Add to Mirror favourites'
    fav.setAttribute('aria-label', 'Add to Mirror favourites')
    fav.textContent = '♥'
    fav.style.cssText = 'flex:0 0 auto;width:34px;height:34px;border-radius:50%;border:0;background:rgba(255,255,255,.95);color:#2B2B2B;font-size:15px;line-height:34px;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.18);'
    fav.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation()
      fav.disabled = true
      const r = await savePiece({ ...product, image: product.image || tileImage(tile) })
      fav.disabled = false
      if (r?.error) { fav.title = r.error; fav.style.color = '#9B3A3A'; return }
      fav.textContent = '♥'
      fav.style.background = '#141414'
      fav.style.color = '#F7F6F3'
      fav.title = 'In your Mirror favourites'
    })

    wrap.append(ask, fav)
    tile.addEventListener('mouseenter', () => {
      wrap.style.opacity = '1'
      clearTimeout(pillRevert)
      // The card no longer follows the cursor: crossing a tile only reveals
      // this tile's own buttons — the badge on the edge opens the card.
    })
    tile.addEventListener('mouseleave', () => { if (!menu) wrap.style.opacity = '0'; revertPiece(pagePiece) })
    tile.appendChild(wrap)
    touched.add(tile)
  }

  function mark(el, p) {
    if (el.querySelector(':scope > .myra-mirror-mark')) return
    if (getComputedStyle(el).position === 'static') { el.dataset.myraPos = '1'; el.style.position = 'relative' }
    const dot = document.createElement('span')
    dot.className = 'myra-mirror-mark'
    dot.title = `MYRA ${p.confidence ?? Math.round((p.score || 0) * 100)}% · ${p.brand || ''} — ${WHY[p.why] || ''}${FIT[p.fit] || ''}${p.fit === 'yes' && p.herSize ? ` (${p.herSize})` : ''}`.trim()
    dot.style.cssText = 'position:absolute;top:10px;left:10px;width:8px;height:8px;border-radius:50%;background:#141414;box-shadow:0 0 0 2px rgba(255,255,255,.9);z-index:5;pointer-events:auto;'
    el.appendChild(dot)
  }

  function apply(grid, scores) {
    const children = [...grid.container.children]
    const tileOf = new Map(grid.tiles.map((t) => [t.el, t]))
    const slots = children.map((c, i) => (tileOf.has(c) ? i : -1)).filter((i) => i >= 0)
    const scoreOf = (el) => scores.get(tileOf.get(el).key)?.score ?? 0.1
    const sorted = slots.map((i) => children[i]).sort((a, b) => scoreOf(b) - scoreOf(a)) // stable: ties keep the brand's order
    const seq = children.slice()
    slots.forEach((slot, j) => { seq[slot] = sorted[j] })

    const display = getComputedStyle(grid.container).display
    if (/grid|flex/.test(display)) {
      seq.forEach((el, i) => {
        if (el.dataset.myraOrder == null) el.dataset.myraOrder = el.style.order || ''
        el.style.order = String(i)
        touched.add(el)
      })
    } else {
      children.forEach((el, i) => { if (el.dataset.myraIndex == null) el.dataset.myraIndex = String(i); touched.add(el) })
      seq.forEach((el) => grid.container.appendChild(el))
    }

    let lifted = 0
    sorted.forEach((el, j) => {
      const p = scores.get(tileOf.get(el).key)
      const before = children.indexOf(el), after = slots[j]
      if (p && p.score >= LIFT_MIN && after < before) { lifted++; mark(el, p) }
    })
    return lifted
  }

  let lastHref = location.href
  let pagePiece = null

  // ── WHAT SHE LINGERS ON ───────────────────────────────────────────────────
  // A piece she stays on for a few seconds, and what she types into a shop's
  // search, go to MYRA quietly — so FOR YOU can carry on from where she was
  // without her having to save anything. Once per piece, once per search.
  const VIEW_AFTER_MS = 4000
  const viewedSent = new Set()
  let viewTimer = null, viewKey = null
  function noteView(product) {
    if (vinted) return
    const key = product?.url || null
    if (key === viewKey) return
    clearTimeout(viewTimer); viewKey = key
    if (!key || viewedSent.has(key)) return
    const openedAt = Date.now()
    viewTimer = setTimeout(() => {
      if (viewKey !== key || document.hidden) return
      viewedSent.add(key)
      Promise.resolve(send({ type: 'viewedProduct', product, dwellMs: Date.now() - openedAt })).catch(() => {})
    }, VIEW_AFTER_MS)
  }
  const searchedSent = new Set()
  // A search typed at Google is about anything at all; only a search typed at
  // a shop is a style brief. Those hosts never reach here (the guard at the
  // top of the script returns before any of this), and the same list guards
  // the read in MYRA — this belt-and-braces check keeps the table clean even
  // if the top guard is ever narrowed.
  function noteSearch() {
    if (vinted) return
    if (NON_SHOP_HOST.test(location.host.replace(/^www\./i, '').toLowerCase())) return
    let q = ''
    try {
      const u = new URL(location.href)
      for (const k of ['q', 'query', 'search', 'search_query', 'searchTerm', 's', 'keyword', 'keywords', 'k', 'text']) {
        const v = u.searchParams.get(k)
        if (v && v.trim()) { q = v.trim(); break }
      }
      if (!q && /\/search\/./.test(u.pathname)) q = decodeURIComponent(u.pathname.split('/search/')[1] || '').replace(/[-+_/]+/g, ' ').trim()
    } catch {}
    q = q.slice(0, 80)
    if (q.length < 3 || searchedSent.has(q.toLowerCase())) return
    searchedSent.add(q.toLowerCase())
    Promise.resolve(send({ type: 'searched', host: location.host, query: q })).catch(() => {})
  }
  let navSettle = null

  // ── THE SHOP THAT NEVER RELOADS ───────────────────────────────────────────
  // Waiting for the DOM to settle is not the same as noticing she has moved.
  // A listing that turns into a product changes the URL first, and on a busy
  // shop the mutation debounce can be pushed back indefinitely — which is how
  // she ended up reading the last piece's name on this piece's page. So the
  // URL is watched in its own right: she clicks a piece, and the pill is that
  // piece. (A content script cannot see the page's own pushState — it runs in
  // its own world — so the address is polled and popstate listened for.)
  function onNavigated() {
    if (location.href === lastHref) return
    lastHref = location.href
    lastSig = ''
    pillOff = false
    pagePiece = null
    pageProducts = []
    pageHasPicks = false
    clearTimeout(pillRevert)
    clearInterval(navSettle)
    hidePiece()
    hidePicksBadge()
    // The picks the dot stood for belonged to the page she just left.
    maybePicksBadge()
    // The shop writes the new piece a beat after the address changes. Watch
    // for it rather than guessing at one delay, so the pill is this piece as
    // soon as this piece exists — and give up quietly if it never arrives.
    let tries = 0
    navSettle = setInterval(() => {
      const p = M.pageProduct?.() ?? null
      if (p) {
        pagePiece = p
        noteView(p)
        // Noted, not shown: the badge opens this piece's card when she asks.
      }
      if (p || ++tries >= 20) clearInterval(navSettle)
    }, 150)
    schedule()
  }

  async function run() {
    if (running) return
    running = true
    try {
      // A shop that changes the page without reloading it is a new page to
      // her: everything starts again, including anything she had closed.
      if (location.href !== lastHref) { lastHref = location.href; lastSig = ''; pillOff = false; hidePiece() }
      // One piece on its own page: keep it or style it, whatever the shop.
      pagePiece = M.pageProduct?.() ?? null
      noteView(pagePiece)
      noteSearch()
      // The page's piece is only ever recorded here — its card waits behind
      // the badge now, for the click that asks for it.
      if (!pagePiece && pillFrom === 'page') hidePiece()

      const grids = vinted ? M.vintedGrids() : shopify ? M.findGrids() : M.genericGrids()
      // It speaks this shop but found nothing to re-order — a layout it has not
      // learned. Worth passing on too.
      if (!grids.length) { if (!pagePiece && /shop|collection|catalog|category|products|browse|women/i.test(location.pathname)) offerSite(generic ? 'unsupported' : 'no_grid'); return }
      const tiles = grids.flatMap((g) => g.tiles)
      const sig = tiles.map((t) => t.key).join(',')
      if (sig === lastSig) return
      lastSig = sig
      const details = vinted
        ? M.vintedDetails(tiles.map((t) => t.key))
        : shopify ? await M.details(tiles.map((t) => t.key)) : M.genericDetails(tiles.map((t) => t.key))
      const products = tiles.map((t) => ({ key: t.key, ...(details.get(t.key) || {}) }))
      for (const t of tiles) {
        const d = details.get(t.key) || {}
        const product = { key: t.key, url: d.url || (generic ? t.key : `${location.origin}/products/${t.key}`), title: d.title || t.key, brand: d.brand || null, type: d.type || null, price: d.price ?? null, available: d.available !== false, image: d.image ?? null }
        productOf.set(t.el, product)
        styleButton(t.el, product)
      }
      const t0 = performance.now()
      const res = await send({ type: 'rank', host: location.host, products })
      if (!res || res.error || !Array.isArray(res.products)) return
      const scores = new Map(res.products.map((p) => [p.key, p]))
      lastLifted = grids.reduce((n, g) => n + apply(g, scores), 0)
      lastTotal = tiles.length
      // The page is ranked and has pieces worth picking from: the top-right
      // badge may appear. 0.4 is the bar the picks themselves are held to.
      pageProducts = products
      pageHasPicks = res.products.some((p) => (p.score ?? 0) >= 0.4)
      maybePicksBadge()
      // A job that finished while this page was still being read, or while she
      // was somewhere that is not a shop, belongs here: this is the first shop
      // page since. (One she closed is already gone from the worker.) It no
      // longer opens itself — it lights the badge's dot until she asks.
      if (!panel) {
        const waiting = await send({ type: 'styleJob' })
        if (waiting?.job && waiting.job.status !== 'loading') { jobWaiting = true; badgeMark() }
      }
      const top = res.products.filter((p) => p.score >= LIFT_MIN).sort((a, b) => b.score - a.score).slice(0, 6)
        .map((p) => ({ brand: p.brand, title: (details.get(p.key) || {}).title || p.key, confidence: p.confidence, why: WHY[p.why] || '', fit: FIT[p.fit] || '' }))
      await send({ type: 'pageStats', host: location.host, lifted: lastLifted, total: lastTotal, member: res.member?.name, ms: Math.round(performance.now() - t0), top })
    } finally { running = false; lastRunAt = Date.now() }
  }

  function restore() {
    for (const el of touched) {
      if (el.dataset.myraOrder != null) { el.style.order = el.dataset.myraOrder; delete el.dataset.myraOrder }
      if (el.dataset.myraPos) { el.style.position = ''; delete el.dataset.myraPos }
      el.querySelectorAll(':scope > .myra-mirror-mark, :scope > .myra-mirror-actions').forEach((d) => d.remove())
    }
    const byIndex = [...touched].filter((el) => el.dataset.myraIndex != null).sort((a, b) => Number(a.dataset.myraIndex) - Number(b.dataset.myraIndex))
    for (const el of byIndex) { el.parentElement?.appendChild(el); delete el.dataset.myraIndex }
    touched.clear(); lastSig = ''
  }

  let timer = null
  let lastRunAt = 0
  // A shop whose DOM never settles — carousels, lazy pictures, analytics
  // dropping nodes in — would push this debounce back for as long as it kept
  // moving, and the mirror would never run at all. After MAX_WAIT it goes.
  const MAX_WAIT = 2000
  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(run, Date.now() - lastRunAt > MAX_WAIT ? 0 : 500)
  }
  onMessage((msg) => {
    if (msg?.type === 'restore') { observer.disconnect(); closeMenu(); closePicks(); hidePiece(); restore() }
    // A panel she already opened keeps being written into as the job builds.
    // One she has not opened stays shut — a finished job lights the badge's
    // dot instead, and on a page that is not a shop it simply waits in the
    // worker for the next shop page.
    if (msg?.type === 'styleUpdate') {
      if (panel) renderPanel(msg.job)
      else if ((pagePiece || productOf.size) && msg.job?.status !== 'loading') { jobWaiting = true; badgeMark() }
    }
    if (msg?.type === 'rerun') { lastSig = ''; observer.observe(document.body, { childList: true, subtree: true }); schedule() }
  })
  const observer = new MutationObserver((muts) => {
    if (muts.some((m) => [...m.addedNodes].some((n) => n.nodeType === 1 && !/myra-mirror-/.test(n.className || '')))) schedule()
  })
  addEventListener('popstate', onNavigated)
  addEventListener('hashchange', onNavigated)
  setInterval(onNavigated, 300)

  await run()
  // A panel that was building when she left the last page still belongs to
  // her — if here is a shop, the badge's dot says it is ready and she opens
  // it. Anywhere else it waits in the worker rather than interrupting, and
  // the next shop page picks it up.
  const inFlight = await send({ type: 'styleJob' })
  if (inFlight?.job && (panel || pagePiece || productOf.size) && inFlight.job.status !== 'loading') { jobWaiting = true; badgeMark() }
  observer.observe(document.body, { childList: true, subtree: true })
})()
