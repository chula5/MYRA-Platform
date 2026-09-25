'use client'

// FOR YOU — the first thing she sees. Her newest looks, big; one plain reason
// under each; one tap to answer. Saying why is offered, never required.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import FallbackImage from '@/components/FallbackImage'
import ShopTheLookOverlay from '@/components/source-panel/ShopTheLookOverlay'
import MirrorCurtain from '@/components/me/MirrorCurtain'
import ShopBrain from './ShopBrain'
import { answerLook, explainAnswer, type ForYouLook, type ForYouView } from './for-you-actions'

const REASONS: { id: string; label: string }[] = [
  { id: 'not_my_style', label: 'Not my style' },
  { id: 'colour', label: 'The colour' },
  { id: 'fit_concern', label: 'Not sure it would fit' },
  { id: 'owned_similar', label: 'I have something like it' },
  { id: 'wrong_occasion', label: 'Wrong for the occasion' },
  { id: 'too_expensive', label: 'Too expensive' },
]

export default function ForYouClient({ view, testMemberId }: { view: ForYouView; testMemberId?: string }) {
  // Until her looks are ready the screen is only the mirror. It waits for the
  // first pictures to load (a little wiggle at least, never more than a few
  // seconds), then rises to the logo and the page appears whole.
  const [curtain, setCurtain] = useState<'waiting' | 'leaving' | 'gone'>('waiting')
  useEffect(() => {
    let live = true
    const urls = view.looks.slice(0, 4).map((l) => l.image_url).filter((u): u is string => !!u)
    const loaded = Promise.all(urls.map((u) => new Promise<void>((done) => {
      const img = new window.Image()
      img.onload = () => done()
      img.onerror = () => done()
      img.src = u
    })))
    const atLeast = new Promise((r) => setTimeout(r, 1100))
    const atMost = new Promise((r) => setTimeout(r, 6000))
    void Promise.race([Promise.all([loaded, atLeast]), atMost]).then(() => {
      if (!live) return
      setCurtain('leaving')
      setTimeout(() => { if (live) setCurtain('gone') }, 760)
    })
    return () => { live = false }
  }, [view.looks])

  return (
    <div className={`myra-pearl relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] w-screen min-h-screen ${testMemberId ? '' : '-my-10'}`}>
      {curtain !== 'gone' && <MirrorCurtain leaving={curtain === 'leaving'} />}
      <div className="w-full px-6 sm:px-10 pb-16 pt-10">
        <div className="w-full">
          <div className="text-center mb-10">
            <h1 className="text-[clamp(32px,5vw,76px)] tracking-[0.045em] text-[#4A4E57] leading-[1.05]">
              {view.firstName ? `HELLO ${view.firstName.toUpperCase()}` : 'HELLO'}
            </h1>
          </div>

          {/* What she kept on other people's sites, already worked on. Draws
              nothing until there is something to show. */}
          <ShopBrain testMemberId={testMemberId} />

          <div className="text-center mb-10">
            <p className="myra-section-note">YOUR NEWEST LOOKS</p>
            <p className="myra-guide-text mt-3 text-[clamp(21px,1.25vw,32px)] text-[#55534E]">
              Like and dislike the outfits — that is how MYRA learns what you would actually wear.
            </p>
          </div>
          {view.error && <p className="text-[20px] text-[#B83A3A] text-center mb-6">{view.error}</p>}
          {view.looks.length === 0 ? (
            <p className="text-[22px] text-[#4A4E57] text-center py-10">
              Your first looks are on their way.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6 md:gap-8 w-full">
              {view.looks.map((l) => <LookCard key={l.look_id} look={l} testMemberId={testMemberId} />)}
            </div>
          )}
          <div className="text-center mt-12">
            {testMemberId ? (
              <p className="text-[20px] text-[#55534E]">Her other looks are in ALL LOOKS.</p>
            ) : (
              <Link href="/me/looks" className="text-[22px] text-[#2B2B2B] underline underline-offset-4">See all your looks →</Link>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function LookCard({ look, testMemberId }: { look: ForYouLook; testMemberId?: string }) {
  const [answer, setAnswer] = useState<'yes' | 'no' | null>(look.response)
  // SOURCE ITEMS — the pieces, over the outfit itself, as on her looks page.
  const [sourceOpen, setSourceOpen] = useState(false)
  // A dislike opens the comment straight away, with the cursor already in it:
  // the reason is worth more than the thumb, and it is asked for once.
  const whyRef = useRef<HTMLTextAreaElement | null>(null)
  const [askWhy, setAskWhy] = useState(false)
  const [reason, setReason] = useState<string | null>(null)
  const [words, setWords] = useState('')
  const [thanked, setThanked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function tap(verdict: 'yes' | 'no') {
    setBusy(true)
    setError(null)
    const r = await answerLook(look.look_id, verdict, testMemberId)
    setBusy(false)
    if (r.error) { setError(r.error); return }
    setAnswer(verdict)
    setAskWhy(verdict === 'no')
    setThanked(false)
  }

  useEffect(() => { if (askWhy) whyRef.current?.focus({ preventScroll: true }) }, [askWhy])

  async function sendWhy() {
    setBusy(true)
    const r = await explainAnswer(look.look_id, 'no', reason, words, testMemberId)
    setBusy(false)
    if (r.error) { setError(r.error); return }
    setAskWhy(false)
    setThanked(true)
  }

  return (
    <article className="flex flex-col gap-3">
      <div className="relative aspect-[3/4] bg-[#E4E2DD] overflow-hidden rounded-[18px] shadow-[0_2px_14px_rgba(43,43,43,0.08)]">
        {look.image_url && (
          <FallbackImage src={look.image_url} thumbWidth={900} alt="" className="absolute inset-0 w-full h-full object-cover" />
        )}
        <span className="absolute top-4 left-4 bg-[rgba(255,255,255,0.92)] rounded-full px-5 py-2 text-[clamp(21px,1.25vw,32px)] tracking-[0.08em] text-[#2B2B2B]">
          {look.occasion_label.toUpperCase()}
        </span>

        {sourceOpen && look.pieces.length > 0 && (
          <div className="absolute inset-0 z-30" onClick={(e) => e.stopPropagation()}>
            <ShopTheLookOverlay
              items={look.pieces.map((p) => ({
                item_id: p.item_id ?? `unlinked-${p.product_name}`,
                product_name: p.product_name,
                image_url: p.image_url,
                retailer_url: p.owned ? null : p.url,
                price: p.price_gbp != null ? String(p.price_gbp) : null,
                currency: 'GBP',
                item_type: p.item_type,
                brand: { name: p.brand },
              })) as any}
              onClose={() => setSourceOpen(false)}
              size="large"
            />
          </div>
        )}

        {/* What the look is made of, and more like it — over the outfit, never instead of it. */}
        {!sourceOpen && look.pieces.length > 0 && (
          <div className="absolute inset-x-0 bottom-0 z-20 pt-12 pb-16 px-3 bg-gradient-to-t from-black/55 via-black/15 to-transparent pointer-events-none">
            <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
              <button
                onClick={(e) => { e.stopPropagation(); setSourceOpen(true) }}
                className="pointer-events-auto text-white text-[clamp(17px,1.05vw,26px)] tracking-[0.1em] uppercase font-light hover:opacity-70 transition-opacity"
              >
                Source items
              </button>
              <Link
                href={`/me/looks?q=${encodeURIComponent(look.occasion_label)}`}
                onClick={(e) => e.stopPropagation()}
                className="pointer-events-auto text-white text-[clamp(17px,1.05vw,26px)] tracking-[0.1em] uppercase font-light hover:opacity-70 transition-opacity"
              >
                More like this
              </Link>
            </div>
          </div>
        )}

        {/* Thumbs on the photo itself, bottom left and right: small, silver
            until she taps, black once chosen. Tapping the lit one again takes
            the answer back; tapping the other changes it. */}
        <div className="absolute inset-x-4 bottom-4 flex items-center justify-between pointer-events-none" role="group" aria-label="Would you wear this?">
          <button
            type="button"
            disabled={busy}
            aria-pressed={answer === 'yes'}
            aria-label="I would wear this"
            title="I'd wear this"
            onClick={() => (answer === 'yes' ? setAnswer(null) : tap('yes'))}
            className="myra-thumb pointer-events-auto disabled:opacity-50"
            data-on={answer === 'yes' ? 'yes' : undefined}
          >
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z" />
            </svg>
          </button>
          <button
            type="button"
            disabled={busy}
            aria-pressed={answer === 'no'}
            aria-label="Not for me"
            title="Not for me"
            onClick={() => { if (answer === 'no') { setAnswer(null); setAskWhy(false) } else void tap('no') }}
            className="myra-thumb pointer-events-auto disabled:opacity-50"
            data-on={answer === 'no' ? 'no' : undefined}
          >
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-5 empty:hidden">
        {answer === 'no' && (thanked || askWhy) && (
          <div className="flex flex-col gap-4 bg-white/85 rounded-[18px] shadow-[0_2px_14px_rgba(43,43,43,0.08)] px-5 md:px-7 py-5">
            {thanked && <p className="text-[21px] text-[#55534E] text-center">Thank you — that really helps.</p>}
            {askWhy && (
              <div className="flex flex-col gap-3">
                <p className="text-[21px] text-[#2B2B2B]">What didn&rsquo;t you like about it? Optional, and it teaches MYRA more than the thumb does.</p>
                <div className="flex flex-wrap gap-2.5">
                  {REASONS.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setReason(reason === r.id ? null : r.id)}
                      className={`text-[20px] px-4 py-2.5 rounded-full border transition-colors ${reason === r.id ? 'bg-[#2B2B2B] border-[#2B2B2B] text-white' : 'border-[#6E6B65] text-[#2B2B2B]'}`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                <textarea
                  ref={whyRef}
                  value={words}
                  onChange={(e) => setWords(e.target.value)}
                  rows={2}
                  placeholder="In your own words — the colour, the shape, the price…"
                  className="myra-guide-text text-[20px] bg-white rounded-[14px] border border-[#6E6B65] px-4 py-3 placeholder:text-[#8C8A85] focus:outline-none focus:border-[#2B2B2B]"
                />
                <div className="flex gap-3">
                  <button
                    disabled={busy || (!reason && !words.trim())}
                    onClick={sendWhy}
                    className="text-[20px] px-6 py-3 rounded-full bg-[#2B2B2B] text-white disabled:opacity-40"
                  >
                    Send
                  </button>
                  <button onClick={() => setAskWhy(false)} className="text-[20px] px-6 py-3 text-[#55534E]">No thanks</button>
                </div>
              </div>
            )}
          </div>
        )}

        {error && <p className="text-[20px] text-[#B83A3A]">{error}</p>}
      </div>
    </article>
  )
}
