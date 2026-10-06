'use client'

// SHARE TO MYRA, FROM THE APP.
//
// Mounted once in the /me layout. Inside the iPhone app (and only there), it
// mints her Mirror token and hands it to the native side, where the share
// sheet reads it. So: sign in to the app once, then hold on any piece in
// Safari, share, choose MYRA — kept. No Safari extension needed.
//
// Runs on every app open, so the 30-day token is quietly refreshed long
// before it lapses. In a browser this renders nothing and does nothing.

import { useEffect } from 'react'
import { Capacitor, registerPlugin } from '@capacitor/core'
import { mintMirrorTokenForApp } from '@/app/me/native-actions'

interface MirrorBridgePlugin {
  setToken(o: { token: string; apiBase: string }): Promise<{ ok: boolean }>
  clearToken(): Promise<{ ok: boolean }>
  hasToken(): Promise<{ connected: boolean }>
}

// Implemented in ios/App/App/MirrorBridgePlugin.swift and registered by
// MyraViewController. @capacitor/core finds it through the headers the app
// injects into the page; in a browser the proxy exists but is never called.
const MirrorBridge = registerPlugin<MirrorBridgePlugin>('MirrorBridge')

/** The native plugin, or null in a browser / an app build without it. */
function nativeBridge(): MirrorBridgePlugin | null {
  if (typeof window === 'undefined') return null
  try {
    if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('MirrorBridge')) return null
    return MirrorBridge
  } catch { return null }
}

const DONE_KEY = 'myra_native_share_at'

/** Forget the share sheet's sign-in. Called before signing out of the app. */
export async function clearNativeShareToken(): Promise<void> {
  const bridge = nativeBridge()
  if (!bridge) return
  try { await bridge.clearToken() } catch { /* the token lapses on its own in 30 days */ }
  try { sessionStorage.removeItem(DONE_KEY) } catch { /* private window */ }
}

export default function NativeShareBridge() {
  useEffect(() => {
    const bridge = nativeBridge()
    if (!bridge) return
    // Once per app session is plenty; the layout remounts on every cold open.
    try { if (sessionStorage.getItem(DONE_KEY)) return } catch { /* private window */ }
    let live = true
    ;(async () => {
      const r = await mintMirrorTokenForApp().catch(() => null)
      if (!live || !r || 'error' in r) return
      try {
        await bridge.setToken({ token: r.token, apiBase: window.location.origin })
        try { sessionStorage.setItem(DONE_KEY, String(Date.now())) } catch { /* private window */ }
      } catch (err) {
        // An app build older than the plugin: the Safari extension route still works.
        console.warn('[native-share] could not hand the token to the app', err)
      }
    })()
    return () => { live = false }
  }, [])
  return null
}
