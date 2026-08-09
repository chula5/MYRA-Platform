'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { thumbUrl } from '@/lib/image-utils'
import {
  runStockSentinel,
  getHeroReplacementOptions,
  applyHeroReplacement,
  type PausedSet,
  type HeroReplacementOption,
} from './stock-sentinel'

// Styling sets paused because their HERO died. One replacement decision applies
// across the whole set, then each variant re-renders sequentially.
export default function SetStockPanel({ pausedSets }: { pausedSets: PausedSet[] }) {
  const router = useRouter()
  const [running, setRunning] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [pickerFor, setPickerFor] = useState<string | null>(null)
  const [options, setOptions] = useState<HeroReplacementOption[]>([])
  const [loadingOpts, setLoadingOpts] = useState(false)
  const [applying, setApplying] = useState(false)

  async function sweep() {
    setRunning(true)
    const r = await runStockSentinel()
    setRunning(false)
    setMsg(
      r.error
        ? r.error.toUpperCase()
        : `SENTINEL: ${r.heroSetsPaused} SET${r.heroSetsPaused === 1 ? '' : 'S'} PAUSED (HERO DEAD) · ${r.variantsPaused} VARIANT${r.variantsPaused === 1 ? '' : 'S'} PAUSED · ${r.setsUnderStyled} NOW UNDER-STYLED`,
    )
    router.refresh()
  }

  async function openPicker(setId: string) {
    setPickerFor(setId)
    setLoadingOpts(true)
    const r = await getHeroReplacementOptions(setId)
    setOptions(r.options)
    setLoadingOpts(false)
  }

  async function pick(setId: string, itemId: string) {
    setApplying(true)
    const r = await applyHeroReplacement(setId, itemId)
    setApplying(false)
    setPickerFor(null)
    setMsg(r.error ? r.error.toUpperCase() : `HERO REPLACED ACROSS ${r.swapped} VARIANTS — RE-RENDERING SEQUENTIALLY IN THE BACKGROUND.`)
    router.refresh()
  }

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] tracking-[0.135em] text-[#6B6B6B]">STYLING SETS · STOCK SENTINEL</p>
        <button
          onClick={sweep}
          disabled={running}
          className="border border-[#0A0A0A] text-[#4A4E57] px-4 py-1.5 text-[9px] tracking-[0.14em] rounded-full hover:bg-[#0A0A0A] hover:text-white transition-colors disabled:opacity-50"
        >
          {running ? 'SWEEPING…' : '▶ RUN SENTINEL SWEEP'}
        </button>
      </div>
      {msg && <p className="text-[9px] tracking-[0.1em] text-[#C4A882] mb-3">{msg}</p>}

      {pausedSets.length === 0 ? (
        <p className="text-[10px] tracking-[0.08em] text-[#A8A8A4]">NO SETS PAUSED — HERO ITEMS ARE ALL IN STOCK.</p>
      ) : (
        <div className="space-y-3">
          {pausedSets.map((s) => (
            <div key={s.styling_set_id} className="border border-[#E8B4B4] bg-[#FDF6F6] rounded-[12px] p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-13 rounded-[6px] overflow-hidden bg-[#F2F2F0] flex-shrink-0" style={{ height: 52 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {s.hero_image && <img src={thumbUrl(s.hero_image, 300)} alt="" className="w-full h-full object-cover" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] tracking-[0.06em] text-[#4A4E57] truncate">
                    {[s.hero_brand, s.hero_name].filter(Boolean).join(' — ').toUpperCase()}
                  </p>
                  <p className="text-[8px] tracking-[0.08em] text-[#B83A3A]">
                    HERO OUT OF STOCK · {s.variant_count} VARIANT{s.variant_count === 1 ? '' : 'S'} PAUSED TOGETHER
                  </p>
                </div>
                <button
                  onClick={() => openPicker(s.styling_set_id)}
                  className="bg-[#0A0A0A] text-white px-4 py-2 text-[9px] tracking-[0.12em] rounded-full hover:opacity-85"
                >
                  REPLACE HERO ONCE →
                </button>
              </div>

              {pickerFor === s.styling_set_id && (
                <div className="mt-4 border-t border-[#E8B4B4]/50 pt-4">
                  <p className="text-[8px] tracking-[0.1em] text-[#6B6B6B] mb-3">
                    ONE DECISION — THE REPLACEMENT APPLIES ACROSS THE WHOLE SET, THEN EACH VARIANT RE-RENDERS.
                  </p>
                  {loadingOpts ? (
                    <p className="text-[9px] tracking-[0.1em] text-[#A8A8A4] py-4">LOADING REPLACEMENTS…</p>
                  ) : (
                    <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2">
                      {options.map((opt) => (
                        <button key={opt.item_id} onClick={() => pick(s.styling_set_id, opt.item_id)} disabled={applying} className="text-left group disabled:opacity-50">
                          <div className="aspect-[3/4] rounded-[6px] overflow-hidden bg-[#F2F2F0]">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={thumbUrl(opt.image_url, 300)} alt="" className="w-full h-full object-cover group-hover:opacity-85" />
                          </div>
                          <p className="text-[7px] tracking-[0.06em] text-[#6B6B6B] mt-0.5 truncate">{(opt.brand_name ?? '').toUpperCase()}</p>
                          <p className="text-[7px] tracking-[0.04em] text-[#4A4E57] truncate">{opt.product_name}</p>
                          <p className="text-[7px] text-[#A8A8A4]">{(opt.compat * 100).toFixed(0)}</p>
                        </button>
                      ))}
                      {options.length === 0 && <p className="col-span-full text-[9px] tracking-[0.1em] text-[#A8A8A4] py-3">NO IN-STOCK REPLACEMENTS IN THIS SLOT.</p>}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
