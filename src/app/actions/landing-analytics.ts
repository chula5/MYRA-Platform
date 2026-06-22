'use server'

import { createAdminClient } from '@/lib/supabase-server'

export type LandingEventType =
  | 'pageview'
  | 'cta_click'
  | 'instagram_click'
  | 'tiktok_click'
  | 'waitlist_signup'

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
      .insert({ event_type: eventType, path, ref: cleanRef } as any)
    // If the ref column doesn't exist yet (migration not run), retry without it
    // so core tracking keeps working.
    if (error) {
      await admin.from('landing_event').insert({ event_type: eventType, path })
    }
  } catch {
    // Analytics should never break the page — silently swallow all errors.
  }
}
