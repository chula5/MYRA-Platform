// Instagram, for ARCHIVAL LOOKS — "Instagram API with Instagram Login".
//
// Instagram closed its API for personal accounts in December 2024; this one
// reads a PROFESSIONAL (Creator or Business) account's own media, with her
// consent, through Instagram's own sign-in. Free to switch to in the app.
// Env: INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET, INSTAGRAM_REDIRECT_URI
// (…/api/instagram/callback). Until Meta reviews the app it works for people
// added as testers on it — same stage Gmail started at.

const GRAPH = 'https://graph.instagram.com'

export function instagramConfigured(): boolean {
  return !!(process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET && process.env.INSTAGRAM_REDIRECT_URI)
}

export function instagramAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.INSTAGRAM_APP_ID ?? '',
    redirect_uri: process.env.INSTAGRAM_REDIRECT_URI ?? '',
    response_type: 'code',
    scope: 'instagram_business_basic',
    state,
  })
  return `https://www.instagram.com/oauth/authorize?${params.toString()}`
}

export interface InstagramGrant { token: string; expiresAt: string | null; userId: string; username: string | null }

/** Code → short-lived token → long-lived (60 day) token, plus who she is. */
export async function exchangeInstagramCode(code: string): Promise<InstagramGrant> {
  const form = new URLSearchParams({
    client_id: process.env.INSTAGRAM_APP_ID ?? '',
    client_secret: process.env.INSTAGRAM_APP_SECRET ?? '',
    grant_type: 'authorization_code',
    redirect_uri: process.env.INSTAGRAM_REDIRECT_URI ?? '',
    code: code.replace(/#_$/, ''),
  })
  const shortRes = await fetch('https://api.instagram.com/oauth/access_token', { method: 'POST', body: form })
  const short: any = await shortRes.json().catch(() => ({}))
  const shortToken: string | undefined = short.access_token ?? short.data?.[0]?.access_token
  const userId = String(short.user_id ?? short.data?.[0]?.user_id ?? '')
  if (!shortRes.ok || !shortToken) throw new Error(short.error_message ?? short.error?.message ?? 'Instagram did not accept the sign-in')

  const longRes = await fetch(`${GRAPH}/access_token?${new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: process.env.INSTAGRAM_APP_SECRET ?? '', access_token: shortToken })}`)
  const long: any = await longRes.json().catch(() => ({}))
  const token: string = long.access_token ?? shortToken
  const expiresAt = long.expires_in ? new Date(Date.now() + Number(long.expires_in) * 1000).toISOString() : null

  let username: string | null = null
  try {
    const me: any = await (await fetch(`${GRAPH}/me?${new URLSearchParams({ fields: 'user_id,username', access_token: token })}`)).json()
    username = me.username ?? null
  } catch { /* the name is a nicety */ }
  return { token, expiresAt, userId, username }
}

/** Long-lived tokens last 60 days and can be refreshed once they are a day old. */
export async function refreshInstagramToken(token: string): Promise<{ token: string; expiresAt: string | null } | null> {
  try {
    const r: any = await (await fetch(`${GRAPH}/refresh_access_token?${new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: token })}`)).json()
    if (!r.access_token) return null
    return { token: r.access_token, expiresAt: r.expires_in ? new Date(Date.now() + Number(r.expires_in) * 1000).toISOString() : null }
  } catch { return null }
}

export interface InstagramImage { id: string; url: string; permalink: string | null; caption: string | null; takenAt: string | null }

/** Her photos, newest first. Videos are skipped; a carousel gives each of its images. */
export async function listInstagramImages(token: string, max = 60): Promise<InstagramImage[]> {
  const out: InstagramImage[] = []
  let url: string | null = `${GRAPH}/me/media?${new URLSearchParams({
    fields: 'id,caption,media_type,media_url,permalink,timestamp,children{id,media_type,media_url}',
    limit: '30',
    access_token: token,
  })}`
  while (url && out.length < max) {
    const res = await fetch(url)
    const page: any = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(page.error?.message ?? `Instagram returned ${res.status}`)
    for (const m of page.data ?? []) {
      const base = { permalink: m.permalink ?? null, caption: m.caption ?? null, takenAt: m.timestamp ?? null }
      if (m.media_type === 'IMAGE' && m.media_url) out.push({ id: String(m.id), url: m.media_url, ...base })
      else if (m.media_type === 'CAROUSEL_ALBUM') {
        for (const c of m.children?.data ?? []) if (c.media_type === 'IMAGE' && c.media_url) out.push({ id: String(c.id), url: c.media_url, ...base })
      }
      if (out.length >= max) break
    }
    url = page.paging?.next ?? null
  }
  return out.slice(0, max)
}
