// Server-side read of the anonymous visitor id.
//
// SessionTracker writes `myra_vid` to both localStorage (for its own session
// bookkeeping) and a cookie. The cookie is the only one the server can see, and
// the server is where every outbound click is logged — the /go redirect runs no
// client JS at all.
//
// The id is opaque and random: it identifies a browser, not a person, and
// carries nothing personal. Admin browsers never get one (SessionTracker bails
// before setting it), so the team's own clicks stay out of the numbers.

import { cookies } from 'next/headers'

const VISITOR_COOKIE = 'myra_vid'

export async function getVisitorId(): Promise<string | null> {
  try {
    const store = await cookies()
    const v = store.get(VISITOR_COOKIE)?.value
    return v && v.length <= 100 ? v : null
  } catch {
    // Outside a request scope (cron, background job) — no visitor to speak of.
    return null
  }
}
