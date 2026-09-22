// MYRA Mirror — how a brand site's listing becomes a list of tiles.
//
// Phase 0 speaks Shopify only. Every Shopify storefront exposes
// /products/<handle>.js with vendor, type, title and price, so we never
// scrape the brand's markup for facts — only for WHERE each tile is. The
// grid is found structurally: the container whose direct children each hold
// exactly one product link. The page stays the brand's; we touch order only.

;(() => {
  const M = (window.__myraMirror = window.__myraMirror || {})

  // Vinted is not Shopify and has no product JSON: its tiles carry the facts
  // (brand, size, price, picture, link) in their own markup, so they are read
  // from the tile itself. Same contract as Shopify: find grids, hand back
  // tiles with keys, answer details() per key.
  M.isVinted = () => /(^|\.)vinted\.[a-z.]+$/i.test(location.hostname)

  const vintedItemId = (href) => {
    try {
      const u = new URL(href, location.href)
      const m = u.pathname.match(/\/items\/(\d+)/)
      return m ? m[1] : null
    } catch { return null }
  }

  const vintedTileFacts = (el) => {
    const a = el.querySelector('a[href*="/items/"]')
    const img = el.querySelector('img')
    const text = (el.innerText || '').split('\n').map((t) => t.trim()).filter(Boolean)
    // Vinted writes brand, then size, then condition, then price.
    const priceLine = text.find((t) => /^[£€$]\s?\d/.test(t))
    const price = priceLine ? Number(priceLine.replace(/[^\d.]/g, '')) : null
    // A catalogue tile's alt reads: "<seller's title>, Brand: X, Condition: Y,
    // Size: Z, <price>". The brand is the labelled field, never the title.
    const alt = img?.getAttribute('alt') || ''
    const brand = (alt.match(/Brand:\s*([^,]+)/i)?.[1] || '').trim() || null
    const size = (alt.match(/Size:\s*([^,]+)/i)?.[1] || '').trim() || null
    const title = (alt.split(',')[0] || text.slice(0, 2).join(' ') || 'Vinted piece').trim()
    return {
      brand: brand && brand.length <= 60 ? brand : null,
      title,
      size,
      type: null,
      price,
      url: a ? new URL(a.getAttribute('href'), location.href).href : location.href,
      available: true,
      sizes: size ? [{ label: size, available: true }] : [],
      image: img ? (img.currentSrc || img.src) : null,
    }
  }

  M.vintedGrids = () => {
    const byItem = new Map()
    for (const a of document.querySelectorAll('a[href*="/items/"]')) {
      const id = vintedItemId(a.getAttribute('href') || '')
      if (!id) continue
      if (!byItem.has(id)) byItem.set(id, [])
      byItem.get(id).push(a)
    }
    if (byItem.size < 4) return []
    // The tile is the highest ancestor that still holds exactly this one item.
    const tileOf = (a) => {
      let el = a
      for (let i = 0; i < 6 && el.parentElement; i++) {
        const parent = el.parentElement
        const ids = new Set([...parent.querySelectorAll('a[href*="/items/"]')].map((x) => vintedItemId(x.getAttribute('href') || '')).filter(Boolean))
        if (ids.size !== 1) break
        el = parent
      }
      return el
    }
    const byContainer = new Map()
    for (const [id, anchors] of byItem) {
      const tile = tileOf(anchors[0])
      const container = tile.parentElement
      if (!container) continue
      if (!byContainer.has(container)) byContainer.set(container, [])
      byContainer.get(container).push({ el: tile, key: id })
    }
    return [...byContainer.entries()]
      .filter(([, tiles]) => tiles.length >= 4)
      .map(([container, tiles]) => ({ container, tiles }))
  }

  M.vintedDetails = (keys) => {
    const found = new Map()
    for (const g of M.vintedGrids()) for (const t of g.tiles) found.set(t.key, vintedTileFacts(t.el))
    return new Map(keys.map((k) => [k, found.get(k) || { brand: null }]))
  }


  // ── ANY OTHER SHOP ────────────────────────────────────────────────────────
  // A third of the brands MYRA watches are not Shopify and not Vinted: ME+EM,
  // Sessùn, Bimba y Lola, Max Mara, Agnès b., By Malene Birger, Claudie
  // Pierlot, Adolfo Domínguez, Vanessa Bruno, Varley. They have no product
  // JSON, so the grid is read the way a person reads it: repeated tiles, each
  // with one picture, one link and a price. Nothing is invented — a tile that
  // carries no price or no picture is not a product.
  const CURRENCY = /(?:[£€$]|GBP|EUR|USD)\s?\d[\d.,]*/i
  const priceIn = (el) => {
    const m = (el.innerText || '').match(CURRENCY)
    if (!m) return null
    const n = Number(m[0].replace(/[^\d.,]/g, '').replace(/,(\d{2})$/, '.$1').replace(/,/g, ''))
    return Number.isFinite(n) && n > 0 ? n : null
  }

  /** The shop's own name: what it calls itself, not its domain. */
  M.siteBrand = () => {
    const meta = document.querySelector('meta[property="og:site_name"]')?.getAttribute('content')
    if (meta && meta.length <= 60) return meta.trim()
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const j = JSON.parse(s.textContent || '{}')
        const nodes = Array.isArray(j) ? j : j['@graph'] ? j['@graph'] : [j]
        for (const n of nodes) {
          const b = typeof n?.brand === 'string' ? n.brand : n?.brand?.name
          if (b) return String(b).slice(0, 60)
          if (n?.['@type'] === 'Organization' && n?.name) return String(n.name).slice(0, 60)
        }
      } catch { /* a shop's bad JSON is not our problem */ }
    }
    const host = location.hostname.replace(/^(www|uk|us|intl|en|gb|shop)\./, '').split('.')[0]
    return host.charAt(0).toUpperCase() + host.slice(1)
  }

  const sameOrigin = (a) => {
    try { return new URL(a.getAttribute('href'), location.href).origin === location.origin } catch { return false }
  }
  const hrefOf = (a) => {
    try { const u = new URL(a.getAttribute('href'), location.href); return `${u.origin}${u.pathname}` } catch { return null }
  }

  // → [{ container, tiles: [{ el, key }] }] on any shop.
  M.genericGrids = () => {
    // Every link that wraps (or sits beside) a picture — a product tile's shape.
    const byHref = new Map()
    for (const a of document.querySelectorAll('a[href]')) {
      if (!sameOrigin(a)) continue
      const href = hrefOf(a)
      if (!href || href === location.pathname || /\/(cart|account|login|search|help|contact|about|blog|journal)(\/|$)/i.test(href)) continue
      if (!a.querySelector('img') && !a.parentElement?.querySelector('img')) continue
      if (!byHref.has(href)) byHref.set(href, [])
      byHref.get(href).push(a)
    }
    if (byHref.size < 4) return []

    // The tile: the highest ancestor that still holds exactly this one product.
    const tileOf = (a) => {
      let el = a
      for (let i = 0; i < 7 && el.parentElement && el.parentElement !== document.body; i++) {
        const parent = el.parentElement
        const hrefs = new Set([...parent.querySelectorAll('a[href]')].filter(sameOrigin).map(hrefOf).filter(Boolean))
        if (hrefs.size !== 1) break
        el = parent
      }
      return el
    }

    const byContainer = new Map()
    for (const [href, anchors] of byHref) {
      const tile = tileOf(anchors[0])
      const container = tile.parentElement
      if (!container) continue
      if (!byContainer.has(container)) byContainer.set(container, [])
      byContainer.get(container).push({ el: tile, key: href })
    }

    return [...byContainer.entries()]
      .filter(([container, tiles]) => {
        if (tiles.length < 4) return false
        // A row of four navigation cards is not a grid of products: most tiles
        // must show a price, and the grid must take real room on the page.
        const priced = tiles.filter((t) => priceIn(t.el) != null).length
        if (priced < Math.max(3, tiles.length * 0.5)) return false
        const box = container.getBoundingClientRect()
        return box.width > 200 && box.height > 200
      })
      .map(([container, tiles]) => ({ container, tiles }))
  }

  M.genericDetails = (keys) => {
    const brand = M.siteBrand()
    const found = new Map()
    for (const g of M.genericGrids()) {
      for (const t of g.tiles) {
        const el = t.el
        const img = [...el.querySelectorAll('img')]
          .map((i) => ({ i, area: (i.naturalWidth || i.width || 0) * (i.naturalHeight || i.height || 0) }))
          .sort((x, y) => y.area - x.area)[0]?.i
        const heading = el.querySelector('h1, h2, h3, h4, [class*="title"], [class*="name"]')
        const lines = (el.innerText || '').split('\n').map((x) => x.trim()).filter(Boolean)
        const title = (heading?.textContent || img?.getAttribute('alt') || lines.find((l) => !CURRENCY.test(l)) || 'Piece').trim().slice(0, 200)
        found.set(t.key, {
          brand,
          title,
          type: null,
          price: priceIn(el),
          url: t.key,
          available: !/sold out|out of stock/i.test(el.innerText || ''),
          sizes: [],
          image: img ? (img.currentSrc || img.src || null) : null,
        })
      }
    }
    return new Map(keys.map((k) => [k, found.get(k) || { brand: null }]))
  }


  // ── ONE PRODUCT PAGE, ANY SHOP ────────────────────────────────────────────
  // A product page is not a grid, and every shop writes one the same way for
  // Google: JSON-LD, then Open Graph. That is enough to save a piece to MYRA
  // and to style it, on a shop the mirror cannot otherwise read.
  M.pageProduct = () => {
    const out = { url: location.href.split(/[?#]/)[0], title: null, brand: null, price: null, image: null, available: true, sizes: [] }
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      let json
      try { json = JSON.parse(s.textContent || '{}') } catch { continue }
      const nodes = Array.isArray(json) ? json : json['@graph'] ? json['@graph'] : [json]
      for (const n of nodes) {
        const type = Array.isArray(n?.['@type']) ? n['@type'] : [n?.['@type']]
        if (!type.includes('Product')) continue
        out.title = typeof n.name === 'string' ? n.name.slice(0, 200) : out.title
        out.brand = (typeof n.brand === 'string' ? n.brand : n.brand?.name) ?? out.brand
        const offers = Array.isArray(n.offers) ? n.offers[0] : n.offers
        const price = Number(offers?.price ?? offers?.lowPrice)
        if (Number.isFinite(price) && price > 0) out.price = price
        if (typeof offers?.availability === 'string') out.available = !/OutOfStock|SoldOut/i.test(offers.availability)
        const img = Array.isArray(n.image) ? n.image[0] : n.image
        if (typeof img === 'string') out.image = img
      }
    }
    const meta = (p) => document.querySelector(`meta[property="${p}"], meta[name="${p}"]`)?.getAttribute('content') || null
    if (meta('og:type') === 'product' || /\/(product|products|p|item)s?\//i.test(location.pathname)) {
      out.title = out.title || meta('og:title') || document.querySelector('h1')?.textContent?.trim() || null
      out.image = out.image || meta('og:image')
      out.brand = out.brand || meta('product:brand') || M.siteBrand()
      if (out.price == null) {
        const p = Number((meta('product:price:amount') || '').replace(/[^\d.]/g, ''))
        if (Number.isFinite(p) && p > 0) out.price = p
      }
    }
    if (!out.title || !out.image) return null
    if (out.price == null) {
      const m = (document.body.innerText || '').match(/(?:[£€$])\s?\d[\d.,]*/)
      if (m) { const n = Number(m[0].replace(/[^\d.,]/g, '').replace(/,/g, '')); if (Number.isFinite(n) && n > 0) out.price = n }
    }
    out.title = String(out.title).slice(0, 200)
    out.brand = out.brand ? String(out.brand).slice(0, 80) : M.siteBrand()
    return out
  }

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
