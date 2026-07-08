// Client-side engagement tracking. Logs an interaction (outfit view, style-item
// click, similar/explore click) into landing_event with the outfit/item id in
// `path` and the referral code attached. Fire-and-forget — never blocks the UI.
import { recordLandingEvent, type LandingEventType } from '@/app/actions/landing-analytics'
import { getStoredRef } from '@/lib/ref'

export function trackEngagement(type: LandingEventType, id: string) {
  try {
    if (!id) return
    void recordLandingEvent(type, id, getStoredRef())
  } catch {
    /* never break browsing */
  }
}
