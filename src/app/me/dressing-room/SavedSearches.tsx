'use client'

// YOUR SEARCHES — the searches she kept in Browse, and what MYRA has found for
// each since (lib/saved-search: re-run every hour as new pieces come in).
// Opening one goes to Browse with what is new first; letting one go stops the looking.

import Link from 'next/link'
import { useEffect, useState } from 'react'
import FallbackImage from '@/components/FallbackImage'
import { listMySearches, removeSearch, type SavedSearchView } from '@/app/me/browse/saved-search-actions'

const CARD = 'bg-white/85 shadow-[0_2px_14px_rgba(43,43,43,0.08)] rounded-[18px]'

export default function SavedSearches({ testMemberId }: { testMemberId?: string }) {
  const [searches, setSearches] = useState<SavedSearchView[] | null>(null)
  useEffect(() => {
    let live = true
    listMySearches(testMemberId).then((r) => { if (live) setSearches(r.searches) }).catch(() => { if (live) setSearches([]) })
    return () => { live = false }
  }, [testMemberId])

  async function forget(id: string) {
    setSearches((cur) => (cur ?? []).filter((s) => s.id !== id))
    await removeSearch(id, testMemberId).catch(() => { /* gone from view either way */ })
  }

  if (searches === null) return null
  if (!searches.length) {
    return (
      <section className={`${CARD} px-6 sm:px-8 py-10 text-center`}>
        <p className="text-[21px] xl:text-[24px] 2xl:text-[28px] text-[#4A4E57]">
          No searches kept yet. Search in Browse — a navy cami, wide-leg trousers — and tap SAVE THIS SEARCH. MYRA keeps looking and puts what she finds here.
        </p>
        <Link href="/me/browse" className="inline-block mt-6 text-[19px] xl:text-[22px] tracking-[0.08em] px-7 py-3.5 bg-[#2B2B2B] text-white rounded-full">GO TO BROWSE</Link>
      </section>
    )
  }

  return (
    <div className="space-y-6">
      {searches.map((s) => (
        <section key={s.id} className={`${CARD} px-5 sm:px-7 py-6`}>
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <p className="text-[20px] xl:text-[24px] text-[#2B2B2B] mr-auto">
              “{s.query}”
              {s.fresh > 0 && <span className="ml-3 align-middle text-[15px] xl:text-[17px] tracking-[0.12em] rounded-full bg-[#7C838B] text-white px-3 py-1">{s.fresh} NEW</span>}
            </p>
            <Link
              href={`/me/browse?saved=${encodeURIComponent(s.id)}`}
              className="text-[16px] xl:text-[19px] tracking-[0.08em] rounded-full bg-[#2B2B2B] text-white px-6 py-3"
            >
              {s.fresh > 0 ? 'SEE WHAT’S NEW' : 'OPEN'}
            </Link>
            <button
              type="button"
              onClick={() => void forget(s.id)}
              className="text-[16px] xl:text-[19px] tracking-[0.08em] text-[#6E6B65] underline underline-offset-4"
            >
              Stop looking
            </button>
          </div>
          {s.shopNote && <p className="text-[15px] xl:text-[17px] tracking-[0.12em] text-[#7C838B] -mt-1 mb-4">{s.shopNote}</p>}
          {s.pieces.length > 0 ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 xl:grid-cols-6 gap-3">
              {s.pieces.slice(0, 6).map((p) => (
                <Link key={p.item_id} href={`/me/browse?saved=${encodeURIComponent(s.id)}`} className="block bg-white rounded-[14px] overflow-hidden shadow-[0_1px_8px_rgba(43,43,43,0.06)]">
                  <div className="relative aspect-[3/4] bg-[#F3F2F0] overflow-hidden">
                    {p.image_url && <FallbackImage src={p.image_url} thumbWidth={400} alt={p.product_name} className="absolute inset-0 w-full h-full object-cover" />}
                    {p.fresh && <span className="absolute top-2 left-2 rounded-full bg-[#7C838B] text-white px-2.5 py-0.5 text-[13px] tracking-[0.12em]">NEW</span>}
                  </div>
                  <div className="px-2.5 py-2">
                    {p.brand && <p className="text-[13px] xl:text-[15px] tracking-[0.1em] text-[#6E6B65] truncate">{p.brand.toUpperCase()}</p>}
                    {p.price_gbp != null && <p className="text-[15px] xl:text-[17px] text-[#2B2B2B]">£{Math.round(p.price_gbp)}</p>}
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-[18px] xl:text-[21px] text-[#4A4E57]">MYRA is looking. New pieces land here as the shops bring them in.</p>
          )}
        </section>
      ))}
    </div>
  )
}
