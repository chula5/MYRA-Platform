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
  if (!M.isShopify()) return

  const LIFT_MIN = 0.6 // named / core-family and above earn the mark
  const WHY = {
    named: 'one of your brands', wardrobe: 'in your wardrobe', shopped: 'you shop them', liked: 'you liked them',
    learned: 'learned from your decisions', similar: 'close to your brands', baseline: '', input_only: 'input only',
  }
  const FIT = { yes: ' · in your size', no: ' · not your size', sold_out: ' · sold out in your size', unknown: '' }

  let running = false, lastSig = '', lastLifted = 0, lastTotal = 0
  const touched = new Set()
  const productOf = new Map() // tile el → { key, url, title, brand, type, price, image, available }

  // ── STYLE IN MYRA — a small M on each piece; click → a box pops out beside it ──
  const API = state.apiBase.replace(/\/+$/, '')
  let popout = null
  function closePopout() {
    if (!popout) return
    popout.backdrop.remove(); popout.frame.remove(); popout = null
    document.removeEventListener('keydown', onKey)
  }
  const onKey = (e) => { if (e.key === 'Escape') closePopout() }
  window.addEventListener('message', async (e) => {
    if (!popout || e.source !== popout.iframe.contentWindow) return
    const d = e.data || {}
    if (d.type === 'myra-style-ready') {
      const t = await send({ type: 'token' })
      if (t?.token) popout.iframe.contentWindow.postMessage({ type: 'myra-token', token: t.token, product: popout.product }, API)
    }
    if (d.type === 'myra-style-close') closePopout()
  })
  function openPopout(tile, product) {
    closePopout()
    const r = tile.getBoundingClientRect()
    const W = 360, H = Math.min(640, window.innerHeight - 32)
    const right = r.right + 12 + W <= window.innerWidth
    const left = right ? r.right + 12 : Math.max(16, r.left - 12 - W)
    const top = Math.max(16, Math.min(r.top, window.innerHeight - H - 16))
    const backdrop = document.createElement('div')
    backdrop.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:transparent;'
    backdrop.addEventListener('click', closePopout)
    const frame = document.createElement('div')
    frame.className = 'myra-mirror-popout'
    frame.style.cssText = `position:fixed;z-index:2147483647;left:${left}px;top:${top}px;width:${W}px;height:${H}px;background:#F7F6F3;border:1px solid #2B2B2B;box-shadow:0 18px 50px rgba(0,0,0,.22);overflow:hidden;`
    const iframe = document.createElement('iframe')
    iframe.src = `${API}/mirror/style?u=${encodeURIComponent(product.url)}`
    iframe.style.cssText = 'width:100%;height:100%;border:0;display:block;background:#F7F6F3;'
    iframe.setAttribute('title', 'Style in MYRA')
    frame.appendChild(iframe)
    document.body.append(backdrop, frame)
    document.addEventListener('keydown', onKey)
    popout = { backdrop, frame, iframe, product }
  }
  function tileImage(tile) {
    const imgs = [...tile.querySelectorAll('img')].map((img) => ({ img, area: (img.naturalWidth || img.width) * (img.naturalHeight || img.height) })).sort((a, b) => b.area - a.area)
    const img = imgs[0]?.img
    if (!img) return null
    const src = img.currentSrc || img.src
    try { return new URL(src, location.href).href } catch { return null }
  }
  function styleButton(tile, product) {
    if (tile.querySelector(':scope > .myra-mirror-style')) return
    if (getComputedStyle(tile).position === 'static') { tile.dataset.myraPos = '1'; tile.style.position = 'relative' }
    const b = document.createElement('button')
    b.className = 'myra-mirror-style'
    b.type = 'button'
    b.textContent = 'M'
    b.title = 'Style in MYRA'
    b.style.cssText = 'position:absolute;top:10px;right:10px;width:28px;height:28px;border-radius:50%;background:#141414;color:#F7F6F3;border:0;font:600 13px/28px -apple-system,Helvetica,Arial,sans-serif;letter-spacing:.02em;cursor:pointer;z-index:6;opacity:0;transition:opacity .15s;box-shadow:0 0 0 2px rgba(255,255,255,.9);'
    tile.addEventListener('mouseenter', () => { b.style.opacity = '1' })
    tile.addEventListener('mouseleave', () => { b.style.opacity = '0' })
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openPopout(tile, { ...product, image: product.image || tileImage(tile) }) })
    tile.appendChild(b)
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
      const grids = M.findGrids()
      if (!grids.length) return
      const tiles = grids.flatMap((g) => g.tiles)
      const sig = tiles.map((t) => t.key).join(',')
      if (sig === lastSig) return
      lastSig = sig
      const details = await M.details(tiles.map((t) => t.key))
      const products = tiles.map((t) => ({ key: t.key, ...(details.get(t.key) || {}) }))
      for (const t of tiles) {
        const d = details.get(t.key) || {}
        const product = { key: t.key, url: d.url || `${location.origin}/products/${t.key}`, title: d.title || t.key, brand: d.brand || null, type: d.type || null, price: d.price ?? null, available: d.available !== false, image: null }
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
      el.querySelectorAll(':scope > .myra-mirror-mark, :scope > .myra-mirror-style').forEach((d) => d.remove())
    }
    const byIndex = [...touched].filter((el) => el.dataset.myraIndex != null).sort((a, b) => Number(a.dataset.myraIndex) - Number(b.dataset.myraIndex))
    for (const el of byIndex) { el.parentElement?.appendChild(el); delete el.dataset.myraIndex }
    touched.clear(); lastSig = ''
  }

  let timer = null
  const schedule = () => { clearTimeout(timer); timer = setTimeout(run, 500) }
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'restore') { observer.disconnect(); closePopout(); restore() }
    if (msg?.type === 'rerun') { lastSig = ''; observer.observe(document.body, { childList: true, subtree: true }); schedule() }
  })
  const observer = new MutationObserver((muts) => {
    if (muts.some((m) => [...m.addedNodes].some((n) => n.nodeType === 1 && !/myra-mirror-/.test(n.className || '')))) schedule()
  })
  await run()
  observer.observe(document.body, { childList: true, subtree: true })
})()
