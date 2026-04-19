'use server'

import crypto from 'crypto'

const CLOUD_NAME = 'dugby2pow'
const API_KEY = '333725823491761'
const API_SECRET = 'xlmEKzOlLW9rLxNA6rqTQBn3dkk'

function makePublicId(productUrl: string): string {
  try {
    const url = new URL(productUrl)
    const parts = url.pathname.split('/').filter(Boolean)
    // Use last 2-3 path segments for a descriptive ID
    const slug = parts.slice(-3).join('-').toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 60)
    return slug || `product-${Date.now()}`
  } catch {
    return `product-${Date.now()}`
  }
}

// ── Known-retailer CDN shortcuts (for bot-protected / JS-only sites) ──────────
async function tryKnownRetailerCdn(productUrl: string): Promise<string | null> {
  try {
    const u = new URL(productUrl)
    const hostname = u.hostname.replace('www.', '')
    const path = u.pathname

    // Mytheresa — product ID is last path segment ending in -pXXXXXXXX
    if (hostname.includes('mytheresa.com')) {
      const m = path.match(/-p(\d{7,9})\/?$/)
      if (m) {
        // Try front (packshot) first, fall back to first model shot
        for (const name of ['front', 'a', '1']) {
          const cdnUrl = `https://assets.mytheresa.com/product-images/p${m[1]}/${name}.jpg`
          const res = await fetch(cdnUrl, { method: 'HEAD' })
          if (res.ok) return cdnUrl
        }
      }
    }

    // Net-a-Porter — images at cdn-images.farfetch-contents.com or similar
    if (hostname.includes('net-a-porter.com')) {
      // NAP product IDs in URL like /product/1234567
      const m = path.match(/\/(\d{7,9})\/?$/)
      if (m) {
        const cdnUrl = `https://www.net-a-porter.com/variants/images/${m[1]}/in/w920_a3-4_q60.jpg`
        const res = await fetch(cdnUrl, { method: 'HEAD' })
        if (res.ok) return cdnUrl
      }
    }

    // Farfetch — try og:image via their server-side rendered version
    if (hostname.includes('farfetch.com')) {
      const m = path.match(/item-(\d+)\.aspx/i)
      if (m) {
        const cdnUrl = `https://cdn-images.farfetch-contents.com/${m[1]}_1_front_476.jpg`
        const res = await fetch(cdnUrl, { method: 'HEAD' })
        if (res.ok) return cdnUrl
      }
    }

    return null
  } catch {
    return null
  }
}

