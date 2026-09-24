'use client'

// SCIURA'S BOARD — who dresses whom.
//
// One row per member: her stylist today, Sciura's proposal (primary, blend,
// the one-line reason), and APPLY. Sciura proposes; Chloe decides.

import { useEffect, useState } from 'react'
import { listRoutingBoard, routeMemberNow, applyRouting, type RoutingRow } from './routing-actions'

export default function SciuraPanel() {
  const [rows, setRows] = useState<RoutingRow[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  async function refresh() {
    const r = await listRoutingBoard()
    setRows(r.rows)
    if (r.error) setMsg(r.error.toUpperCase())
  }
  useEffect(() => { void refresh() }, [])

  async function route(memberId: string) {
    setBusy(`route-${memberId}`); setMsg(null)
    const r = await routeMemberNow(memberId)
    setBusy(null)
    if (r.error) setMsg(r.error.toUpperCase())
    await refresh()
  }
  async function apply(memberId: string, stylistId: string) {
    setBusy(`apply-${memberId}`); setMsg(null)
    const r = await applyRouting(memberId, stylistId)
    setBusy(null)
    setMsg(r.error ? r.error.toUpperCase() : 'APPLIED — SHE IS NOW ON THAT STYLIST')
    await refresh()
  }

  return (
    <div className="border border-[#E2E0DB] bg-white rounded-[14px] p-5">
      <p className="text-[12px] tracking-[0.14em] text-[#0A0A0A] mb-1">SCIURA · WHO DRESSES WHOM</p>
      <p className="text-[9px] tracking-[0.05em] text-[#A8A8A4] mb-4 max-w-2xl leading-relaxed">
        The chief reads a member — her pictures, her dressing room, her brands — against every stylist&apos;s eye,
        brands and signature pieces, and proposes a primary with a blend. The reason is the difference line
        written on the primary&apos;s brief, never a paragraph. She proposes; you apply.
      </p>
      {msg && <p className="text-[9px] tracking-[0.12em] text-[#C4A882] mb-3">{msg}</p>}
      <div className="divide-y divide-[#F2F2F0]">
        {rows.map((r) => {
          const p = r.routing?.primary
          const stale = r.routing && !r.routing.applied_at
          return (
            <div key={r.member_id} className="py-3 flex flex-wrap items-start gap-x-6 gap-y-2">
              <div className="w-[160px] shrink-0">
                <p className="text-[11px] tracking-[0.08em] text-[#0A0A0A]">{r.name.toUpperCase()}</p>
                <p className="text-[9px] tracking-[0.06em] text-[#6B6B6B] mt-0.5">NOW · {(r.current ?? 'no stylist').toUpperCase()}</p>
              </div>
              <div className="flex-1 min-w-[260px]">
                {r.routing ? (
                  <>
                    <p className="text-[10px] tracking-[0.08em] text-[#0A0A0A]">
                      {p ? `SCIURA SAYS · ${p.public_name.toUpperCase()}` : 'SCIURA SAYS · NO MATCH YET'}
                      {r.routing.blend.length > 1 && (
                        <span className="text-[#6B6B6B]"> · {r.routing.blend.map((c) => `${c.public_name} ${c.share}%`).join(' / ')}</span>
                      )}
                    </p>
                    <p className="text-[10px] text-[#4A4E57] mt-1 leading-relaxed">{r.routing.reason}</p>
                    <p className="text-[8px] tracking-[0.08em] text-[#A8A8A4] mt-1">
                      READ {r.routing.evidence.pictures} PICTURES · {r.routing.evidence.pieces} PIECES · {r.routing.evidence.brands} BRANDS · {new Date(r.routing.computed_at).toLocaleString('en-GB')}
                      {r.routing.applied_at ? ' · APPLIED' : stale ? ' · NOT APPLIED' : ''}
                    </p>
                  </>
                ) : (
                  <p className="text-[9px] tracking-[0.08em] text-[#A8A8A4]">NOT READ YET.</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => route(r.member_id)} disabled={!!busy} className="border border-[#E2E0DB] px-3 py-1.5 text-[9px] tracking-[0.1em] rounded-full text-[#6B6B6B] hover:border-[#0A0A0A] disabled:opacity-50">
                  {busy === `route-${r.member_id}` ? 'READING…' : r.routing ? 'READ AGAIN' : 'ASK SCIURA'}
                </button>
                {p && p.stylist_id !== r.current_id && (
                  <button onClick={() => apply(r.member_id, p.stylist_id)} disabled={!!busy} className="bg-[#0A0A0A] text-white px-4 py-1.5 text-[9px] tracking-[0.12em] rounded-full hover:opacity-85 disabled:opacity-50">
                    {busy === `apply-${r.member_id}` ? '…' : `APPLY ${p.public_name.toUpperCase()} →`}
                  </button>
                )}
              </div>
            </div>
          )
        })}
        {!rows.length && <p className="text-[9px] tracking-[0.08em] text-[#A8A8A4] py-2">NO MEMBERS.</p>}
      </div>
    </div>
  )
}
