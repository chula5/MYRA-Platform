'use client'

import { useEffect, useState } from 'react'
import { joinWaitlist } from '@/app/admin/ai/waitlist-actions'
import LandingTracker, { trackLandingClick, trackLandingSignup } from '@/components/analytics/LandingTracker'

const POPUP_SEEN_KEY = 'myra_waitlist_popup_seen'
const POPUP_DELAY_MS = 2500

export default function LandingPageClient() {
  const [modalOpen, setModalOpen] = useState(false)
  const [dismissed, setDismissed] = useState(false) // popup closed → show inline form at bottom

  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // Auto-open the invite popup once per session, a couple of seconds in.
  useEffect(() => {
    let seen = false
    try { seen = sessionStorage.getItem(POPUP_SEEN_KEY) === '1' } catch {}
    if (seen) { setDismissed(true); return }
    const t = setTimeout(() => {
      setModalOpen(true)
      try { sessionStorage.setItem(POPUP_SEEN_KEY, '1') } catch {}
    }, POPUP_DELAY_MS)
    return () => clearTimeout(t)
  }, [])

  function closeModal() {
    setModalOpen(false)
    setDismissed(true) // reveal the inline email box at the bottom
  }

  function openModal() {
    setModalOpen(true)
    try { sessionStorage.setItem(POPUP_SEEN_KEY, '1') } catch {}
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError(null)
    trackLandingClick('cta_click')
    const res = await joinWaitlist(email)
    setSubmitting(false)
    if (res.error) { setError(res.error); return }
    trackLandingSignup()
    setSuccess(true)
  }

  return (
    <>
      <LandingTracker />

      {/* ── Invite popup ─────────────────────────────────────── */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center px-5"
          style={{ backgroundColor: 'rgba(10,10,10,0.55)' }}
          onClick={closeModal}
        >
          <div
            className="mirror-frame relative w-full max-w-[420px]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={closeModal}
              aria-label="Close"
              className="absolute top-5 right-7 z-20 text-[#6B6B6B] hover:text-[#4A4E57] text-[20px] leading-none transition-colors"
            >
              ×
            </button>

            <div className="mirror-glass px-8 sm:px-12 pt-16 pb-12 sm:pb-14">
            {success ? (
              <div className="text-center py-6">
                <p className="mirror-engrave text-[13px] tracking-[0.22em] text-[#4A4E57] mb-3">YOU&rsquo;RE ON THE LIST</p>
                <p className="text-[11px] tracking-[0.12em] text-[#6B6B6B] leading-relaxed">
                  Thank you — we&rsquo;ll be in touch with your first look at MYRA.
                </p>
              </div>
            ) : (
              <div className="text-center">
                <p className="text-[10px] tracking-[0.32em] text-[#8A8A86] mb-6">MYRA · THE WAITLIST</p>
                <h2 className="mirror-engrave text-[clamp(34px,9vw,48px)] tracking-[0.04em] text-[#4A4E57] leading-[0.95] mb-5">
                  BE FIRST.
                </h2>
                <p className="text-[12px] tracking-[0.10em] text-[#6B6B6B] leading-relaxed mb-8 max-w-[320px] mx-auto">
                  Join the waitlist for first access to MYRA — curated outfits, styled for you, the
                  moment we launch.
                </p>

                <form onSubmit={submit} className="flex flex-col gap-3">
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="YOUR EMAIL ADDRESS"
                    className="glass-input w-full rounded-full px-5 py-3.5 text-[12px] tracking-[0.10em] text-[#4A4E57] placeholder-[#A8A8A4] text-center focus:outline-none"
                  />
                  {error && <p className="text-[10px] tracking-[0.12em] text-[#B83A3A]">{error}</p>}
                  <button
                    type="submit"
                    disabled={submitting}
                    className="glass-dark w-full rounded-full py-3.5 text-[11px] tracking-[0.22em] text-[#4A4E57] disabled:opacity-50"
                  >
                    {submitting ? 'JOINING…' : 'REQUEST ACCESS'}
                  </button>
                </form>
              </div>
            )}
            </div>
          </div>
        </div>
      )}

      {/* ── Sticky bottom dock ───────────────────────────────── */}
      <div className="fixed bottom-0 left-0 right-0 z-40 pointer-events-none flex justify-center pb-5 sm:pb-7 px-4">
        <div className="pointer-events-auto w-full max-w-[460px]">
          {success ? (
            <div className="glass-dark rounded-full text-[#4A4E57] text-center text-[11px] tracking-[0.20em] px-8 py-4">
              YOU&rsquo;RE ON THE LIST ✓
            </div>
          ) : dismissed ? (
            // Inline email form — shown after the popup is dismissed.
            <form
              onSubmit={submit}
              className="glass-input flex items-stretch gap-0 rounded-full overflow-hidden"
            >
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="JOIN THE WAITLIST — YOUR EMAIL"
                className="flex-1 min-w-0 bg-transparent px-5 sm:px-6 py-3.5 text-[11px] tracking-[0.12em] text-[#4A4E57] placeholder-[#A8A8A4] focus:outline-none"
              />
              <button
                type="submit"
                disabled={submitting}
                aria-label="Join the waitlist"
                className="glass-dark flex-shrink-0 text-[#4A4E57] px-6 sm:px-8 text-[16px] rounded-full m-1 disabled:opacity-50"
              >
                {submitting ? '…' : '→'}
              </button>
            </form>
          ) : (
            // Initial state — the pill button (also opens the popup).
            <div className="flex justify-center">
              <button
                onClick={openModal}
                className="glass-dark inline-flex items-center gap-3 rounded-full text-[#4A4E57] text-[11px] sm:text-[12px] tracking-[0.22em] px-10 sm:px-14 py-3.5 sm:py-4"
              >
                JOIN THE WAITLIST
              </button>
            </div>
          )}
          {dismissed && !success && error && (
            <p className="text-[9px] tracking-[0.14em] text-[#B83A3A] text-center mt-2 bg-white/90 py-1 rounded">{error}</p>
          )}
        </div>
      </div>
    </>
  )
}
