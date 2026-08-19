'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { thumbUrl } from '@/lib/image-utils'
import {
  createPersonaDraft,
  scoreMoodboard,
  updateStylist,
  computeStylistMask,
  composeSeedSets,
  setStylistLive,
  runStylistBackfill,
  runBrandDemo,
  type StylistListEntry,
} from './actions'
import InspirationReview from './InspirationReview'
import ClientsPanel from './ClientsPanel'

const STATUS_TONE: Record<string, string> = {
  draft: 'text-[#8B5E00] border-[#E8D9B8]',
  seeding: 'text-[#4A6FA5] border-[#C7D4E8]',
  live: 'text-[#3D7A50] border-[#C9E0CF]',
  paused: 'text-[#B83A3A] border-[#E8B4B4]',
}

export default function StylistsClient({
  stylists,
  brands,
}: {
  stylists: StylistListEntry[]
  brands: { brand_id: string; name: string }[]
}) {
  const router = useRouter()
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  // New persona form
  const [newName, setNewName] = useState('')
  const [newMoodboard, setNewMoodboard] = useState('')
  // Constitution editor
  const [editing, setEditing] = useState<string | null>(null)
  const [inspecting, setInspecting] = useState<string | null>(null)
  const [constitutionText, setConstitutionText] = useState('')
  const [voiceText, setVoiceText] = useState('')
  // Brand demo
  const [demoBrand, setDemoBrand] = useState('')
  const [demoN, setDemoN] = useState(3)

  async function run(label: string, fn: () => Promise<{ error?: string } & Record<string, unknown>>, okMsg: (r: any) => string) {
    setBusy(label)
    setMsg(null)
    const r = await fn()
    setBusy(null)
    setMsg(r.error ? r.error.toUpperCase() : okMsg(r).toUpperCase())
    router.refresh()
  }

  const personaOptions = stylists.map((x) => ({ stylist_id: x.stylist_id, name: x.name }))

  return (
    <div className="space-y-8">
      {msg && <p className="text-[9px] tracking-[0.12em] text-[#C4A882]">{msg}</p>}

      <ClientsPanel personas={personaOptions} />

      {/* Stylist cards */}
      <div className="space-y-4">
        {stylists.map((s) => (
          <div key={s.stylist_id} className="border border-[#E2E0DB] bg-white rounded-[14px] p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-[15px] tracking-[0.08em] text-[#0A0A0A]">{s.name.toUpperCase()}</p>
                  <span className={`border rounded-full px-2 py-0.5 text-[8px] tracking-[0.12em] ${STATUS_TONE[s.status] ?? ''}`}>{s.status.toUpperCase()}</span>
                  <span className="text-[8px] tracking-[0.1em] text-[#A8A8A4]">{s.type.toUpperCase()}</span>
                </div>
                <p className="text-[9px] tracking-[0.06em] text-[#6B6B6B] mt-1">
                  AUTONOMY STAGE {s.autonomy.stage} — {s.autonomy.stageLabel} · {s.liveOutfits} LIVE OUTFITS
                  {s.pendingSeeds > 0 && <span className="text-[#C4A882]"> · {s.pendingSeeds} VARIANTS IN REVIEW QUEUE</span>}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {s.type === 'real' && (
                  <button
                    onClick={() => run('backfill', runStylistBackfill, (r) => `BACKFILL: RANGE SET, ${r.maskRows} MASK ROWS, ${r.outfitsAttributed} OUTFITS ATTRIBUTED, ${r.setsCreated} RETRO SETS`)}
                    disabled={!!busy}
                    className="border border-[#0A0A0A] text-[#4A4E57] px-4 py-1.5 text-[9px] tracking-[0.12em] rounded-full hover:bg-[#0A0A0A] hover:text-white transition-colors disabled:opacity-50"
                  >
                    {busy === 'backfill' ? 'RUNNING…' : 'RUN CHLOE BACKFILL'}
                  </button>
                )}
                {s.type === 'persona' && s.status === 'draft' && (
                  <>
                    <button onClick={() => run(`score-${s.stylist_id}`, () => scoreMoodboard(s.stylist_id), (r) => `MOODBOARD SCORED: ${r.scored} IMAGES (${r.failed} FAILED) — RANGE + DRAFT CONSTITUTION PROPOSED`)} disabled={!!busy} className="border border-[#E2E0DB] px-3 py-1.5 text-[9px] tracking-[0.1em] rounded-full text-[#6B6B6B] hover:border-[#0A0A0A] disabled:opacity-50">
                      {busy === `score-${s.stylist_id}` ? 'SCORING…' : '1 · SCORE MOODBOARD'}
                    </button>
                    <button onClick={() => run(`mask-${s.stylist_id}`, () => computeStylistMask(s.stylist_id), (r) => `MASK: ${r.eligible} ELIGIBLE / ${r.excluded} EXCLUDED`)} disabled={!!busy} className="border border-[#E2E0DB] px-3 py-1.5 text-[9px] tracking-[0.1em] rounded-full text-[#6B6B6B] hover:border-[#0A0A0A] disabled:opacity-50">
                      {busy === `mask-${s.stylist_id}` ? '…' : '2 · COMPUTE MASK'}
                    </button>
                    <button onClick={() => run(`seed-${s.stylist_id}`, () => composeSeedSets(s.stylist_id, 3), (r) => `${r.sets} SEED SETS (${r.staged} VARIANTS) → YOUR REVIEW QUEUE`)} disabled={!!busy} className="border border-[#E2E0DB] px-3 py-1.5 text-[9px] tracking-[0.1em] rounded-full text-[#6B6B6B] hover:border-[#0A0A0A] disabled:opacity-50">
                      {busy === `seed-${s.stylist_id}` ? 'COMPOSING…' : '3 · COMPOSE SEED SETS'}
                    </button>
                  </>
                )}
                {s.type === 'persona' && s.status === 'seeding' && (
                  <button onClick={() => run(`live-${s.stylist_id}`, () => setStylistLive(s.stylist_id), () => `${s.name} IS LIVE`)} disabled={!!busy} className="bg-[#0A0A0A] text-white px-4 py-1.5 text-[9px] tracking-[0.12em] rounded-full hover:opacity-85 disabled:opacity-50">
                    GO LIVE →
                  </button>
                )}
                <button
                  onClick={() => {
                    setEditing(editing === s.stylist_id ? null : s.stylist_id)
                    setConstitutionText(JSON.stringify(s.constitution ?? {}, null, 2))
                    setVoiceText(s.voice_notes ?? '')
                  }}
                  className="border border-[#E2E0DB] px-3 py-1.5 text-[9px] tracking-[0.1em] rounded-full text-[#6B6B6B] hover:border-[#0A0A0A]"
                >
                  {editing === s.stylist_id ? 'CLOSE' : 'EDIT RULES'}
                </button>
                {s.type === 'persona' && (
                  <button
                    onClick={() => setInspecting(inspecting === s.stylist_id ? null : s.stylist_id)}
                    className={`px-3 py-1.5 text-[9px] tracking-[0.1em] rounded-full border transition-colors ${
                      s.envelope_status === 'needs_review'
                        ? 'bg-[#C4A882] text-white border-[#C4A882]'
                        : 'border-[#E2E0DB] text-[#6B6B6B] hover:border-[#0A0A0A]'
                    }`}
                    title="Ingest, vision-score and review the moodboard — only confirmed images shape the envelope"
                  >
                    {inspecting === s.stylist_id ? 'CLOSE INSPIRATION' : 'INSPIRATION & SCORING'}
                  </button>
                )}
              </div>
            </div>

            {/* Moodboard strip */}
            {s.moodboard.length > 0 && (
              <div className="flex gap-2 mt-3 overflow-x-auto">
                {s.moodboard.slice(0, 8).map((m, i) => (
                  <div key={i} className="w-14 h-[72px] rounded-[6px] overflow-hidden bg-[#F2F2F0] flex-shrink-0 relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={thumbUrl(m.url, 300)} alt="" className="w-full h-full object-cover" />
                    {m.vector && <span className="absolute bottom-0.5 right-0.5 bg-[#3D7A50] text-white text-[6px] px-1 rounded">✓</span>}
                  </div>
                ))}
              </div>
            )}

            {/* Scoring review — the surface where the vision pass gets corrected */}
            {inspecting === s.stylist_id && (
              <InspirationReview
                personaId={s.stylist_id}
                personaName={s.name}
                envelopeStatus={s.envelope_status ?? null}
              />
            )}

            {/* Rules editor: constitution JSON + voice notes */}
            {editing === s.stylist_id && (
              <div className="mt-4 border-t border-[#F2F2F2] pt-4 space-y-3">
                <div>
                  <p className="text-[8px] tracking-[0.12em] text-[#A8A8A4] mb-1">CONSTITUTION (JSON — same structure as the House Style Constitution)</p>
                  <textarea
                    value={constitutionText}
                    onChange={(e) => setConstitutionText(e.target.value)}
                    rows={10}
                    className="w-full border border-[#E2E0DB] rounded-[10px] p-3 text-[10px] font-mono text-[#4A4E57] focus:outline-none focus:border-[#0A0A0A]"
                  />
                </div>
                <div>
                  <p className="text-[8px] tracking-[0.12em] text-[#A8A8A4] mb-1">VOICE NOTES (TONE + VOCABULARY FOR LABELS AND FUTURE CHAT)</p>
                  <textarea
                    value={voiceText}
                    onChange={(e) => setVoiceText(e.target.value)}
                    rows={3}
                    className="w-full border border-[#E2E0DB] rounded-[10px] p-3 text-[11px] text-[#4A4E57] focus:outline-none focus:border-[#0A0A0A]"
                  />
                </div>
                <button
                  onClick={() => run(`save-${s.stylist_id}`, () => updateStylist(s.stylist_id, { constitution: constitutionText, voice_notes: voiceText }), () => 'RULES SAVED')}
                  disabled={!!busy}
                  className="bg-[#0A0A0A] text-white px-5 py-2 text-[9px] tracking-[0.14em] rounded-full hover:opacity-85 disabled:opacity-50"
                >
                  SAVE RULES
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* New persona */}
      <div className="border border-[#E2E0DB] bg-white rounded-[14px] p-5">
        <p className="text-[10px] tracking-[0.135em] text-[#6B6B6B] mb-1">NEW PERSONA STYLIST</p>
        <p className="text-[9px] tracking-[0.05em] text-[#A8A8A4] mb-4 max-w-2xl leading-relaxed">
          One shared item library — a persona is a lens over it. Create in draft with moodboard image
          URLs, then: score moodboard → edit + confirm the proposed rules → compute the item mask →
          compose seed sets (they arrive in your review queue tagged with the persona) → go live.
        </p>
        <div className="flex flex-col gap-2 max-w-2xl">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="PERSONA NAME"
            className="border border-[#E2E0DB] rounded-[10px] px-4 py-2.5 text-[11px] tracking-[0.08em] text-[#4A4E57] placeholder:text-[#A8A8A4] focus:outline-none focus:border-[#0A0A0A]"
          />
          <textarea
            value={newMoodboard}
            onChange={(e) => setNewMoodboard(e.target.value)}
            placeholder="MOODBOARD IMAGE URLS — ONE PER LINE"
            rows={4}
            className="border border-[#E2E0DB] rounded-[10px] px-4 py-2.5 text-[10px] tracking-[0.04em] text-[#4A4E57] placeholder:text-[#A8A8A4] focus:outline-none focus:border-[#0A0A0A]"
          />
          <button
            onClick={() => run('create', () => createPersonaDraft(newName, newMoodboard.split('\n')), () => `PERSONA CREATED IN DRAFT`)}
            disabled={!!busy || !newName.trim()}
            className="self-start bg-[#0A0A0A] text-white px-5 py-2 text-[10px] tracking-[0.14em] rounded-full hover:opacity-85 disabled:opacity-50"
          >
            {busy === 'create' ? 'CREATING…' : 'CREATE DRAFT PERSONA'}
          </button>
        </div>
      </div>

      {/* Brand demo mode */}
      <div className="border border-[#E2E0DB] bg-white rounded-[14px] p-5">
        <p className="text-[10px] tracking-[0.135em] text-[#6B6B6B] mb-1">BRAND DEMO MODE</p>
        <p className="text-[9px] tracking-[0.05em] text-[#A8A8A4] mb-4 max-w-2xl leading-relaxed">
          Compose styling sets where every hero piece is from one brand — full constitution and
          confidence gate, output to a DRAFT project, never auto-published. The brand-partnership pitch tool.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={demoBrand}
            onChange={(e) => setDemoBrand(e.target.value)}
            className="border border-[#E2E0DB] rounded-[10px] px-3 py-2.5 text-[11px] tracking-[0.08em] text-[#4A4E57] bg-white focus:outline-none focus:border-[#0A0A0A]"
          >
            <option value="">SELECT BRAND…</option>
            {brands.map((b) => (
              <option key={b.brand_id} value={b.brand_id}>{b.name.toUpperCase()}</option>
            ))}
          </select>
          <select
            value={demoN}
            onChange={(e) => setDemoN(Number(e.target.value))}
            className="border border-[#E2E0DB] rounded-[10px] px-3 py-2.5 text-[11px] tracking-[0.08em] text-[#4A4E57] bg-white focus:outline-none focus:border-[#0A0A0A]"
          >
            {[2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} SETS</option>)}
          </select>
          <button
            onClick={() => run('demo', () => runBrandDemo(demoBrand, demoN), (r) => `BRAND DEMO: ${r.sets} SETS · ${r.outfits} OUTFITS → DRAFT PROJECT`)}
            disabled={!!busy || !demoBrand}
            className="bg-[#0A0A0A] text-white px-5 py-2 text-[10px] tracking-[0.14em] rounded-full hover:opacity-85 disabled:opacity-50"
          >
            {busy === 'demo' ? 'COMPOSING…' : 'COMPOSE BRAND DEMO →'}
          </button>
        </div>
      </div>
    </div>
  )
}
