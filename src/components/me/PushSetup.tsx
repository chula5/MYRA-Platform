'use client'

// NOTIFICATIONS, IN THE APP.
//
// Mounted once in the /me layout. Inside the iPhone app (and only there):
//  · once she has said yes, the phone's token is handed to the server on each
//    app open (registerPushDevice), so a new token is never missed;
//  · a tap on a notification opens the page it is about (the push carries a
//    /me path);
//  · if iOS has not asked yet, MYRA asks first in its own words — iOS lets an
//    app ask only once, so the system prompt comes only after her YES here.
//    Never during the welcome or the tour; NOT NOW waits a fortnight.
// In a browser this renders nothing and does nothing.

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { registerPushDevice } from '@/app/me/native-actions'

const ASKED_KEY = 'myra:push-asked-at'
const TOUR_KEY = 'myra:tour'
const ASK_AGAIN_MS = 14 * 24 * 3600_000
const T = 'text-[18px] xl:text-[21px]'

function pushAvailable(): boolean {
  if (typeof window === 'undefined') return false
  try { return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('PushNotifications') } catch { return false }
}

/** Only her own pages: a push never opens somewhere outside MYRA. */
const safePath = (u: unknown): string | null => (typeof u === 'string' && /^\/(?!\/)/.test(u) ? u : null)

let listening = false
let registeredThisOpen = false

export default function PushSetup() {
  const router = useRouter()
  const pathname = usePathname()
  const [ask, setAsk] = useState(false)

  // Listeners first, once per app open: the token, and a tap on a push.
  useEffect(() => {
    if (!pushAvailable() || listening) return
    listening = true
    void PushNotifications.addListener('registration', (t) => {
      void registerPushDevice(t.value).catch(() => undefined)
    })
    void PushNotifications.addListener('registrationError', (e) => {
      console.warn('[push] registration failed', e?.error)
    })
    void PushNotifications.addListener('pushNotificationActionPerformed', (a) => {
      const path = safePath((a?.notification?.data as any)?.url)
      if (path) router.push(path)
    })
  }, [router])

  // Then where she stands: already yes → register; never asked → maybe ask.
  useEffect(() => {
    if (!pushAvailable()) return
    if (pathname?.startsWith('/me/welcome')) return
    let live = true
    ;(async () => {
      const { receive } = await PushNotifications.checkPermissions()
      if (!live) return
      if (receive === 'granted') {
        if (!registeredThisOpen) { registeredThisOpen = true; await PushNotifications.register() }
        return
      }
      if (receive === 'denied') return // Settings → MYRA → Notifications is the way back
      try {
        if (localStorage.getItem(TOUR_KEY) != null) return
        const at = Number(localStorage.getItem(ASKED_KEY) ?? 0)
        if (at && Date.now() - at < ASK_AGAIN_MS) return
      } catch { /* private storage: ask */ }
      setAsk(true)
    })().catch(() => undefined)
    return () => { live = false }
  }, [pathname])

  const answer = async (yes: boolean) => {
    setAsk(false)
    try { localStorage.setItem(ASKED_KEY, String(Date.now())) } catch { /* ignore */ }
    if (!yes) return
    try {
      const { receive } = await PushNotifications.requestPermissions()
      if (receive === 'granted') { registeredThisOpen = true; await PushNotifications.register() }
    } catch (err) {
      console.warn('[push] could not ask', err)
    }
  }

  if (!ask) return null
  return (
    <div className="fixed inset-x-0 bottom-0 z-[65] flex justify-center" role="dialog" aria-label="Notifications">
      <div className="w-full myra-pearl rounded-t-[26px] shadow-[0_-8px_40px_rgba(43,43,43,0.25)] px-6 pt-6 pb-[calc(24px+env(safe-area-inset-bottom))]">
        <p className="text-[15px] tracking-[0.16em] text-[#7C838B] mb-1">NOTIFICATIONS</p>
        <p className="text-[26px] tracking-[0.04em] text-[#0A0A0A] leading-tight mb-3">HEAR WHEN YOUR BRANDS DROP</p>
        <p className={`${T} text-[#2B2B2B] mb-5`}>MYRA can tell you on a Monday when the brands you love have new pieces in your size, and when your looks are ready.</p>
        <div className="flex gap-3">
          <button type="button" onClick={() => answer(true)} className={`${T} px-6 py-3 rounded-full bg-[#2B2B2B] text-white`}>Yes, tell me</button>
          <button type="button" onClick={() => answer(false)} className={`${T} px-6 py-3 rounded-full border border-[rgba(43,43,43,0.2)] text-[#2B2B2B]`}>Not now</button>
        </div>
      </div>
    </div>
  )
}
