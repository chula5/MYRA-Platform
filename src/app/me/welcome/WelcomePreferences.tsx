'use client'

// STEP TWO of her welcome: check the few things MYRA cannot guess — her sizes,
// what she actually dresses for, and the brands she loves. Her stylist has already filled these in, so this is
// a confirmation, not a form: she changes what is wrong and goes in. Skipping is
// allowed; everything here also lives on her YOU page.

import { useEffect, useState } from 'react'
import { loadMySettings, saveMySettings, type YouSizes } from '../settings-actions'
import { SIZE_CATEGORIES, ladderFor, type SizeCategory } from '@/lib/size-canonical'
import { OCCASION_TYPES } from '@/lib/pilot-stylist'

const SIZE_LABEL: Record<SizeCategory, string> = {
  tops: 'Tops & dresses', bottoms: 'Trousers & skirts', outerwear: 'Coats & jackets', shoes: 'Shoes',
}
const BODY = 'text-[clamp(20px,1.15vw,32px)]'
const FIELD = 'rounded-full bg-white px-5 py-3 text-[clamp(20px,1.1vw,28px)] text-[#2B2B2B] shadow-[0_10px_18px_-12px_rgba(120,120,120,0.6)] outline-none'

export default function WelcomePreferences({
  previewMemberId, firstName, onDone,
}: {
  previewMemberId?: string
  firstName?: string
  /** She is finished with this step — go into the platform. */
  onDone: () => void
}) {
  const [sizes, setSizes] = useState<Record<SizeCategory, YouSizes> | null>(null)
  const [brands, setBrands] = useState<string[]>([])
  const [adding, setAdding] = useState('')
  const [occasions, setOccasions] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void loadMySettings(previewMemberId).then((v) => {
      if (!live || !v) return
      setSizes(v.sizes); setBrands(v.brands); setOccasions(v.occasions)
    }).catch(() => undefined)
    return () => { live = false }
  }, [previewMemberId])

  const setSize = (c: SizeCategory, key: keyof YouSizes, v: string) =>
    setSizes((cur) => ({ ...cur!, [c]: { ...cur![c], [key]: v === '' ? null : Number(v) } }))

  const addBrand = () => {
    const name = adding.trim()
    if (!name) return
    if (!brands.some((b) => b.toLowerCase() === name.toLowerCase())) setBrands([...brands, name])
    setAdding('')
  }

  async function saveAndGo() {
    setSaving(true); setErr(null)
    const r = await saveMySettings({ ...(sizes ? { sizes } : {}), brands, occasions }, previewMemberId)
    setSaving(false)
    if (r.error) { setErr(r.error); return }
    onDone()
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center px-4 py-8" role="dialog" aria-modal="true" aria-label="Your sizes and brands">
      <div className="absolute inset-0 bg-[rgba(20,20,20,0.55)]" onClick={onDone} />
      <div data-lenis-prevent className="relative w-full max-w-[1100px] max-h-full overflow-y-auto myra-pearl rounded-[26px] shadow-[0_24px_70px_rgba(0,0,0,0.35)] px-7 sm:px-12 py-9 sm:py-12 space-y-8">
        <header className="space-y-3 text-center">
          <p className="text-[clamp(18px,1vw,26px)] tracking-[0.2em] text-[#6E6B65]">STEP 2 OF 2</p>
          <h2 className="text-[clamp(30px,2.6vw,60px)] leading-tight text-[#2B2B2B]">
            {firstName ? `${firstName}, just checking a few things` : 'Just checking a few things'}
          </h2>
          <p className={`${BODY} text-[#4A4E57]`}>Your stylist has filled these in. Change anything that isn’t right.</p>
        </header>

        <section className="rounded-[20px] bg-white/80 px-6 sm:px-8 py-7 space-y-5">
          <h3 className="text-[clamp(24px,1.5vw,38px)] text-[#2B2B2B]">Your sizes <span className="text-[#A8A8A4]">(UK)</span></h3>
          {!sizes ? (
            <p className={`${BODY} text-[#6E6B65]`}>Reading your sizes…</p>
          ) : (
            <div className="space-y-4">
              {SIZE_CATEGORIES.map((c) => (
                <div key={c} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3">
                  <span className={`${BODY} text-[#55534E]`}>{SIZE_LABEL[c]}</span>
                  <select aria-label={`${SIZE_LABEL[c]} size`} className={`${FIELD} w-[132px]`} value={sizes[c].value ?? ''} onChange={(e) => setSize(c, 'value', e.target.value)}>
                    <option value="">—</option>
                    {ladderFor(c).map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                  <select aria-label={`${SIZE_LABEL[c]} — also wears`} className={`${FIELD} w-[168px]`} value={sizes[c].adjacent ?? ''} onChange={(e) => setSize(c, 'adjacent', e.target.value)} disabled={sizes[c].value == null}>
                    <option value="">or also…</option>
                    {ladderFor(c).filter((n) => n !== sizes[c].value).map((n) => <option key={n} value={n}>also {n}</option>)}
                  </select>
                </div>
              ))}
            </div>
          )}
          <p className={`${BODY} text-[#6E6B65]`}>MYRA only shows you pieces it can find in your size.</p>
        </section>

        <section className="rounded-[20px] bg-white/80 px-6 sm:px-8 py-7 space-y-5">
          <h3 className="text-[clamp(24px,1.5vw,38px)] text-[#2B2B2B]">What you dress for</h3>
          <p className={`${BODY} text-[#6E6B65]`}>Tap the ones that are part of your life. MYRA only styles for these.</p>
          <div className="flex flex-wrap gap-2.5">
            {OCCASION_TYPES.map((o) => {
              const on = occasions.includes(o.id)
              const label = o.label.toLowerCase().replace(/(^|\s|\/|—)\S/g, (m) => m.toUpperCase())
              return (
                <button key={o.id} type="button" aria-pressed={on}
                  onClick={() => setOccasions(on ? occasions.filter((x) => x !== o.id) : [...occasions, o.id])}
                  className={`rounded-full px-5 py-2.5 ${BODY} transition-colors ${on ? 'bg-[#2B2B2B] text-white' : 'bg-white text-[#55534E] shadow-[0_8px_18px_-12px_rgba(43,43,43,0.5)]'}`}>
                  {on ? '✓ ' : ''}{label}
                </button>
              )
            })}
          </div>
        </section>

        <section className="rounded-[20px] bg-white/80 px-6 sm:px-8 py-7 space-y-5">
          <h3 className="text-[clamp(24px,1.5vw,38px)] text-[#2B2B2B]">Brands you love</h3>
          <div className="flex flex-wrap gap-2.5">
            {brands.map((b) => (
              <button key={b} type="button" onClick={() => setBrands(brands.filter((x) => x !== b))}
                aria-label={`Remove ${b}`}
                className={`rounded-full px-5 py-2.5 ${BODY} bg-[#2B2B2B] text-white`}>
                {b} <span className="opacity-60">×</span>
              </button>
            ))}
            {!brands.length && <p className={`${BODY} text-[#6E6B65]`}>No brands yet — add the ones you buy most.</p>}
          </div>
          <div className="flex flex-wrap gap-3">
            <input
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addBrand() } }}
              placeholder="Add a brand"
              className={`${FIELD} flex-1 min-w-[220px]`}
            />
            <button type="button" onClick={addBrand} className={`${BODY} px-[1.4em] py-[0.6em] rounded-full bg-white text-[#2B2B2B] shadow-[0_8px_18px_-12px_rgba(43,43,43,0.5)]`}>Add</button>
          </div>
          <p className={`${BODY} text-[#6E6B65]`}>MYRA looks here first, and keeps finding you others like them.</p>
        </section>

        {err && <p className={`${BODY} text-[#9B3A3A] text-center`}>{err}</p>}

        <div className="flex flex-wrap items-center justify-center gap-5">
          <button type="button" onClick={saveAndGo} disabled={saving}
            className="text-[clamp(24px,1.5vw,44px)] tracking-[0.1em] px-[1.6em] py-[0.6em] bg-[#2B2B2B] text-white rounded-full disabled:opacity-40">
            {saving ? 'Saving…' : 'That’s right — show me around →'}
          </button>
          <button type="button" onClick={onDone} className="text-[clamp(20px,1.1vw,30px)] underline underline-offset-4 text-[#6E6B65]">Skip for now</button>
        </div>
      </div>
    </div>
  )
}
