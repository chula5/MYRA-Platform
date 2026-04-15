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
