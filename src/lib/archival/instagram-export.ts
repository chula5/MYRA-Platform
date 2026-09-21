// Reading an Instagram "Download your information" export — the pure parts.
//
// Instagram closed its API to personal accounts, but every account can ask
// Instagram for its own data and gets a zip by email. Whatever she ticked when
// asking (JSON or HTML, all data or posts only), her post photos always sit
// under media/posts/<YYYYMM>/ — so that is all this looks for. Stories, reels,
// profile pictures and above all her messages are never touched, and the zip
// itself never leaves her browser: only the chosen photos are sent to MYRA.
//
// No I/O here; tested.

// HEIC is left out: browsers cannot show it and Instagram serves posts as JPEG.
const IMAGE = /\.(jpe?g|png|webp)$/i

export interface ExportPhoto {
  /** Path inside the zip. */
  path: string
  /** When she posted it — from the export's own list when there, else the folder month. */
  takenAt: string | null
  caption: string | null
}

/** Is this zip entry one of her own post photos? */
export function isPostPhoto(path: string): boolean {
  const p = path.replace(/\\/g, '/').toLowerCase()
  if (!IMAGE.test(p)) return false
  // Her feed posts. Not stories, reels covers, profile photos, or anything from messages.
  if (!/(^|\/)media\/posts\//.test(p)) return false
  if (/\/(inbox|message_requests|messages)\//.test(p)) return false
  return true
}

/** media/posts/202403/abc.jpg → 2024-03-01, when the export's own list has no date. */
export function monthFromPath(path: string): string | null {
  const m = path.replace(/\\/g, '/').match(/media\/posts\/(\d{4})(\d{2})\//i)
  if (!m) return null
  const month = Number(m[2])
  if (month < 1 || month > 12) return null
  return `${m[1]}-${m[2]}-01T12:00:00.000Z`
}

/** Instagram writes its text as Latin-1 bytes of UTF-8; put captions back together. */
export function fixMojibake(s: string): string {
  try {
    const bytes = Uint8Array.from(Array.from(s).map((ch) => ch.charCodeAt(0) & 0xff))
    const out = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return out
  } catch {
    return s
  }
}

/**
 * The export's own list of posts (posts_1.json): when each photo was posted
 * and its caption. Shapes differ between export versions, so read loosely.
 */
export function readPostsList(raw: unknown): Map<string, { takenAt: string | null; caption: string | null }> {
  const out = new Map<string, { takenAt: string | null; caption: string | null }>()
  const posts = Array.isArray(raw) ? raw : []
  for (const post of posts as any[]) {
    const postTitle = typeof post?.title === 'string' ? post.title : null
    const postTime = typeof post?.creation_timestamp === 'number' ? post.creation_timestamp : null
    for (const m of (Array.isArray(post?.media) ? post.media : []) as any[]) {
      if (typeof m?.uri !== 'string') continue
      const ts = typeof m.creation_timestamp === 'number' ? m.creation_timestamp : postTime
      const caption = (typeof m.title === 'string' && m.title ? m.title : postTitle) || null
      out.set(m.uri.replace(/\\/g, '/').toLowerCase(), {
        takenAt: ts ? new Date(ts * 1000).toISOString() : null,
        caption: caption ? fixMojibake(caption).slice(0, 600) : null,
      })
    }
  }
  return out
}

/**
 * Her post photos, newest first, capped. `paths` is every entry in the zip;
 * `listed` is what posts_1.json said about them (may be empty).
 */
export function pickPostPhotos(
  paths: string[],
  listed: Map<string, { takenAt: string | null; caption: string | null }>,
  limit: number,
): ExportPhoto[] {
  const photos = paths.filter(isPostPhoto).map((path): ExportPhoto => {
    const norm = path.replace(/\\/g, '/').toLowerCase()
    // The list names files from the export's root; the zip may nest that root in a folder.
    const key = norm.slice(norm.indexOf('media/posts/'))
    const info = listed.get(key) ?? listed.get(norm) ?? null
    return { path, takenAt: info?.takenAt ?? monthFromPath(path), caption: info?.caption ?? null }
  })
  photos.sort((a, b) => (b.takenAt ?? '').localeCompare(a.takenAt ?? '') || b.path.localeCompare(a.path))
  return photos.slice(0, Math.max(0, limit))
}

/** Is this the export's list of posts? */
export function isPostsList(path: string): boolean {
  return /(^|\/)posts_\d+\.json$/i.test(path.replace(/\\/g, '/'))
}
