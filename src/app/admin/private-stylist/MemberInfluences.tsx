'use client'

// STYLE INFLUENCES on her card, under the persona picker: the people whose
// style she loves, laid on top of her stylist. Pick from everyone saved on
// /admin/influences (drafts too — Chloe can link before a person is live).

import { useEffect, useState } from 'react'
import FallbackImage from '@/components/FallbackImage'
import { loadMemberInfluencesAdmin, linkInfluenceMember, unlinkInfluenceMember } from '@/app/admin/influences/actions'

type View = Awaited<ReturnType<typeof loadMemberInfluencesAdmin>>

export default function MemberInfluences({ memberId }: { memberId: string }) {
  const [view, setView] = useState<View | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = async () => setView(await loadMemberInfluencesAdmin(memberId))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void refresh() }, [memberId])

  async function act(fn: () => Promise<{ error?: string }>) {
    setBusy(true)
    await fn()
    await refresh()
    setBusy(false)
  }

  if (!view) return null
  const linked = new Set(view.linked.map((l) => l.id))
  const options = view.all.filter((p) => !linked.has(p.id))

  return (
    <div className="flex flex-wrap items-center gap-2 mt-4">
      <span className="text-[20px] tracking-[0.12em] text-[#A8A8A4] mr-1">STYLE INFLUENCES</span>
      {view.error && <span className="text-[20px] tracking-[0.1em] text-[#B83A3A]">{view.error}</span>}
      {view.linked.map((p) => (
        <span key={p.id} className="inline-flex items-center gap-2 border border-[#0A0A0A] rounded-full pl-1 pr-1 py-1">
          <span className="relative w-9 h-9 rounded-full overflow-hidden bg-[#F4F3F0] shrink-0">
            {p.image_url && <FallbackImage src={p.image_url} thumbWidth={120} alt="" className="absolute inset-0 w-full h-full object-cover object-top" />}
          </span>
          <span className="text-[20px] tracking-[0.04em] text-[#2B2B2B]">{p.name}</span>
          {p.source === 'member' && <span className="text-[14px] tracking-[0.1em] text-[#7C838B]">HER PICK</span>}
          <button aria-label={`Remove ${p.name}`} disabled={busy}
            onClick={() => act(() => unlinkInfluenceMember(p.id, memberId))}
            className="w-8 h-8 rounded-full text-[20px] text-[#6B6B6B] hover:bg-[#F4F3F0]">×</button>
        </span>
      ))}
      {!view.error && (
        options.length ? (
          <select value="" disabled={busy}
            onChange={(e) => { const id = e.target.value; if (id) void act(() => linkInfluenceMember(id, memberId)) }}
            className="border border-[#E2E0DB] bg-white px-2 py-1.5 text-[20px] tracking-[0.06em] text-[#4A4E57] outline-none focus:border-[#0A0A0A]"
            title="Lay this person's style on top of her stylist">
            <option value="">+ ADD</option>
            {options.map((p) => <option key={p.id} value={p.id}>{p.name}{p.status === 'live' ? '' : ' (draft)'}</option>)}
          </select>
        ) : (
          <a href="/admin/influences" className="text-[20px] tracking-[0.08em] text-[#7C838B] underline">
            {view.all.length ? 'ALL LINKED · ADD SOMEONE NEW' : 'ADD THE FIRST PERSON'}
          </a>
        )
      )}
    </div>
  )
}
