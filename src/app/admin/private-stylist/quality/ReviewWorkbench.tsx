'use client'

// The Outfit Quality review workbench: every frozen source item side by side,
// the selected stylist and context, and a rules-only status — with NO generated
// image and NO machine verdict before the human decision persists. Verdicts
// are exactly Yes / structured No. Hold is a disposition, not a verdict. Undo
// and withdrawal append reversals; nothing is erased.
//
// Keyboard: Y yes · N begin no · H hold · V history · J/K move. Shortcuts are
// inert while typing in any editable control or while a form owns the moment,
// and they run the same validation and mutation path as the buttons.

import { useCallback, useEffect, useRef, useState } from 'react'
import RulesOnlyBadge from './RulesOnlyBadge'
import {
  loadReviewQueueAction,
  decideCandidateAction,
  undoCandidateDecisionAction,
  withdrawCandidateApprovalAction,
  holdCandidateAction,
  releaseCandidateAction,
  loadCaseHistoryAction,
} from './review-actions.gated'
import { editQualityCandidate } from './actions.gated'
import { REVIEW_REASONS, reasonRequiresItem, reviewReason } from '@/lib/outfit-quality/review-reasons'
import { REVIEW_SHORTCUTS, reviewShortcutForKey } from '@/lib/outfit-quality/review-keyboard'
import { canEditAsNewVersion } from '@/lib/outfit-quality/review-state'
import type { ReviewCard, ReviewFilters, ReviewQueueResult, CaseHistory } from '@/lib/outfit-quality/review-read'

const PARTITIONS = ['test', 'training', 'validation', 'holdout', 'synthetic'] as const
const selectCls = 'border border-[#D8D5CF] px-3 py-2 text-[18px] text-[#0A0A0A] bg-white'
const btnDark = 'border border-[#0A0A0A] bg-[#0A0A0A] text-white px-5 py-2 text-[16px] tracking-[0.14em] hover:opacity-85 disabled:opacity-40'
const btnLight = 'border border-[#0A0A0A] px-5 py-2 text-[16px] tracking-[0.14em] text-[#0A0A0A] hover:bg-[#F2F2F2] disabled:opacity-40'
const btnWarn = 'border border-[#B83A3A] px-5 py-2 text-[16px] tracking-[0.14em] text-[#B83A3A] hover:bg-[#FBF3F3] disabled:opacity-40'

type FormState =
  | { kind: 'no'; versionId: string }
  | { kind: 'hold'; versionId: string }
  | { kind: 'edit'; versionId: string }
  | { kind: 'withdraw'; versionId: string }
  | null

