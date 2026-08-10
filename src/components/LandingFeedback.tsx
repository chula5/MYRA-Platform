'use client'

import { useState } from 'react'
import { submitFeedback } from '@/app/actions/feedback'

// Styled as archive index cards, matching the search card on The Edit: a
// hairline #2B2B2B rule, square corners, an off-white ground, and a ruled
// label cell to the left of the thing you fill in. No rounded pills, no
// drop shadows on the fields.
//
// No background of its own: both pages that use this sit inside .myra-texture,
// and the cream fill this used to carry painted the page ground out.
export default function LandingFeedback() {
  return (
    <section className="pb-28 sm:pb-36 px-3 sm:px-10">
      <div className="max-w-4xl mx-auto text-center">
        <p className="myra-field text-[#6B6B6B] mb-6">MORE OUTFITS ON THE WAY</p>
        <p className="myra-field leading-[1.75] max-w-[680px] mx-auto mb-12">
          We&rsquo;re working hard to bring you more outfits and more brands every week. If there&rsquo;s a label
          you&rsquo;d love to see, or any feedback at all, tell us below.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-left mb-12">
          <MiniForm
            kind="brand"
            label="SUGGEST A BRAND"
            placeholder="E.G. KHAITE, TOTÊME, JACQUEMUS…"
            cta="ADD BRAND"
          />
          <MiniForm
            kind="feedback"
            label="SHARE FEEDBACK"
            placeholder="WHAT WOULD MAKE MYRA BETTER FOR YOU?"
            multiline
            cta="SEND FEEDBACK"
          />
        </div>

        <p className="myra-field text-[#6B6B6B]">
          Brand partnerships or any other questions?{' '}
          <a href="mailto:info@myraassistant.co.uk" className="text-[#4A4E57] underline underline-offset-4 hover:opacity-70 transition-opacity">
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
    'myra-field w-full bg-transparent border-0 px-4 md:px-6 py-5 md:py-6 placeholder:text-[#B4B4AE] focus:outline-none'

  return (
    <div className="border border-[#2B2B2B] bg-[#FCFCFA] shadow-[0_10px_34px_rgba(0,0,0,0.13)]">
      {/* Card head — the same rule and rhythm as the archive card. */}
      <div className="flex items-center justify-between px-4 md:px-6 pt-4 md:pt-5 pb-3">
        <p className="myra-field">{label}</p>
        <span className="w-[18px] h-[18px] rounded-full border border-[#2B2B2B]" aria-hidden />
      </div>

      <div className="px-3 md:px-6 pb-4 md:pb-6">
        {done ? (
          <div className="border border-[#2B2B2B]">
            <p className="myra-field px-4 md:px-6 py-6">THANK YOU — WE&rsquo;VE GOT IT.</p>
          </div>
        ) : (
          <form onSubmit={submit} className="border border-[#2B2B2B]">
            {multiline ? (
              <textarea
                value={value}
                onChange={(e) => setValue(e.target.value)}
                rows={3}
                placeholder={placeholder}
                className={`${field} resize-none border-b border-[#2B2B2B]`}
              />
            ) : (
              <input
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={placeholder}
                className={`${field} border-b border-[#2B2B2B]`}
              />
            )}

            {err && (
              <p className="myra-field px-4 md:px-6 py-3 border-b border-[#2B2B2B]" style={{ color: '#B83A3A' }}>
                {err.toUpperCase()}
              </p>
            )}

            <button
              type="submit"
              disabled={busy || !value.trim()}
              className="myra-field w-full px-4 md:px-6 py-5 text-left hover:bg-[#F1F0EC] transition-colors disabled:opacity-40"
            >
              {busy ? 'SENDING…' : cta} →
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
