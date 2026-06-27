'use server'

import { headers } from 'next/headers'
import { createAdminClient } from '@/lib/supabase-server'

export type LandingEventType =
  | 'pageview'
  | 'cta_click'
  | 'instagram_click'
  | 'tiktok_click'
  | 'waitlist_signup'
  | 'account_signup'

function getCountry(): string | null {
  try {
    const h = headers()
    return h.get('x-vercel-ip-country') || h.get('cf-ipcountry') || null
  } catch {
    return null
  }
}

export async function recordLandingEvent(
  eventType: LandingEventType,
  path: string = '/',
  ref?: string | null,
) {
  try {
    const admin = createAdminClient()
    const cleanRef = ref ? ref.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40) || null : null
    const { error } = await admin
      .from('landing_event')
      .insert({ event_type: eventType, path, ref: cleanRef, country: getCountry() } as any)
    // If the ref/country columns don't exist yet (migration not run), retry
    // without them so core tracking keeps working.
    if (error) {
      await admin.from('landing_event').insert({ event_type: eventType, path } as any)
    }
  } catch {
    // Analytics should never break the page — silently swallow all errors.
  }
}

// Log a free-text search query (occasion or brand, e.g. "summer wedding",
// "jacquemus dress") so admins can see what people are searching for. Reuses
// landing_event with event_type 'search'; the query lives in `path`.
export async function recordSearchQuery(query: string) {
  try {
    const q = query.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 120)
    if (!q) return
    const admin = createAdminClient()
    await admin.from('landing_event').insert({ event_type: 'search', path: q } as any)
  } catch {
    // never break browsing
  }
}
