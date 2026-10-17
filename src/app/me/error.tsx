'use client'

// When a room breaks in the browser, this stands in for Next's grey
// "Application error" page: MYRA's own words, a way back, and the error
// itself in small type so a screenshot says what went wrong. The error is
// also sent to the server log, so Chloe can read it without the phone.

import { useEffect } from 'react'
import { reportClientError } from './error-actions'

export default function MeError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    void reportClientError({
      message: String(error?.message ?? error).slice(0, 500),
      stack: String(error?.stack ?? '').slice(0, 2000),
      digest: error?.digest ?? null,
      path: typeof window !== 'undefined' ? window.location.pathname + window.location.search : '',
      agent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 200) : '',
    }).catch(() => undefined)
  }, [error])

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-6 gap-6">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/myra-mirror-transparent.png" alt="" className="h-24 w-auto" />
      <p className="text-[24px] xl:text-[28px] text-[#2B2B2B] leading-snug max-w-md">Something went wrong in this room.</p>
      <div className="flex flex-wrap items-center justify-center gap-4">
        <button type="button" onClick={reset} className="text-[19px] xl:text-[22px] px-6 py-3 rounded-full bg-[#2B2B2B] text-white">Try again</button>
        <button type="button" onClick={() => window.location.reload()} className="text-[19px] xl:text-[22px] underline underline-offset-4 text-[#55534E]">Reload the page</button>
      </div>
      <p className="text-[15px] text-[#7C838B] break-words max-w-md leading-snug">
        {String(error?.message ?? 'Unknown error').slice(0, 300)}{error?.digest ? ` · ${error.digest}` : ''}
      </p>
    </div>
  )
}
