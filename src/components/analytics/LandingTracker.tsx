'use client'

import { useEffect } from 'react'
import { recordLandingEvent, type LandingEventType } from '@/app/actions/landing-analytics'

const REF_KEY = 'myra_ref'

// Read ?ref= from the URL (first seen wins) and remember it for the session, so
// a signup later in the visit is still attributed to the referrer.
export function getRef(): string | null {
  try {
    const fromUrl = new URL(window.location.href).searchParams.get('ref')
    if (fromUrl) {
      sessionStorage.setItem(REF_KEY, fromUrl)
      return fromUrl
    }
    return sessionStorage.getItem(REF_KEY)
  } catch {
    return null
  }
}

// Drop this anywhere on the landing page — fires one pageview per mount.
// `initialRef` is the referral code resolved server-side (from a /code pretty
// link), since the browser URL stays clean and has no ?ref to read client-side.
export default function LandingTracker({ initialRef }: { initialRef?: string | null }) {
  useEffect(() => {
    // Skip the team's own browsers (any that have visited /admin).
    try { if (localStorage.getItem('myra_is_admin') === '1') return } catch { /* ignore */ }
    if (initialRef) {
      try { sessionStorage.setItem(REF_KEY, initialRef) } catch { /* ignore */ }
    }
    recordLandingEvent('pageview', '/', initialRef || getRef())
  }, [initialRef])
  return null
}

// Use this in onClick handlers to track button/link clicks.
export function trackLandingClick(eventType: LandingEventType) {
  recordLandingEvent(eventType, '/', getRef())
}

// Call on a successful waitlist signup.
export function trackLandingSignup() {
  recordLandingEvent('waitlist_signup', '/', getRef())
}
