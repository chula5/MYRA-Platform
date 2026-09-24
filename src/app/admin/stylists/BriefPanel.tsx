'use client'

// A STYLIST'S BRIEF, on her card — her nevers in plain sight, and the line
// that separates her from the stylist she collides with.
//
// The summary is always shown (bans red, preferences grey, overlaps named);
// EDIT BRIEF opens the whole document. Nevers are matched on words, so each
// carries the words it is matched on — a never with no words is a rule for
// the look check and the chat, never for the composer's gate.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { StylistBrief, StylistNever, Overlap } from '@/lib/stylist-brief'
import { updateStylistBrief } from './actions'

const label = 'text-[9px] tracking-[0.12em] text-[#A8A8A4] mb-1'
const field = 'w-full border border-[#E2E0DB] rounded-[10px] px-3 py-2 text-[11px] text-[#4A4E57] focus:outline-none focus:border-[#0A0A0A] bg-white'

export default function BriefPanel({
  stylistId, name, brief, overlaps, confirmedImages,
}: {
  stylistId: string
  name: string
  brief: StylistBrief
  overlaps: Overlap[]
  confirmedImages: number
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [b, setB] = useState<StylistBrief>(brief)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const bans = brief.nevers.filter((n) => n.kind === 'ban')
  const prefs = brief.nevers.filter((n) => n.kind === 'preference')

  async function save() {
    setBusy(true)
    const r = await updateStylistBrief(stylistId, b)
    setBusy(false)
    setMsg(r.error ? r.error.toUpperCase() : 'BRIEF SAVED')
    if (!r.error) { setEditing(false); router.refresh() }
  }

  const setList = (k: 'signature_pieces' | 'brands' | 'palette' | 'fabrics') => (v: string) =>
    setB({ ...b, [k]: v.split(',').map((x) => x.trim()).filter(Boolean) })
  const setNever = (i: number, patch: Partial<StylistNever>) =>
    setB({ ...b, nevers: b.nevers.map((n, j) => (j === i ? { ...n, ...patch } : n)) })

  return (
    <div className="mt-4 border-t border-[#F2F2F2] pt-4">
      {/* Always visible: who she is to a member, and what she never does */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] tracking-[0.1em] text-[#0A0A0A]">
            {(brief.public_name || name).toUpperCase()}
            {brief.tagline && <span className="text-[#6B6B6B]"> · {brief.tagline.toUpperCase()}</span>}
          </p>
          <p className="text-[9px] tracking-[0.06em] text-[#A8A8A4] mt-1">
            {confirmedImages} REFERENCE OUTFITS CONFIRMED · {brief.brands.length} BRANDS · {brief.signature_pieces.length} SIGNATURE PIECES
            {brief.image_url ? '' : ' · NO PORTRAIT YET'}
          </p>
        </div>
        <button onClick={() => { setEditing((x) => !x); setB(brief); setMsg(null) }} className="border border-[#E2E0DB] px-3 py-1.5 text-[9px] tracking-[0.1em] rounded-full text-[#6B6B6B] hover:border-[#0A0A0A]">
          {editing ? 'CLOSE BRIEF' : 'EDIT BRIEF'}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {bans.map((n) => (
          <span key={n.text} title={n.match.length ? `matched on: ${n.match.join(', ')}` : 'no match words — look check and chat only'}
            className="border border-[#E8B4B4] text-[#B83A3A] rounded-full px-2.5 py-1 text-[9px] tracking-[0.06em]">
            NEVER · {n.text.toUpperCase()}{!n.match.length && ' ◦'}
          </span>
        ))}
        {prefs.map((n) => (
          <span key={n.text} title={n.match.length ? `matched on: ${n.match.join(', ')}` : 'no match words — look check and chat only'}
            className="border border-[#DCDEE1] text-[#7C838B] rounded-full px-2.5 py-1 text-[9px] tracking-[0.06em]">
            AVOIDS · {n.text.toUpperCase()}{!n.match.length && ' ◦'}
          </span>
        ))}
        {!brief.nevers.length && <span className="text-[9px] tracking-[0.08em] text-[#B83A3A]">NO NEVERS WRITTEN — SHE WILL DRESS LIKE EVERYONE ELSE</span>}
      </div>

      {overlaps.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {overlaps.map((o) => (
            <div key={o.slug} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className={`text-[9px] tracking-[0.12em] ${o.difference ? 'text-[#6B6B6B]' : 'text-[#B83A3A]'}`}>
                OVERLAP · {o.name.toUpperCase()}{o.cosine != null ? ` · ${Math.round(o.cosine * 100)}% SAME EYE` : ''}
              </span>
              <span className="text-[10px] text-[#0A0A0A]">
                {o.difference ?? 'NO DIFFERENCE LINE WRITTEN — SCIURA CANNOT TELL THEM APART'}
              </span>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div className="mt-4 border-t border-[#F2F2F2] pt-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div><p className={label}>PUBLIC NAME (WHAT SHE SEES)</p><input className={field} value={b.public_name} onChange={(e) => setB({ ...b, public_name: e.target.value })} /></div>
            <div><p className={label}>TAGLINE</p><input className={field} value={b.tagline} onChange={(e) => setB({ ...b, tagline: e.target.value })} /></div>
            <div><p className={label}>PORTRAIT IMAGE URL</p><input className={field} value={b.image_url ?? ''} onChange={(e) => setB({ ...b, image_url: e.target.value || null })} placeholder="https://…" /></div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div><p className={label}>SIGNATURE PIECES (COMMA-SEPARATED)</p><textarea rows={2} className={field} value={b.signature_pieces.join(', ')} onChange={(e) => setList('signature_pieces')(e.target.value)} /></div>
            <div><p className={label}>BRANDS</p><textarea rows={2} className={field} value={b.brands.join(', ')} onChange={(e) => setList('brands')(e.target.value)} /></div>
            <div><p className={label}>PALETTE</p><input className={field} value={b.palette.join(', ')} onChange={(e) => setList('palette')(e.target.value)} /></div>
            <div><p className={label}>FABRICS</p><input className={field} value={b.fabrics.join(', ')} onChange={(e) => setList('fabrics')(e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div><p className={label}>DAY</p><input className={field} value={b.day ?? ''} onChange={(e) => setB({ ...b, day: e.target.value })} /></div>
            <div><p className={label}>EVENING</p><input className={field} value={b.evening ?? ''} onChange={(e) => setB({ ...b, evening: e.target.value })} /></div>
            <div><p className={label}>WEEKEND</p><input className={field} value={b.weekend ?? ''} onChange={(e) => setB({ ...b, weekend: e.target.value })} /></div>
          </div>

          <div>
            <p className={label}>NEVERS — BAN BLOCKS A LOOK · AVOID LOWERS ITS SCORE · MATCH WORDS ARE WHAT THE COMPOSER LOOKS FOR IN A PIECE&apos;S NAME, TYPE, MATERIAL, COLOUR OR BRAND</p>
            <div className="space-y-2">
              {b.nevers.map((n, i) => (
                <div key={i} className="flex flex-wrap md:flex-nowrap items-center gap-2">
                  <button type="button" onClick={() => setNever(i, { kind: n.kind === 'ban' ? 'preference' : 'ban' })}
                    className={`shrink-0 w-[68px] rounded-full px-2 py-1.5 text-[9px] tracking-[0.1em] border ${n.kind === 'ban' ? 'border-[#B83A3A] text-[#B83A3A]' : 'border-[#DCDEE1] text-[#7C838B]'}`}>
                    {n.kind === 'ban' ? 'BAN' : 'AVOID'}
                  </button>
                  <input className={field} value={n.text} onChange={(e) => setNever(i, { text: e.target.value })} placeholder="No denim" />
                  <input className={`${field} md:w-[40%]`} value={n.match.join(', ')} onChange={(e) => setNever(i, { match: e.target.value.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean) })} placeholder="match words: denim, jean" />
                  <button type="button" onClick={() => setB({ ...b, nevers: b.nevers.filter((_, j) => j !== i) })} className="shrink-0 text-[#A8A8A4] hover:text-[#B83A3A] text-[16px] leading-none px-1">×</button>
                </div>
              ))}
            </div>
            <button type="button" onClick={() => setB({ ...b, nevers: [...b.nevers, { text: '', kind: 'ban', match: [] }] })} className="mt-2 border border-[#E2E0DB] px-3 py-1.5 text-[9px] tracking-[0.1em] rounded-full text-[#6B6B6B] hover:border-[#0A0A0A]">
              + ADD A NEVER
            </button>
          </div>

          <div>
            <p className={label}>SIBLINGS — THE STYLIST SHE COLLIDES WITH, AND THE ONE LINE THAT SEPARATES THEM (SCIURA READS THIS OUT)</p>
            <div className="space-y-2">
              {b.siblings.map((s, i) => (
                <div key={i} className="flex flex-wrap md:flex-nowrap items-center gap-2">
                  <input className={`${field} md:w-[160px]`} value={s.slug} onChange={(e) => setB({ ...b, siblings: b.siblings.map((x, j) => (j === i ? { ...x, slug: e.target.value.trim() } : x)) })} placeholder="slug, e.g. chanel" />
                  <input className={field} value={s.difference} onChange={(e) => setB({ ...b, siblings: b.siblings.map((x, j) => (j === i ? { ...x, difference: e.target.value } : x)) })} placeholder="She is X; the other is Y." />
                  <button type="button" onClick={() => setB({ ...b, siblings: b.siblings.filter((_, j) => j !== i) })} className="shrink-0 text-[#A8A8A4] hover:text-[#B83A3A] text-[16px] leading-none px-1">×</button>
                </div>
              ))}
            </div>
            <button type="button" onClick={() => setB({ ...b, siblings: [...b.siblings, { slug: '', difference: '' }] })} className="mt-2 border border-[#E2E0DB] px-3 py-1.5 text-[9px] tracking-[0.1em] rounded-full text-[#6B6B6B] hover:border-[#0A0A0A]">
              + ADD A SIBLING
            </button>
          </div>

          <div className="flex items-center gap-3">
            <button onClick={save} disabled={busy} className="bg-[#0A0A0A] text-white px-5 py-2 text-[9px] tracking-[0.14em] rounded-full hover:opacity-85 disabled:opacity-50">
              {busy ? 'SAVING…' : 'SAVE BRIEF'}
            </button>
            {msg && <span className="text-[9px] tracking-[0.12em] text-[#C4A882]">{msg}</span>}
          </div>
        </div>
      )}
    </div>
  )
}
