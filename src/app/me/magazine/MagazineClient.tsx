'use client'

// MYRA MAGAZINE — everything she subscribes to, read for her and laid out as
// one page: a masthead, then each publication's issue with the few pieces that
// are hers. Made to be read in a minute, not browsed.

import { useEffect, useState } from 'react'
import FallbackImage from '@/components/FallbackImage'
import { ArchiveCard } from '@/components/ArchiveCard'
import { loadMyMagazine, refreshMyMagazine, setPublicationMuted, type MagazinePageView } from './actions'

const MONTH = { month: 'long', day: 'numeric' } as const

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

  return (
    <div className={`myra-pearl relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] w-screen min-h-screen ${testMemberId ? '' : '-my-10'}`}>
      <div className="w-full px-6 sm:px-10 pb-16">
        <ArchiveCard
          className="w-full"
          intro="settle"
          heading={
            <div className="text-center">
              <h1 className="text-[clamp(34px,6vw,86px)] tracking-[0.14em] text-[#4A4E57] leading-[1]">MYRA MAGAZINE</h1>
              <p className="myra-section-note mt-4">
                EVERYTHING YOU SUBSCRIBE TO, READ FOR YOU — ONLY WHAT&rsquo;S YOU
              </p>
              {view.test && (
                <p className="text-[18px] tracking-[0.1em] text-[#8B5E00] mt-4">
                  TEST AS {view.firstName.toUpperCase()} — HER REAL NEWSLETTERS
                </p>
              )}
            </div>
          }
        >
          {view.error && <p className="text-[20px] text-[#B83A3A] text-center mb-6">{view.error}</p>}

          <div className="w-full">
            {/* Masthead line: read again, and what has been read */}
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 border-y border-[#2B2B2B] py-4 mb-12">
              <button
                disabled={busy || view.needsInbox}
                onClick={read}
                className="text-[20px] tracking-[0.12em] px-7 py-3 bg-[#2B2B2B] text-white disabled:opacity-40"
              >
                {busy ? 'READING…' : 'READ THIS WEEK'}
              </button>
              {msg && <p className="text-[20px] text-[#2B2B2B]">{msg}</p>}
              {view.needsInbox && (
                <p className="text-[20px] text-[#2B2B2B]">
                  Connect your email in your dressing room and MYRA reads the newsletters you already get.
                </p>
              )}
            </div>

            {view.issues.length === 0 && !view.needsInbox && !busy && (
              <p className="text-[22px] text-[#4A4E57] text-center py-10">
                Nothing yet. Press READ THIS WEEK and MYRA will go through your newsletters.
              </p>
            )}

            {/* The issues */}
            <div className="space-y-16">
              {view.issues.map((issue) => (
                <article key={issue.issue_id}>
                  <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-[#C3BFB8] pb-3 mb-6">
                    <h2 className="text-[clamp(24px,3vw,40px)] tracking-[0.06em] text-[#2B2B2B]">{issue.publication.toUpperCase()}</h2>
                    <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
                      {issue.received_at && (
                        <p className="text-[18px] text-[#6E6B65]">{new Date(issue.received_at).toLocaleDateString('en-GB', MONTH)}</p>
                      )}
                      <button
                        disabled={busy}
                        onClick={() => mute(issue.publication, true)}
                        className="text-[18px] underline underline-offset-4 text-[#6E6B65] disabled:opacity-40"
                      >
                        Stop reading this
                      </button>
                    </div>
                  </header>

                  {issue.subject && (
                    <p className="text-[clamp(22px,2.2vw,32px)] text-[#4A4E57] leading-snug mb-7 max-w-4xl">{issue.subject}</p>
                  )}

                  <div className="grid grid-cols-2 md:grid-cols-4 2xl:grid-cols-6 gap-[6px] w-full">
                    {issue.picks.map((p, i) => {
                      const body = (
                        <>
                          <div className="relative aspect-[3/4] bg-[#EDEDED] overflow-hidden">
                            {p.image_url && (
                              <FallbackImage src={p.image_url} thumbWidth={700} alt={p.name} className="absolute inset-0 w-full h-full object-cover" />
                            )}
                          </div>
                          <div className="px-4 py-4 text-left">
                            {p.brand && <p className="text-[18px] tracking-[0.1em] text-[#6E6B65]">{p.brand.toUpperCase()}</p>}
                            <p className="text-[21px] text-[#2B2B2B] leading-tight mt-1 line-clamp-2">{p.name}</p>
                            {p.price != null && (
                              <p className="text-[19px] text-[#55534E] mt-1">
                                {p.currency === 'GBP' || !p.currency ? '£' : `${p.currency} `}{Math.round(p.price)}
                              </p>
                            )}
                            {p.why && <p className="text-[19px] text-[#4A4E57] mt-2 italic">{p.why}</p>}
                          </div>
                        </>
                      )
                      return p.url ? (
                        <a key={i} href={p.url} target="_blank" rel="noopener noreferrer" className="bg-white hover:outline hover:outline-2 hover:outline-[#2B2B2B]">
                          {body}
                        </a>
                      ) : (
                        <div key={i} className="bg-white">{body}</div>
                      )
                    })}
                  </div>
                </article>
              ))}
            </div>

            {/* What she is subscribed to, and what MYRA has stopped reading */}
            {view.publications.length > 0 && (
              <div className="mt-16 border-t border-[#2B2B2B] pt-6">
                <p className="myra-section-note">YOUR SUBSCRIPTIONS</p>
                <div className="flex flex-wrap gap-x-6 gap-y-3 mt-4">
                  {view.publications.map((p) => (
                    <button
                      key={p.publication}
                      disabled={busy}
                      onClick={() => mute(p.publication, !p.muted)}
                      className={`text-[19px] px-4 py-2 border disabled:opacity-40 ${p.muted ? 'border-[#C3BFB8] text-[#8C8A85] line-through' : 'border-[#2B2B2B] text-[#2B2B2B]'}`}
                      title={p.muted ? 'Start reading this again' : 'Stop reading this'}
                    >
                      {p.publication}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </ArchiveCard>
      </div>
    </div>
  )
}
