'use client'

import { useEffect, useState } from 'react'
import { submitApplication } from '@/app/apply/actions'

// The APPLY NOW pop-out. Opens on the 'myra:open-apply' event (fired by every
// ApplyButton). A few taste questions so Chloe can get a feel for the person's
// style before accepting them into a personal edit. Answers (brands, price
// range, inspirations) are saved via submitApplication → the application table.
const PRICE_RANGES = [
  'Under £150 a piece',
  '£150 – 400 a piece',
  '£400 – 800 a piece',
  '£800+ a piece',
  'A mix — no set budget',
]

// A starting list to click from; they can also type any brand not listed.
const BRAND_OPTIONS = [
  'Isabel Marant', 'The Row', 'Totême', 'Khaite', 'Ganni', 'Anine Bing',
  'Reformation', 'Sézane', 'Zimmermann', 'Staud', 'Nanushka', 'Cult Gaia',
  'Jacquemus', 'Loewe', 'Bottega Veneta', 'Saint Laurent', 'Chloé', 'Celine',
  'Prada', 'Miu Miu', 'Max Mara', 'Frame', 'AGOLDE', 'Citizens of Humanity',
  'Vince', 'Theory', 'Aritzia', 'Rouje', 'ME+EM', 'Sandro', 'Maje', 'Ba&sh',
  'Rixo', 'Realisation Par', 'Faithfull the Brand', 'Posse', 'Djerf Avenue',
  'COS', 'Arket', '& Other Stories', 'Massimo Dutti', 'Twinset', 'Diesel',
  'DeMellier', 'Cami NYC', 'Skims', 'With Nothing Underneath',
]

const EMPTY = { name: '', email: '', priceRange: '', inspiration: '', note: '' }

