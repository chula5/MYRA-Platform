'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

// A small mirror-led nudge that slides into the bottom-right corner once an
// anonymous visitor engages with the Edit (picks an occasion / searches),
// inviting them to create a login. Listens for the 'myra:engage' window event
// dispatched by FeedClient.
export default function SignupPrompt({ href = '/signin' }: { href?: string }) {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const onEngage = () => setShow(true)
    window.addEventListener('myra:engage', onEngage)
    return () => window.removeEventListener('myra:engage', onEngage)
  }, [])

  if (!show) return null

  return (
    <div className="fixed bottom-5 right-5 z-[60] w-[min(300px,calc(100vw-2.5rem))] animate-[fadeIn_0.4s_ease]">
      <div className="relative bg-white border border-[#E2E0DB] rounded-[16px] shadow-[0_8px_30px_rgba(0,0,0,0.14)] p-5">
        <button
          onClick={() => setShow(false)}
          aria-label="Dismiss"
          className="absolute top-2.5 right-3 text-[#A8A8A4] hover:text-[#4A4E57] text-[16px] leading-none"
        >
          ×
        </button>
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/myra-mirror-transparent.png" alt="" className="h-10 w-auto flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-[11px] tracking-[0.06em] text-[#4A4E57] leading-relaxed">
              CREATE A LOGIN TO SAVE OUTFITS AND WE&rsquo;LL LEARN YOUR TASTE TO RECOMMEND LOOKS MADE FOR YOU.
            </p>
            <Link
              href={href}
              className="inline-block mt-3 bg-[#0A0A0A] text-white px-4 py-2 rounded-full text-[10px] tracking-[0.12em] hover:opacity-85 transition-opacity"
            >
              LOG IN / SIGN UP
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
