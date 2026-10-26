// Is this email image a photo of the piece? Order emails carry spacer GIFs,
// return-label QR codes, barcodes and links that expire (Vinted signs its
// thumbnails; H&M refuses outside fetches). A find only keeps a photo that
// loads now, is bigger than an icon, has something in it, and is not a code.
// Free: one fetch and a 96px look with sharp, no AI.

export type PhotoCheck =
  | { ok: true; bytes: Buffer; contentType: string }
  | { ok: false; reason: string }

const HEADERS: Record<string, string>[] = [
  {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
  },
  { 'User-Agent': 'curl/7.88.1', Accept: '*/*' },
]

/** Names that say what the picture is before it is opened. */
const NOT_A_PIECE = /(qr[-_]?code|\bqr\b|barcode|return[-_]?label|spacer|pixel|blank\.gif|transparent\.gif)/i

async function download(url: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  for (const headers of HEADERS) {
    try {
      const controller = new AbortController()
      const t = setTimeout(() => controller.abort(), 10_000)
      const res = await fetch(url, { signal: controller.signal, headers })
      clearTimeout(t)
      const contentType = res.headers.get('content-type') ?? ''
      if (res.ok && contentType.startsWith('image/')) return { bytes: Buffer.from(await res.arrayBuffer()), contentType }
    } catch { /* next header set */ }
  }
  return null
}

/**
 * What the pixels say. A QR code or barcode is two hard colours that flip
 * back and forth across the whole picture; a garment — even a striped one —
 * is shaded and soft-edged, and flips one way at most.
 */
export function looksLikeCode(grey: Uint8Array | Buffer, colour: Uint8Array | Buffer, n: number): boolean {
  let mean = 0
  for (let i = 0; i < grey.length; i++) mean += grey[i]
  mean /= grey.length
  let across = 0
  let down = 0
  let spread = 0
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = grey[y * n + x]
      spread += (v - mean) ** 2
      if (x > 0 && (grey[y * n + x - 1] > mean) !== (v > mean)) across++
      if (y > 0 && (grey[(y - 1) * n + x] > mean) !== (v > mean)) down++
    }
  }
  const contrast = Math.sqrt(spread / grey.length)
  // Share of pixels in the two commonest colours (4 bits a channel).
  const counts = new Map<number, number>()
  for (let i = 0; i < colour.length; i += 3) {
    const k = ((colour[i] >> 4) << 8) | ((colour[i + 1] >> 4) << 4) | (colour[i + 2] >> 4)
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const top = Array.from(counts.values()).sort((a, b) => b - a)
  const twoTone = ((top[0] ?? 0) + (top[1] ?? 0)) / (colour.length / 3)
  // A QR code flips both ways in hard contrast and is mostly its two colours;
  // a barcode flips one way and is almost nothing else. Busy prints flip as
  // much but spread over hundreds of shades, so they pass.
  const qr = across / n > 6 && down / n > 6 && contrast > 45 && twoTone > 0.45
  const barcode = (across / n > 8 || down / n > 8) && twoTone > 0.85 && contrast > 60
  return qr || barcode
}

export async function checkPiecePhoto(url: string | null | undefined, alt?: string | null): Promise<PhotoCheck> {
  if (!url || !/^https?:\/\//i.test(url)) return { ok: false, reason: 'no photo' }
  if (NOT_A_PIECE.test(url) || NOT_A_PIECE.test(alt ?? '')) return { ok: false, reason: 'not a photo of the piece' }
  const got = await download(url)
  if (!got) return { ok: false, reason: 'photo does not load' }
  try {
    const sharp = (await import('sharp')).default
    const meta = await sharp(got.bytes).metadata()
    if (!meta.width || !meta.height || meta.width < 80 || meta.height < 80) return { ok: false, reason: 'too small to be a photo' }
    const n = 96
    const base = sharp(got.bytes).flatten({ background: '#ffffff' }).resize(n, n, { fit: 'fill' })
    const grey = await base.clone().greyscale().raw().toBuffer()
    const colour = await base.clone().removeAlpha().raw().toBuffer()
    let mean = 0
    for (let i = 0; i < grey.length; i++) mean += grey[i]
    mean /= grey.length
    let spread = 0
    for (let i = 0; i < grey.length; i++) spread += (grey[i] - mean) ** 2
    // A white tee on white is still ~3; a blank or one-colour image is under 1.5.
    if (Math.sqrt(spread / grey.length) < 1.5) return { ok: false, reason: 'blank image' }
    if (looksLikeCode(grey, colour, n)) return { ok: false, reason: 'a code, not the piece' }
    return { ok: true, ...got }
  } catch {
    return { ok: false, reason: 'not an image' }
  }
}
