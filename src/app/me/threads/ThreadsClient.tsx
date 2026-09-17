'use client'

// THREADS — her own page of what MYRA knows. The tangle at the top resolves
// into one line, which is the idea: a hundred small signals pulled into one
// way of dressing. Every thread shows where it came from, so nothing MYRA
// believes about her is hidden from her.

import { useEffect, useState } from 'react'
import { loadMyThreads, type ThreadsPageView } from './actions'

function Tangle({ className = '' }: { className?: string }) {
  const s = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' } as const
  return (
    <svg viewBox="0 0 900 260" preserveAspectRatio="xMidYMid meet" className={className} aria-hidden>
      {/* One line: loose, then knotted, then loose again */}
      <path
        d="M0 214c70 18 120-6 150-40M150 174c40-46 12-96-38-96s-72 62-30 96 122 34 160-6 8-104-44-108-92 50-56 96 118 42 158 2 14-98-38-104-86 44-54 88 104 40 142 6 34-70 4-92"
        {...s}
        strokeWidth="3.2"
      />
      <path d="M472 88c46 10 60 70 22 100s-104 8-104-40" {...s} strokeWidth="3.2" />
      <path d="M498 176c56 26 118 6 152-34 30-36 88-44 158-24l92 26" {...s} strokeWidth="3.2" />
    </svg>
  )
}

export default function ThreadsClient({ testMemberId }: { testMemberId?: string }) {
  const [view, setView] = useState<ThreadsPageView | null>(null)

  useEffect(() => {
    let live = true
    void loadMyThreads(testMemberId).then((v) => { if (live) setView(v) })
    return () => { live = false }
  }, [testMemberId])

  if (!view) return null
  if (!view.memberId) return null

  const c = view.counts

  return (
    <div className={`myra-pearl relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] w-screen min-h-screen ${testMemberId ? '' : '-my-10'}`}>
      <div className="w-full px-6 sm:px-10 py-8 pb-16 space-y-6">

        {/* What MYRA knows, in one line */}
        <section className="rounded-[18px] bg-white/85 shadow-[0_2px_14px_rgba(43,43,43,0.08)] px-8 py-9">
          <div className="grid lg:grid-cols-[minmax(0,1fr)_440px] gap-8 items-center">
            <div>
              <p className="text-[20px] tracking-[0.18em] text-[#6E6B65]">THREADS</p>
              <h1 className="text-[clamp(30px,4vw,56px)] tracking-[0.03em] text-[#2B2B2B] leading-[1.05] mt-3">
                HOW YOU DRESS
              </h1>
              <p className="text-[22px] text-[#4A4E57] mt-4 max-w-2xl leading-snug">{view.opening}</p>
              {view.test && (
                <p className="text-[18px] tracking-[0.1em] text-[#8B5E00] mt-4">
                  TEST AS {view.firstName.toUpperCase()} — READ FROM HER REAL RECORDS
                </p>
              )}
              <div className="flex flex-wrap gap-x-7 gap-y-2 mt-6">
                {[
                  [c.pieces, 'pieces you own'],
                  [c.pictures, 'pictures you kept'],
                  [c.yes, 'looks you said yes to'],
                  [c.no, 'looks you turned down'],
                  [c.brands, 'brands you named'],
                ].filter(([n]) => (n as number) > 0).map(([n, label]) => (
                  <p key={label as string} className="text-[20px] text-[#2B2B2B]">
                    <span className="text-[26px]">{n as number}</span> <span className="text-[#6E6B65]">{label as string}</span>
                  </p>
                ))}
              </div>
            </div>
            <div className="text-[#2B2B2B]">
              <Tangle className="w-full h-auto" />
            </div>
          </div>
        </section>

        {view.error && <p className="text-[20px] text-[#B83A3A] text-center">{view.error}</p>}

        {/* The threads themselves */}
        <div className="grid md:grid-cols-2 2xl:grid-cols-3 gap-4">
          {view.threads.map((t) => (
            <article key={t.id} className="rounded-[18px] bg-white/85 shadow-[0_2px_14px_rgba(43,43,43,0.08)] px-7 py-7 flex flex-col gap-4">
              <div className="flex items-start justify-between gap-4">
                <h2 className="text-[24px] text-[#2B2B2B] leading-tight">{t.title}</h2>
                {/* How many places agree — a thread pulled from three is a strong one. */}
                <span className="flex gap-1 shrink-0 pt-2" title={`${t.strength} source${t.strength === 1 ? '' : 's'} agree`}>
                  {[0, 1, 2].map((i) => (
                    <span key={i} className={`block w-2.5 h-2.5 rounded-full ${i < t.strength ? 'bg-[#2B2B2B]' : 'bg-[rgba(43,43,43,0.15)]'}`} />
                  ))}
                </span>
              </div>
              <p className="text-[22px] text-[#4A4E57] leading-snug">{t.line}</p>
              <dl className="mt-auto space-y-2 border-t border-[rgba(43,43,43,0.12)] pt-4">
                {t.evidence.map((e, i) => (
                  <div key={i} className="flex flex-wrap gap-x-3">
                    <dt className="text-[19px] tracking-[0.06em] text-[#6E6B65]">{e.from}</dt>
                    <dd className="text-[19px] text-[#2B2B2B]">{e.detail}</dd>
                  </div>
                ))}
              </dl>
            </article>
          ))}
        </div>

        {/* Where the weave is still thin */}
        {view.thin.length > 0 && (
          <section className="rounded-[18px] bg-white/85 shadow-[0_2px_14px_rgba(43,43,43,0.08)] px-8 py-7">
            <p className="text-[20px] tracking-[0.16em] text-[#6E6B65]">STILL THIN</p>
            <ul className="mt-4 space-y-2">
              {view.thin.map((t, i) => (
                <li key={i} className="text-[21px] text-[#4A4E57]">{t}</li>
              ))}
            </ul>
          </section>
        )}

        <p className="text-[19px] text-[#6E6B65] text-center">
          Read fresh from your own records each time you open it. Nothing here is kept apart from what you have already given MYRA.
        </p>
      </div>
    </div>
  )
}
