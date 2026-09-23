// MYRA Mirror — reorder the brand's own grid into her order. Nothing is
// restyled, no link is rewritten, no cookie is touched: CSS `order` on the
// grid's children (DOM order as a fallback for non-flex grids), plus one
// small MYRA mark on a piece that was lifted. Turning the extension off for a
// site puts every tile back where the brand had it.

;(async () => {
  const M = window.__myraMirror
  if (!M || window.top !== window) return
  const send = (msg) => new Promise((r) => { try { chrome.runtime.sendMessage(msg, (v) => r(chrome.runtime.lastError ? null : v)) } catch { r(null) } })

  const state = await send({ type: 'state', host: location.host })
  if (!state || !state.connected || !state.enabled) return
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
  const onKey = (e) => { if (e.key === 'Escape') { closeMenu(); closePanel() } }
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
  try { loadedVersion = chrome.runtime.getManifest().version } catch { /* not available in some contexts */ }
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

  /** The fallback path: this page talks to MYRA itself, with the token the worker holds. */
  async function styleFromPage(product, mode) {
    const t = await send({ type: 'token' })
    if (!t?.token) { renderPanel({ status: 'error', product, mode, error: RELOAD_NOTE }); return }
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
  }
  function openPanel(job) {
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

  function renderPanel(job) {
    if (!job) { panel?.remove(); panel = null; return }
    if (!panel) openPanel(job)
    if (!panel) return
    const modeLabel = job.mode === 'wardrobe' ? 'with your wardrobe' : 'with new pieces'
    const head = `
      <div style="position:sticky;top:0;background:rgba(247,247,249,.92);backdrop-filter:blur(8px);padding:18px 18px 12px;display:flex;gap:12px;align-items:flex-start;">
        <img src="${esc(chrome.runtime.getURL('icons/mirror.png'))}" alt="" style="width:26px;height:auto;flex:0 0 auto;margin-top:2px">
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
        ${looks.map((l, i) => lookCard(l, i)).join('')}
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
        ? `<div style="padding:4px 14px 20px">${looks.map((l, i) => lookCard(l, i)).join('')}</div>`
        : `<div style="padding:6px 18px 20px;font-size:14px;opacity:.7">Nothing MYRA would put with it yet${job.mode === 'wardrobe' ? ' from your own pieces' : ''}.</div>`)
    }
    panel.innerHTML = head + body
    panel.querySelector('[data-myra="close"]')?.addEventListener('click', closePanel)
  }

  function lookCard(look, i) {
    const pieces = (look.items || []).slice(0, 6)
    const tiles = pieces.map((p) => `
      <a href="${esc(p.url || '#')}" target="_blank" rel="noreferrer" style="display:block;flex:0 0 72px;text-decoration:none;color:inherit">
        <div style="position:relative;width:72px;aspect-ratio:3/4;border-radius:12px;overflow:hidden;background:#EFEFED">
          ${p.image_url ? `<img src="${esc(p.image_url)}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">` : ''}
          ${p.owned ? '<span style="position:absolute;top:4px;left:4px;background:#141414;color:#fff;border-radius:999px;padding:1px 7px;font-size:10px">Yours</span>' : ''}
        </div>
        <div style="font-size:11px;line-height:1.25;margin-top:4px;opacity:.75;max-height:28px;overflow:hidden">${esc(p.product_name || p.brand || '')}</div>
      </a>`).join('')
    return `<div style="background:#fff;border-radius:18px;padding:12px;margin-bottom:12px;box-shadow:0 8px 22px -18px rgba(0,0,0,.5)">
      <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;opacity:.5;margin-bottom:8px">Look ${i + 1}</div>
      <div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:4px">${tiles}</div>
      ${look.why ? `<div style="font-size:12.5px;opacity:.7;margin-top:9px;line-height:1.35">${esc(look.why)}</div>` : ''}
    </div>`
  }


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
        <img src="${chrome.runtime.getURL('icons/mirror.png')}" alt="" style="width:24px;height:auto;margin-top:1px">
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
      said.textContent = r?.error ? friendly(r.error) : r?.again ? 'Already on her list — she knows you want it.' : 'Passed on to MYRA. She’ll take a look.'
      btn.remove()
      rememberAsked()
      setTimeout(() => box.remove(), 4000)
    })
    document.body.appendChild(box)
  }


  // ── ONE PIECE, ON ITS OWN PAGE ────────────────────────────────────────────
  // Any shop, readable or not: keep it, or ask what to wear with it.
  function offerProduct(product) {
    if (document.querySelector('.myra-mirror-product')) return
    const box = document.createElement('div')
    box.className = 'myra-mirror-product'
    box.style.cssText = `position:fixed;z-index:2147483646;right:16px;bottom:16px;width:min(330px,calc(100vw - 32px));background:linear-gradient(160deg,#F7F7F9 0%,#E9E9EC 100%);border-radius:22px;box-shadow:0 20px 50px rgba(0,0,0,.24);padding:15px 17px;font:400 14px/1.4 ${FONT};color:#2B2B2B;`
    box.innerHTML = `
      <div style="display:flex;gap:11px;align-items:flex-start">
        <img src="${chrome.runtime.getURL('icons/mirror.png')}" alt="" style="width:22px;height:auto;margin-top:2px">
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
    const said = box.querySelector('[data-myra="said"]')
    const say = (t) => { said.style.display = 'block'; said.textContent = t }
    box.querySelector('[data-myra="close"]').addEventListener('click', () => box.remove())
    box.querySelector('[data-myra="save"]').addEventListener('click', async (e) => {
      const b = e.currentTarget
      b.disabled = true
      say('Saving…')
      const r = await send({ type: 'saveProduct', product })
      if (r?.error) { say(friendly(r.error)); b.disabled = false; return }
      b.textContent = '♥ Saved'
      say('In your saved pieces — MYRA watches its stock and will tell you if it starts to go.')
    })
    box.querySelector('[data-myra="style"]').addEventListener('click', (e) => openMenu(e.currentTarget, product))
    document.body.appendChild(box)
  }

  function tileImage(tile) {
    const imgs = [...tile.querySelectorAll('img')].map((img) => ({ img, area: (img.naturalWidth || img.width) * (img.naturalHeight || img.height) })).sort((a, b) => b.area - a.area)
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
    wrap.style.cssText = `position:absolute;left:10px;right:10px;bottom:10px;display:flex;gap:6px;align-items:center;justify-content:space-between;z-index:6;opacity:0;transition:opacity .15s;font:500 13px/1 ${FONT};`

    const ask = document.createElement('button')
    ask.type = 'button'
    ask.className = 'myra-mirror-ask'
    ask.innerHTML = `<img src="${chrome.runtime.getURL('icons/mirror.png')}" alt="" style="width:18px;height:18px;object-fit:contain;filter:invert(1)"><span>What do I wear with this?</span>`
    ask.style.cssText = 'flex:1 1 auto;min-width:0;display:flex;align-items:center;justify-content:center;gap:8px;border:0;border-radius:999px;background:rgba(20,20,20,.92);color:#F7F6F3;padding:9px 12px;cursor:pointer;font:500 12.5px/1 ' + FONT + ';letter-spacing:.08em;text-transform:uppercase;white-space:nowrap;overflow:hidden;backdrop-filter:blur(4px);'
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
      const r = await send({ type: 'saveProduct', product: { ...product, image: product.image || tileImage(tile) } })
      fav.disabled = false
      if (r?.error) { fav.title = r.error; fav.style.color = '#9B3A3A'; return }
      fav.textContent = '♥'
      fav.style.background = '#141414'
      fav.style.color = '#F7F6F3'
      fav.title = 'In your Mirror favourites'
    })

    wrap.append(ask, fav)
    tile.addEventListener('mouseenter', () => { wrap.style.opacity = '1' })
    tile.addEventListener('mouseleave', () => { if (!menu) wrap.style.opacity = '0' })
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

  async function run() {
    if (running) return
    running = true
    try {
      // One piece on its own page: keep it or style it, whatever the shop.
      const piece = M.pageProduct?.()
      if (piece) offerProduct(piece)

      const grids = vinted ? M.vintedGrids() : shopify ? M.findGrids() : M.genericGrids()
      // It speaks this shop but found nothing to re-order — a layout it has not
      // learned. Worth passing on too.
      if (!grids.length) { if (!piece && /shop|collection|catalog|category|products|browse|women/i.test(location.pathname)) offerSite(generic ? 'unsupported' : 'no_grid'); return }
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
      const top = res.products.filter((p) => p.score >= LIFT_MIN).sort((a, b) => b.score - a.score).slice(0, 6)
        .map((p) => ({ brand: p.brand, title: (details.get(p.key) || {}).title || p.key, confidence: p.confidence, why: WHY[p.why] || '', fit: FIT[p.fit] || '' }))
      await send({ type: 'pageStats', host: location.host, lifted: lastLifted, total: lastTotal, member: res.member?.name, ms: Math.round(performance.now() - t0), top })
    } finally { running = false }
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
  const schedule = () => { clearTimeout(timer); timer = setTimeout(run, 500) }
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'restore') { observer.disconnect(); closeMenu(); restore() }
    if (msg?.type === 'styleUpdate') renderPanel(msg.job)
    if (msg?.type === 'rerun') { lastSig = ''; observer.observe(document.body, { childList: true, subtree: true }); schedule() }
  })
  const observer = new MutationObserver((muts) => {
    if (muts.some((m) => [...m.addedNodes].some((n) => n.nodeType === 1 && !/myra-mirror-/.test(n.className || '')))) schedule()
  })
  // A panel that was building when she left the last page carries on here.
  const inFlight = await send({ type: 'styleJob' })
  if (inFlight?.job) openPanel(inFlight.job)

  await run()
  observer.observe(document.body, { childList: true, subtree: true })
})()
