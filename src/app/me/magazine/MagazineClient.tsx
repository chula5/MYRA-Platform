'use client'

// MYRA MAGAZINE — her own subscriptions, read for her and set like a spread:
// the masthead and one piece of the day down the left, the newest issue from
// her inbox across the middle, and everything else that was hers down the
// right. Made to be read in a minute, not browsed.
//
// It reads the inbox she has already connected for her orders — no second
// sign-in, and the email itself is never stored.
//
// Only the pieces speak here: a photograph, a name, a price. The labels and
// the reading she does not need are gone.

import { useEffect, useState } from 'react'
import FallbackImage from '@/components/FallbackImage'
import { loadMyMagazine, refreshMyMagazine, setPublicationMuted, type MagazinePageView } from './actions'
import { cleanName, type MagazinePick } from '@/lib/magazine/core'

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
  // The piece of the day comes from anywhere BUT the issue leading the middle,
  // so the same piece never heads two parts of the page.
  const leadPicks = (lead?.picks ?? []).slice(0, 3)
  const ofTheDay = issues.slice(1).flatMap((i) => i.picks).find((p) => p.image_url)
    ?? (lead?.picks ?? []).slice(3).find((p) => p.image_url)
    ?? null
  // Everything else she was kept — the piece of the day does not appear twice.
  const inLead = new Set(leadPicks.map((p) => `${p.name}|${p.brand ?? ''}`))
  const rest = issues.flatMap((i) => i.picks.map((p) => ({ ...p, publication: i.publication })))
    .filter((p) => !(ofTheDay && p.name === ofTheDay.name && p.brand === ofTheDay.brand))
    .filter((p) => !inLead.has(`${p.name}|${p.brand ?? ''}`))
    // The same piece from two newsletters is one piece.
    .filter((p, i, all) => all.findIndex((q) => q.name === p.name && q.brand === p.brand) === i)
    .slice(0, 8)

  return (
    <div className={`myra-pearl relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] w-screen min-h-screen ${testMemberId ? '' : '-my-10'}`}>
      <div className="w-full px-6 sm:px-10 py-8 pb-16">
        <div className="grid xl:grid-cols-[300px_minmax(0,1fr)_460px] gap-6 items-start">

          {/* The masthead, and one piece chosen for her */}
          <aside className="rounded-[18px] overflow-hidden bg-[#8C8A85] text-white px-7 py-8 flex flex-col gap-7 min-h-[560px]">
            <div>
              <h1 className="text-[clamp(36px,4vw,62px)] leading-[0.95] tracking-[0.06em]">MYRA</h1>
              <p className="text-[19px] tracking-[0.14em] text-white/80 mt-2">
                {view.firstName ? `FOR ${view.firstName.toUpperCase()}` : 'FOR YOU'}
              </p>
            </div>

            <div className="border-t border-white/30 pt-6">
              {ofTheDay ? (
                <>
                  <div className="relative aspect-[3/4] rounded-[14px] overflow-hidden bg-white/10">
                    {ofTheDay.image_url && (
                      <FallbackImage src={ofTheDay.image_url} thumbWidth={700} alt={ofTheDay.name} className="absolute inset-0 w-full h-full object-cover" />
                    )}
                  </div>
                  <p className="text-[26px] leading-tight mt-4">{cleanName(ofTheDay.name)}</p>
                  <p className="text-[20px] tracking-[0.1em] mt-3">{(ofTheDay.brand ?? '').toUpperCase()}</p>
                  {price(ofTheDay) && <p className="text-[19px] text-white/80">{price(ofTheDay)}</p>}
                  {ofTheDay.url && (
                    <a href={ofTheDay.url} target="_blank" rel="noopener noreferrer" className="inline-block mt-4 text-[19px] rounded-full border border-white/70 px-5 py-2.5">
                      SEE IT
                    </a>
                  )}
                </>
              ) : (
                <p className="text-[20px] text-white/85">Nothing picked yet.</p>
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
              {view.needsInbox && (
                <p className="text-[18px] text-white/75 mt-3">Connect your email in your dressing room first.</p>
              )}
            </div>
          </aside>

          {/* What came in: the newest issue */}
          <section className="rounded-[18px] overflow-hidden bg-white/85 shadow-[0_2px_14px_rgba(43,43,43,0.08)] min-h-[560px] flex flex-col">
            <div className="px-8 pt-8">
              <h2 className="text-[clamp(30px,3.4vw,52px)] leading-[1.05] text-[#2B2B2B]">
                {lead?.subject ?? (view.needsInbox ? 'Connect your email' : 'Nothing read yet')}
              </h2>
              <p className="text-[19px] tracking-[0.1em] text-[#6E6B65] mt-4">
                {lead
                  ? `${lead.publication.toUpperCase()}${lead.received_at ? ` · ${new Date(lead.received_at).toLocaleDateString('en-GB', DATE).toUpperCase()}` : ''}`
                  : 'MYRA reads the newsletters you already get, and keeps what is yours.'}
              </p>
              {msg && <p className="text-[20px] text-[#2B2B2B] mt-4">{msg}</p>}
              {view.error && <p className="text-[20px] text-[#B83A3A] mt-4">{view.error}</p>}
            </div>

            {/* The pieces she was kept from this issue, big. A newsletter's own
                hero is usually a banner of type, so a piece leads instead. */}
            {lead && lead.picks.length > 0 && (
              <div className="px-8 mt-6 grid grid-cols-2 lg:grid-cols-3 gap-5">
                {lead.picks.slice(0, 3).map((p, i) => {
                  const body = (
                    <>
                      <div className="relative aspect-[3/4] rounded-[14px] overflow-hidden bg-[#EDEDED]">
                        {p.image_url && (
                          <FallbackImage src={p.image_url} thumbWidth={800} alt={p.name} className="absolute inset-0 w-full h-full object-cover" />
                        )}
                      </div>
                      <p className="text-[20px] text-[#2B2B2B] mt-3 leading-tight">{cleanName(p.name)}</p>
                      <p className="text-[19px] text-[#6E6B65] mt-1">{[p.brand, price(p)].filter(Boolean).join(' · ')}</p>
                    </>
                  )
                  return p.url
                    ? <a key={i} href={p.url} target="_blank" rel="noopener noreferrer" className="block group">{body}</a>
                    : <div key={i}>{body}</div>
                })}
              </div>
            )}

            {lead?.hero_image && lead.picks.length === 0 && (
              <div className="relative flex-1 mt-6 mx-8 rounded-[14px] overflow-hidden bg-[#EDEDED] min-h-[260px]">
                <FallbackImage src={lead.hero_image} thumbWidth={1400} alt="" className="absolute inset-0 w-full h-full object-cover" />
              </div>
            )}

            {lead && (
              <div className="px-8 pb-8 pt-6 mt-auto flex flex-wrap items-center justify-between gap-4">
                <p className="text-[19px] tracking-[0.14em] text-[#6E6B65]">{lead.picks.length} KEPT</p>
                <button
                  disabled={busy}
                  onClick={() => mute(lead.publication, true)}
                  className="text-[19px] rounded-full border border-[#2B2B2B] px-5 py-2.5 text-[#2B2B2B] disabled:opacity-40"
                >
                  MUTE
                </button>
              </div>
            )}
          </section>

          {/* Everything else that was hers */}
          <aside className="rounded-[18px] bg-white/85 shadow-[0_2px_14px_rgba(43,43,43,0.08)] px-6 py-7 min-h-[560px]">
            <p className="text-[19px] tracking-[0.16em] text-[#2B2B2B] border-b border-[rgba(43,43,43,0.15)] pb-3">RECOMMENDED</p>

            {rest.length === 0 ? (
              <p className="text-[20px] text-[#4A4E57] mt-5">
                {view.needsInbox ? 'No inbox connected yet.' : 'Press READ THIS WEEK.'}
              </p>
            ) : (
              <div className="divide-y divide-[rgba(43,43,43,0.12)]">
                {rest.map((p, i) => {
                  const body = (
                    <div className="flex gap-4 py-4">
                      <div className="relative w-[92px] shrink-0 aspect-[3/4] rounded-[12px] overflow-hidden bg-[#EDEDED]">
                        {p.image_url && (
                          <FallbackImage src={p.image_url} thumbWidth={400} alt={p.name} className="absolute inset-0 w-full h-full object-cover" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-[19px] tracking-[0.08em] text-[#6E6B65]">{(p.brand ?? p.publication).toUpperCase()}</p>
                        <p className="text-[20px] text-[#2B2B2B] leading-tight mt-0.5">{cleanName(p.name)}</p>
                        {price(p) && <p className="text-[19px] text-[#55534E] mt-0.5">{price(p)}</p>}
                      </div>
                    </div>
                  )
                  return p.url ? (
                    <a key={i} href={p.url} target="_blank" rel="noopener noreferrer" className="block hover:bg-white/60">{body}</a>
                  ) : (
                    <div key={i}>{body}</div>
                  )
                })}
              </div>
            )}

            {view.publications.length > 0 && (
              <div className="mt-7">
                <p className="text-[18px] tracking-[0.14em] text-[#6E6B65] mb-3">SUBSCRIPTIONS</p>
                <div className="flex flex-wrap gap-2">
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
