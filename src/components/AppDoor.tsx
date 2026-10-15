'use client'

// THE APP'S FRONT DOOR.
//
// Inside the iPhone app the website is never shown: a person who opens the
// app sees the MYRA logo on silver and two doors — SIGN IN and APPLY. Either
// opens at once: the sign-in form, or the application (brands, price range,
// whose style inspires her). The server cannot tell the app's web view from
// Safari, so the page says so itself (inNativeApp) and draws the door over
// whatever is underneath; in Safari and on the desktop nothing here renders,
// and the landing page and sign-in page are exactly as they were.
//
// A login that is signed in but has no member record (an application still
// being looked at) is told so here, with a way to sign out — rather than
// being dropped on the website.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import AuthForm from '@/app/earlyaccess/AuthForm'
import ApplyModal from '@/components/ApplyModal'
import { earlyAccessSignOut } from '@/app/earlyaccess/actions'
import { inNativeApp } from '@/components/me/AppFirstOpen'

const SITE = 'https://www.myraassistant.co.uk'

export type AppDoorState =
  | 'out'      // nobody signed in: the two doors
  | 'waiting'  // signed in, no member yet: her application is being looked at
  | 'member'   // signed in member on a page that is not hers: straight to For You

export default function AppDoor({
  state,
  error,
  withApplyModal = true,
}: {
  state: AppDoorState
  /** A sign-in error sent back by the server: the door opens on the form, with it. */
  error?: string
  /** The landing page mounts its own ApplyModal; the door must not add a second. */
  withApplyModal?: boolean
}) {
  const router = useRouter()
  // Nothing is drawn until the page knows where it is, so Safari never sees a flash.
  const [app, setApp] = useState(false)
  const [panel, setPanel] = useState<'doors' | 'signin'>(error ? 'signin' : 'doors')

  useEffect(() => {
    // In development only, ?app=1 shows the door in an ordinary browser.
    const preview = process.env.NODE_ENV !== 'production' && new URLSearchParams(window.location.search).get('app') === '1'
    setApp(inNativeApp() || preview)
  }, [])

  useEffect(() => {
    if (!app) return
    if (state === 'member') { router.replace('/me'); return }
    // The page underneath must not scroll behind the door.
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [app, state, router])

  if (!app || state === 'member') return null

  const openApply = () => window.dispatchEvent(new Event('myra:open-apply'))
  const whatIsMyra = () => { window.location.href = `x-safari-${SITE}` }

  return (
    <div
      className="fixed inset-0 z-[95] myra-pearl overflow-y-auto overscroll-contain"
      data-lenis-prevent
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="min-h-full flex flex-col items-center justify-center px-7 py-12">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/myra-logo-black.png" alt="MYRA" className="h-[120px] w-auto" />

        {state === 'waiting' ? (
          <div className="mt-10 w-full max-w-[360px] text-center">
            <p className="text-[22px] leading-snug text-[#2B2B2B]">Thank you — your application is being looked at.</p>
            <p className="mt-4 text-[17px] leading-relaxed text-[#4A4E57]">
              If MYRA is right for your taste, Chloe will be in touch to set up your own personal edit.
            </p>
            <form action={earlyAccessSignOut} className="mt-10">
              <button type="submit" className="myra-silver-button text-[17px] tracking-[0.14em]">SIGN OUT</button>
            </form>
          </div>
        ) : panel === 'signin' ? (
          <div className="mt-8 w-full max-w-[360px]">
            <div className="myra-app-door myra-silver-card px-6 py-8">
              <AuthForm initialMode="signin" error={error} appDoor />
            </div>
            <button
              type="button"
              onClick={() => setPanel('doors')}
              className="mt-6 w-full text-center text-[15px] tracking-[0.12em] text-[#6B6B6B]"
            >
              ← BACK
            </button>
          </div>
        ) : (
          <div className="mt-12 w-full max-w-[360px] space-y-5">
            <button type="button" onClick={() => setPanel('signin')} className="myra-silver-button text-[19px] tracking-[0.16em]">
              SIGN IN
            </button>
            <button type="button" onClick={openApply} className="myra-silver-button text-[19px] tracking-[0.16em]">
              APPLY
            </button>
            <button
              type="button"
              onClick={whatIsMyra}
              className="block w-full pt-6 text-center text-[15px] tracking-[0.12em] text-[#7C838B]"
            >
              WHAT IS MYRA? →
            </button>
          </div>
        )}
      </div>

      {withApplyModal && <ApplyModal />}
    </div>
  )
}
