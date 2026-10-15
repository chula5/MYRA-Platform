import 'server-only'
import sharp from 'sharp'

// A PIECE'S PICTURE, SMALL ENOUGH TO HAND TO AN ASSISTANT.
//
// An MCP answer can carry images beside its text. Claude shows them in the
// tool result and sees them itself, so an outfit arrives as pictures, not a
// list of names. Product shots are big; each one is shrunk to a thumbnail
// before it goes, and one that will not fetch is simply left out — the text
// still names the piece and links to it.

export interface ImageBlock { type: 'image'; data: string; mimeType: 'image/jpeg' }

const SIDE = 360
const FETCH_MS = 4000
const MAX_BYTES = 6 * 1024 * 1024

async function thumbnail(url: string): Promise<ImageBlock | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal, cache: 'no-store',
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36', Accept: 'image/*,*/*;q=0.8' },
    })
    if (!res.ok) return null
    const len = Number(res.headers.get('content-length') ?? 0)
    if (len > MAX_BYTES) return null
    const bytes = Buffer.from(await res.arrayBuffer())
    if (!bytes.length || bytes.length > MAX_BYTES) return null
    const small = await sharp(bytes).rotate().resize(SIDE, SIDE, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }).jpeg({ quality: 72 }).toBuffer()
    return { type: 'image', data: small.toString('base64'), mimeType: 'image/jpeg' }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** A thumbnail per URL, in the same order; null where one would not fetch. */
export const pictureBlocks = (urls: string[]): Promise<(ImageBlock | null)[]> => Promise.all(urls.map(thumbnail))
