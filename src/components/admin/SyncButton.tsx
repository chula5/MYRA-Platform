'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { syncCommissions, syncMetaSpend } from '@/app/admin/commissions/actions'

type Result = { label: string; detail: string; tone: 'ok' | 'error' | 'idle' }

/**
 * Pulls fresh data from the networks on demand. Deliberately manual: these are
 * rate-limited third-party APIs, and a page render should never be the thing
 * that calls them.
 */
export default function SyncButton({
  target,
  label = 'SYNC NOW',
  days = 60,
}: {
  target: 'commissions' | 'meta'
  label?: string
  days?: number
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [results, setResults] = useState<Result[]>([])

  function run() {
    setResults([])
    startTransition(async () => {
      try {
        if (target === 'meta') {
          const r = await syncMetaSpend(days)
          setResults([
            {
              label: 'META',
              detail:
                r.status === 'ok'
                  ? `${r.rows} DAY-ROWS UPDATED`
                  : (r.message ?? r.status).toUpperCase(),
              tone: r.status === 'ok' ? 'ok' : 'error',
            },
          ])
        } else {
          const out = await syncCommissions(undefined, days)
          setResults(
            out.map((o) => ({
              label: o.network.toUpperCase(),
              detail:
                o.status === 'ok'
                  ? `${o.rows} TRANSACTIONS`
                  : o.status === 'not_configured'
                    ? `NOT CONNECTED — ${(o.missing ?? []).join(', ')}`
                    : (o.message ?? 'FAILED').slice(0, 120).toUpperCase(),
              tone: o.status === 'ok' ? 'ok' : 'error',
            })),
          )
        }
        router.refresh()
      } catch (err) {
        setResults([{ label: 'SYNC', detail: (err instanceof Error ? err.message : String(err)).toUpperCase(), tone: 'error' }])
      }
    })
  }

  return (
    <div>
      <button
        onClick={run}
        disabled={pending}
        className="bg-[#0A0A0A] text-white px-5 py-2.5 rounded-[10px] text-[10px] tracking-[0.14em] hover:opacity-85 transition-opacity disabled:opacity-40"
      >
        {pending ? 'SYNCING…' : label}
      </button>

      {results.length > 0 && (
        <div className="mt-3 space-y-1">
          {results.map((r) => (
            <p
              key={r.label}
              className="text-[9px] tracking-[0.09em]"
              style={{ color: r.tone === 'ok' ? '#1B7F4B' : '#B83A3A' }}
            >
              {r.label} · {r.detail}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
