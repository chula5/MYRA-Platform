// MYRA — read HER OWN Vinted purchases, in her own signed-in tab.
//
// Vinted has no API for buyers and MYRA never holds her Vinted password: this
// runs only in a tab she is already signed into, only when she asks for it
// (the popup's "Send my purchases to MYRA"), and reads only her orders list —
// what she can see on screen. Nothing is written back to Vinted.

;(() => {
  const ORDER_LINK = /\/(orders?|transactions?)\/(\d+)/i
  const ITEM_LINK = /\/items\/(\d+)/i

  const text = (el) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()

  /** The photo inside a card: Vinted serves item photos from its own image CDN. */
  function photoIn(card) {
    const img = [...card.querySelectorAll('img')].find((i) => /vinted(cdn)?\.net|images\d*\.vinted/i.test(i.src || ''))
    return img?.src || null
  }

  /** £12.50, 12,50 €, 12.50 GBP → { price, currency } */
  function priceIn(s) {
    const m = s.match(/(£|€|\$)\s?(\d+[.,]?\d*)|(\d+[.,]?\d*)\s?(GBP|EUR|USD)/i)
    if (!m) return { price: null, currency: null }
    const raw = (m[2] ?? m[3] ?? '').replace(',', '.')
    const symbol = m[1] ?? m[4] ?? ''
    const currency = { '£': 'GBP', '€': 'EUR', $: 'USD' }[symbol] ?? symbol.toUpperCase() ?? null
    const price = parseFloat(raw)
    return { price: Number.isFinite(price) ? price : null, currency: currency || null }
  }

  /**
   * Every order row on the page. Vinted renames its classes often, so this
   * works from the links instead: the card is the nearest block holding a link
   * to an order or an item, its own photo, and a line of text.
   */
  function readOrders() {
    const anchors = [...document.querySelectorAll('a[href]')].filter((a) => ORDER_LINK.test(a.href) || ITEM_LINK.test(a.href))
    const seen = new Set()
    const out = []
    for (const a of anchors) {
      let card = a
      for (let up = 0; up < 6 && card.parentElement; up++) {
        card = card.parentElement
        if (card.querySelector('img') && text(card).length > 12) break
      }
      const photo = photoIn(card)
      const line = text(card)
      if (!line || (!photo && line.length < 15)) continue
      const orderId = (a.href.match(ORDER_LINK) ?? [])[2] ?? null
      const itemId = (a.href.match(ITEM_LINK) ?? [])[1] ?? null
      const key = orderId ? `o${orderId}` : itemId ? `i${itemId}` : `t${line.slice(0, 60)}`
      if (seen.has(key)) continue
      seen.add(key)
      const title = text(a) || line.split('·')[0]
      out.push({
        key,
        order_id: orderId,
        product_url: a.href,
        product_name: title.slice(0, 160),
        image_url: photo,
        line: line.slice(0, 300),
        ...priceIn(line),
      })
    }
    return out
  }

  chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
    if (msg?.type !== 'readVintedOrders') return false
    try {
      respond({ ok: true, url: location.href, orders: readOrders() })
    } catch (e) {
      respond({ ok: false, error: String(e?.message || e) })
    }
    return true
  })
})()
