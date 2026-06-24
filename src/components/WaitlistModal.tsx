'use client'

import { useState } from 'react'
import { joinWaitlist } from '@/app/admin/ai/waitlist-actions'

export default function WaitlistModal({ triggerClassName, onOpen }: { triggerClassName?: string; onOpen?: () => void }) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const result = await joinWaitlist(email)
    setSubmitting(false)
    if (result.error) { setError(result.error); return }
    setSuccess(true)
  }

  return (
    <>
      {/* Trigger button */}
      <button
        onClick={() => { setOpen(true); onOpen?.() }}
        className={triggerClassName ?? "inline-flex items-center gap-3 bg-white border border-white text-[#4A4E57] text-[13px] tracking-[0.09em] px-12 py-4 hover:bg-white/90 transition-all duration-300"}
      >
        JOIN THE WAITLIST
      </button>

      {/* Modal overlay */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-6"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white w-full max-w-[440px] px-10 py-12 relative"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close */}
            <button
              onClick={() => setOpen(false)}
              className="absolute top-4 right-5 text-[#A8A8A4] hover:text-[#4A4E57] text-[20px] transition-colors"
            >
              ×
            </button>

            {success ? (
              <div className="text-center">
                <p className="text-[13px] tracking-[0.09em] text-[#4A4E57] mb-2">YOU'RE ON THE LIST</p>
                <p className="text-[11px] tracking-[0.054em] text-[#6B6B6B]">We'll be in touch soon.</p>
              </div>
            ) : (
              <>
                <p className="text-[11px] tracking-[0.113em] text-[#6B6B6B] mb-3">MYRA</p>
                <h2 className="text-[22px] tracking-[0.054em] text-[#4A4E57] mb-2">JOIN THE WAITLIST</h2>
                <p className="text-[12px] tracking-[0.045em] text-[#6B6B6B] mb-8">
                  Be the first to access your personal outfit discovery tool.
                </p>
                <form onSubmit={handleSubmit}>
                  <input
                    type="email"
                    placeholder="YOUR EMAIL ADDRESS"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full border border-[#E2E0DB] px-4 py-3 text-[12px] tracking-[0.045em] text-[#4A4E57] placeholder-[#A8A8A4] focus:outline-none focus:border-[#0A0A0A] transition-colors mb-4"
                  />
                  {error && (
                    <p className="text-[10px] tracking-[0.054em] text-red-500 mb-3">{error}</p>
                  )}
                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full bg-[#0A0A0A] text-white py-3.5 text-[11px] tracking-[0.09em] hover:opacity-85 transition-opacity disabled:opacity-50"
                  >
                    {submitting ? 'JOINING...' : 'JOIN →'}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