export default function ReviewWorkbench() {
  const [queue, setQueue] = useState<ReviewQueueResult | null>(null)
  const [filters, setFilters] = useState<{ partition: string; stylistId: string; contextType: string; disposition: string }>({
    partition: '',
    stylistId: '',
    contextType: '',
    disposition: 'active',
  })
  const [focusIdx, setFocusIdx] = useState(0)
  const [form, setForm] = useState<FormState>(null)
  const [historyFor, setHistoryFor] = useState<string | null>(null) // case_id
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  // One idempotency key per in-flight logical action; regenerated on settle so
  // a deliberate second action is new work, while a retried click replays.
  const keysRef = useRef(new Map<string, string>())
  const keyFor = (scope: string) => {
    const existing = keysRef.current.get(scope)
    if (existing) return existing
    const k = crypto.randomUUID()
    keysRef.current.set(scope, k)
    return k
  }
  const clearKey = (scope: string) => keysRef.current.delete(scope)

  const cards = queue?.cards ?? []
  const focused = cards[Math.min(focusIdx, Math.max(cards.length - 1, 0))] ?? null

  const refresh = useCallback(async (f = filters) => {
    const active: ReviewFilters = {
      partition: f.partition || null,
      stylistId: f.stylistId || null,
      contextType: (f.contextType || null) as ReviewFilters['contextType'],
      disposition: (f.disposition || 'active') as ReviewFilters['disposition'],
    }
    const q = await loadReviewQueueAction(active)
    setQueue(q)
    setFocusIdx((i) => Math.min(i, Math.max(q.cards.length - 1, 0)))
  }, [filters])

  useEffect(() => {
    refresh().catch((e) => setMsg(String(e instanceof Error ? e.message : e).toUpperCase()))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.partition, filters.stylistId, filters.contextType, filters.disposition])

  async function run(scope: string, fn: () => Promise<any>, ok: string) {
    setBusy(scope)
    setMsg(null)
    try {
      const r = await fn()
      if (r?.error || (r && r.ok === false)) setMsg(String(r.error ?? r.message ?? r.code).toUpperCase())
      else setMsg(ok)
      await refresh()
      return r
    } catch (e) {
      setMsg(`FAILED: ${e instanceof Error ? e.message : String(e)}`.toUpperCase())
      return { ok: false, code: 'exception', message: String(e) }
    } finally {
      setBusy(null)
      clearKey(scope)
    }
  }

  // ── Keyboard ─────────────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && form) {
        setForm(null)
        return
      }
      // A form/dialog owns every other keystroke while it is open.
      if (form) return
      const action = reviewShortcutForKey(e.key, e.target, e)
      if (!action) return
      const card = cards[Math.min(focusIdx, Math.max(cards.length - 1, 0))]
      if (action === 'next' || action === 'prev') {
        e.preventDefault()
        const next = Math.max(0, Math.min(cards.length - 1, focusIdx + (action === 'next' ? 1 : -1)))
        setFocusIdx(next)
        document.getElementById(`oq-review-card-${cards[next]?.candidate_version_id}`)?.scrollIntoView({ block: 'nearest' })
        return
      }
      if (!card) return
      e.preventDefault()
      if (action === 'yes' && card.disposition === 'active') submitYes(card)
      else if (action === 'no' && card.disposition === 'active') setForm({ kind: 'no', versionId: card.candidate_version_id })
      else if (action === 'hold' && card.disposition === 'active') setForm({ kind: 'hold', versionId: card.candidate_version_id })
      else if (action === 'history') setHistoryFor((h) => (h === card.case_id ? null : card.case_id))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, focusIdx, form, busy])

  async function submitYes(card: ReviewCard) {
    const scope = `decide-${card.candidate_version_id}`
    await run(scope, () => decideCandidateAction(card.candidate_version_id, { decision: 'yes', idempotencyKey: keyFor(scope) }), 'APPROVED — EXACT VERSION · RENDER CYCLE QUEUED · MACHINE RESULT BELOW')
  }

  function resetFilters() {
    setFilters({ partition: '', stylistId: '', contextType: '', disposition: 'active' })
  }

  if (!queue) {
    return <p className="text-[20px] tracking-[0.12em] text-[#6B6B6B]">LOADING REVIEW QUEUE…</p>
  }

  return (
    <div>
      {/* aria-live status for every mutation outcome and validation error */}
      <div aria-live="polite" role="status" className="min-h-[28px]">
        {msg && <p className="text-[20px] tracking-[0.12em] text-[#9A7B45] mb-4">{msg}</p>}
      </div>

      {/* ── Counts + composable filters ─────────────────────────────────── */}
      <section aria-label="Queue filters and counts" className="border border-[#E2E0DB] p-5 mb-8">
        <p className="text-[20px] tracking-[0.14em] text-[#0A0A0A] mb-4">
          QUEUE — {queue.counts.active} ACTIVE · {queue.counts.held} HELD · {queue.counts.reviewed} REVIEWED
        </p>
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-[16px] tracking-[0.1em] text-[#6B6B6B]">
            PARTITION
            <select className={selectCls} value={filters.partition} onChange={(e) => setFilters({ ...filters, partition: e.target.value })} aria-label="Filter by dataset partition">
              <option value="">ALL PARTITIONS</option>
              {PARTITIONS.map((p) => (
                <option key={p} value={p}>{p.toUpperCase()}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[16px] tracking-[0.1em] text-[#6B6B6B]">
            STYLIST
            <select className={selectCls} value={filters.stylistId} onChange={(e) => setFilters({ ...filters, stylistId: e.target.value })} aria-label="Filter by selected stylist">
              <option value="">ALL STYLISTS</option>
              {queue.stylists.map((s) => (
                <option key={s.stylist_id} value={s.stylist_id}>{s.name}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[16px] tracking-[0.1em] text-[#6B6B6B]">
            CONTEXT
            <select className={selectCls} value={filters.contextType} onChange={(e) => setFilters({ ...filters, contextType: e.target.value })} aria-label="Filter by context type">
              <option value="">ALL CONTEXTS</option>
              <option value="real_member">REAL MEMBER</option>
              <option value="evaluation_profile">EVALUATION PROFILE</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[16px] tracking-[0.1em] text-[#6B6B6B]">
            QUEUE
            <select className={selectCls} value={filters.disposition} onChange={(e) => setFilters({ ...filters, disposition: e.target.value })} aria-label="Filter by queue disposition">
              <option value="active">ACTIVE</option>
              <option value="held">HELD</option>
              <option value="reviewed">REVIEWED</option>
              <option value="all">ALL</option>
            </select>
          </label>
          <button className={btnLight} onClick={resetFilters}>RESET FILTERS</button>
        </div>
        <p className="mt-4 text-[16px] tracking-[0.08em] text-[#6B6B6B]">
          KEYS:{' '}
          {REVIEW_SHORTCUTS.map((s) => `${s.key} ${s.action === 'yes' ? 'YES' : s.action === 'no' ? 'BEGIN NO' : s.action === 'hold' ? 'HOLD' : s.action === 'history' ? 'HISTORY' : s.action === 'next' ? 'NEXT' : 'PREV'}`).join(' · ')}
          {' '}— INERT WHILE TYPING
        </p>
      </section>

      {cards.length === 0 && (
        <p className="text-[18px] tracking-[0.1em] text-[#6B6B6B]">NOTHING IN THIS VIEW — ADJUST OR RESET THE FILTERS.</p>
      )}

      <div className="flex flex-col gap-6">
        {cards.map((card, idx) => (
          <ReviewCardView
            key={card.candidate_version_id}
            card={card}
            focused={idx === focusIdx}
            busy={busy}
            form={form}
            setForm={setForm}
            historyOpen={historyFor === card.case_id}
            toggleHistory={() => setHistoryFor((h) => (h === card.case_id ? null : card.case_id))}
            onFocus={() => setFocusIdx(idx)}
            run={run}
            keyFor={keyFor}
          />
        ))}
      </div>
    </div>
  )
}

// ── One review card ───────────────────────────────────────────────────────────

function ReviewCardView({
  card,
  focused,
  busy,
  form,
  setForm,
  historyOpen,
  toggleHistory,
  onFocus,
  run,
  keyFor,
}: {
  card: ReviewCard
  focused: boolean
  busy: string | null
  form: FormState
  setForm: (f: FormState) => void
  historyOpen: boolean
  toggleHistory: () => void
  onFocus: () => void
  run: (scope: string, fn: () => Promise<any>, ok: string) => Promise<any>
  keyFor: (scope: string) => string
}) {
  const vid = card.candidate_version_id
  const shortId = vid.slice(0, 8)
  // Every disposition carries an accurate text state — never colour alone and
  // never a fall-through that calls a withdrawn or failed version "awaiting".
  const stateLabel =
    card.disposition === 'held'
      ? 'HELD'
      : card.state === 'approval_withdrawn'
        ? 'APPROVAL WITHDRAWN'
        : card.decision === 'yes'
          ? 'REVIEWED — YES'
          : card.decision === 'no'
            ? 'REVIEWED — NO'
            : card.disposition === 'active'
              ? 'AWAITING REVIEW'
              : card.state.replace(/_/g, ' ').toUpperCase()

  const scope = `decide-${vid}`

  async function submitYes() {
    await run(scope, () => decideCandidateAction(vid, { decision: 'yes', idempotencyKey: keyFor(scope) }), 'APPROVED — EXACT VERSION · RENDER CYCLE QUEUED · MACHINE RESULT BELOW')
  }

  return (
    <article
      id={`oq-review-card-${vid}`}
      aria-label={`Candidate version ${card.version_no}, ${stateLabel.toLowerCase()}, ${card.items.length} items`}
      aria-current={focused ? 'true' : undefined}
      onClick={onFocus}
      className={`border p-5 ${focused ? 'border-[#0A0A0A]' : 'border-[#E2E0DB]'}`}
    >
      <div className="flex items-center gap-4 flex-wrap">
        <span className="text-[18px] tracking-[0.14em] text-[#0A0A0A]">
          CANDIDATE V{card.version_no} · {shortId}
          {!card.is_current && <span className="text-[#B83A3A]"> · SUPERSEDED BY A NEWER VERSION</span>}
        </span>
        <span className="text-[18px] tracking-[0.14em] text-[#9A7B45]">{stateLabel}</span>
        {focused && <span className="text-[16px] tracking-[0.14em] text-[#6B6B6B]">◂ KEYBOARD FOCUS</span>}
        {card.rules_only && <RulesOnlyBadge />}
      </div>

      <p className="mt-2 text-[18px] tracking-[0.1em] text-[#6B6B6B]">
        {card.context_type === 'real_member' ? 'REAL MEMBER' : 'EVALUATION PROFILE'}: {card.context_label}
        {' · '}STYLIST: {card.stylist_name ?? card.selected_stylist_id}
        {' · '}PARTITION: {card.data_partition.toUpperCase()}
      </p>

      {card.has_subjective_check && !card.decision && (
        <p className="mt-1 text-[16px] tracking-[0.1em] text-[#6B6B6B]">MACHINE CHECK ON FILE — REVEALED ONLY AFTER YOUR DECISION IS SAVED</p>
      )}

      {/* Frozen source items, side by side, in manifest order. No generated
          image exists or is requested anywhere in this view. */}
      <div className="mt-3 flex gap-3 flex-wrap" role="group" aria-label={`Frozen source items for candidate version ${card.version_no}`}>
        {card.items.map((it, i) => (
          <figure key={it.candidate_item_id} className="w-28">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={it.source_image_url}
              alt={`Item ${i + 1} of ${card.items.length}, ${it.slot}: ${String(it.item_snapshot?.brand ?? '')} ${String(it.item_snapshot?.item_type ?? 'item')}`.trim()}
              className="w-28 h-36 object-cover border border-[#EDEBE6]"
            />
            <figcaption className="text-[13px] text-[#6B6B6B] mt-1 leading-snug">
              {it.slot.toUpperCase()} · {String(it.item_snapshot?.brand ?? '—').toUpperCase()}
              <br />
              <span className="text-[#A8A8A4]">ITEM {it.candidate_item_id.slice(0, 8)}</span>
            </figcaption>
          </figure>
        ))}
      </div>

      {/* Decided: the machine result is now revealed for this exact version. */}
      {card.decision && (
        <div className="mt-3 border border-[#EDEBE6] bg-[#FCFCFA] p-3" aria-label="Revealed machine result">
          <p className="text-[16px] tracking-[0.12em] text-[#6B6B6B]">
            YOUR DECISION: {card.decision.toUpperCase()}
            {card.reason_code ? ` — ${reviewReason(card.reason_code)?.label ?? card.reason_code}` : ''}
            {card.decided_item_id ? ` · ITEM ${card.decided_item_id.slice(0, 8)}` : ''}
            {' · BY '}{(card.reviewer_user_id ?? '').slice(0, 8)} · {card.decided_at ? new Date(card.decided_at).toLocaleString() : ''}
          </p>
          {card.machine && card.machine.length > 0 ? (
            card.machine.map((m, i) => (
              <p key={i} className="mt-1 text-[16px] tracking-[0.08em] text-[#0A0A0A]">
                MACHINE RESULT (REVEALED AFTER YOUR DECISION): {(m.verdict ?? m.status).toUpperCase()}
                {typeof m.score === 'number' ? ` · SCORE ${m.score}` : ''}
                {m.issues ? ` · ${JSON.stringify(m.issues)}` : ''}
              </p>
            ))
          ) : (
            <p className="mt-1 text-[16px] tracking-[0.08em] text-[#6B6B6B]">MACHINE RESULT: NONE RECORDED FOR THIS VERSION</p>
          )}
          {card.render_status && (
            <p className="mt-1 text-[16px] tracking-[0.1em] text-[#6B6B6B]">RENDER: {card.render_status.toUpperCase()}</p>
          )}
        </div>
      )}

      {card.hold && (
        <p className="mt-2 text-[16px] tracking-[0.1em] text-[#9A7B45]">
          ON HOLD BY {card.hold.held_by.slice(0, 8)} · {new Date(card.hold.created_at).toLocaleString()}
          {card.hold.reason ? ` — ${card.hold.reason}` : ''}
        </p>
      )}

      {/* ── Actions ─────────────────────────────────────────────────────── */}
      <div className="mt-4 flex items-center gap-3 flex-wrap">
        {card.disposition === 'active' && (
          <>
            <button className={btnDark} disabled={busy === scope} onClick={submitYes} aria-label={`Yes — approve candidate version ${card.version_no} exactly as shown`}>
              YES — GOOD AS SHOWN (Y)
            </button>
            <button className={btnLight} onClick={() => setForm({ kind: 'no', versionId: vid })} aria-label={`No — reject candidate version ${card.version_no} with a structured reason`} aria-expanded={form?.kind === 'no' && form.versionId === vid}>
              NO — STRUCTURED REASON (N)
            </button>
            <button className={btnLight} onClick={() => setForm({ kind: 'hold', versionId: vid })} aria-label={`Hold candidate version ${card.version_no}`} aria-expanded={form?.kind === 'hold' && form.versionId === vid}>
              HOLD (H)
            </button>
          </>
        )}
        {/* Editing is offered from any reviewable or reviewed state: it always
            creates a fresh child version and never mutates this card. */}
        {canEditAsNewVersion(card.disposition) && (
          <button className={btnLight} onClick={() => setForm({ kind: 'edit', versionId: vid })} aria-label={`Edit candidate version ${card.version_no} as a new version`} aria-expanded={form?.kind === 'edit' && form.versionId === vid}>
            EDIT AS NEW VERSION
          </button>
        )}
        {card.disposition === 'held' && (
          <button
            className={btnLight}
            disabled={busy === `release-${vid}`}
            onClick={() => run(`release-${vid}`, () => releaseCandidateAction(vid), 'RELEASED — BACK IN THE ACTIVE QUEUE')}
            aria-label={`Release candidate version ${card.version_no} from hold`}
          >
            RELEASE
          </button>
        )}
        {card.decision && card.can_undo && (
          <button
            className={btnLight}
            disabled={busy === `undo-${vid}`}
            onClick={() => run(`undo-${vid}`, () => undoCandidateDecisionAction(vid, { idempotencyKey: keyFor(`undo-${vid}`) }), 'DECISION UNDONE — REVERSAL APPENDED, ORIGINAL PRESERVED')}
            aria-label={`Undo the ${card.decision} decision on candidate version ${card.version_no}`}
          >
            UNDO {card.decision.toUpperCase()}
          </button>
        )}
        {card.decision === 'yes' && (
          <button
            className={btnWarn}
            disabled={busy === `withdraw-${vid}`}
            onClick={() => setForm({ kind: 'withdraw', versionId: vid })}
            aria-label={`Withdraw approval of candidate version ${card.version_no}`}
            aria-expanded={form?.kind === 'withdraw' && form.versionId === vid}
          >
            WITHDRAW APPROVAL
          </button>
        )}
        <button className={btnLight} onClick={toggleHistory} aria-label={`History of case for candidate version ${card.version_no}`} aria-expanded={historyOpen}>
          {historyOpen ? 'HIDE HISTORY' : 'HISTORY (V)'}
        </button>
      </div>

      {form?.kind === 'no' && form.versionId === vid && (
        <NoForm
          card={card}
          busy={busy === scope}
          onCancel={() => setForm(null)}
          onSubmit={async (reasonCode, candidateItemId, note) => {
            const r = await run(scope, () => decideCandidateAction(vid, { decision: 'no', reasonCode, candidateItemId, note, idempotencyKey: keyFor(scope) }), 'REJECTED — STRUCTURED NO RECORDED')
            if (r?.ok) setForm(null)
            return r
          }}
        />
      )}
      {form?.kind === 'hold' && form.versionId === vid && (
        <HoldForm
          busy={busy === `hold-${vid}`}
          onCancel={() => setForm(null)}
          onSubmit={async (reason) => {
            const r = await run(`hold-${vid}`, () => holdCandidateAction(vid, { reason }), 'ON HOLD — OUT OF THE ACTIVE QUEUE, NO VERDICT RECORDED')
            if (r?.ok) setForm(null)
          }}
        />
      )}
      {form?.kind === 'edit' && form.versionId === vid && (
        <EditForm
          card={card}
          busy={busy === `edit-${vid}`}
          onCancel={() => setForm(null)}
          onSubmit={async (items) => {
            const r = await run(`edit-${vid}`, () => editQualityCandidate({ candidateVersionId: vid, items, editKey: keyFor(`edit-${vid}`) }), 'EDITED — A FRESH CHILD VERSION IS NOW IN REVIEW; THE ORIGINAL IS UNCHANGED')
            if (r?.ok) setForm(null)
          }}
        />
      )}
      {form?.kind === 'withdraw' && form.versionId === vid && (
        <WithdrawConfirm
          busy={busy === `withdraw-${vid}`}
          onCancel={() => setForm(null)}
          onConfirm={async (note) => {
            const r = await run(`withdraw-${vid}`, () => withdrawCandidateApprovalAction(vid, { idempotencyKey: keyFor(`withdraw-${vid}`), note }), 'APPROVAL WITHDRAWN — APPENDED TO HISTORY, NOTHING ERASED')
            if (r?.ok) setForm(null)
          }}
        />
      )}

      {historyOpen && <HistoryPanel caseId={card.case_id} />}
    </article>
  )
}

// ── Structured No ─────────────────────────────────────────────────────────────

function NoForm({
  card,
  busy,
  onCancel,
  onSubmit,
}: {
  card: ReviewCard
  busy: boolean
  onCancel: () => void
  onSubmit: (reasonCode: string, candidateItemId: string | null, note: string) => Promise<any>
}) {
  const [reasonCode, setReasonCode] = useState('')
  const [itemId, setItemId] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const reasonRef = useRef<HTMLSelectElement>(null)
  const itemRef = useRef<HTMLSelectElement>(null)

  useEffect(() => {
    reasonRef.current?.focus()
  }, [])

  const needsItem = reasonCode ? reasonRequiresItem(reasonCode) : false

  async function submit() {
    if (!reasonCode) {
      setError('CHOOSE ONE STRUCTURED REASON — A NOTE ALONE IS NOT A REASON')
      reasonRef.current?.focus()
      return
    }
    if (needsItem && !itemId) {
      setError('THIS REASON IS ABOUT ONE ITEM — CHOOSE THE AFFECTED ITEM')
      itemRef.current?.focus()
      return
    }
    setError(null)
    const r = await onSubmit(reasonCode, needsItem ? itemId : null, note)
    if (r && r.ok === false) {
      setError(String(r.message ?? r.code).toUpperCase())
      if (r.code === 'missing_item' || r.code === 'foreign_item') itemRef.current?.focus()
      else reasonRef.current?.focus()
    }
  }

  return (
    <div className="mt-4 border border-[#E2E0DB] p-4" role="group" aria-label={`Structured no for candidate version ${card.version_no}`}>
      <div className="flex flex-wrap gap-4 items-end">
        <label className="flex flex-col gap-1 text-[16px] tracking-[0.1em] text-[#6B6B6B]">
          REASON (REQUIRED)
          <select
            ref={reasonRef}
            className={selectCls}
            value={reasonCode}
            onChange={(e) => { setReasonCode(e.target.value); setItemId(''); setError(null) }}
            aria-label="Structured reason"
            aria-describedby={error ? `no-error-${card.candidate_version_id}` : undefined}
          >
            <option value="">— CHOOSE ONE REASON —</option>
            {REVIEW_REASONS.map((r) => (
              <option key={r.code} value={r.code}>{r.label}</option>
            ))}
          </select>
        </label>

        {needsItem && (
          <label className="flex flex-col gap-1 text-[16px] tracking-[0.1em] text-[#6B6B6B]">
            AFFECTED ITEM (REQUIRED)
            <select ref={itemRef} className={selectCls} value={itemId} onChange={(e) => setItemId(e.target.value)} aria-label="Affected item">
              <option value="">— WHICH ITEM —</option>
              {card.items.map((it, i) => (
                <option key={it.candidate_item_id} value={it.candidate_item_id}>
                  {`ITEM ${i + 1} · ${it.slot.toUpperCase()} · ${String(it.item_snapshot?.brand ?? '—').toUpperCase()}`}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="flex flex-col gap-1 text-[16px] tracking-[0.1em] text-[#6B6B6B] flex-1 min-w-56">
          NOTE (OPTIONAL — NEVER A SUBSTITUTE FOR THE REASON)
          <textarea
            className="border border-[#D8D5CF] px-3 py-2 text-[16px] text-[#0A0A0A] h-16"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-label="Optional supporting note"
          />
        </label>
      </div>

      {error && (
        <p id={`no-error-${card.candidate_version_id}`} role="alert" className="mt-2 text-[16px] tracking-[0.1em] text-[#B83A3A]">
          {error}
        </p>
      )}

      <div className="mt-3 flex gap-3">
        <button className={btnDark} disabled={busy} onClick={submit} aria-label={`Submit no decision for candidate version ${card.version_no}`}>
          {busy ? 'SAVING…' : 'SUBMIT NO'}
        </button>
        <button className={btnLight} onClick={onCancel}>CANCEL</button>
      </div>
    </div>
  )
}

// ── Hold ──────────────────────────────────────────────────────────────────────

function HoldForm({ busy, onCancel, onSubmit }: { busy: boolean; onCancel: () => void; onSubmit: (reason: string) => Promise<any> }) {
  const [reason, setReason] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus() }, [])
  return (
    <div className="mt-4 border border-[#E2E0DB] p-4" role="group" aria-label="Hold this candidate">
      <p className="text-[16px] tracking-[0.1em] text-[#6B6B6B] mb-2">HOLD TAKES THE CANDIDATE OUT OF THE ACTIVE QUEUE. IT RECORDS NO VERDICT AND TEACHES NOTHING.</p>
      <label className="flex flex-col gap-1 text-[16px] tracking-[0.1em] text-[#6B6B6B] max-w-xl">
        REASON (OPTIONAL)
        <input ref={ref} className="border border-[#D8D5CF] px-3 py-2 text-[16px] text-[#0A0A0A]" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Hold reason" />
      </label>
      <div className="mt-3 flex gap-3">
        <button className={btnDark} disabled={busy} onClick={() => onSubmit(reason)}>{busy ? 'HOLDING…' : 'CONFIRM HOLD'}</button>
        <button className={btnLight} onClick={onCancel}>CANCEL</button>
      </div>
    </div>
  )
}

// ── Withdrawal ────────────────────────────────────────────────────────────────

function WithdrawConfirm({ busy, onCancel, onConfirm }: { busy: boolean; onCancel: () => void; onConfirm: (note: string) => Promise<any> }) {
  const [note, setNote] = useState('')
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => { ref.current?.focus() }, [])
  return (
    <div className="mt-4 border border-[#B83A3A] p-4" role="alertdialog" aria-label="Confirm approval withdrawal" aria-describedby="withdraw-explain">
      <p id="withdraw-explain" className="text-[16px] tracking-[0.1em] text-[#B83A3A] mb-2">
        WITHDRAWAL IS EXPLICIT AND APPEND-ONLY: THE APPROVAL IS REVERSED, ANY STILL-QUEUED RENDER IS CANCELLED, AND READY
        OUTPUT LEAVES READY SURFACES. THE ORIGINAL DECISION, RENDER RECORDS, AND LINEAGE REMAIN IN HISTORY.
      </p>
      <label className="flex flex-col gap-1 text-[16px] tracking-[0.1em] text-[#6B6B6B] max-w-xl">
        NOTE (OPTIONAL)
        <input className="border border-[#D8D5CF] px-3 py-2 text-[16px] text-[#0A0A0A]" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Withdrawal note" />
      </label>
      <div className="mt-3 flex gap-3">
        <button ref={ref} className={btnWarn} disabled={busy} onClick={() => onConfirm(note)} aria-label="Confirm withdrawal of this approval">
          {busy ? 'WITHDRAWING…' : 'CONFIRM WITHDRAWAL'}
        </button>
        <button className={btnLight} onClick={onCancel}>CANCEL</button>
      </div>
    </div>
  )
}

// ── Edit as new version ───────────────────────────────────────────────────────

function EditForm({
  card,
  busy,
  onCancel,
  onSubmit,
}: {
  card: ReviewCard
  busy: boolean
  onCancel: () => void
  onSubmit: (items: { item_id: string; slot: string }[]) => Promise<any>
}) {
  const [rows, setRows] = useState<{ item_id: string; slot: string }[]>(card.items.map((it) => ({ item_id: it.item_id, slot: it.slot })))
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { ref.current?.querySelector('input')?.focus() }, [])

  const SLOT_OPTIONS = ['outerwear', 'top', 'bottom', 'dress', 'shoe', 'bag', 'jewellery', 'accessory']

  function submit() {
    const clean = rows.filter((r) => r.item_id.trim())
    if (clean.length === 0) {
      setError('AN EDIT NEEDS AT LEAST ONE ITEM')
      return
    }
    if (new Set(clean.map((r) => r.item_id.trim())).size !== clean.length) {
      setError('THE SAME ITEM CANNOT APPEAR TWICE')
      return
    }
    setError(null)
    onSubmit(clean.map((r) => ({ item_id: r.item_id.trim(), slot: r.slot })))
  }

  return (
    <div ref={ref} className="mt-4 border border-[#E2E0DB] p-4" role="group" aria-label={`Edit candidate version ${card.version_no} as a new version`}>
      <p className="text-[16px] tracking-[0.1em] text-[#6B6B6B] mb-3">
        EDITING CREATES A FRESH CHILD VERSION WITH NEW CHECKS. THE REJECTED ORIGINAL IS NEVER MUTATED AND NEVER BECOMES A POSITIVE.
      </p>
      <div className="flex flex-col gap-2">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <select
              className={selectCls}
              value={r.slot}
              onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, slot: e.target.value } : x)))}
              aria-label={`Slot for edited item ${i + 1}`}
            >
              {SLOT_OPTIONS.map((s) => (
                <option key={s} value={s}>{s.toUpperCase()}</option>
              ))}
            </select>
            <input
              className="border border-[#D8D5CF] px-3 py-2 text-[16px] text-[#0A0A0A] flex-1 font-mono"
              value={r.item_id}
              onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, item_id: e.target.value } : x)))}
              aria-label={`Item id for edited item ${i + 1}`}
            />
            <button className={btnLight} onClick={() => setRows(rows.filter((_, k) => k !== i))} aria-label={`Remove edited item ${i + 1}`}>×</button>
          </div>
        ))}
      </div>
      {error && <p role="alert" className="mt-2 text-[16px] tracking-[0.1em] text-[#B83A3A]">{error}</p>}
      <div className="mt-3 flex gap-3">
        <button className={btnLight} onClick={() => setRows([...rows, { item_id: '', slot: 'top' }])}>ADD ITEM</button>
        <button className={btnDark} disabled={busy} onClick={submit}>{busy ? 'CREATING VERSION…' : 'SAVE AS NEW VERSION'}</button>
        <button className={btnLight} onClick={onCancel}>CANCEL</button>
      </div>
    </div>
  )
}

