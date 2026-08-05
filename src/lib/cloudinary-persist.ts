import crypto from 'crypto'

// Cloudinary creds (same account used elsewhere in the app)
const CLOUD_NAME = 'dugby2pow'
const API_KEY = '333725823491761'
const API_SECRET = 'xlmEKzOlLW9rLxNA6rqTQBn3dkk'

export function isCloudinaryUrl(url: string | null | undefined): boolean {
  return !!url && url.includes('res.cloudinary.com')
}

/** Fetch image bytes from a URL, trying multiple UA/referer combos — retailer
 *  CDNs often reject non-browser requests but accept one of these. */
async function fetchImageBytes(imageUrl: string): Promise<{ data: Buffer; contentType: string } | null> {
  let origin = ''
  try { origin = new URL(imageUrl).origin + '/' } catch { /* keep empty */ }
  const headerSets: Record<string, string>[] = [
    {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      ...(origin ? { Referer: origin } : {}),
    },
    { 'User-Agent': 'Googlebot-Image/1.0', Accept: 'image/*' },
    { 'User-Agent': 'curl/7.88.1', Accept: '*/*' },
  ]

  for (const headers of headerSets) {
    try {
      const controller = new AbortController()
      const t = setTimeout(() => controller.abort(), 10000)
      const res = await fetch(imageUrl, { signal: controller.signal, headers })
      clearTimeout(t)
      const contentType = res.headers.get('content-type') ?? ''
      if (res.ok && contentType.startsWith('image/')) {
        return { data: Buffer.from(await res.arrayBuffer()), contentType }
      }
    } catch { /* try next header set */ }
  }
  return null
}

/**
 * Persist a remote image into MYRA's Cloudinary account and return the stable
 * secure URL, or null if every route failed. Tries a server-side byte fetch
 * first (beats hotlink/bot protection), then falls back to letting Cloudinary
 * fetch the URL itself. Never throws.
 */
export async function persistImageToCloudinary(
  imageUrl: string,
  opts: { folder?: string; publicId?: string } = {},
): Promise<string | null> {
  if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) return null

  const folder = opts.folder ?? 'outfit-saves'
  const publicId = (opts.publicId ?? `img-${Date.now()}`).toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 100)
  const timestamp = String(Math.floor(Date.now() / 1000))
  const paramsToSign = `folder=${folder}&public_id=${publicId}&timestamp=${timestamp}`
  const signature = crypto.createHash('sha1').update(paramsToSign + API_SECRET).digest('hex')

  const form = new FormData()
  form.append('api_key', API_KEY)
  form.append('timestamp', timestamp)
  form.append('signature', signature)
  form.append('folder', folder)
  form.append('public_id', publicId)

  const bytes = await fetchImageBytes(imageUrl)
  if (bytes) {
    form.append('file', `data:${bytes.contentType};base64,${bytes.data.toString('base64')}`)
  } else {
    form.append('file', imageUrl)
  }

  try {
    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
      method: 'POST',
      body: form,
    })
    const data = await res.json()
    if (!data.secure_url) {
      console.error('[persistImageToCloudinary] upload failed:', data.error?.message ?? 'no secure_url')
      return null
    }
    return data.secure_url as string
  } catch (err) {
    console.error('[persistImageToCloudinary]', err)
    return null
  }
}
