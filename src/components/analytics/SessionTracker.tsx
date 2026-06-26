'use client'

import { useEffect } from 'react'
import { startSession, pingSession } from '@/app/actions/session-analytics'

const VISITOR_KEY = 'myra_vid'
const SESSION_KEY = 'myra_sid'
const SEEN_KEY = 'myra_seen_before'
const PING_MS = 20_000

function uuid(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  } catch { /* ignore */ }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

// Tracks browser sessions for retention analytics (time on site + repeat
// session rate). Skips /admin so the team's own browsing doesn't skew it.
export default function SessionTracker() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.location.pathname.startsWith('/admin')) return

    let visitorId = ''
    let sessionId = ''
    try {
      visitorId = localStorage.getItem(VISITOR_KEY) || uuid()
      localStorage.setItem(VISITOR_KEY, visitorId)
      sessionId = sessionStorage.getItem(SESSION_KEY) || ''
    } catch { /* storage blocked → skip tracking */ return }

    if (!sessionId) {
      sessionId = uuid()
      let isReturning = false
      try {
        isReturning = localStorage.getItem(SEEN_KEY) === '1'
        localStorage.setItem(SEEN_KEY, '1')
        sessionStorage.setItem(SESSION_KEY, sessionId)
      } catch { /* ignore */ }
      void startSession(sessionId, visitorId, isReturning, window.location.pathname)
    }

    const interval = setInterval(() => void pingSession(sessionId), PING_MS)
    const onHide = () => { if (document.visibilityState === 'hidden') void pingSession(sessionId) }
    document.addEventListener('visibilitychange', onHide)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [])

  return null
}