// ── History ───────────────────────────────────────────────────────────────────

function HistoryPanel({ caseId }: { caseId: string }) {
  const [history, setHistory] = useState<CaseHistory | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    loadCaseHistoryAction(caseId)
      .then((h) => {
        if (!live) return
        if ('error' in h) setErr(h.error)
        else setHistory(h)
      })
      .catch((e) => live && setErr(String(e)))
    return () => { live = false }
  }, [caseId])

  return (
    <div className="mt-4 border border-[#EDEBE6] bg-[#FCFCFA] p-4" role="region" aria-label="Case lineage and event history">
      {err && <p role="alert" className="text-[16px] text-[#B83A3A]">{err.toUpperCase()}</p>}
      {!history && !err && <p className="text-[16px] tracking-[0.1em] text-[#6B6B6B]">LOADING HISTORY…</p>}
      {history && (
        <>
          <p className="text-[16px] tracking-[0.12em] text-[#6B6B6B] mb-2">
            LINEAGE:{' '}
            {history.versions.map((v) => `V${v.version_no} ${v.is_current ? '(CURRENT)' : ''} [${v.state.toUpperCase()}]`).join(' → ') || '—'}
          </p>
          {history.events.length === 0 && history.holds.length === 0 && (
            <p className="text-[16px] tracking-[0.1em] text-[#6B6B6B]">NO REVIEW EVENTS YET.</p>
          )}
          <ol className="flex flex-col gap-1">
            {history.events.map(({ event, effective, label }) => (
              <li key={event.review_event_id} className="text-[16px] tracking-[0.06em] text-[#0A0A0A]">
                <span className="text-[#A8A8A4]">{new Date(event.created_at).toLocaleString()} · </span>
                V{history.versions.find((v) => v.candidate_version_id === event.candidate_version_id)?.version_no ?? '?'} · {label}
                {event.candidate_item_id ? ` · ITEM ${event.candidate_item_id.slice(0, 8)}` : ''}
                {event.note ? ` — “${event.note}”` : ''}
                <span className="text-[#6B6B6B]"> · BY {event.reviewer_user_id.slice(0, 8)}</span>
                {!effective && <span className="text-[#B83A3A]"> · SUPERSEDED</span>}
                <span className="text-[#A8A8A4]"> · EVENT {event.review_event_id.slice(0, 8)}</span>
              </li>
            ))}
            {history.holds.map((h) => (
              <li key={h.hold_id} className="text-[16px] tracking-[0.06em] text-[#6B6B6B]">
                <span className="text-[#A8A8A4]">{new Date(h.created_at).toLocaleString()} · </span>
                HELD BY {h.held_by.slice(0, 8)}{h.reason ? ` — ${h.reason}` : ''}
                {h.released_at ? ` · RELEASED BY ${(h.released_by ?? '').slice(0, 8)} AT ${new Date(h.released_at).toLocaleString()}` : ' · STILL HELD'}
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  )
}
