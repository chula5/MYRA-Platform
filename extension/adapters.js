// MYRA Mirror — how a brand site's listing becomes a list of tiles.
//
// Phase 0 speaks Shopify only. Every Shopify storefront exposes
// /products/<handle>.js with vendor, type, title and price, so we never
// scrape the brand's markup for facts — only for WHERE each tile is. The
// grid is found structurally: the container whose direct children each hold
// exactly one product link. The page stays the brand's; we touch order only.

;(() => {
  const M = (window.__myraMirror = window.__myraMirror || {})

  M.isShopify = () =>
    !!(window.Shopify ||
      document.querySelector('script[src*="cdn.shopify.com"], link[href*="cdn.shopify.com"], meta[name="shopify-checkout-api-token"]'))

  M.productHandle = (href) => {
    try {
      const u = new URL(href, location.href)
      if (u.origin !== location.origin) return null
      const m = u.pathname.match(/\/products\/([^/?#]+)/i)
      return m ? decodeURIComponent(m[1]).toLowerCase() : null
    } catch { return null }
  }

  // → [{ container, tiles: [{ el, key }] }] — deepest containers with ≥4 tiles.
  M.findGrids = () => {
    const byHandle = new Map()
    for (const a of document.querySelectorAll('a[href*="/products/"]')) {
      const h = M.productHandle(a.getAttribute('href') || '')
      if (!h) continue
      if (!byHandle.has(h)) byHandle.set(h, [])
      byHandle.get(h).push(a)
    }
    if (byHandle.size < 4) return []

    // container → (direct child → set of handles inside it)
    const stats = new Map()
    for (const [h, anchors] of byHandle) {
      for (const a of anchors) {
        let child = a, parent = a.parentElement, depth = 0
        while (parent && parent !== document.documentElement && depth < 14) {
          let m = stats.get(parent)
          if (!m) stats.set(parent, (m = new Map()))
          let s = m.get(child)
          if (!s) m.set(child, (s = new Set()))
          s.add(h)
          child = parent; parent = parent.parentElement; depth++
        }
      }
    }

    const candidates = []
    for (const [container, children] of stats) {
      let tiles = 0, multi = 0
      for (const s of children.values()) s.size === 1 ? tiles++ : multi++
      // Most direct children are single-product tiles → this is a product grid.
      if (tiles < 4 || multi > 1 || tiles < container.children.length * 0.5) continue
      // A hidden list (predictive search, a closed drawer) is not the page's grid.
      const box = container.getBoundingClientRect()
      if (box.width < 40 || box.height < 40) continue
      candidates.push({ container, children, tiles })
    }
    // Keep the deepest grids only — a wrapper around a grid is not a grid.
    const grids = candidates.filter((g) => !candidates.some((o) => o !== g && g.container.contains(o.container)))
    return grids.map((g) => ({
      container: g.container,
      tiles: [...g.children].filter(([c, s]) => s.size === 1 && c.parentElement === g.container).map(([c, s]) => ({ el: c, key: [...s][0] })),
    }))
  }

  // Size variants, collapsed per label (a size on two colourways is available if either is).
  M.sizesOf = (p) => {
    const options = Array.isArray(p.options) ? p.options : []
    let idx = options.findIndex((o) => /size|taille|gr[öo][sß]+e|talla|taglia/i.test((o && o.name) || ''))
    if (idx < 0 && options.length === 1 && (p.variants || []).length > 1) idx = 0
    if (idx < 0) return []
    const key = `option${idx + 1}`
    const byLabel = new Map()
    for (const v of p.variants || []) {
      const label = v && v[key]
      if (!label) continue
      byLabel.set(label, (byLabel.get(label) || false) || v.available !== false)
    }
    return [...byLabel].slice(0, 60).map(([label, available]) => ({ label: String(label).slice(0, 40), available }))
  }

  // handle → { brand, title, type, price, url, available, sizes } via /products/<handle>.js,
  // cached per session so a second page of the same store costs nothing.
  const CACHE_KEY = 'myra:mirror:products:v2'
  const load = () => { try { return JSON.parse(sessionStorage.getItem(CACHE_KEY) || '{}') } catch { return {} } }
  const save = (o) => { try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(o)) } catch {} }

  M.details = async (handles) => {
    const cache = load()
    const missing = [...new Set(handles)].filter((h) => !cache[h])
    const queue = missing.slice()
    const worker = async () => {
      while (queue.length) {
        const h = queue.shift()
        try {
          const r = await fetch(`/products/${encodeURIComponent(h)}.js`, { credentials: 'same-origin' })
          if (!r.ok) { cache[h] = { brand: null }; continue }
          const p = await r.json()
          cache[h] = {
            brand: p.vendor || null,
            title: p.title || null,
            type: p.type || null,
            price: typeof p.price === 'number' ? p.price / 100 : null,
            url: `${location.origin}/products/${h}`,
            available: p.available !== false,
            sizes: M.sizesOf(p),
          }
        } catch { cache[h] = { brand: null } }
      }
    }
    await Promise.all(Array.from({ length: Math.min(8, missing.length) }, worker))
    save(cache)
    return new Map(handles.map((h) => [h, cache[h] || { brand: null }]))
  }
})()
