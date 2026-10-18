'use client'

// FOR YOU — the first thing she sees: what MYRA did while she shopped. More
// like the pieces she kept out there, more from the labels she was reading,
// and those pieces already styled. Her looks, with the thumbs, live in LOOKS
// now, not here (Chloe, 2026-10-18).

import { useEffect, useState } from 'react'
import Link from 'next/link'
import MirrorCurtain from '@/components/me/MirrorCurtain'
import Mannequin from '@/components/me/Mannequin'
import ShopBrain from './ShopBrain'
import type { ForYouView } from './for-you-actions'
import type { ShopBrainView } from './shop-brain-actions'

const shopBrainHasContent = (v: ShopBrainView) => v.saved.length > 0 || v.similar.length > 0 || v.fromBrands.length > 0

export default function ForYouClient({ view, testMemberId, shopBrain }: {
  view: ForYouView
  testMemberId?: string
  /** Her shop section, already gathered on the server behind the mirror.
   *  null: it was not back in time, so the section fetches it itself. */
  shopBrain?: ShopBrainView | null
}) {
  // Until the page is ready the screen is only the mirror. The page is drawn
  // underneath it the whole time: the curtain waits for what MYRA did while
  // she shopped to arrive, then rises to the logo and the page appears whole —
  // never the mirror over a page that has not loaded, never a page that fills
  // in after the mirror has gone. One short beat at least, so the wiggle reads
  // as the house; a few seconds at most, so a slow network never holds her at
  // the door.
  const [curtain, setCurtain] = useState<'waiting' | 'leaving' | 'gone'>('waiting')
  const [brain, setBrain] = useState<'loading' | 'empty' | 'content'>(
    shopBrain ? (shopBrainHasContent(shopBrain) ? 'content' : 'empty') : 'loading',
  )
  const [beatPassed, setBeatPassed] = useState(false)
  const [waitedEnough, setWaitedEnough] = useState(false)

  useEffect(() => {
    let live = true
    const beat = setTimeout(() => { if (live) setBeatPassed(true) }, 700)
    const most = setTimeout(() => { if (live) setWaitedEnough(true) }, 2500)
    return () => { live = false; clearTimeout(beat); clearTimeout(most) }
  }, [])

  const ready = waitedEnough || (brain !== 'loading' && beatPassed)
  useEffect(() => {
    if (curtain === 'waiting' && ready) setCurtain('leaving')
  }, [ready, curtain])
  // Its own effect: when it lived in the one above, the change to 'leaving'
  // re-ran that effect and cancelled this timer, so the curtain never went.
  useEffect(() => {
    if (curtain !== 'leaving') return
    const t = setTimeout(() => setCurtain('gone'), 760)
    return () => clearTimeout(t)
  }, [curtain])

  // Nothing kept out in the shops yet is said plainly, with the way onward —
  // never left as a blank page.
  const nothingYet = brain === 'empty' && !view.error

  return (
    <div className={`myra-pearl relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] w-screen min-h-screen ${testMemberId ? '' : '-my-10'}`}>
      {curtain !== 'gone' && <MirrorCurtain leaving={curtain === 'leaving'} />}
      <div className="w-full px-6 sm:px-10 pb-16 pt-10">
        <div className="w-full">
          <div className="text-center mb-10">
            <h1 className="text-[clamp(20px,2.2vw,32px)] tracking-[0.045em] text-[#4A4E57] leading-[1.05]">
              {view.firstName ? `HELLO ${view.firstName.toUpperCase()}` : 'HELLO'}
            </h1>
          </div>

          {/* What she kept on other people's sites, already worked on. Draws
              nothing until there is something to show. */}
          <ShopBrain testMemberId={testMemberId} initialView={shopBrain ?? undefined} onReady={(has) => setBrain(has ? 'content' : 'empty')} />

          {/* The curtain has a ceiling; if it lifts before her shop section
              is back, say MYRA is on it — never a blank page under HELLO. */}
          {curtain === 'gone' && brain === 'loading' && (
            <div className="flex flex-col items-center gap-4 mt-16 mb-16" aria-live="polite">
              <Mannequin working />
              <p className="text-[19px] xl:text-[22px] tracking-[0.12em] text-[#4A4E57]">MYRA IS GATHERING WHAT YOU KEPT</p>
            </div>
          )}

          {nothingYet && (
            <div className="text-center max-w-[560px] mx-auto mt-6 mb-16">
              <p className="myra-section-note">NOTHING HERE YET</p>
              <p className="myra-guide-text normal-case text-[19px] text-[#4A4E57] mt-5">
                Save a piece with the MYRA Mirror while you shop, and by the time you open MYRA it is styled and waiting here. The looks your stylist made for you are in LOOKS.
              </p>
              <div className="flex flex-wrap justify-center gap-3 mt-7">
                <Link href="/me/looks" className="inline-block text-[15px] tracking-[0.06em] rounded-full bg-[#2B2B2B] text-white px-7 py-3">
                  SEE YOUR LOOKS
                </Link>
                <Link href="/me/browse" className="inline-block text-[15px] tracking-[0.06em] rounded-full border border-[#2B2B2B] text-[#2B2B2B] px-7 py-3">
                  BROWSE THE SHOPS
                </Link>
              </div>
            </div>
          )}

          {view.error && <p className="text-[20px] text-[#B83A3A] text-center mb-6">{view.error}</p>}
        </div>
      </div>
    </div>
  )
}
