'use client'

// MYRA MAGAZINE — her own subscriptions, read for her and set like a spread:
// the masthead and one piece of the day down the left, the newest issue from
// her inbox across the middle, and everything else that was hers down the
// right. Made to be read in a minute, not browsed.
//
// It reads the inbox she has already connected for her orders — no second
// sign-in, and the email itself is never stored.

import { useEffect, useState } from 'react'
import FallbackImage from '@/components/FallbackImage'
import { loadMyMagazine, refreshMyMagazine, setPublicationMuted, type MagazinePageView } from './actions'
import type { MagazinePick } from '@/lib/magazine/core'

const DATE = { day: 'numeric', month: 'long' } as const

const price = (p: MagazinePick) =>
  p.price == null ? null : `${p.currency === 'GBP' || !p.currency ? '£' : `${p.currency} `}${Math.round(p.price)}`

export default function MagazineClient({ testMemberId }: { testMemberId?: string }) {
  const [view, setView] = useState<MagazinePageView | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const refresh = async () => setView(await loadMyMagazine(testMemberId))

  useEffect(() => { void refresh() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [testMemberId])

  async function read() {
    setBusy(true)
    setMsg('Reading your newsletters…')
    const r = await refreshMyMagazine(testMemberId)
    setBusy(false)
    setMsg(r.error ?? (r.picks
      ? `${r.picks} piece${r.picks === 1 ? '' : 's'} for you from ${r.issues} newsletter${r.issues === 1 ? '' : 's'}.`
      : `Read ${r.read} newsletter${r.read === 1 ? '' : 's'} — nothing in them was you.`))
    await refresh()
  }

  async function mute(publication: string, muted: boolean) {
    setBusy(true)
    await setPublicationMuted(publication, muted, testMemberId)
    setBusy(false)
    setMsg(muted ? `${publication} won't be read again.` : `${publication} is back in your magazine.`)
    await refresh()
  }

  if (!view) return null
  if (!view.memberId) return null

  const issues = view.issues
  const lead = issues[0] ?? null
  // The piece of the day: the first thing MYRA kept, with a picture.
  const ofTheDay = issues.flatMap((i) => i.picks).find((p) => p.image_url) ?? null
  // Everything else she was kept — the piece of the day does not appear twice.
  const rest = issues.flatMap((i) => i.picks.map((p) => ({ ...p, publication: i.publication })))
    .filter((p) => !(ofTheDay && p.name === ofTheDay.name && p.brand === ofTheDay.brand))
    .slice(0, 12)

  return (
    <div className={`myra-pearl relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] w-screen min-h-screen ${testMemberId ? '' : '-my-10'}`}>
      <div className="w-full px-6 sm:px-10 py-8 pb-16">
        <div className="grid xl:grid-cols-[320px_minmax(0,1fr)_420px] gap-6 items-start">

          {/* The masthead, and one piece chosen for her */}
          <aside className="rounded-[18px] overflow-hidden bg-[#8C8A85] text-white px-7 py-8 flex flex-col gap-7 min-h-[560px]">
            <div>
              <p className="text-[19px] tracking-[0.2em] text-white/80">MYRA MAGAZINE</p>
              <h1 className="text-[clamp(36px,4vw,62px)] leading-[0.95] tracking-[0.06em] mt-3">MYRA</h1>
              <p className="text-[19px] tracking-[0.14em] text-white/80 mt-3">
                {view.firstName ? `FOR ${view.firstName.toUpperCase()}` : 'FOR YOU'}
              </p>
            </div>

            <div className="border-t border-white/30 pt-6">
              <p className="text-[19px] tracking-[0.16em] text-white/80">ITEM OF THE DAY</p>
              {ofTheDay ? (
                <>
                  <p className="text-[26px] leading-tight mt-3">{ofTheDay.name}</p>
                  {ofTheDay.why && <p className="text-[20px] text-white/85 mt-2 leading-snug">{ofTheDay.why}</p>}
                  <div className="relative aspect-[3/4] rounded-[14px] overflow-hidden bg-white/10 mt-5">
                    {ofTheDay.image_url && (
                      <FallbackImage src={ofTheDay.image_url} thumbWidth={700} alt={ofTheDay.name} className="absolute inset-0 w-full h-full object-cover" />
                    )}
                  </div>
                  <p className="text-[20px] tracking-[0.1em] mt-4">{(ofTheDay.brand ?? '').toUpperCase()}</p>
                  <p className="text-[19px] text-white/80">{price(ofTheDay) ?? 'In your size, in your colours'}</p>
                  {ofTheDay.url && (
                    <a href={ofTheDay.url} target="_blank" rel="noopener noreferrer" className="inline-block mt-4 text-[19px] rounded-full border border-white/70 px-5 py-2.5">
                      See it
                    </a>
                  )}
                </>
              ) : (
                <p className="text-[20px] text-white/85 mt-3">Nothing chosen yet. Read this week and MYRA picks one.</p>
              )}
            </div>

            <div className="mt-auto border-t border-white/30 pt-5">
              <button
                onClick={read}
                disabled={busy || view.needsInbox}
                className="w-full text-[20px] tracking-[0.1em] rounded-full bg-white text-[#2B2B2B] px-6 py-3.5 disabled:opacity-50"
              >
                {busy ? 'READING…' : 'READ THIS WEEK'}
              </button>
              <p className="text-[18px] text-white/75 mt-3 leading-snug">
                {view.needsInbox
                  ? 'Connect your email in your dressing room first.'
                  : 'Read straight from the inbox you already connected.'}
              </p>
            </div>
          </aside>

          {/* What came in: the newest issue */}
          <section className="rounded-[18px] overflow-hidden bg-white/85 shadow-[0_2px_14px_rgba(43,43,43,0.08)] min-h-[560px] flex flex-col">
            <div className="px-8 pt-8">
              <p className="text-[19px] tracking-[0.16em] text-[#6E6B65]">HERO FROM YOUR INBOX</p>
              <h2 className="text-[clamp(30px,3.4vw,52px)] leading-[1.05] text-[#2B2B2B] mt-3">
                {lead?.subject ?? (view.needsInbox ? 'Connect your email' : 'Nothing read yet')}
              </h2>
              <p className="text-[21px] text-[#4A4E57] mt-4 max-w-xl leading-snug">
                {lead
                  ? `From ${lead.publication}${lead.received_at ? `, ${new Date(lead.received_at).toLocaleDateString('en-GB', DATE)}` : ''} — only the pieces that are yours.`
                  : 'MYRA reads the fashion newsletters you already subscribe to and keeps what is yours.'}
              </p>
              {msg && <p className="text-[20px] text-[#2B2B2B] mt-4">{msg}</p>}
              {view.error && <p className="text-[20px] text-[#B83A3A] mt-4">{view.error}</p>}
            </div>

            <div className="relative flex-1 mt-6 mx-8 mb-6 rounded-[14px] overflow-hidden bg-[#EDEDED] min-h-[320px]">
              {(lead?.hero_image ?? lead?.picks[0]?.image_url) && (
                <FallbackImage
                  src={(lead?.hero_image ?? lead?.picks[0]?.image_url) as string}
                  thumbWidth={1400}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover"
                />
              )}
            </div>

            {lead && (
              <div className="px-8 pb-8 border-t border-[rgba(43,43,43,0.15)] pt-5 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-[19px] tracking-[0.14em] text-[#6E6B65]">CURATED FROM YOUR SUBSCRIPTION EMAIL</p>
                  <p className="text-[22px] text-[#2B2B2B] mt-1">
                    {lead.picks.length} piece{lead.picks.length === 1 ? '' : 's'} kept from {lead.publication}
                  </p>
                </div>
                <button
                  disabled={busy}
                  onClick={() => mute(lead.publication, true)}
                  className="text-[19px] rounded-full border border-[#2B2B2B] px-5 py-2.5 text-[#2B2B2B] disabled:opacity-40"
                >
                  Stop reading {lead.publication}
                </button>
              </div>
            )}
          </section>

          {/* Everything else that was hers */}
          <aside className="rounded-[18px] bg-white/85 shadow-[0_2px_14px_rgba(43,43,43,0.08)] px-6 py-7 min-h-[560px]">
            <div className="flex items-baseline justify-between gap-4 border-b border-[rgba(43,43,43,0.15)] pb-3">
              <p className="text-[19px] tracking-[0.16em] text-[#2B2B2B]">RECOMMENDED FOR YOU</p>
              <p className="text-[18px] text-[#6E6B65]">From your subscriptions</p>
            </div>

            {rest.length === 0 ? (
              <p className="text-[20px] text-[#4A4E57] mt-5">
                {view.needsInbox ? 'Nothing to read until an inbox is connected.' : 'Press READ THIS WEEK and MYRA goes through your newsletters.'}
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-4 mt-5">
                {rest.map((p, i) => {
                  const body = (
                    <>
                      <div className="relative aspect-[3/4] rounded-[14px] overflow-hidden bg-[#EDEDED]">
                        {p.image_url && (
                          <FallbackImage src={p.image_url} thumbWidth={500} alt={p.name} className="absolute inset-0 w-full h-full object-cover" />
                        )}
                      </div>
                      <p className="text-[19px] tracking-[0.06em] text-[#2B2B2B] mt-2 leading-tight line-clamp-2">{p.name.toUpperCase()}</p>
                      <p className="text-[18px] text-[#6E6B65]">{[p.brand, price(p)].filter(Boolean).join(' · ')}</p>
                      {p.why && <p className="text-[18px] text-[#4A4E57] italic leading-snug">{p.why}</p>}
                    </>
                  )
                  return p.url ? (
                    <a key={i} href={p.url} target="_blank" rel="noopener noreferrer" className="block">{body}</a>
                  ) : (
                    <div key={i}>{body}</div>
                  )
                })}
              </div>
            )}

            <p className="text-[19px] tracking-[0.1em] text-[#6E6B65] text-center mt-7 pt-5 border-t border-[rgba(43,43,43,0.15)]">
              INSPIRED BY YOU. READ BY MYRA.
            </p>

            {view.publications.length > 0 && (
              <div className="mt-5">
                <p className="text-[18px] tracking-[0.14em] text-[#6E6B65]">YOUR SUBSCRIPTIONS</p>
                <div className="flex flex-wrap gap-2 mt-3">
                  {view.publications.map((p) => (
                    <button
                      key={p.publication}
                      disabled={busy}
                      onClick={() => mute(p.publication, !p.muted)}
                      title={p.muted ? 'Start reading this again' : 'Stop reading this'}
                      className={`text-[18px] rounded-full px-4 py-2 border disabled:opacity-40 ${p.muted ? 'border-[#C3BFB8] text-[#8C8A85] line-through' : 'border-[rgba(43,43,43,0.3)] text-[#2B2B2B]'}`}
                    >
                      {p.publication}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}
