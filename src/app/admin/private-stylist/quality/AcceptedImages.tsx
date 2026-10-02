'use client'

// Accepted Images — the Quality Lab gallery of durable, fidelity-passed,
// still-approved renders. A routine second human approval is deliberately
// absent: the human approved the exact source outfit, the machine fidelity
// check gated the image. The human lever here is the override: NOT GOOD
// ENOUGH (one of three reasons) removes the image immediately; image reasons
// then offer an explicit new render cycle, and an underlying-outfit reason
// offers explicit withdrawal of the approval.
//
// The render queue control is the explicit LOCAL drain: one click processes
// one job, and only on the machine holding the Higgsfield CLI credentials.

import { useCallback, useEffect, useState } from 'react'
import {
  loadAcceptedImagesAction,
  loadRemovedImagesAction,
  loadRenderAttentionAction,
  loadRenderQueueCountsAction,
  markNotGoodEnoughAction,
  regenerateRenderCycleAction,
  withdrawUnderlyingOutfitAction,
  drainQualityRendersAction,
} from './gallery-actions.gated'
import type { AcceptedImageCard, RemovedImageCard, AttentionJob } from '@/lib/outfit-quality/gallery'

const REASONS = [
  { value: 'image_fidelity', label: 'IMAGE FIDELITY — THE RENDER MISREPRESENTS AN ITEM' },
  { value: 'image_quality', label: 'IMAGE QUALITY — THE IMAGE ITSELF IS POOR' },
  { value: 'underlying_outfit', label: 'UNDERLYING OUTFIT — THE COMBINATION IS WRONG' },
] as const

