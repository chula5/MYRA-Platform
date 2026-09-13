'use client'

// HER WARDROBE — the drawer from the old home page, pulled out from the right,
// but hung with her own things.
//
// The feed's wardrobe reads `saved_outfit` against the public outfit table.
// Her looks are `pilot_look` rows, so the outfit half of that would always be
// empty for her. The honest equivalent is what she has already told us: the
// looks she said she would wear. Saved PIECES need no translation — they are
// the same `item` rows, saved through the same action, so that half is the
// existing feature untouched.

import { useEffect, useState } from 'react'
import { getWardrobe, toggleSaveItem, type WardrobeItem } from '@/app/edit/save-actions'
import type { ClientLook } from './actions'

function fmtPrice(price: string | null, currency: string | null): string {
  if (!price) return ''
  const sym: Record<string, string> = { GBP: '£', USD: '$', EUR: '€', AUD: 'A$', CAD: 'C$', JPY: '¥' }
  const s = sym[currency ?? 'GBP'] ?? ''
  return `${s}${String(price).replace(/\.00$/, '')}`
}

export function HangerIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 4.5a1.6 1.6 0 0 0-1.6 1.6c0 .9.7 1.5 1.6 1.9L21 13H3l9-5" />
    </svg>
  )
}

export default function ClientWardrobe({
  loved,
  onOpenLook,
  // Saved PIECES are scoped to whoever is signed in, so in the admin mirror
  // they would be Chloe's, not hers. The mirror shows the drawer and the looks
  // half only — better an honest gap than someone else's wardrobe.
  readOnly = false,
}: {
  loved: ClientLook[]
  onOpenLook?: (look: ClientLook) => void
  readOnly?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<WardrobeItem[]>([])

  async function load() {
    if (readOnly) { setLoading(false); return }
    setLoading(true)
    const w = await getWardrobe()
    setItems(w.items)
    setLoading(false)
  }

  useEffect(() => { load() }, [])
  useEffect(() => { if (open) load() }, [open])
  useEffect(() => {
    const openIt = () => setOpen(true)
    const saved = () => { if (open) load() }
    window.addEventListener('myra:open-wardrobe', openIt)
    window.addEventListener('myra:item-saved', saved)
    return () => {
      window.removeEventListener('myra:open-wardrobe', openIt)
      window.removeEventListener('myra:item-saved', saved)
    }
  }, [open])

  const count = loved.length + items.length

  async function removeItem(id: string) {
    setItems((i) => i.filter((x) => x.item_id !== id))
    await toggleSaveItem(id)
  }

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Open my wardrobe"
          className="fixed right-0 top-1/2 -translate-y-1/2 z-[55] flex flex-col items-center gap-2 bg-white border border-r-0 border-[#E2E0DB] rounded-l-[16px] px-2.5 py-4 shadow-[-4px_0_14px_rgba(0,0,0,0.07)] hover:pr-3.5 transition-all duration-300"
        >
          <HangerIcon className="w-4 h-4 text-[#4A4E57]" />
          <span className="text-[9px] tracking-[0.16em] text-[#4A4E57] [writing-mode:vertical-rl] rotate-180">WARDROBE</span>
          {count > 0 && (
            <span className="text-[9px] text-white bg-[#C8302A] rounded-full min-w-[16px] h-[16px] px-1 flex items-center justify-center leading-none">
              {count}
            </span>
          )}
        </button>
      )}

      <div className={`fixed inset-0 z-50 ${open ? '' : 'pointer-events-none'}`}>
        <div
          onClick={() => setOpen(false)}
          className={`absolute inset-0 bg-black/30 transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0'}`}
        />
        <aside
          className={`absolute right-0 top-0 h-full w-[min(390px,92vw)] bg-[#FAFAF8] shadow-2xl flex flex-col transition-transform duration-300 ${open ? 'translate-x-0' : 'translate-x-full'}`}
        >
          <div className="bg-[#2B2B2B] text-white px-5 h-12 flex items-center justify-between flex-shrink-0">
            <span className="text-[13px] tracking-[0.18em] inline-flex items-center gap-2">
              <HangerIcon className="w-4 h-4" /> MY WARDROBE
            </span>
            <button onClick={() => setOpen(false)} aria-label="Close" className="text-white/70 hover:text-white text-[22px] leading-none">×</button>
          </div>

          <div data-lenis-prevent className="flex-1 overflow-y-auto px-5 py-5">
            {loading && count === 0 ? (
              <p className="text-[14px] text-[#A8A8A4] py-16 text-center">Opening your wardrobe…</p>
            ) : count === 0 ? (
              <div className="py-16 text-center">
                <HangerIcon className="w-7 h-7 text-[#D8D2C6] mx-auto mb-4" />
                <p className="text-[14px] text-[#8C8A85] leading-relaxed max-w-[240px] mx-auto">
                  Your wardrobe is empty. Say you would wear a look, or tap the{' '}
                  <span className="text-[#C8302A]">♥</span> on a piece in Source Items, to hang it here.
                </p>
              </div>
            ) : (
              <>
                {loved.length > 0 && (
                  <section className="mb-8">
                    <p className="text-[13px] tracking-[0.14em] text-[#8C8A85] uppercase mb-3">
                      Looks you loved · {loved.length}
                    </p>
                    <div className="grid grid-cols-2 gap-2.5">
                      {loved.map((l) => (
                        <button
                          key={l.look_id}
                          onClick={() => { setOpen(false); onOpenLook?.(l) }}
                          className="group relative aspect-[3/4] overflow-hidden bg-[#EDEDED] text-left"
                        >
                          {l.image_url && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={l.image_url} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                          )}
                          <span className="absolute inset-x-0 bottom-0 px-2 py-1.5 bg-gradient-to-t from-black/60 to-transparent text-white text-[12px] tracking-[0.08em]">
                            {l.occasion_label}
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                )}

                {items.length > 0 && !readOnly && (
                  <section>
                    <p className="text-[13px] tracking-[0.14em] text-[#8C8A85] uppercase mb-3">
                      Pieces you saved · {items.length}
                    </p>
                    <div className="space-y-3">
                      {items.map((it) => (
                        <div key={it.item_id} className="flex items-center gap-3">
                          {it.image_url && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={it.image_url} alt="" className="w-14 aspect-[3/4] object-cover shrink-0 bg-[#EDEDED]" />
                          )}
                          <div className="min-w-0 flex-1">
                            {it.brand_name && (
                              <p className="text-[12px] tracking-[0.1em] text-[#8C8A85] uppercase truncate">{it.brand_name}</p>
                            )}
                            <p className={`text-[15px] text-[#2B2B2B] truncate ${it.sold ? 'line-through opacity-60' : ''}`}>
                              {it.product_name}
                            </p>
                            <p className="text-[14px] text-[#55534E]">
                              {it.sold ? 'Sold' : fmtPrice(it.price, it.currency)}
                              {it.unique && !it.sold && <span className="text-[#8A7340]"> · one of one</span>}
                            </p>
                            {it.retailer_url && !it.sold && (
                              <a href={it.retailer_url} target="_blank" rel="noopener noreferrer" className="text-[13px] tracking-[0.08em] uppercase text-[#2B2B2B] underline underline-offset-2">
                                Shop it
                              </a>
                            )}
                          </div>
                          <button
                            onClick={() => removeItem(it.item_id)}
                            aria-label="Remove from wardrobe"
                            className="text-[#C8302A] text-[17px] leading-none shrink-0 hover:opacity-60"
                          >
                            ♥
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
        </aside>
      </div>
    </>
  )
}
