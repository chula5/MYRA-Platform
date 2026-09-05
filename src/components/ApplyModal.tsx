'use client'

import { useEffect, useState } from 'react'
import { submitApplication } from '@/app/apply/actions'

// The APPLY NOW pop-out. Opens on the 'myra:open-apply' event (fired by every
// ApplyButton). A few taste questions so Chloe can get a feel for the person's
// style before accepting them into a personal edit.
const PRICE_RANGES = [
  'Under £150 a piece',
  '£150 – 400 a piece',
  '£400 – 800 a piece',
  '£800+ a piece',
  'A mix — no set budget',
]

const EMPTY = { name: '', email: '', brands: '', priceRange: '', inspiration: '', note: '' }

export default function ApplyModal() {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ ...EMPTY })
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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    const r = await submitApplication(form)
    setBusy(false)
    if (r.error) setError(r.error)
    else { setDone(true); setForm({ ...EMPTY }) }
  }

  const labelCls = 'block text-[11px] tracking-[0.14em] text-[#6B6B6B] mb-2 uppercase'
  const inputCls =
    'w-full border border-[#D8D5CE] bg-white px-4 py-3 text-[14px] text-[#0A0A0A] tracking-[0.02em] outline-none focus:border-[#0A0A0A] transition-colors placeholder:text-[#B4B4AE]'

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start sm:items-center justify-center p-4 sm:p-6 bg-black/40 overflow-y-auto"
      onClick={() => setOpen(false)}
    >
      <div
        className="relative w-full max-w-[580px] my-6 bg-[#FBFAF8] border border-[#2B2B2B] shadow-[0_30px_80px_rgba(0,0,0,0.25)] p-7 sm:p-10"
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
              <p className="text-[17px] tracking-[0.1em] text-[#0A0A0A] mb-2">APPLY FOR YOUR PERSONAL EDIT</p>
              <p className="text-[13px] text-[#6B6B6B] leading-[1.65]">
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

            <div>
              <label className={labelCls}>Brands you love</label>
              <textarea className={`${inputCls} min-h-[68px] resize-none`} value={form.brands} onChange={set('brands')} placeholder="e.g. Khaite, Totême, The Row, Isabel Marant…" />
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
              className="mt-1 rounded-full bg-[#0A0A0A] text-white px-8 py-4 text-[13px] tracking-[0.2em] hover:opacity-85 transition-opacity disabled:opacity-40"
            >
              {busy ? 'SENDING…' : 'SUBMIT APPLICATION →'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
