'use client'

// THE APP'S FIRST OPEN.
//
// The iPhone app opens on For You. The server sends a login that has never
// been welcomed to /me/welcome — but a login made on the web, welcomed there,
// still has an app to be shown round: the Safari extension is set up from
// Settings, not from a web store, and that is said once, in the app. The
// server cannot tell the app's WKWebView from Safari, so the app says so
// itself here and goes to the welcome once. The welcome notes the visit on
// her login (markWelcomed({ app: true })) and in this app's storage.

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export const APP_WELCOMED_KEY = 'myra:app-welcomed'

/** True inside the MYRA iPhone app (the Capacitor shell), where the page is not in Safari. */
export function inNativeApp(): boolean {
  if (typeof window === 'undefined') return false
  try { return !!(window as any).Capacitor?.isNativePlatform?.() } catch { return false }
}

export default function AppFirstOpen({ welcomed }: { welcomed: boolean }) {
  const router = useRouter()
  useEffect(() => {
    if (welcomed || !inNativeApp()) return
    try { if (localStorage.getItem(APP_WELCOMED_KEY)) return } catch { /* private window */ }
    router.replace('/me/welcome?app=1')
  }, [welcomed, router])
  return null
}