export default function AcceptedImages() {
  const [cards, setCards] = useState<AcceptedImageCard[] | null>(null)
  const [removed, setRemoved] = useState<RemovedImageCard[]>([])
  const [attention, setAttention] = useState<AttentionJob[]>([])
  const [counts, setCounts] = useState<{ queued: number; running: number }>({ queued: 0, running: 0 })
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  /** Locally retained cards that were just overridden, so their explicit next action stays reachable. */
  const [justRemoved, setJustRemoved] = useState<Record<string, { card: AcceptedImageCard; actions: ('regenerate' | 'withdraw')[] }>>({})

  const refresh = useCallback(async () => {
    const [c, r, a, q] = await Promise.all([
      loadAcceptedImagesAction(),
      loadRemovedImagesAction(),
      loadRenderAttentionAction(),
      loadRenderQueueCountsAction(),
    ])
    setCards(c)
    setRemoved(r)
    setAttention(a)
    setCounts(q)
  }, [])

  useEffect(() => {
    refresh().catch((e) => setMsg(String(e)))
  }, [refresh])

  async function run(key: string, fn: () => Promise<any>, ok: string) {
    setBusy(key)
    setMsg(null)
    try {
      const r = await fn()
      if (r?.ok === false) setMsg(`${r.code}: ${r.message}`.toUpperCase())
      else if (r?.error) setMsg(String(r.error).toUpperCase())
      else setMsg(ok)
      await refresh()
      return r
    } catch (e) {
      setMsg(`FAILED: ${e instanceof Error ? e.message : String(e)}`.toUpperCase())
      return { ok: false }
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      {msg && <p className="text-[20px] tracking-[0.12em] text-[#C4A882] mb-6" role="status">{msg}</p>}

      {/* ── Render queue: explicit local drain ─────────────────────────── */}
      <section className="border border-[#E2E0DB] p-6 mb-10" aria-label="Render queue">
        <h2 className="text-[22px] tracking-[0.14em] text-[#0A0A0A] mb-3">RENDER QUEUE</h2>
        <p className="text-[18px] tracking-[0.08em] text-[#6B6B6B]">
          {counts.queued} QUEUED · {counts.running} RUNNING — RENDERS RUN ONLY ON THIS LOCAL MACHINE (HIGGSFIELD CLI), ONE JOB PER CLICK
        </p>
        <button
          onClick={() =>
            run('drain', async () => {
              const r = await drainQualityRendersAction({ maxJobs: 1 })
              if (r.skipped) return { ok: false, code: 'no_renderer', message: r.skipped }
              return { ok: true, ...r }
            }, 'RENDER JOB PROCESSED')
          }
          disabled={busy === 'drain' || counts.queued === 0}
          className="mt-4 border border-[#0A0A0A] px-6 py-2 text-[18px] tracking-[0.16em] text-[#0A0A0A] hover:bg-[#0A0A0A] hover:text-white disabled:opacity-40"
        >
          {busy === 'drain' ? 'RENDERING… (CAN TAKE MINUTES)' : 'PROCESS NEXT RENDER (LOCAL)'}
        </button>

        {attention.length > 0 && (
          <div className="mt-6" aria-label="Renders requiring attention">
            <h3 className="text-[18px] tracking-[0.14em] text-[#B83A3A] mb-2">REQUIRES ATTENTION ({attention.length})</h3>
            {attention.map((j) => (
              <p key={j.render_job_id} className="text-[16px] tracking-[0.06em] text-[#6B6B6B]">
                JOB {j.render_job_id.slice(0, 8)} · CYCLE {j.cycle_no} · {j.generation_count} GENERATION(S) — {j.last_error ?? 'NO DETAIL'}
              </p>
            ))}
          </div>
        )}
      </section>

      {/* ── Accepted images ────────────────────────────────────────────── */}
      <section aria-label="Accepted images">
        <h2 className="text-[22px] tracking-[0.14em] text-[#0A0A0A] mb-5">ACCEPTED IMAGES</h2>
        {cards === null && <p className="text-[20px] tracking-[0.12em] text-[#6B6B6B]">LOADING…</p>}
        {cards !== null && cards.length === 0 && Object.keys(justRemoved).length === 0 && (
          <p className="text-[18px] tracking-[0.1em] text-[#6B6B6B]">No accepted images yet. Approve a candidate in the review queue, then process its render locally.</p>
        )}
        <div className="flex flex-col gap-8">
          {(cards ?? []).map((c) => (
            <AcceptedCard
              key={c.render_attempt_id}
              card={c}
              busy={busy}
              onOverride={async (reason, note, key) => {
                const r = await markNotGoodEnoughAction(c.render_attempt_id, { reason, note, idempotencyKey: key })
                if (r.ok) {
                  setJustRemoved((m) => ({ ...m, [c.render_attempt_id]: { card: c, actions: r.nextActions } }))
                  await refresh()
                }
                return r
              }}
              run={run}
            />
          ))}
          {Object.entries(justRemoved).map(([id, { card, actions }]) =>
            cards?.some((c) => c.render_attempt_id === id) ? null : (
              <RemovedPendingCard
                key={id}
                attemptId={id}
                imageUrl={card.image_url}
                reason={null}
                note={null}
                actions={actions}
                busy={busy}
                run={run}
                onDone={() => setJustRemoved((m) => { const n = { ...m }; delete n[id]; return n })}
              />
            ),
          )}
        </div>
      </section>

      {/* ── Previously removed, action still pending ────────────────────── */}
      {removed.filter((r) => r.actions.length > 0 && !justRemoved[r.render_attempt_id]).length > 0 && (
        <section className="mt-10" aria-label="Removed images pending action">
          <h2 className="text-[22px] tracking-[0.14em] text-[#0A0A0A] mb-5">REMOVED — ACTION PENDING</h2>
          <div className="flex flex-col gap-8">
            {removed
              .filter((r) => r.actions.length > 0 && !justRemoved[r.render_attempt_id])
              .map((r) => (
                <RemovedPendingCard
                  key={r.render_attempt_id}
                  attemptId={r.render_attempt_id}
                  imageUrl={r.image_url}
                  reason={r.reason}
                  note={r.note}
                  actions={r.actions}
                  busy={busy}
                  run={run}
                  onDone={() => refresh()}
                />
              ))}
          </div>
        </section>
      )}
    </div>
  )
}

function AcceptedCard({
  card,
  busy,
  onOverride,
  run,
}: {
  card: AcceptedImageCard
  busy: string | null
  onOverride: (reason: string, note: string | null, key: string) => Promise<any>
  run: (key: string, fn: () => Promise<any>, ok: string) => Promise<any>
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<string>('')
  const [note, setNote] = useState('')

  return (
    <article className="border border-[#E2E0DB] p-5" aria-label={`Accepted image ${card.render_attempt_id.slice(0, 8)}`}>
      <div className="flex gap-6 flex-wrap">
        <figure className="w-56">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={card.image_url} alt={`Generated editorial render, cycle ${card.cycle_no} attempt ${card.attempt_no}`} className="w-56 h-72 object-cover border border-[#EDEBE6]" />
          <figcaption className="text-[13px] text-[#6B6B6B] mt-1">GENERATED · CYCLE {card.cycle_no} · ATTEMPT {card.attempt_no}</figcaption>
        </figure>
        <div>
          <p className="text-[16px] tracking-[0.1em] text-[#6B6B6B] mb-2">FROZEN SOURCE ITEMS</p>
          <div className="flex gap-2 flex-wrap">
            {card.items.map((it) => (
              <figure key={it.candidate_item_id} className="w-20">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={it.source_image_url} alt={`${it.slot}: ${it.label}`} className="w-20 h-24 object-cover border border-[#EDEBE6]" />
                <figcaption className="text-[13px] text-[#6B6B6B] mt-1">{it.slot.toUpperCase()}</figcaption>
              </figure>
            ))}
          </div>
        </div>
        <div className="text-[16px] tracking-[0.08em] text-[#6B6B6B]">
          <p>STYLIST: {(card.stylist_name ?? card.stylist_id).toUpperCase()}</p>
          <p>CONTEXT: {card.context_type === 'real_member' ? 'REAL MEMBER' : 'EVALUATION PROFILE'}</p>
          <p>PARTITION: {card.data_partition.toUpperCase()}</p>
          <p>FIDELITY: {card.fidelity.status.toUpperCase()}{card.fidelity.score !== null ? ` · ${Math.round(card.fidelity.score * 100)}%` : ''}{card.fidelity.issueCount > 0 ? ` · ${card.fidelity.issueCount} ISSUE(S)` : ''}</p>
          <p>HISTORY: {card.attempts.map((a) => `C${a.cycle_no}A${a.attempt_no}${a.ready_at ? '✓' : '·'}`).join(' ')}</p>
        </div>
      </div>

      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="mt-4 border border-[#B83A3A] px-5 py-2 text-[16px] tracking-[0.14em] text-[#B83A3A]"
        >
          NOT GOOD ENOUGH
        </button>
      ) : (
        <fieldset className="mt-4 border border-[#EDEBE6] p-4" aria-label="Not good enough reason">
          <legend className="text-[16px] tracking-[0.1em] text-[#6B6B6B]">REASON (REQUIRED) — REMOVES THE IMAGE IMMEDIATELY</legend>
          {REASONS.map((r) => (
            <label key={r.value} className="flex items-center gap-2 text-[16px] text-[#0A0A0A] mt-2">
              <input type="radio" name={`nge-${card.render_attempt_id}`} checked={reason === r.value} onChange={() => setReason(r.value)} />
              {r.label}
            </label>
          ))}
          <label className="flex flex-col gap-1 mt-3 text-[14px] tracking-[0.08em] text-[#6B6B6B]">
            NOTE (OPTIONAL)
            <input value={note} onChange={(e) => setNote(e.target.value)} className="border border-[#D8D5CF] px-2 py-1 text-[16px]" aria-label="Override note" />
          </label>
          <div className="mt-3 flex gap-3">
            <button
              disabled={!reason || busy === `nge-${card.render_attempt_id}`}
              onClick={() =>
                run(`nge-${card.render_attempt_id}`, () => onOverride(reason, note || null, crypto.randomUUID()), 'IMAGE REMOVED FROM ACCEPTED')
              }
              className="border border-[#B83A3A] px-5 py-2 text-[16px] tracking-[0.14em] text-[#B83A3A] disabled:opacity-40"
            >
              CONFIRM REMOVAL
            </button>
            <button onClick={() => setOpen(false)} className="px-5 py-2 text-[16px] tracking-[0.14em] text-[#6B6B6B]">
              CANCEL
            </button>
          </div>
        </fieldset>
      )}
    </article>
  )
}

