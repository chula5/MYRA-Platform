'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { thumbUrl } from '@/lib/image-utils'
import { auditPull, auditSwap, auditKeep, type AuditEntry } from './actions'

export default function AuditClient({ entries }: { entries: AuditEntry[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [msg, setMsg] = useState<string | null>(null)

  async function act(e: AuditEntry, kind: 'pull' | 'swap' | 'keep') {
    setBusy((b) => ({ ...b, [e.id]: true }))
    if (kind === 'pull') {
      const r = await auditPull(e.id)
      setMsg(r.error ? r.error.toUpperCase() : 'PULLED + UNPUBLISHED — AUTONOMY STAGE DEMOTED.')
    } else if (kind === 'swap') {
      const r = await auditSwap(e.id)
      setMsg(r.error ? r.error.toUpperCase() : 'UNPUBLISHED FOR EDITS — AUTONOMY STAGE DEMOTED.')
      if (r.outfitId && r.projectId) {
        window.location.href = `/admin/projects/${r.projectId}/outfits/${r.outfitId}/edit`
        return
      }
    } else {
      await auditKeep(e.id)
    }
    setBusy((b) => ({ ...b, [e.id]: false }))
    router.refresh()
  }

  const pending = entries.filter((e) => !e.audit_action)
  const done = entries.filter((e) => e.audit_action)

  return (
    <div className="space-y-8">
      {msg && <p className="text-[9px] tracking-[0.12em] text-[#8B5E00]">{msg}</p>}
      {pending.length === 0 ? (
        <p className="text-[11px] tracking-[0.12em] text-[#A8A8A4] py-12 text-center">NOTHING AWAITING AUDIT.</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {pending.map((e) => (
            <div key={e.id} className="border border-[#E2E0DB] bg-white rounded-[10px] overflow-hidden">
              <a href={`/outfit/${e.outfit_id}`} className="block aspect-[3/4] bg-[#F2F2F0]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {e.image_url && <img src={thumbUrl(e.image_url, 600)} alt="" className="w-full h-full object-cover" />}
              </a>
              <div className="p-2">
                <p className="text-[8px] tracking-[0.06em] text-[#6B6B6B] truncate">{(e.aesthetic_label ?? '').toUpperCase()}</p>
                <p className="text-[7px] tracking-[0.08em] text-[#A8A8A4]">STAGE {e.stage} · {new Date(e.published_at).toLocaleDateString('en-GB')}</p>
                <div className="flex items-center gap-1 mt-2">
                  <button onClick={() => act(e, 'keep')} disabled={busy[e.id]} className="flex-1 bg-[#0A0A0A] text-white py-1.5 text-[8px] tracking-[0.1em] rounded-full hover:opacity-85 disabled:opacity-50">KEEP</button>
                  <button onClick={() => act(e, 'swap')} disabled={busy[e.id]} title="Unpublish + open the swap sheet (demotes the stage)" className="px-2 py-1.5 text-[8px] tracking-[0.08em] border border-[#E2E0DB] text-[#8B5E00] rounded-full hover:border-[#8B5E00] disabled:opacity-50">SWAP</button>
                  <button onClick={() => act(e, 'pull')} disabled={busy[e.id]} title="Unpublish immediately (demotes the stage)" className="px-2 py-1.5 text-[8px] tracking-[0.08em] border border-[#E2E0DB] text-[#B83A3A] rounded-full hover:border-[#B83A3A] disabled:opacity-50">PULL</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {done.length > 0 && (
        <div>
          <p className="text-[10px] tracking-[0.135em] text-[#6B6B6B] mb-3">AUDITED</p>
          <div className="flex flex-wrap gap-2">
            {done.map((e) => (
              <span key={e.id} className={`border rounded-full px-3 py-1 text-[8px] tracking-[0.08em] ${e.audit_action === 'kept' ? 'border-[#E2E0DB] text-[#3D7A50]' : 'border-[#E8B4B4] text-[#B83A3A]'}`}>
                {(e.aesthetic_label ?? e.outfit_id.slice(0, 8)).toUpperCase().slice(0, 30)} — {e.audit_action?.toUpperCase()}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