export default function ApplyModal() {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ ...EMPTY })
  const [brands, setBrands] = useState<string[]>([])
  const [q, setQ] = useState('')
  const [listOpen, setListOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onOpen = () => { setOpen(true); setDone(false); setError(null) }
    window.addEventListener('myra:open-apply', onOpen)
    return () => window.removeEventListener('myra:open-apply', onOpen)
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [open])

  if (!open) return null

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const addBrand = (b: string) => {
    const v = b.trim()
    if (v && !brands.some((x) => x.toLowerCase() === v.toLowerCase())) setBrands((s) => [...s, v])
    setQ('')
  }
  const removeBrand = (b: string) => setBrands((s) => s.filter((x) => x !== b))
  const query = q.trim().toLowerCase()
  const matches = BRAND_OPTIONS.filter(
    (b) => !brands.some((x) => x.toLowerCase() === b.toLowerCase()) && b.toLowerCase().includes(query),
  ).slice(0, 8)
  const canAddCustom =
    q.trim().length > 1 &&
    !BRAND_OPTIONS.some((b) => b.toLowerCase() === query) &&
    !brands.some((b) => b.toLowerCase() === query)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    const r = await submitApplication({ ...form, brands: brands.join(', ') })
    setBusy(false)
    if (r.error) setError(r.error)
    else { setDone(true); setForm({ ...EMPTY }); setBrands([]) }
  }

  const labelCls = 'block text-[13px] tracking-[0.14em] text-[#6B6B6B] mb-2 uppercase'
  const inputCls =
    'w-full border border-[#D8D5CE] bg-white px-4 py-3.5 text-[16px] text-[#0A0A0A] tracking-[0.02em] outline-none focus:border-[#0A0A0A] transition-colors placeholder:text-[#B4B4AE]'

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start sm:items-center justify-center p-4 sm:p-6 bg-black/40 overflow-y-auto"
      onClick={() => setOpen(false)}
    >
      <div
        className="relative w-full max-w-[760px] my-6 bg-[#FBFAF8] border border-[#2B2B2B] shadow-[0_30px_80px_rgba(0,0,0,0.25)] p-9 sm:p-14"
        onClick={(e) => e.stopPropagation()}
        data-lenis-prevent
      >
        <button
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="absolute top-4 right-5 text-[22px] leading-none text-[#4A4E57] hover:opacity-60 transition-opacity"
        >
          ×
        </button>

        {done ? (
          <div className="text-center py-8">
            <p className="text-[16px] tracking-[0.14em] text-[#0A0A0A] mb-3">THANK YOU</p>
            <p className="text-[14px] text-[#4A4E57] leading-[1.75] max-w-[420px] mx-auto">
              We&rsquo;ve got your application. If MYRA is right for your taste, we&rsquo;ll be in
              touch to set up your own personal edit — refined to you.
            </p>
            <button
              onClick={() => setOpen(false)}
              className="mt-8 rounded-full bg-[#0A0A0A] text-white px-8 py-3.5 text-[12px] tracking-[0.2em] hover:opacity-85 transition-opacity"
            >
              DONE
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-5">
            <div>
              <p className="text-[24px] sm:text-[27px] tracking-[0.06em] text-[#0A0A0A] mb-2.5">APPLY FOR YOUR PERSONAL EDIT</p>
              <p className="text-[15px] text-[#6B6B6B] leading-[1.65]">
                A few questions so we can get a feel for your style. If it&rsquo;s a fit, we&rsquo;ll
                build you a refined edit of your own.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Your name</label>
                <input className={inputCls} value={form.name} onChange={set('name')} placeholder="First & last" />
              </div>
              <div>
                <label className={labelCls}>Email</label>
                <input className={inputCls} type="email" required value={form.email} onChange={set('email')} placeholder="you@email.com" />
              </div>
            </div>

            {/* Brands — click from the list or type your own */}
            <div>
              <label className={labelCls}>Brands you love</label>
              {brands.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2.5">
                  {brands.map((b) => (
                    <button
                      key={b}
                      type="button"
                      onClick={() => removeBrand(b)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-[#0A0A0A] text-[#0A0A0A] px-3.5 py-1.5 text-[13px] tracking-[0.04em] hover:bg-[#0A0A0A] hover:text-white transition-colors"
                    >
                      {b} <span aria-hidden>×</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="relative">
                <input
                  className={inputCls}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onFocus={() => setListOpen(true)}
                  onBlur={() => setTimeout(() => setListOpen(false), 150)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      const pick = matches[0] ?? (canAddCustom ? q.trim() : '')
                      if (pick) addBrand(pick)
                    }
                  }}
                  placeholder="Search a brand, or type your own and press Enter"
                />
                {listOpen && (query.length > 0 || matches.length > 0) && (
                  <div
                    className="absolute z-10 left-0 right-0 mt-1 max-h-60 overflow-y-auto border border-[#D8D5CE] bg-white shadow-[0_16px_40px_rgba(0,0,0,0.14)]"
                    data-lenis-prevent
                  >
                    {matches.map((b) => (
                      <button
                        key={b}
                        type="button"
                        onMouseDown={(e) => { e.preventDefault(); addBrand(b) }}
                        className="w-full text-left px-4 py-2.5 text-[15px] text-[#0A0A0A] hover:bg-[#F1F0EC] transition-colors"
                      >
                        {b}
                      </button>
                    ))}
                    {canAddCustom && (
                      <button
                        type="button"
                        onMouseDown={(e) => { e.preventDefault(); addBrand(q.trim()) }}
                        className="w-full text-left px-4 py-2.5 text-[15px] text-[#8B5E00] hover:bg-[#F1F0EC] transition-colors"
                      >
                        + Add &ldquo;{q.trim()}&rdquo;
                      </button>
                    )}
                    {!matches.length && !canAddCustom && (
                      <p className="px-4 py-2.5 text-[14px] text-[#A8A8A4]">No matches — keep typing to add your own.</p>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div>
              <label className={labelCls}>Price range you shop</label>
              <select className={inputCls} value={form.priceRange} onChange={set('priceRange')}>
                <option value="">Select…</option>
                {PRICE_RANGES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>

            <div>
              <label className={labelCls}>Whose style inspires you?</label>
              <textarea className={`${inputCls} min-h-[68px] resize-none`} value={form.inspiration} onChange={set('inspiration')} placeholder="People, muses, accounts — anyone whose taste you love" />
            </div>

            <div>
              <label className={labelCls}>Anything else <span className="normal-case tracking-normal">(optional)</span></label>
              <textarea className={`${inputCls} min-h-[56px] resize-none`} value={form.note} onChange={set('note')} placeholder="What you want more of, what you can never find…" />
            </div>

            {error && <p className="text-[13px] text-[#B83A3A]">{error}</p>}

            <button
              type="submit"
              disabled={busy}
              className="mt-2 rounded-full bg-[#0A0A0A] text-white px-9 py-5 text-[15px] tracking-[0.2em] hover:opacity-85 transition-opacity disabled:opacity-40"
            >
              {busy ? 'SENDING…' : 'SUBMIT APPLICATION →'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
