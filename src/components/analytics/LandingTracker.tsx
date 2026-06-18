'use client'

import { useEffect } from 'react'
import { recordLandingEvent, type LandingEventType } from '@/app/actions/landing-analytics'

// Drop this anywhere on the landing page — fires one pageview per mount.
export default function LandingTracker() {
  useEffect(() => {
    recordLandingEvent('pageview', '/')
  }, [])
  return null
}

// Use this in onClick handlers to track button/link clicks.
export function trackLandingClick(eventType: LandingEventType) {
  recordLandingEvent(eventType, '/')
}
