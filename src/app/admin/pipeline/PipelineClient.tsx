'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { thumbUrl } from '@/lib/image-utils'
import {
  runPipelineBatch,
  fastLaneApprove,
  fastLaneOverride,
  pipelineReject,
  standardApprove,
  runEjectionBackfill,
  type PipelineCard,
} from './actions'

const SLOT_LABEL: Record<string, string> = {
  outerwear: 'OUTERWEAR', top: 'TOP', bottom: 'BOTTOM', dress: 'DRESS',
  shoe: 'SHOES', bag: 'BAG', jewellery: 'JEWELLERY', accessory: 'ACCESSORY',
}

type Busy = Record<string, string | undefined> // card id → action in flight

export default function PipelineClient({ fast, standard }: { fast: PipelineCard[]; standard: PipelineCard[] }) {
  const router = useRouter()
  const [tab, setTab] = useState<'fast' | 'standard'>(fast.length ? 'fast' : 'standard')
  const [busy, setBusy] = useState<Busy>({})
  const [running, startRun] = useTransition()
  const [runMsg, setRunMsg] = useState<string | null>(null)
  const [done, setDone] = useState<Set<string>>(new Set())

  function runBatch() {
    setRunMsg(null)
    startRun(async () => {
      const res = await runPipelineBatch(8)
      setRunMsg(
        res.error
          ? res.error.toUpperCase()
          : `STAGED ${res.staged} OUTFIT${res.staged === 1 ? '' : 'S'} (${res.fast} FAST LANE${res.visionScored ? ` · ${res.visionScored} ITEMS VISION-SCORED` : ''})`,
      )
      router.refresh()
    })
  }

  function backfill() {
    setRunMsg(null)
    startRun(async () => {
      const res = await runEjectionBackfill()
      setRunMsg(res.error ? res.error.toUpperCase() : `BACKFILLED ${res.inserted} EJECTIONS FROM SWAP HISTORY`)
      router.refresh()
    })
  }

  async function act(id: string, kind: 'approve' | 'override' | 'reject' | 'std-approve') {
    setBusy((b) => ({ ...b, [id]: kind }))
    const fn =
      kind === 'approve' ? fastLaneApprove
      : kind === 'override' ? fastLaneOverride
      : kind === 'std-approve' ? standardApprove
      : pipelineReject
    const res: any = await fn(id)
    setBusy((b) => ({ ...b, [id]: undefined }))
    if (!res?.error && kind !== 'override') setDone((d) => new Set(d).add(id))
    if (res?.underStyled) setRunMsg('SET DROPPED BELOW 2 APPROVED VARIANTS — COMPOSING REPLACEMENTS IN THE BACKGROUND.')
    router.refresh()
  }

  const cards = tab === 'fast' ? fast : standard

  // ── Set-aware grouping: variants of one hero review consecutively ──
  // Cards sharing a styling_set_id form a grouped stack with a hero header and
  // "VARIANT N OF M". Ungrouped cards ride solo.
  const groups: { key: string; setId: string | null; cards: PipelineCard[] }[] = []
  {
    const byKey = new Map<string, PipelineCard[]>()
    for (const c of cards) {
      const key = c.styling_set_id ?? `solo-${c.id}`
      const arr = byKey.get(key) ?? []
      arr.push(c)
      byKey.set(key, arr)
    }
    for (const [key, cs] of Array.from(byKey.entries())) {
      groups.push({ key, setId: cs[0].styling_set_id ?? null, cards: cs })
    }
  }

  const DIRECTION_LABEL: Record<string, string> = {
    daytime: 'DAYTIME CASUAL', evening: 'EVENING', layered: 'LAYERED', weekend: 'WEEKEND AWAY',
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {(['fast', 'standard'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-[10px] tracking-[0.14em] rounded-full border transition-colors ${
                tab === t ? 'bg-[#0A0A0A] text-white border-[#0A0A0A]' : 'text-[#6B6B6B] border-[#E2E0DB] hover:border-[#0A0A0A]'
              }`}
            >
              {t === 'fast' ? `⚡ FAST LANE (${fast.length})` : `STANDARD REVIEW (${standard.length})`}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={backfill}
            disabled={running}
            className="border border-[#E2E0DB] text-[#6B6B6B] px-4 py-2 text-[9px] tracking-[0.14em] rounded-full hover:border-[#0A0A0A] transition-colors disabled:opacity-50"
          >
            BACKFILL SWAP HISTORY
          </button>
          <button
            onClick={runBatch}
            disabled={running}
            className="bg-[#0A0A0A] text-white px-5 py-2 text-[10px] tracking-[0.14em] rounded-full hover:opacity-85 transition-opacity disabled:opacity-50"
          >
            {running ? 'COMPOSING…' : '▶ RUN PIPELINE'}
          </button>
        </div>
      </div>
      {runMsg && <p className="text-[9px] tracking-[0.12em] text-[#C4A882]">{runMsg}</p>}

      {cards.length === 0 ? (
        <p className="text-[11px] tracking-[0.12em] text-[#A8A8A4] py-16 text-center">
          {tab === 'fast'
            ? 'NO FAST-LANE OUTFITS PENDING — RUN THE PIPELINE TO STAGE MORE.'
            : 'NO STANDARD-LANE OUTFITS PENDING.'}
        </p>
      ) : tab === 'fast' ? (
        /* Batch grid — grouped by styling set, one tap each */
        <div className="space-y-6">
          {groups.map((g) => {
            const visible = g.cards.filter((c) => !done.has(c.id))
            if (!visible.length) return null
            const total = g.cards[0]?.set_size ?? g.cards.length
            return (
              <div key={g.key} className={g.setId ? 'border border-[#E2E0DB] rounded-[12px] p-3 bg-[#FAFAF8]' : ''}>
                {g.setId && (
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-9 h-12 rounded-[6px] overflow-hidden bg-[#F2F2F0] flex-shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {g.cards[0].anchor?.image_url && (
                        <img src={thumbUrl(g.cards[0].anchor.image_url, 300)} alt="" className="w-full h-full object-cover" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[8px] tracking-[0.16em] text-[#C4A882]">STYLING SET · {total} VARIANT{total === 1 ? '' : 'S'}</p>
                      <p className="text-[10px] tracking-[0.06em] text-[#4A4E57] truncate">
                        {[(g.cards[0].anchor?.brand_name ?? '').toUpperCase(), g.cards[0].anchor?.product_name?.toUpperCase()].filter(Boolean).join(' — ')}
                      </p>
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {visible.map((c, vi) => (
            <div key={c.id} className="border border-[#E2E0DB] bg-white rounded-[10px] overflow-hidden">
              <div className="aspect-[3/4] bg-[#F2F2F0] relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {(c.outfit_image || c.anchor?.image_url) && (
                  <img src={thumbUrl(c.outfit_image ?? c.anchor!.image_url, 600)} alt="" className="w-full h-full object-cover" />
                )}
                <span className="absolute top-1.5 left-1.5 bg-[#3D7A50] text-white text-[7px] tracking-[0.1em] px-1.5 py-0.5 rounded">
                  {((c.confidence ?? 0) * 100).toFixed(0)}
                </span>
                {g.setId && (
                  <span className="absolute top-1.5 right-1.5 bg-[#0A0A0A]/80 text-white text-[7px] tracking-[0.08em] px-1.5 py-0.5 rounded">
                    {vi + 1} OF {total}
                  </span>
                )}
                {c.prerender_status === 'queued' && !c.outfit_image && (
                  <span className="absolute bottom-1.5 left-1.5 bg-white/85 text-[#6B6B6B] text-[7px] tracking-[0.08em] px-1.5 py-0.5 rounded">RENDERING…</span>
                )}
              </div>
              <div className="p-2">
                <p className="text-[8px] tracking-[0.08em] text-[#6B6B6B] truncate">{(c.anchor?.brand_name ?? '').toUpperCase()}</p>
                <p className="text-[9px] tracking-[0.04em] text-[#4A4E57] truncate">{c.anchor?.product_name?.toUpperCase()}</p>
                {c.variant_direction && (
                  <p className="text-[7px] tracking-[0.1em] text-[#C4A882] mt-0.5">{DIRECTION_LABEL[c.variant_direction] ?? c.variant_direction.toUpperCase()}</p>
                )}
                <p className="text-[7px] tracking-[0.06em] text-[#A8A8A4] mt-0.5 truncate">
                  + {c.items.map((i) => SLOT_LABEL[i.slot] ?? i.slot).join(' · ')}
                </p>
                <div className="flex items-center gap-1 mt-2">
                  <button
                    onClick={() => act(c.id, 'approve')}
                    disabled={!!busy[c.id]}
                    className="flex-1 bg-[#0A0A0A] text-white py-1.5 text-[9px] tracking-[0.12em] rounded-full hover:opacity-85 disabled:opacity-50"
                  >
                    {busy[c.id] === 'approve' ? '…' : '✓'}
                  </button>
                  <button
                    onClick={() => act(c.id, 'override')}
                    disabled={!!busy[c.id]}
                    title="Needs edits — moves to standard lane and tightens the gate"
                    className="px-2.5 py-1.5 text-[9px] tracking-[0.1em] border border-[#E2E0DB] text-[#8B5E00] rounded-full hover:border-[#8B5E00] disabled:opacity-50"
                  >
                    ✎
                  </button>
                  <button
                    onClick={() => act(c.id, 'reject')}
                    disabled={!!busy[c.id]}
                    className="px-2.5 py-1.5 text-[9px] tracking-[0.1em] border border-[#E2E0DB] text-[#B83A3A] rounded-full hover:border-[#B83A3A] disabled:opacity-50"
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>
          ))}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        /* Standard lane — grouped by styling set, full cards with reasons */
        <div className="space-y-6">
          {groups.map((g) => {
            const visible = g.cards.filter((c) => !done.has(c.id))
            if (!visible.length) return null
            const total = g.cards[0]?.set_size ?? g.cards.length
            return (
              <div key={g.key} className={g.setId ? 'border border-[#E2E0DB] rounded-[12px] p-3 bg-[#FAFAF8]' : ''}>
                {g.setId && (
                  <p className="text-[8px] tracking-[0.16em] text-[#C4A882] mb-2">
                    STYLING SET · {[(g.cards[0].anchor?.brand_name ?? '').toUpperCase(), g.cards[0].anchor?.product_name?.toUpperCase()].filter(Boolean).join(' — ')}
                  </p>
                )}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {visible.map((c, vi) => (
            <div key={c.id} className="border border-[#E2E0DB] bg-white rounded-[12px] p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[9px] tracking-[0.16em] text-[#6B6B6B]">
                  {(c.anchor?.brand_name ?? '').toUpperCase()} · {c.anchor?.product_name?.toUpperCase()}
                  {g.setId && <span className="ml-2 text-[#C4A882]">VARIANT {vi + 1} OF {total}{c.variant_direction ? ` · ${(DIRECTION_LABEL[c.variant_direction] ?? c.variant_direction).toUpperCase()}` : ''}</span>}
                  {c.overridden && <span className="ml-2 text-[#8B5E00]">OVERRIDE</span>}
                </p>
                <p className="text-[9px] tracking-[0.12em] text-[#A8A8A4]">
                  COHERENCE {((c.base_score ?? 0) * 100).toFixed(0)} · CONFIDENCE {((c.confidence ?? 0) * 100).toFixed(0)}
                </p>
              </div>
              {c.reasons.length > 0 && (
                <ul className="mb-3 space-y-0.5">
                  {c.reasons.map((r, i) => (
                    <li key={i} className="text-[8px] tracking-[0.06em] text-[#8B5E00] leading-relaxed">▲ {r.toUpperCase()}</li>
                  ))}
                </ul>
              )}
              <div className="grid grid-cols-5 gap-1.5 mb-3">
                {c.anchor && (
                  <div className="relative">
                    <div className="aspect-[3/4] rounded-[6px] overflow-hidden bg-[#F2F2F0]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={thumbUrl(c.anchor.image_url, 600)} alt="" className="w-full h-full object-cover" />
                    </div>
                    <span className="absolute top-1 left-1 bg-[#0A0A0A] text-white text-[7px] tracking-[0.1em] px-1 py-0.5 rounded">ANCHOR</span>
                  </div>
                )}
                {c.items.map((it) => (
                  <div key={it.item_id}>
                    <div className="aspect-[3/4] rounded-[6px] overflow-hidden bg-[#F2F2F0]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {it.image_url && <img src={thumbUrl(it.image_url, 600)} alt="" className="w-full h-full object-cover" />}
                    </div>
                    <p className="text-[7px] tracking-[0.1em] text-[#A8A8A4] mt-0.5 truncate">{SLOT_LABEL[it.slot] ?? it.slot}</p>
                    <p className="text-[7px] tracking-[0.06em] text-[#6B6B6B] truncate">{(it.brand_name ?? '').toUpperCase()}</p>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => act(c.id, 'std-approve')}
                  disabled={!!busy[c.id]}
                  className="flex-1 bg-[#0A0A0A] text-white py-2 text-[10px] tracking-[0.16em] rounded-full hover:opacity-85 disabled:opacity-50"
                >
                  {busy[c.id] === 'std-approve' ? 'CREATING…' : 'APPROVE ✓'}
                </button>
                <a
                  href={`/admin/outfit-review`}
                  className="px-4 py-2 text-[10px] tracking-[0.12em] border border-[#E2E0DB] text-[#6B6B6B] rounded-full hover:border-[#0A0A0A] transition-colors"
                >
                  EDIT IN REVIEW
                </a>
                <button
                  onClick={() => act(c.id, 'reject')}
                  disabled={!!busy[c.id]}
                  className="px-4 py-2 text-[10px] tracking-[0.12em] border border-[#E2E0DB] text-[#B83A3A] rounded-full hover:border-[#B83A3A] disabled:opacity-50"
                >
                  REJECT
                </button>
              </div>
            </div>
          ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
