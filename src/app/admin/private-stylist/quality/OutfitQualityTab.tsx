'use client'

// The Outfit Quality — Batches view. An admin creates a draft batch for exactly
// one context (a real member OR an evaluation profile, shown with distinct
// selectors) and one explicit stylist, starts it to freeze the stylist
// snapshot, and then explicitly generates bounded chunks (≤ 25) toward the
// batch target (≤ 150). RULES ONLY is shown before Start (stylist preview), on
// the batch, and on every associated candidate. No control auto-starts work.

import { useCallback, useEffect, useState } from 'react'
import {
  loadQualityData,
  previewStylist,
  createQualityBatch,
  startQualityBatch,
  pauseQualityBatch,
  resumeQualityBatch,
  generateQualityChunk,
  loadBatchCandidates,
  type QualityData,
} from './actions.gated'
import type { BatchView } from '@/lib/outfit-quality/batch-read'
import type { PreDecisionCandidate } from '@/lib/outfit-quality/queue-read-model'
import RulesOnlyBadge from './RulesOnlyBadge'
import { thumbUrl } from '@/lib/image-utils'
import ReviewWorkbench from './ReviewWorkbench'
import CoverageView from './CoverageView'

const PARTITIONS = ['test', 'training', 'validation', 'holdout', 'synthetic'] as const
type ContextType = 'real_member' | 'evaluation_profile'
// Composition-only release: there is no rendering view. The generated-image
// gallery and its render-queue controls are removed from the Quality Lab.
type QualityView = 'review' | 'batches' | 'coverage'

const VIEW_LABELS: Record<QualityView, string> = {
  review: 'REVIEW QUEUE',
  batches: 'BATCHES',
  coverage: 'COVERAGE',
}

export default function OutfitQualityTab() {
  const [view, setView] = useState<QualityView>('review')
  return (
    <div>
      <div className="flex gap-6 border-b border-[#E2E0DB] mb-8" role="tablist" aria-label="Outfit Quality views">
        {(['review', 'batches', 'coverage'] as const).map((v) => (
          <button
            key={v}
            role="tab"
            aria-selected={view === v}
            onClick={() => setView(v)}
            className={`pb-3 text-[20px] tracking-[0.18em] transition-colors duration-300 ${
              view === v ? 'text-[#0A0A0A] border-b border-[#0A0A0A] -mb-px' : 'text-[#6B6B6B] hover:text-[#0A0A0A]'
            }`}
          >
            {VIEW_LABELS[v]}
          </button>
        ))}
      </div>
      {view === 'review' ? <ReviewWorkbench /> : view === 'batches' ? <BatchesView /> : <CoverageView />}
    </div>
  )
}