async function scrapeProductImage(productUrl: string): Promise<string | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12000)

  try {
    const res = await fetch(productUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-GB,en;q=0.9',
        'Cache-Control': 'no-cache',
      },
    })
    clearTimeout(timeout)
    if (!res.ok) return null

    const html = await res.text()
    const imageExtensions = /\.(jpg|jpeg|png|webp|avif)(\?[^"'`\s]*)?/i
    const candidates: string[] = []

    // ── 1. Collect from meta tags (og:image, twitter:image) — don't return early, score like everything else
    const metaPatterns = [
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
      /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
    ]
    for (const p of metaPatterns) {
      const m = html.match(p)
      if (m?.[1]?.startsWith('http')) candidates.push(m[1])
    }

    // ── 2. JSON-LD image fields
    const ldImgArr = html.match(/"image"\s*:\s*\["?(https?:[^"\]]+)"?\]/i)
    if (ldImgArr?.[1]) candidates.push(ldImgArr[1])
    const ldImg = html.match(/"image"\s*:\s*"(https?:[^"]+)"/i)
    if (ldImg?.[1]) candidates.push(ldImg[1])

    // ── 3. Script tags (Next.js __NEXT_DATA__, embedded JSON, etc.)
    for (const sm of Array.from(html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi))) {
      const content = sm[1]
      if (!content || content.length < 20) continue
      for (const m of Array.from(content.matchAll(/["'`](https?:\/\/[^"'`\s]{10,}\.(?:jpg|jpeg|png|webp|avif)[^"'`\s]*?)["'`]/gi))) {
        candidates.push(m[1])
      }
    }

    // ── 4. img tag src / data-src / srcset
    for (const tag of Array.from(html.matchAll(/<img[^>]+>/gi))) {
      const dataSrc = tag[0].match(/data-src=["']([^"']+)["']/i)
      if (dataSrc?.[1]?.startsWith('http') && imageExtensions.test(dataSrc[1])) candidates.push(dataSrc[1])

      const srcset = tag[0].match(/srcset=["']([^"']+)["']/i)
      if (srcset?.[1]) {
        const firstSrc = srcset[1].trim().split(/\s*,\s*/)[0]?.split(/\s+/)[0]
        if (firstSrc?.startsWith('http') && imageExtensions.test(firstSrc)) candidates.push(firstSrc)
      }

      const src = tag[0].match(/\bsrc=["']([^"']+)["']/i)
      if (src?.[1]?.startsWith('http') && imageExtensions.test(src[1])) candidates.push(src[1])
    }

    if (candidates.length === 0) return null

    // ── Deduplicate (strip query strings for comparison, keep full URL)
    const seen = new Set<string>()
    const unique = candidates.filter(url => {
      const key = url.split('?')[0]
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    // ── Score: strongly prefer flat/packshot images over model photos ──
    const score = (url: string) => {
      const u = url.toLowerCase()
      let s = 0

      // ── Strong boost: dedicated packshot folder/path ──
      if (/\/packshot\//i.test(url)) s += 50
      // _P suffix = packshot convention (Sandro, many French brands)
      if (/[_-]p\.(jpg|jpeg|png|webp|avif)/i.test(url)) s += 45
      // plain/ghost/flat product shot keywords in the path
      if (/\/(?:flat|ghost|still|plain|white)[_-]?(?:bg|lay|background)?[/_]/i.test(url)) s += 40

      // _1 or -1 = usually the hero product shot (before model alternates)
      if (/[_-]1\.(jpg|jpeg|png|webp|avif)/i.test(url)) s += 20
      // _A suffix
      if (/[_-]a\.(jpg|jpeg|png|webp|avif)/i.test(url)) s += 15

      // large resolution signals
      if (/2000|1200|hi[_-]?res|large|zoom|full|original/i.test(url)) s += 8
      if (/pdp|product/i.test(url)) s += 5

      // ── Strong penalty: model / editorial shots ──
      if (/model|worn|lifestyle|editorial|lookbook|campaign|runway|styled|outfit/i.test(u)) s -= 50
      // _2, _3 ... _9 in filename = almost always model alternates
      if (/[_-][2-9]\.(jpg|jpeg|png|webp|avif)/i.test(url)) s -= 20
      // _H_ = hover/on-body on many French retailers (Sandro, Maje, etc.)
      if (/[_-]h[_-]/i.test(url)) s -= 35
      // _V = video thumbnail / on-body
      if (/[_-]v\.(jpg|jpeg|png|webp|avif)/i.test(url)) s -= 30
      // _B, _C etc. in Sandro-style naming = model shots
      if (/[_-][b-z]\.(jpg|jpeg|png|webp|avif)/i.test(url) && !/[_-]p\./i.test(url)) s -= 20

      // ── Penalty: small thumbnails ──
      // Query string with small dimensions
      if (/[?&]s[hw]=(?:[1-9][0-9]|[1-9])\b/i.test(url)) s -= 25  // sw=50 / sh=65 etc.
      if (/thumb|small|tiny|icon|logo|cart|swatch|badge/i.test(u)) s -= 30

      // ── Mild boost: same domain, good format ──
      try { if (new URL(url).hostname === new URL(productUrl).hostname) s += 5 } catch {}
      if (/\.(jpg|jpeg|webp)/i.test(url)) s += 3

      return s
    }

    unique.sort((a, b) => score(b) - score(a))
    return unique[0] ?? null

  } catch {
    clearTimeout(timeout)
    return null
  }
}

/** Fetch image bytes from a URL, trying multiple referer/header combos */
async function fetchImageBytes(imageUrl: string): Promise<{ data: Buffer; contentType: string } | null> {
  const headerSets = [
    // Standard browser
    {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      'Referer': new URL(imageUrl).origin + '/',
    },
    // Googlebot (some CDNs whitelist crawlers)
    {
      'User-Agent': 'Googlebot-Image/1.0',
      'Accept': 'image/*',
    },
    // Minimal headers
    {
      'User-Agent': 'curl/7.88.1',
      'Accept': '*/*',
    },
  ]

  for (const headers of headerSets) {
    try {
      const controller = new AbortController()
      const t = setTimeout(() => controller.abort(), 10000)
      const res = await fetch(imageUrl, { signal: controller.signal, headers })
      clearTimeout(t)
      const contentType = res.headers.get('content-type') ?? ''
      if (res.ok && contentType.startsWith('image/')) {
        const buf = Buffer.from(await res.arrayBuffer())
        return { data: buf, contentType }
      }
    } catch { /* try next */ }
  }
  return null
}

/** Upload a base64 data URI directly to Cloudinary — used when the browser fetches the image */
export async function uploadBase64ToCloudinary(
  base64DataUri: string,
  sourceUrl: string
): Promise<{ cloudinaryUrl?: string; error?: string }> {
  const timestamp = String(Math.floor(Date.now() / 1000))
  const folder = 'outfit-saves'
  const publicId = makePublicId(sourceUrl)
  const paramsToSign = `folder=${folder}&public_id=${publicId}&timestamp=${timestamp}`
  const signature = crypto.createHash('sha1').update(paramsToSign + API_SECRET).digest('hex')

  const formPayload = new FormData()
  formPayload.append('file', base64DataUri)
  formPayload.append('api_key', API_KEY)
  formPayload.append('timestamp', timestamp)
  formPayload.append('signature', signature)
  formPayload.append('folder', folder)
  formPayload.append('public_id', publicId)

  try {
    const cloudRes = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`,
      { method: 'POST', body: formPayload }
    )
    const data = await cloudRes.json()
    if (!data.secure_url) return { error: data.error?.message ?? 'Cloudinary upload failed' }
    return { cloudinaryUrl: data.secure_url }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Upload failed' }
  }
}

export async function scrapeAndUploadToCloudinary(
  productUrl: string
): Promise<{ cloudinaryUrl?: string; error?: string }> {
  if (!productUrl) return { error: 'No URL provided' }

  // 1. Find the image URL (known CDN shortcut → scraping fallback)
  const imageUrl = (await tryKnownRetailerCdn(productUrl)) ?? (await scrapeProductImage(productUrl))
  if (!imageUrl) {
    return { error: 'Could not find a product image on this page. Try right-clicking the image in your browser → Copy Image Address, then paste it into the Image URL field.' }
  }

  // 2. Sign the upload
  const timestamp = String(Math.floor(Date.now() / 1000))
  const folder = 'outfit-saves'
  const publicId = makePublicId(productUrl)
  const paramsToSign = `folder=${folder}&public_id=${publicId}&timestamp=${timestamp}`
  const signature = crypto.createHash('sha1').update(paramsToSign + API_SECRET).digest('hex')

  const formPayload = new FormData()
  formPayload.append('api_key', API_KEY)
  formPayload.append('timestamp', timestamp)
  formPayload.append('signature', signature)
  formPayload.append('folder', folder)
  formPayload.append('public_id', publicId)

  // 3a. Try fetching image bytes server-side first — avoids Cloudinary being blocked by CDN
  const imageBytes = await fetchImageBytes(imageUrl)
  if (imageBytes) {
    const base64 = `data:${imageBytes.contentType};base64,${imageBytes.data.toString('base64')}`
    formPayload.append('file', base64)
  } else {
    // 3b. Fall back: let Cloudinary fetch the URL directly (works for open CDNs)
    formPayload.append('file', imageUrl)
  }

  try {
    const cloudRes = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`,
      { method: 'POST', body: formPayload }
    )
    const data = await cloudRes.json()
    if (!data.secure_url) {
      return { error: data.error?.message ?? 'Cloudinary upload failed' }
    }
    return { cloudinaryUrl: data.secure_url }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Upload failed' }
  }
}
