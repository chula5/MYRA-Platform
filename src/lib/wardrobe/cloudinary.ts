// Cloudinary hosting for wardrobe assets (garment crops + cutouts).
//
// Set CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET (plus the existing
// NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME) to upload into the `wardrobe/<owner>`
// folder and to be able to delete assets when a client deletes a photo.
// Without them we fall back to the item library's existing upload helper,
// which stores into its own folder and cannot delete — still fully functional
// for the import itself.
import crypto from 'crypto'
import { uploadBase64ToCloudinary } from '@/app/admin/items/cloudinary-upload'

const CLOUD_NAME = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME || 'dugby2pow'
const API_KEY = process.env.CLOUDINARY_API_KEY || ''
const API_SECRET = process.env.CLOUDINARY_API_SECRET || ''

export function cloudinaryWardrobeCredentials(): boolean {
  return Boolean(API_KEY && API_SECRET)
}

function sign(params: Record<string, string>): string {
  const toSign = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&')
  return crypto.createHash('sha1').update(toSign + API_SECRET).digest('hex')
}

export async function uploadBufferToCloudinary(
  bytes: Buffer,
  opts: { folder: string; publicId: string; contentType?: string },
): Promise<{ url?: string; publicId?: string; error?: string }> {
  const contentType = opts.contentType ?? 'image/png'
  if (!cloudinaryWardrobeCredentials()) {
    // Fallback: the library's helper. It derives the public id from the last
    // path segments of a "source url", so hand it a synthetic one.
    const dataUri = `data:${contentType};base64,${bytes.toString('base64')}`
    const r = await uploadBase64ToCloudinary(dataUri, `https://wardrobe.myra.local/${opts.folder}/${opts.publicId}`)
    if (r.error || !r.cloudinaryUrl) return { error: r.error ?? 'Cloudinary upload failed' }
    return { url: r.cloudinaryUrl, publicId: cloudinaryPublicId(r.cloudinaryUrl) ?? undefined }
  }
  try {
    const timestamp = String(Math.floor(Date.now() / 1000))
    const params = { folder: opts.folder, public_id: opts.publicId, timestamp }
    const form = new FormData()
    form.append('api_key', API_KEY)
    form.append('timestamp', timestamp)
    form.append('signature', sign(params))
    form.append('folder', opts.folder)
    form.append('public_id', opts.publicId)
    form.append('file', new Blob([new Uint8Array(bytes)], { type: contentType }), `${opts.publicId}.png`)
    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, { method: 'POST', body: form })
    const data: any = await res.json().catch(() => ({}))
    if (!data.secure_url) return { error: data.error?.message ?? `Cloudinary upload failed (${res.status})` }
    return { url: data.secure_url as string, publicId: data.public_id as string }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Cloudinary upload failed' }
  }
}

/** Best-effort delete; used when a client deletes a source photo. No-op without credentials. */
export async function destroyCloudinaryAsset(publicId: string | null | undefined): Promise<void> {
  if (!publicId || !cloudinaryWardrobeCredentials()) return
  try {
    const timestamp = String(Math.floor(Date.now() / 1000))
    const params = { public_id: publicId, timestamp }
    const form = new FormData()
    form.append('api_key', API_KEY)
    form.append('timestamp', timestamp)
    form.append('signature', sign(params))
    form.append('public_id', publicId)
    await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/destroy`, { method: 'POST', body: form })
  } catch { /* best-effort */ }
}

/** Cloudinary public_id from a delivery URL, or null when it isn't ours. */
export function cloudinaryPublicId(url: string | null | undefined): string | null {
  if (!url || !url.includes('res.cloudinary.com')) return null
  const m = url.match(/\/upload\/(?:[^/]+\/)*?(?:v\d+\/)?(.+?)\.[a-z0-9]+$/i)
  return m ? m[1] : null
}
