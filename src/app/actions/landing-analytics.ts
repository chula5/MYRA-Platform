'use server'

import { createAdminClient } from '@/lib/supabase-server'

export type LandingEventType = 'pageview' | 'cta_click' | 'instagram_click' | 'tiktok_click'

export async function recordLandingEvent(
  eventType: LandingEventType,
  path: string = '/',
) {
  try {
    const admin = createAdminClient()
    await admin.from('landing_event').insert({ event_type: eventType, path })
  } catch {
    // Analytics should never break the page — silently swallow all errors.
  }
}
