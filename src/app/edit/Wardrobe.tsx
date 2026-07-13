'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  getWardrobe,
  toggleSaveOutfit,
  toggleSaveItem,
  type WardrobeOutfit,
  type WardrobeItem,
} from './save-actions'
import { affiliateUrl } from '@/lib/affiliate'

function fmtPrice(price: string | null, currency: string | null): string {
  if (!price) return ''
  const sym: Record<string, string> = { GBP: '£', USD: '$', EUR: '€', AUD: 'A$', CAD: 'C$', JPY: '¥' }
  const s = sym[currency ?? 'GBP'] ?? ''
  const clean = String(price).replace(/\.00$/, '')
  return s ? `${s}${clean}` : clean
}

function HangerIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 4.5a1.6 1.6 0 0 0-1.6 1.6c0 .9.7 1.5 1.6 1.9L21 13H3l9-5" />
    </svg>
  )
}

export default function Wardrobe() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [outfits, setOutfits] = useState<WardrobeOutfit[]>([])
  const [items, setItems] = useState<WardrobeItem[]>([])

  async function load() {
    setLoading(true)
    const w = await getWardrobe()
    setOutfits(w.outfits)
    setItems(w.items)
    setLoading(false)
  }

  useEffect(() => { load() }, [])
  useEffect(() => { if (open) load() }, [open])
  // Open from the header "MY WARDROBE" button (or anywhere).
  useEffect(() => {
    const openIt = () => setOpen(true)
    window.addEventListener('myra:open-wardrobe', openIt)
    return () => window.removeEventListener('myra:open-wardrobe', openIt)
  }, [])

  const count = outfits.length + items.length

  async function removeOutfit(id: string) {
    setOutfits((o) => o.filter((x) => x.outfit_id !== id))
    await toggleSaveOutfit(id)
  }
  async function removeItem(id: string) {
    setItems((i) => i.filter((x) => x.item_id !== id))
    await toggleSaveItem(id)
  }

  return (
    <>
      {/* Right-edge handle */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Open my wardrobe"
          className="fixed right-0 top-1/2 -translate-y-1/2 z-[55] flex flex-col items-center gap-2 bg-white border border-r-0 border-[#E2E0DB] rounded-l-[16px] px-2.5 py-4 shadow-[-4px_0_14px_rgba(0,0,0,0.07)] hover:pr-3.5 transition-all duration-300"
        >
          <HangerIcon className="w-4 h-4 text-[#4A4E57]" />
          <span className="text-[8px] tracking-[0.16em] text-[#4A4E57] [writing-mode:vertical-rl] rotate-180">WARDROBE</span>
          {count > 0 && (
            <span className="text-[8px] tracking-[0.04em] text-white bg-[#C8302A] rounded-full min-w-[15px] h-[15px] px-1 flex items-center justify-center leading-none">
              {count}
            </span>
          )}
        </button>
      )}

      {/* Backdrop + sliding panel */}
      <div className={`fixed inset-0 z-50 ${open ? '' : 'pointer-events-none'}`}>
        <div
          onClick={() => setOpen(false)}
          className={`absolute inset-0 bg-black/30 transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0'}`}
        />
        <aside
          className={`absolute right-0 top-0 h-full w-[min(390px,92vw)] bg-[#FAFAF8] shadow-2xl flex flex-col transition-transform duration-300 ${open ? 'translate-x-0' : 'translate-x-full'}`}
        >
          {/* Wardrobe top frame */}
          <div className="bg-[#2B2B2B] text-white px-5 h-12 flex items-center justify-between flex-shrink-0">
            <span className="text-[11px] tracking-[0.18em] inline-flex items-center gap-2">
              <HangerIcon className="w-4 h-4" /> MY WARDROBE
            </span>
            <button onClick={() => setOpen(false)} aria-label="Close" className="text-white/70 hover:text-white text-[20px] leading-none">×</button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-5">
            {loading ? (
              <p className="text-[10px] tracking-[0.14em] text-[#A8A8A4] py-16 text-center">OPENING YOUR WARDROBE…</p>
            ) : count === 0 ? (
              <div className="py-16 text-center">
                <HangerIcon className="w-7 h-7 text-[#D8D2C6] mx-auto mb-4" />
                <p className="text-[10px] tracking-[0.1em] text-[#A8A8A4] leading-relaxed max-w-[220px] mx-auto">
                  YOUR WARDROBE IS EMPTY. TAP THE <span className="text-[#C8302A]">♥</span> ON AN OUTFIT OR ON ANY ITEM IN SHOP THE LOOK TO HANG IT HERE.
                </p>
              </div>
            ) : (
              <>
                {/* ── TOP COMPARTMENT: saved looks, hanging on the rail ── */}
                <div className="mb-7">
                  <p className="text-[9px] tracking-[0.16em] text-[#6B6B6B] mb-3">SAVED LOOKS · {outfits.length}</p>
                  {outfits.length === 0 ? (
                    <p className="text-[9px] tracking-[0.08em] text-[#A8A8A4] leading-relaxed py-3">
                      No saved looks yet — tap <span className="text-[#C8302A]">♥</span> on an outfit.
                    </p>
                  ) : (
                    <div className="relative">
                      {/* the rail */}
                      <div className="absolute left-1 right-1 top-0 h-[2px] bg-gradient-to-r from-[#C9AE80] via-[#B89A6E] to-[#C9AE80] rounded-full" />
                      <div className="grid grid-cols-3 gap-2.5 pt-0">
                        {outfits.map((o) => (
                          <div key={o.outfit_id} className="relative group">
                            {/* hanger stem from the rail */}
                            <div className="w-[1px] h-2.5 bg-[#B89A6E] mx-auto" />
                            <button
                              onClick={() => { setOpen(false); router.push(`/edit/${o.outfit_id}`) }}
                              className="block w-full aspect-[3/4] overflow-hidden bg-[#EDEDED] border border-[#E2E0DB]"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={o.image_url || '/placeholder-outfit.jpg'} alt="" className="w-full h-full object-cover" />
                            </button>
                            <button
                              onClick={() => removeOutfit(o.outfit_id)}
                              aria-label="Remove"
                              className="absolute top-2.5 right-1 w-4 h-4 rounded-full bg-white/90 text-[#6B6B6B] text-[10px] leading-none flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* divider between the two wardrobe compartments */}
                <div className="border-t border-dashed border-[#E2E0DB]" />

                {/* ── BOTTOM COMPARTMENT: saved items, on the shelf ── */}
                <div className="mt-6">
                  <p className="text-[9px] tracking-[0.16em] text-[#6B6B6B] mb-2">SAVED ITEMS · {items.length}</p>
                  <div className="h-[3px] bg-gradient-to-r from-[#E0DACD] to-[#D8D2C6] rounded-full mb-3" />
                  {items.length === 0 ? (
                    <p className="text-[9px] tracking-[0.08em] text-[#A8A8A4] leading-relaxed py-1">
                      No saved items yet — tap <span className="text-[#C8302A]">♥</span> on an item in Shop The Look.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {items.map((it) => (
                        <div key={it.item_id} className="flex items-stretch gap-2.5 bg-white rounded-[12px] border border-[#E2E0DB] p-2">
                          <div className="relative w-[40px] h-[54px] flex-shrink-0 rounded-[8px] overflow-hidden bg-[#F2F2F2]">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={it.image_url || '/placeholder-outfit.jpg'} alt="" className="w-full h-full object-cover" />
                          </div>
                          <div className="flex-1 min-w-0 flex flex-col">
                            <p className="text-[8px] tracking-[0.07em] text-[#6B6B6B] uppercase truncate">{it.brand_name ?? 'BRAND'}</p>
                            <p className="text-[10px] leading-[1.2] text-[#4A4E57] line-clamp-2">{it.product_name}</p>
                            <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                              <span className="text-[10px] text-[#4A4E57]">{fmtPrice(it.price, it.currency)}</span>
                              {it.retailer_url && (
                                <a
                                  href={affiliateUrl(it.retailer_url, { brandName: it.brand_name, contentId: it.item_id })}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="bg-[#0A0A0A] text-white text-[8px] tracking-[0.06em] px-2 py-0.5 rounded hover:opacity-85 transition-opacity"
                                >
                                  SHOP
                                </a>
                              )}
                            </div>
                          </div>
                          <button
                            onClick={() => removeItem(it.item_id)}
                            aria-label="Remove"
                            className="self-start text-[#C4C4C0] hover:text-[#6B6B6B] text-[14px] leading-none"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </aside>
      </div>
    </>
  )
}
