// Fetch a product image in the shape the vision API wants.
//
// The media type is sniffed from the bytes, not taken from the response
// header: Shopify's CDN serves PNGs under .jpg URLs, and a mislabelled image
// is a hard 400 from the API — which every caller here reads as "could not
// tell", so a wrong header silently costs a real answer.

export interface VisionImage { data: string; mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' }

const MAX_BYTES = 4.5 * 1024 * 1024

function sniff(b: Uint8Array): VisionImage['mediaType'] | null {
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg'
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif'
  if (b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp'
  return null
}

/** Shopify's CDN resizes on request — a 900px copy is plenty to read a
 *  garment from and a tenth of the bytes of the 3,333px original. */
function shrink(url: string): string {
  try {
    const u = new URL(url)
    if (/(^|\.)cdn\.shopify\.com$/.test(u.hostname) && !u.searchParams.has('width')) {
      u.searchParams.set('width', '900')
      return u.toString()
    }
  } catch { /* leave it alone */ }
  return url
}

export async function fetchImageForVision(
  imageUrl: string,
): Promise<{ image?: VisionImage; error?: string }> {
  if (!imageUrl || !/^https?:\/\//.test(imageUrl)) return { error: 'no image' }
  try {
    const res = await fetch(shrink(imageUrl), { signal: AbortSignal.timeout(20000) })
    if (!res.ok) return { error: `image fetch ${res.status}` }
    const buf = new Uint8Array(await res.arrayBuffer())
    if (buf.byteLength > MAX_BYTES) return { error: 'image too large' }
    const mediaType = sniff(buf)
    if (!mediaType) return { error: 'unrecognised image format' }
    return { image: { data: Buffer.from(buf).toString('base64'), mediaType } }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'image fetch failed' }
  }
}
