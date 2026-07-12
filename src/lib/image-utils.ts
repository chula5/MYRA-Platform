// Widths the Next image optimizer accepts (deviceSizes ∪ imageSizes defaults).
const NEXT_IMAGE_WIDTHS = [16, 32, 48, 64, 96, 128, 256, 384, 640, 750, 828, 1080, 1200, 1920]
function snapWidth(w: number): number {
  return NEXT_IMAGE_WIDTHS.find((s) => s >= w) ?? 1920
}

/**
 * Lightweight thumbnail transform: modern format, auto quality, downscale-only
 * to `width` (preserves aspect, no crop). Massively cuts payload for grids.
 *
 * - Cloudinary URLs → inject an f_auto,q_auto,w,c_limit transform after /upload/.
 * - ANY other remote http(s) image (e.g. Higgsfield's CloudFront CDN, where the
 *   originals are ~20MB PNGs) → route it through Next's own image optimizer
 *   (/_next/image), which resizes to the displayed size and serves WebP/AVIF,
 *   cached after the first hit. This is what makes the 85% of outfits hosted
 *   off-Cloudinary load fast too. Works through every existing call site.
 */
export function thumbUrl(url: string, width = 600): string {
  if (!url) return url
  try {
    if (url.includes('res.cloudinary.com')) {
      const i = url.indexOf('/upload/')
      if (i === -1) return url
      const after = url.slice(i + 8)
      if (/(^|\/)(f_auto|q_auto|w_\d)/.test(after.split('/')[0])) return url // already transformed
      return `${url.slice(0, i + 8)}f_auto,q_auto,w_${width},c_limit/${after}`
    }
    if (/^https?:\/\//i.test(url)) {
      return `/_next/image?url=${encodeURIComponent(url)}&w=${snapWidth(width)}&q=72`
    }
    return url
  } catch {
    return url
  }
}

/**
 * Transforms a Cloudinary image URL to use AI subject-aware cropping.
 * Uses Cloudinary's `g_auto:subject` gravity which detects the main subject
 * (e.g. a bag, shoe, garment) and crops tightly around it.
 *
 * For non-Cloudinary URLs, returns the original URL unchanged.
 */
export function smartCropUrl(
  url: string,
  width: number,
  height: number
): string {
  if (!url) return url

  try {
    const u = new URL(url)
    if (!u.hostname.includes('cloudinary.com')) return url

    // Cloudinary URL format:
    // https://res.cloudinary.com/{cloud_name}/image/upload/{transformations}/{version}/{public_id}
    // We inject our transformation after /upload/
    const uploadIndex = url.indexOf('/upload/')
    if (uploadIndex === -1) return url

    const before = url.slice(0, uploadIndex + 8) // includes "/upload/"
    const after = url.slice(uploadIndex + 8)

    // Strip any existing transformation segment (starts with letters like c_,w_,h_,g_,f_,q_)
    // A transformation segment contains commas and underscores, then a slash before the version/id
    const transformPattern = /^([a-z_,/]+\/)+/
    const withoutExisting = after.replace(transformPattern, (match) => {
      // Only strip if it looks like transformations (not a version like v1234567)
      if (/^v\d+/.test(match.replace(/^.*\//, ''))) return match
      return ''
    })

    const transformation = `c_fill,g_auto:subject,w_${width},h_${height},q_auto,f_auto/`

    return `${before}${transformation}${withoutExisting}`
  } catch {
    return url
  }
}
