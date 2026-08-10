'use client'

import { useState } from 'react'
import { submitFeedback } from '@/app/actions/feedback'

// No background of its own: both pages that use this sit inside .myra-texture,
// and the cream fill this used to carry painted the grey texture out.
export default function LandingFeedback() {
  return (
    <section className="pb-28 sm:pb-36 px-6 sm:px-10">
      <div className="max-w-3xl mx-auto text-center">
        <p className="text-[10px] sm:text-[11px] tracking-[0.135em] text-[#6B6B6B] mb-6">MORE OUTFITS ON THE WAY</p>
        <p className="text-[#4A4E57] tracking-[0.04em] sm:tracking-[0.045em] leading-[1.75] text-[clamp(12px,1.45vw,16px)] max-w-[640px] mx-auto mb-12">
          We&rsquo;re working hard to bring you more outfits and more brands every week. If there&rsquo;s a label
          you&rsquo;d love to see, or any feedback at all, tell us below.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 text-left mb-12">
          <MiniForm
            kind="brand"
            label="SUGGEST A BRAND"
            placeholder="E.G. KHAITE, TOTÊME, JACQUEMUS…"
            cta="ADD BRAND"
          />
          <MiniForm
            kind="feedback"
            label="SHARE FEEDBACK"
            placeholder="What would make MYRA better for you?"
            multiline
            cta="SEND FEEDBACK"
          />
        </div>

        <p className="text-[11px] sm:text-[12px] tracking-[0.06em] text-[#6B6B6B]">
          Brand partnerships or any other questions?{' '}
          <a href="mailto:info@myraassistant.co.uk" className="text-[#4A4E57] underline underline-offset-2 hover:opacity-70 transition-opacity">
            info@myraassistant.co.uk
          </a>
        </p>
      </div>
    </section>
  )
}

function MiniForm({
  kind,
  label,
  placeholder,
  cta,
  multiline = false,
}: {
  kind: 'brand' | 'feedback'
  label: string
  placeholder: string
  cta: string
  multiline?: boolean
}) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy || !value.trim()) return
    setBusy(true)
    setErr(null)
    const res = await submitFeedback(kind, value)
    setBusy(false)
    if (res.error) setErr(res.error)
    else { setDone(true); setValue('') }
  }

  const field =
    'w-full border border-[#E2E0DB] bg-[#FAFAF8] rounded-[12px] px-4 py-3 text-[12px] tracking-[0.04em] text-[#4A4E57] placeholder:text-[#A8A8A4] focus:outline-none focus:border-[#0A0A0A] transition-colors'

  return (
    <div className="bg-white border border-[#E2E0DB] rounded-[16px] p-5 flex flex-col">
      <p className="text-[10px] tracking-[0.1em] text-[#6B6B6B] mb-3">{label}</p>
      {done ? (
        <p className="text-[12px] tracking-[0.05em] text-[#4A4E57] py-4">Thank you — we&rsquo;ve got it. 🤍</p>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          {multiline ? (
            <textarea value={value} onChange={(e) => setValue(e.target.value)} rows={3} placeholder={placeholder} className={`${field} resize-none`} />
          ) : (
            <input type="text" value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} className={field} />
          )}
          {err && <p className="text-[10px] tracking-[0.068em] text-[#B83A3A]">{err.toUpperCase()}</p>}
          <button
            type="submit"
            disabled={busy || !value.trim()}
            className="self-start bg-[#0A0A0A] text-white rounded-full px-6 py-2.5 text-[10px] tracking-[0.12em] hover:opacity-85 transition-opacity disabled:opacity-40"
          >
            {busy ? 'SENDING…' : cta}
          </button>
        </form>
      )}
    </div>
  )
}
