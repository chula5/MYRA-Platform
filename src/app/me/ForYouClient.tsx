'use client'

// FOR YOU — the first thing she sees. Her newest looks, big; one plain reason
// under each; one tap to answer. Saying why is offered, never required.

import { useState } from 'react'
import Link from 'next/link'
import FallbackImage from '@/components/FallbackImage'
import { ArchiveCard } from '@/components/ArchiveCard'
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
  return (
    <div className={`myra-texture relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] w-screen min-h-screen ${testMemberId ? '' : '-my-10'}`}>
      <div className="w-full px-6 sm:px-10 pb-16">
        <ArchiveCard
          className="w-full"
          intro="settle"
          heading={
            <div className="text-center">
              <h1 className="text-[clamp(30px,5vw,72px)] tracking-[0.045em] text-[#4A4E57] leading-[1.05]">
                {view.firstName ? `HELLO ${view.firstName.toUpperCase()}` : 'HELLO'}
              </h1>
              <p className="myra-section-note mt-4">YOUR NEWEST LOOKS</p>
              {view.test && (
                <p className="text-[18px] tracking-[0.1em] text-[#8B5E00] mt-4">
                  TEST AS {view.firstName.toUpperCase()} — YOUR TAPS HERE ARE NOT SAVED
                </p>
              )}
            </div>
          }
        >
          {view.error && <p className="text-[20px] text-[#B83A3A] text-center mb-6">{view.error}</p>}
          {view.looks.length === 0 ? (
            <p className="text-[22px] text-[#4A4E57] text-center py-10">
              Your first looks are on their way.
            </p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 md:gap-8 max-w-[1400px] mx-auto">
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
        </ArchiveCard>
      </div>
    </div>
  )
}

function LookCard({ look, testMemberId }: { look: ForYouLook; testMemberId?: string }) {
  const [answer, setAnswer] = useState<'yes' | 'no' | null>(look.response)
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

  async function sendWhy() {
    setBusy(true)
    const r = await explainAnswer(look.look_id, 'no', reason, words, testMemberId)
    setBusy(false)
    if (r.error) { setError(r.error); return }
    setAskWhy(false)
    setThanked(true)
  }

  return (
    <article className="bg-[#F7F6F3] border border-[#2B2B2B] flex flex-col">
      <div className="relative aspect-[3/4] bg-[#E4E2DD] overflow-hidden">
        {look.image_url && (
          <FallbackImage src={look.image_url} thumbWidth={900} alt="" className="absolute inset-0 w-full h-full object-cover" />
        )}
        <span className="absolute top-4 left-4 bg-[rgba(247,246,243,0.92)] px-3 py-1.5 text-[18px] tracking-[0.1em] text-[#2B2B2B]">
          {look.occasion_label.toUpperCase()}
        </span>
      </div>

      <div className="px-5 md:px-7 py-6 flex flex-col gap-5">
        <p className="text-[22px] md:text-[24px] leading-snug text-[#2B2B2B]">{look.why}</p>

        {answer === null && (
          <div className="grid grid-cols-2 gap-3">
            <button
              disabled={busy}
              onClick={() => tap('yes')}
              className="text-[22px] py-4 bg-[#2B2B2B] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              I&rsquo;d wear this
            </button>
            <button
              disabled={busy}
              onClick={() => tap('no')}
              className="text-[22px] py-4 border border-[#2B2B2B] text-[#2B2B2B] hover:bg-[#2B2B2B] hover:text-white transition-colors disabled:opacity-50"
            >
              Not for me
            </button>
          </div>
        )}

        {answer === 'yes' && (
          <p className="text-[22px] text-[#3D6B45]">
            ✓ You&rsquo;d wear this.{' '}
            <button onClick={() => setAnswer(null)} className="text-[20px] text-[#55534E] underline underline-offset-4">Change</button>
          </p>
        )}

        {answer === 'no' && (
          <div className="flex flex-col gap-4">
            <p className="text-[22px] text-[#55534E]">
              {thanked ? 'Thank you — that really helps.' : 'Noted — not for you.'}{' '}
              <button onClick={() => { setAnswer(null); setAskWhy(false) }} className="text-[20px] underline underline-offset-4">Change</button>
            </p>
            {askWhy && (
              <div className="flex flex-col gap-3">
                <p className="text-[20px] text-[#2B2B2B]">Want to say why? It&rsquo;s optional.</p>
                <div className="flex flex-wrap gap-2.5">
                  {REASONS.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setReason(reason === r.id ? null : r.id)}
                      className={`text-[20px] px-4 py-2.5 border transition-colors ${reason === r.id ? 'bg-[#2B2B2B] border-[#2B2B2B] text-white' : 'border-[#6E6B65] text-[#2B2B2B]'}`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                <textarea
                  value={words}
                  onChange={(e) => setWords(e.target.value)}
                  rows={2}
                  placeholder="Or in your own words"
                  className="text-[20px] bg-white border border-[#6E6B65] px-4 py-3 placeholder:text-[#8C8A85] focus:outline-none focus:border-[#2B2B2B]"
                />
                <div className="flex gap-3">
                  <button
                    disabled={busy || (!reason && !words.trim())}
                    onClick={sendWhy}
                    className="text-[20px] px-6 py-3 bg-[#2B2B2B] text-white disabled:opacity-40"
                  >
                    Send
                  </button>
                  <button onClick={() => setAskWhy(false)} className="text-[20px] px-6 py-3 text-[#55534E]">Skip</button>
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
