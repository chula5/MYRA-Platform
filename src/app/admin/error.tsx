'use client'

import { useEffect } from 'react'

/**
 * When an admin page cannot draw — usually the database busy behind a cron,
 * a statement cancelled at its timeout — she sees this instead of Next's
 * "Application error", with the way back on it.
 */
export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error('[admin]', error) }, [error])
  const busy = /timeout|canceling statement|did not answer|fetch failed|ECONNRESET|57014/i.test(error.message)

  return (
    <div className="max-w-xl border border-[#E2E0DB] bg-white rounded-[14px] p-8 mt-6">
      <p className="text-[11px] tracking-[0.14em] text-[#7C838B] mb-3">{busy ? 'THE STUDIO IS BUSY' : 'THIS PAGE COULD NOT LOAD'}</p>
      <p className="text-[13px] tracking-[0.03em] text-[#4A4E57] leading-relaxed">
        {busy
          ? 'The database did not answer in time — a scan or a styling run is probably using it. Try again in a moment.'
          : 'Something went wrong drawing this page. Try again; if it keeps happening the error is in the server log.'}
      </p>
      {error.digest && <p className="mt-3 text-[9px] tracking-[0.09em] text-[#C9C7C2]">REF {error.digest}</p>}
      <div className="mt-6 flex items-center gap-4">
        <button
          type="button"
          onClick={reset}
          className="bg-[#0A0A0A] text-white px-5 py-2.5 rounded-[12px] text-[10px] tracking-[0.14em] hover:opacity-85 transition-opacity"
        >
          TRY AGAIN
        </button>
        <a href="/admin" className="text-[10px] tracking-[0.14em] text-[#4A4E57] hover:text-[#0A0A0A] transition-colors duration-300">
          DASHBOARD →
        </a>
      </div>
    </div>
  )
}
