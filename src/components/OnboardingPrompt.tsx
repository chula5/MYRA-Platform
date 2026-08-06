'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

const DISMISS_KEY = 'myra-style-quiz-dismissed'

/**
 * Optional style-quiz invitation — shown at the top of The Edit for signed-in
 * users who haven't completed onboarding. Slides in under the header; TAKE THE
 * QUIZ opens /onboarding, MAYBE LATER dismisses it (remembered per browser via
 * localStorage). Disappears for good once the quiz is completed, because the
 * server stops rendering it (user_metadata.onboarded).
 */
export default function OnboardingPrompt() {
  const router = useRouter()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    try {
      if (localStorage.getItem(DISMISS_KEY) !== '1') setVisible(true)
    } catch {
      setVisible(true)
    }
  }, [])

  function dismiss() {
    setVisible(false)
    try { localStorage.setItem(DISMISS_KEY, '1') } catch { /* ignore */ }
  }

  if (!visible) return null

  return (
    <div className="bg-[#F2F2F2] px-6 sm:px-10 pt-6">
      <div className="max-w-[1440px] mx-auto">
        <div className="relative bg-white border border-[#E2E0DB] rounded-[12px] px-6 py-5 sm:px-8 sm:py-6 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8">
          <button
            onClick={dismiss}
            aria-label="Dismiss"
            className="absolute top-3 right-3 w-6 h-6 flex items-center justify-center text-[#A8A8A4] hover:text-[#4A4E57] transition-colors"
          >
            ✕
          </button>

          <div className="flex-1 pr-6">
            <p className="text-[10px] tracking-[0.135em] text-[#C4A882] mb-1.5">OPTIONAL — 1 MINUTE</p>
            <p className="text-[14px] sm:text-[15px] tracking-[0.045em] text-[#4A4E57] mb-1">
              MAKE THE EDIT YOURS
            </p>
            <p className="text-[10px] sm:text-[11px] tracking-[0.045em] text-[#A8A8A4] leading-relaxed">
              Take the quick style quiz so MYRA learns your taste and shows you outfits made for you.
              You can also just browse — hearts teach us too.
            </p>
          </div>

          <div className="flex items-center gap-4 flex-shrink-0">
            <button
              onClick={() => router.push('/onboarding')}
              className="bg-[#0A0A0A] text-white px-7 py-3 rounded-[12px] text-[10px] tracking-[0.099em] hover:opacity-85 transition-opacity whitespace-nowrap"
            >
              TAKE THE QUIZ →
            </button>
            <button
              onClick={dismiss}
              className="text-[10px] tracking-[0.09em] text-[#A8A8A4] hover:text-[#4A4E57] underline underline-offset-4 transition-colors whitespace-nowrap"
            >
              MAYBE LATER
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