function RemovedPendingCard({
  attemptId,
  imageUrl,
  reason,
  note,
  actions,
  busy,
  run,
  onDone,
}: {
  attemptId: string
  imageUrl: string
  reason: string | null
  note: string | null
  actions: ('regenerate' | 'withdraw')[]
  busy: string | null
  run: (key: string, fn: () => Promise<any>, ok: string) => Promise<any>
  onDone: () => void
}) {
  return (
    <article className="border border-[#B83A3A] p-5" aria-label={`Removed image ${attemptId.slice(0, 8)}`}>
      <div className="flex gap-6 items-start flex-wrap">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt="Removed render" className="w-32 h-40 object-cover border border-[#EDEBE6] opacity-60" />
        <div className="text-[16px] tracking-[0.08em] text-[#6B6B6B]">
          <p className="text-[#B83A3A]">REMOVED FROM ACCEPTED{reason ? ` — ${reason.replace(/_/g, ' ').toUpperCase()}` : ''}</p>
          {note && <p>NOTE: {note}</p>}
          <div className="mt-3 flex gap-3">
            {actions.includes('regenerate') && (
              <button
                disabled={busy === `regen-${attemptId}`}
                onClick={async () => {
                  const r = await run(`regen-${attemptId}`, () => regenerateRenderCycleAction(attemptId, { idempotencyKey: crypto.randomUUID() }), 'NEW RENDER CYCLE QUEUED — PROCESS IT LOCALLY')
                  if (r?.ok) onDone()
                }}
                className="border border-[#0A0A0A] px-5 py-2 text-[16px] tracking-[0.14em] text-[#0A0A0A] hover:bg-[#0A0A0A] hover:text-white disabled:opacity-40"
              >
                REGENERATE (NEW CYCLE)
              </button>
            )}
            {actions.includes('withdraw') && (
              <button
                disabled={busy === `wd-${attemptId}`}
                onClick={async () => {
                  const r = await run(`wd-${attemptId}`, () => withdrawUnderlyingOutfitAction(attemptId, { idempotencyKey: crypto.randomUUID() }), 'APPROVAL WITHDRAWN — OUTFIT REJECTED, HISTORY PRESERVED')
                  if (r?.ok) onDone()
                }}
                className="border border-[#B83A3A] px-5 py-2 text-[16px] tracking-[0.14em] text-[#B83A3A] disabled:opacity-40"
              >
                WITHDRAW OUTFIT (REMOVE APPROVAL)
              </button>
            )}
            {actions.length === 0 && <p>NO ACTION AVAILABLE — APPROVAL NO LONGER ACTIVE</p>}
          </div>
        </div>
      </div>
    </article>
  )
}
