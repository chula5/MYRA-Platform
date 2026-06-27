'use server'

import { headers } from 'next/headers'
import { createAdminClient } from '@/lib/supabase-server'

// Visitor country from the edge geo header (Vercel / Cloudflare). Null locally.
function getCountry(): string | null {
  try {
    const h = headers()
    return h.get('x-vercel-ip-country') || h.get('cf-ipcountry') || null
  } catch {
    return null
  }
}

// Start (or re-register) a browser session. Fire-and-forget; analytics must
// never break the page.
export async function startSession(
  sessionId: string,
  visitorId: string,
  isReturning: boolean,
  path: string,
) {
  try {
    if (!sessionId || !visitorId) return
    const admin = createAdminClient()
    const now = new Date().toISOString()
    await (admin.from('site_session') as any).upsert(
      {
        session_id: sessionId,
        visitor_id: visitorId,
        is_returning: isReturning,
        path: (path || '/').slice(0, 200),
        country: getCountry(),
        started_at: now,
        last_seen_at: now,
      },
      { onConflict: 'session_id' },
    )
  } catch {
    // swallow
  }
}

// Heartbeat — bump last_seen_at so session duration = last_seen - started.
export async function pingSession(sessionId: string) {
  try {
    if (!sessionId) return
    const admin = createAdminClient()
    await (admin.from('site_session') as any)
      .update({ last_seen_at: new Date().toISOString() })
      .eq('session_id', sessionId)
  } catch {
    // swallow
  }
}