function BatchesView() {
  const [data, setData] = useState<QualityData | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Create-form state. TRAINING is the default on purpose: only training
  // reviews teach the stylist anything (see README "Learning scopes").
  const [partition, setPartition] = useState<string>('training')
  const [contextType, setContextType] = useState<ContextType>('evaluation_profile')
  const [memberId, setMemberId] = useState<string>('')
  const [profileId, setProfileId] = useState<string>('')
  const [stylistId, setStylistId] = useState<string>('')
  const [targetCount, setTargetCount] = useState<number>(10)
  const [fromWays, setFromWays] = useState(false)
  const [preview, setPreview] = useState<{ rules_only: boolean; confirmed_count: number } | null>(null)

  const refresh = useCallback(async () => {
    setLoadError(null)
    try {
      const d = await loadQualityData()
      setData(d)
    } catch (e) {
      setLoadError(`COULD NOT LOAD OUTFIT QUALITY: ${e instanceof Error ? e.message : String(e)}`.toUpperCase())
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function run(key: string, fn: () => Promise<any>, ok: string) {
    setBusy(key)
    setMsg(null)
    try {
      const r = await fn()
      if (r?.error) setMsg(String(r.error).toUpperCase())
      else setMsg(ok)
      await refresh()
      return r
    } catch (e) {
      setMsg(`FAILED: ${e instanceof Error ? e.message : String(e)}`.toUpperCase())
      return { error: String(e) }
    } finally {
      setBusy(null)
    }
  }

  async function onStylistChange(id: string) {
    setStylistId(id)
    setPreview(null)
    if (!id) return
    const p = await previewStylist(id)
    if (!('error' in p)) setPreview({ rules_only: p.rules_only, confirmed_count: p.confirmed_count })
  }

  async function onCreate() {
    await run(
      'create',
      () =>
        createQualityBatch({
          dataPartition: partition,
          realMemberId: contextType === 'real_member' ? memberId : null,
          evaluationProfileId: contextType === 'evaluation_profile' ? profileId : null,
          selectedStylistId: stylistId,
          targetCount,
          source: fromWays && contextType === 'real_member' ? 'styled_ways' : 'composer',
        }),
      'DRAFT BATCH CREATED (ZERO CANDIDATES)',
    )
  }

  if (!data) {
    if (loadError) {
      return (
        <div>
          <p className="text-[20px] tracking-[0.12em] text-[#B83A3A] mb-4">{loadError}</p>
          <button type="button" onClick={() => void refresh()} className="border border-[#0A0A0A] px-5 py-3 text-[18px] tracking-[0.14em] text-[#0A0A0A] hover:bg-[#0A0A0A] hover:text-white">
            RETRY
          </button>
        </div>
      )
    }
    return <p className="text-[20px] tracking-[0.12em] text-[#6B6B6B]">LOADING OUTFIT QUALITY…</p>
  }

  return (
    <div>
      {msg && <p className="text-[20px] tracking-[0.12em] text-[#C4A882] mb-6">{msg}</p>}

      {/* ── Create a batch ─────────────────────────────────────────────── */}
      <section className="border border-[#E2E0DB] p-6 mb-10" aria-label="Create a batch">
        <h2 className="text-[22px] tracking-[0.14em] text-[#0A0A0A] mb-5">NEW BATCH</h2>

        <div className="grid grid-cols-2 gap-6 max-w-3xl">
          <label className="flex flex-col gap-2 text-[18px] tracking-[0.1em] text-[#6B6B6B]">
            DATASET PARTITION
            <select
              value={partition}
              onChange={(e) => setPartition(e.target.value)}
              className="border border-[#D8D5CF] px-3 py-2 text-[18px] text-[#0A0A0A]"
            >
              {PARTITIONS.map((p) => (
                <option key={p} value={p}>{p.toUpperCase()}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-2 text-[18px] tracking-[0.1em] text-[#6B6B6B]">
            TARGET CANDIDATES (1–150)
            <input
              type="number"
              min={1}
              max={150}
              value={targetCount}
              onChange={(e) => setTargetCount(Number(e.target.value))}
              className="border border-[#D8D5CF] px-3 py-2 text-[18px] text-[#0A0A0A]"
            />
          </label>
        </div>

        {/* Context: real member OR evaluation profile — distinct selectors. */}
        <fieldset className="mt-6 max-w-3xl">
          <legend className="text-[18px] tracking-[0.1em] text-[#6B6B6B] mb-2">CONTEXT (EXACTLY ONE)</legend>
          <div className="flex gap-8 mb-4">
            <label className="flex items-center gap-2 text-[18px] text-[#0A0A0A]">
              <input
                type="radio"
                name="context-type"
                checked={contextType === 'real_member'}
                onChange={() => setContextType('real_member')}
              />
              REAL MEMBER
            </label>
            <label className="flex items-center gap-2 text-[18px] text-[#0A0A0A]">
              <input
                type="radio"
                name="context-type"
                checked={contextType === 'evaluation_profile'}
                onChange={() => setContextType('evaluation_profile')}
              />
              EVALUATION PROFILE
            </label>
          </div>

          {contextType === 'real_member' ? (
            <label className="flex flex-col gap-2 text-[18px] tracking-[0.1em] text-[#6B6B6B]">
              REAL MEMBER
              <select
                value={memberId}
                onChange={(e) => setMemberId(e.target.value)}
                className="border border-[#D8D5CF] px-3 py-2 text-[18px] text-[#0A0A0A]"
                aria-label="Real member"
              >
                <option value="">— select a real member —</option>
                {data.members.map((m) => (
                  <option key={m.member_id} value={m.member_id}>{m.name}</option>
                ))}
              </select>
              <span className="flex items-center gap-2 text-[18px] text-[#0A0A0A] normal-case tracking-normal mt-2">
                <input type="checkbox" checked={fromWays} onChange={(e) => setFromWays(e.target.checked)} />
                FROM HER WAYS TO WEAR — review exactly what MYRA showed her, instead of composing new looks
              </span>
            </label>
          ) : (
            <label className="flex flex-col gap-2 text-[18px] tracking-[0.1em] text-[#6B6B6B]">
              EVALUATION PROFILE
              <select
                value={profileId}
                onChange={(e) => setProfileId(e.target.value)}
                className="border border-[#D8D5CF] px-3 py-2 text-[18px] text-[#0A0A0A]"
                aria-label="Evaluation profile"
              >
                <option value="">— select an evaluation profile —</option>
                {data.profiles.map((p) => (
                  <option key={p.profile_id} value={p.profile_id}>{p.name}</option>
                ))}
              </select>
            </label>
          )}
        </fieldset>

        <label className="flex flex-col gap-2 text-[18px] tracking-[0.1em] text-[#6B6B6B] mt-6 max-w-3xl">
          SELECTED STYLIST (REQUIRED — NO DEFAULT)
          <select
            value={stylistId}
            onChange={(e) => onStylistChange(e.target.value)}
            className="border border-[#D8D5CF] px-3 py-2 text-[18px] text-[#0A0A0A]"
            aria-label="Selected stylist"
          >
            <option value="">— select a stylist —</option>
            {data.stylists.map((s) => (
              <option key={s.stylist_id} value={s.stylist_id}>{s.name} ({s.status})</option>
            ))}
          </select>
        </label>

        {preview && (
          <p className="mt-3 text-[18px] tracking-[0.08em] text-[#6B6B6B]">
            {preview.confirmed_count} CONFIRMED INSPIRATION IMAGES{' '}
            {preview.rules_only ? <RulesOnlyBadge /> : <span className="text-[#4A7A4A]">FULL LENS</span>}
          </p>
        )}

        <button
          onClick={onCreate}
          disabled={busy === 'create'}
          className="mt-6 border border-[#0A0A0A] px-6 py-2 text-[18px] tracking-[0.16em] text-[#0A0A0A] hover:bg-[#0A0A0A] hover:text-white disabled:opacity-40"
        >
          {busy === 'create' ? 'CREATING…' : 'CREATE DRAFT BATCH'}
        </button>
      </section>

      {/* ── Batches ────────────────────────────────────────────────────── */}
      <section aria-label="Batches">
        <h2 className="text-[22px] tracking-[0.14em] text-[#0A0A0A] mb-5">BATCHES</h2>
        {data.batches.length === 0 && (
          <p className="text-[18px] tracking-[0.1em] text-[#6B6B6B]">No batches yet.</p>
        )}
        <div className="flex flex-col gap-5">
          {data.batches.map((b) => (
            <BatchCard key={b.batch_id} batch={b} busy={busy} run={run} />
          ))}
        </div>
      </section>
    </div>
  )
}

function BatchCard({
  batch,
  busy,
  run,
}: {
  batch: BatchView
  busy: string | null
  run: (key: string, fn: () => Promise<any>, ok: string) => Promise<any>
}) {
  const [chunk, setChunk] = useState<number>(Math.min(5, batch.chunk_limit))
  const [candidates, setCandidates] = useState<PreDecisionCandidate[] | null>(null)
  const [showCandidates, setShowCandidates] = useState(false)

  async function toggleCandidates() {
    if (!showCandidates && candidates === null) {
      const c = await loadBatchCandidates(batch.batch_id)
      setCandidates(c)
    }
    setShowCandidates((s) => !s)
  }

  const remaining = batch.target_count - batch.produced

  return (
    <div className="border border-[#E2E0DB] p-5">
      <div className="flex items-center gap-4 flex-wrap">
        <span className="text-[18px] tracking-[0.14em] text-[#0A0A0A]">{batch.data_partition.toUpperCase()}</span>
        <span className="text-[18px] tracking-[0.1em] text-[#6B6B6B]">
          {batch.context_type === 'real_member' ? 'MEMBER' : 'PROFILE'}: {batch.context_label}
        </span>
        <span className="text-[18px] tracking-[0.1em] text-[#6B6B6B]">STYLIST: {batch.stylist_name ?? batch.selected_stylist_id}</span>
        <span className="text-[18px] tracking-[0.14em] text-[#765D32]">{batch.status.toUpperCase()}</span>
        {batch.rules_only === true && <RulesOnlyBadge />}
      </div>

      <p className="mt-2 text-[18px] tracking-[0.08em] text-[#6B6B6B]">
        {batch.produced}/{batch.target_count} GENERATED · {batch.awaiting_human} AWAITING HUMAN · {batch.objective_failed} OBJECTIVE-FAILED · {remaining} REMAINING
      </p>
      {batch.last_error && <p className="mt-1 text-[17px] text-[#B83A3A]">{batch.last_error}</p>}

      <div className="mt-4 flex items-center gap-3 flex-wrap">
        {batch.status === 'draft' && (
          <button
            onClick={() => run(`start-${batch.batch_id}`, () => startQualityBatch(batch.batch_id), 'SNAPSHOT FROZEN · BATCH ACTIVE (NO CANDIDATES YET)')}
            disabled={busy === `start-${batch.batch_id}`}
            className="border border-[#0A0A0A] px-5 py-2.5 text-[17px] tracking-[0.12em] hover:bg-[#0A0A0A] hover:text-white disabled:opacity-40"
          >
            START (FREEZE SNAPSHOT)
          </button>
        )}
        {batch.status === 'draft' && (
          <span className="text-[17px] tracking-[0.06em] text-[#6B6B6B]">
            START FREEZES THE STYLIST AS SHE IS NOW — INCLUDING WHAT HER LATEST TRAINING REVIEWS TAUGHT HER.
          </span>
        )}

        {batch.status === 'active' && (
          <>
            <label className="text-[17px] tracking-[0.08em] text-[#6B6B6B] flex items-center gap-2">
              CHUNK (1–{batch.chunk_limit})
              <input
                type="number"
                min={1}
                max={batch.chunk_limit}
                value={chunk}
                onChange={(e) => setChunk(Number(e.target.value))}
                className="border border-[#D8D5CF] px-2 py-1.5 w-20 text-[17px]"
                aria-label="Chunk size"
              />
            </label>
            <button
              onClick={() => run(`gen-${batch.batch_id}`, () => generateQualityChunk(batch.batch_id, chunk), 'CHUNK GENERATED AND CHECKED')}
              disabled={busy === `gen-${batch.batch_id}` || remaining <= 0}
              className="border border-[#0A0A0A] px-5 py-2.5 text-[17px] tracking-[0.12em] hover:bg-[#0A0A0A] hover:text-white disabled:opacity-40"
            >
              {busy === `gen-${batch.batch_id}` ? 'GENERATING…' : 'GENERATE NEXT CHUNK'}
            </button>
            <button
              onClick={() => run(`pause-${batch.batch_id}`, () => pauseQualityBatch(batch.batch_id), 'PAUSED · NEW CLAIMS BLOCKED')}
              disabled={busy === `pause-${batch.batch_id}`}
              className="border border-[#765D32] px-5 py-2.5 text-[17px] tracking-[0.12em] text-[#765D32] disabled:opacity-40"
            >
              PAUSE
            </button>
          </>
        )}

        {batch.status === 'paused' && (
          <button
            onClick={() => run(`resume-${batch.batch_id}`, () => resumeQualityBatch(batch.batch_id), 'RESUMED · NO WORK AUTO-STARTED')}
            disabled={busy === `resume-${batch.batch_id}`}
            className="border border-[#0A0A0A] px-5 py-2.5 text-[17px] tracking-[0.12em] hover:bg-[#0A0A0A] hover:text-white disabled:opacity-40"
          >
            RESUME
          </button>
        )}

        {batch.produced > 0 && (
          <button
            onClick={toggleCandidates}
            className="border border-[#D8D5CF] px-5 py-2.5 text-[17px] tracking-[0.12em] text-[#6B6B6B]"
            aria-expanded={showCandidates}
          >
            {showCandidates ? 'HIDE CANDIDATES' : 'VIEW CANDIDATES'}
          </button>
        )}
      </div>

      {showCandidates && candidates && (
        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {candidates.map((c) => (
            <div key={c.candidate_version_id} className="border border-[#EDEBE6] p-3">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-[17px] tracking-[0.1em] text-[#765D32]">{c.state.toUpperCase()}</span>
                {c.rules_only && <RulesOnlyBadge />}
                {c.has_subjective_check && (
                  <span className="text-[17px] tracking-[0.08em] text-[#6B6B6B]">MACHINE CHECK PENDING REVIEW</span>
                )}
              </div>
              {c.objective_failures?.length > 0 && (
                <ul className="mb-3 space-y-1">
                  {c.objective_failures.map((line) => (
                    <li key={line} className="text-[16px] tracking-[0.06em] text-[#6B6B6B]">{line}</li>
                  ))}
                </ul>
              )}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                {c.items.map((it) => (
                  <figure key={it.candidate_item_id} className="min-w-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={thumbUrl(it.source_image_url, 384)} loading="lazy" decoding="async" alt={`${it.slot}: ${String(it.item_snapshot?.brand ?? 'item')}`} className="aspect-[4/5] w-full bg-[#F7F6F3] object-contain border border-[#EDEBE6]" />
                    <figcaption className="text-[16px] text-[#6B6B6B] mt-2">{it.slot}</figcaption>
                  </figure>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
