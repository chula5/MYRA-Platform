'use client'

// THE TRIALS — the same pieces, every run, every stylist, and every run kept.
//
// One row per stylist: her latest numbers and what moved since the batch
// before, with a provenance line (decisions · pictures · brief changed) so a
// change has a cause. Open a row for her grid: one cell per trial, marked
// LIKE A YES or REPEATS A NO against what Chloe judged before, with the same
// verdict control the bench uses.

import { useEffect, useState } from 'react'
import type { DeltaMetric } from '@/lib/stylist-trials'
import VerdictControls from './VerdictControls'
import {
  loadTrialReport, runAllTrials, setTrialActive, loadStylistTrialGrid, recordTrialVerdict,
  type TrialReport, type TrialCell, type StylistTrialRow,
} from './trial-actions'

const LABEL = 'text-[9px] tracking-[0.12em] text-[#8B8880]'
const CARD = 'border border-[#E2E0DB] bg-white rounded-[14px]'
const PILL = 'rounded-full px-4 py-2 text-[10px] tracking-[0.12em] disabled:opacity-40'
const CHIP = 'rounded-full border border-[#E2E0DB] px-2 py-0.5 text-[9px] tracking-[0.1em] text-[#6B6862]'
const EYE_KEY = 'myra.trials.eye'

const METRICS: { key: DeltaMetric; label: string }[] = [
  { key: 'on_brief', label: 'BRIEF' }, { key: 'occasion', label: 'OCCASION' }, { key: 'distinct', label: 'DISTINCT' },
  { key: 'envelope', label: 'ENVELOPE' }, { key: 'pct_like_yes', label: 'LIKE A YES' }, { key: 'pct_like_no', label: 'REPEATS A NO' },
]

function Delta({ d, invert }: { d: number | null; invert?: boolean }) {
  if (d == null || d === 0) return <span className="text-[#B8B6B0]">{d === 0 ? '·' : ''}</span>
  const good = invert ? d < 0 : d > 0
  return <span className={good ? 'text-[#3D7A50]' : 'text-[#9B3A3A]'}>{d > 0 ? '▲' : '▼'} {d > 0 ? '+' : ''}{d}</span>
}

function Row({ r, open, onOpen }: { r: StylistTrialRow; open: boolean; onOpen: () => void }) {
  const l = r.latest
  return (
    <button type="button" onClick={onOpen} className={`grid w-full grid-cols-[minmax(120px,1.4fr)_repeat(6,minmax(64px,1fr))] items-baseline gap-2 border-b border-[#F2F2F0] py-2.5 text-left ${open ? 'bg-[#FAFAF8]' : ''}`}>
      <span>
        <span className="block text-[12px] tracking-[0.06em] text-[#0A0A0A]">{r.stylist_name.toUpperCase()}</span>
        <span className={`block ${LABEL}`}>
          {l ? `${l.model_decisions} DECISIONS · ${r.images_before != null && r.images_before !== l.envelope_images ? `${r.images_before}→` : ''}${l.envelope_images} PICTURES${r.brief_changed ? ' · BRIEF CHANGED' : ''}${l.errors ? ` · ${l.errors} EMPTY` : ''}` : 'NOT RUN YET'}
        </span>
      </span>
      {METRICS.map((m) => (
        <span key={m.key} className="text-[12px] text-[#0A0A0A]">
          {l?.[m.key] ?? '—'}
          <span className="ml-1 text-[9px] tracking-[0.08em]"><Delta d={r.delta?.[m.key] ?? null} invert={m.key === 'pct_like_no'} /></span>
        </span>
      ))}
    </button>
  )
}

function Cell({ c }: { c: TrialCell }) {
  const sc = c.scores
  return (
    <div className={`${CARD} p-3`}>
      <div className="flex items-center gap-2">
        {c.hero_image && <img src={c.hero_image} alt="" className="h-12 w-9 rounded-[5px] object-cover" />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] text-[#0A0A0A]">{c.label}</p>
          <p className={LABEL}>{c.occasion_label?.toUpperCase() ?? 'NO OCCASION'}</p>
        </div>
        {c.like_yes && <span className={`${CHIP} border-[#C9E0CF] text-[#3D7A50]`}>LIKE A YES</span>}
        {c.like_no && <span className={`${CHIP} border-[#E8B4B4] text-[#9B3A3A]`}>REPEATS A NO</span>}
      </div>
      {c.error
        ? <p className="mt-2 text-[10px] text-[#9B3A3A]">{c.error}</p>
        : (
          <>
            <div className="mt-2 grid grid-cols-4 gap-1.5 sm:grid-cols-5">
              {c.pieces.map((p, i) => (
                <div key={`${p.item_id}-${i}`} title={`${p.brand} — ${p.product_name}`}>
                  {p.image_url
                    ? <img src={p.image_url} alt="" className={`aspect-[3/4] w-full rounded-[6px] object-cover ${p.is_hero ? 'ring-2 ring-[#141414]' : ''}`} />
                    : <div className="aspect-[3/4] w-full rounded-[6px] bg-[#F2F1EE]" />}
                </div>
              ))}
            </div>
            {sc && (
              <div className="mt-2 flex flex-wrap gap-1">
                <span className={CHIP}>BRIEF {sc.on_brief ?? '—'}</span>
                <span className={CHIP}>OCCASION {sc.occasion ?? '—'}</span>
                <span className={CHIP}>DISTINCT {sc.distinct ?? '—'}</span>
                <span className={CHIP}>ENVELOPE {sc.envelope ?? '—'}</span>
                {!!sc.twins?.length && <span className={`${CHIP} border-[#C4A882] text-[#6B5636]`}>SAME AS {sc.twins.join(', ').toUpperCase()}</span>}
              </div>
            )}
            {c.check_result && (
              <p className={`mt-2 text-[9px] tracking-[0.12em] ${c.check_result.verdict === 'works' ? 'text-[#3D7A50]' : c.check_result.verdict === 'clashes' ? 'text-[#9B3A3A]' : 'text-[#6B5636]'}`} title={c.check_result.issues.join(' · ')}>
                EYE · {c.check_result.verdict.toUpperCase()} · COLOUR {c.check_result.colourHarmony}/5 · TOGETHER {c.check_result.piecesGoTogether}/5
              </p>
            )}
            <div className="mt-2">
              <VerdictControls pieces={c.pieces} initial={c.verdict} onSave={(v) => recordTrialVerdict(c.run_id, v)} />
            </div>
          </>
        )}
    </div>
  )
}

export default function TrialsPanel() {
  const [open, setOpen] = useState(false)
  const [report, setReport] = useState<TrialReport | null>(null)
  const [running, setRunning] = useState(false)
  const [eye, setEyeState] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [openStylist, setOpenStylist] = useState<string | null>(null)
  const [grid, setGrid] = useState<{ cells: TrialCell[]; loading: boolean }>({ cells: [], loading: false })
  const [reload, setReload] = useState(0)

  useEffect(() => { try { setEyeState(localStorage.getItem(EYE_KEY) === '1') } catch { /* fine */ } }, [])
  useEffect(() => {
    if (!open) return
    let alive = true
    void loadTrialReport().then((r) => { if (alive) setReport(r) })
    return () => { alive = false }
  }, [open, reload])
  useEffect(() => {
    if (!openStylist) return
    let alive = true
    setGrid({ cells: [], loading: true })
    void loadStylistTrialGrid(openStylist).then((r) => { if (alive) setGrid({ cells: r.cells, loading: false }) })
    return () => { alive = false }
  }, [openStylist, reload])

  function setEye(on: boolean) { setEyeState(on); try { localStorage.setItem(EYE_KEY, on ? '1' : '0') } catch { /* fine */ } }

  async function runAll() {
    setRunning(true); setNote(null)
    const r = await runAllTrials({ withEye: eye })
    setRunning(false)
    setNote(r.error ? r.error.toUpperCase() : `RAN ${r.trials} TRIAL${r.trials === 1 ? '' : 'S'} · ${r.columns} LOOKS${r.errors ? ` · ${r.errors} EMPTY` : ''}`)
    setReload((n) => n + 1)
  }

  const trials = report?.trials ?? []
  const active = trials.filter((t) => t.active).length

  return (
    <div className={`${CARD} p-5`}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-3">
        <div className="text-left">
          <p className="text-[15px] tracking-[0.08em] text-[#0A0A0A]">THE TRIALS</p>
          <p className="mt-1 text-[11px] text-[#6B6862]">The same pieces, every run, every stylist — so you can see who is getting better.</p>
        </div>
        <span className={LABEL}>{open ? 'CLOSE' : 'OPEN'}</span>
      </button>

      {open && (
        <div className="mt-5 space-y-5">
          {report?.error && <p className="text-[9px] tracking-[0.12em] text-[#9B3A3A]">{report.error.toUpperCase()}</p>}

          {/* The set */}
          <div>
            <p className={LABEL}>{active} ACTIVE TRIAL{active === 1 ? '' : 'S'} · {report?.batches ?? 0} RUN{report?.batches === 1 ? '' : 'S'}{report?.last_run_at ? ` · LAST ${new Date(report.last_run_at).toLocaleDateString('en-GB')}` : ''}</p>
            {!trials.length && <p className="mt-2 text-[11px] text-[#6B6862]">No trials yet. Style a piece on the bench and press SAVE AS TRIAL.</p>}
            {!!trials.length && (
              <div className="mt-2 flex flex-wrap gap-2">
                {trials.map((t) => (
                  <button key={t.trial_id} type="button" title={`${t.brand_name ?? ''} — ${t.product_name} · ${t.runs} run${t.runs === 1 ? '' : 's'} · click to ${t.active ? 'pause' : 'resume'}`}
                    onClick={async () => { await setTrialActive(t.trial_id, !t.active); setReload((n) => n + 1) }}
                    className={`flex items-center gap-2 rounded-[10px] border px-2 py-1.5 ${t.active ? 'border-[#E2E0DB] bg-white' : 'border-dashed border-[#E2E0DB] opacity-50'}`}>
                    {t.image_url ? <img src={t.image_url} alt="" className="h-10 w-8 rounded-[4px] object-cover" /> : <div className="h-10 w-8 rounded-[4px] bg-[#F2F1EE]" />}
                    <span className="text-left">
                      <span className="block max-w-[140px] truncate text-[10px] text-[#0A0A0A]">{t.label || t.product_name}</span>
                      <span className={`block ${LABEL}`}>{t.occasion_label?.toUpperCase() ?? 'NO OCCASION'}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Run */}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => void runAll()} disabled={running || !active} className={`${PILL} bg-[#141414] text-[#F7F6F3]`}>
              {running ? 'RUNNING…' : 'RUN ALL'}
            </button>
            <label className={`${LABEL} flex items-center gap-1.5 cursor-pointer`} title={`MYRA's eye on every look — about 2p and 10 seconds each; ${active} trials × every stylist`}>
              <input type="checkbox" checked={eye} onChange={(e) => setEye(e.target.checked)} /> EYE ON THIS RUN
            </label>
            {note && <span className={LABEL}>{note}</span>}
          </div>
          {running && (
            <div className="rounded-[16px] bg-white/70 px-6 py-8 text-center">
              <img src="/myra-mirror-transparent.png" alt="" className="myra-mirror-wiggle h-20 w-auto mx-auto" />
              <p className="mt-3 text-[13px] text-[#4A4E57]">Every stylist, every trial…</p>
            </div>
          )}

          {/* Over time */}
          {!!report?.stylists.length && (
            <div className="overflow-x-auto">
              <div className="min-w-[720px]">
                <div className="grid grid-cols-[minmax(120px,1.4fr)_repeat(6,minmax(64px,1fr))] gap-2 border-b border-[#E2E0DB] pb-2">
                  <span className={LABEL}>STYLIST · SINCE LAST RUN</span>
                  {METRICS.map((m) => <span key={m.key} className={LABEL}>{m.label}</span>)}
                </div>
                {report.stylists.map((r) => (
                  <Row key={r.stylist_id} r={r} open={openStylist === r.stylist_id} onOpen={() => setOpenStylist((s) => (s === r.stylist_id ? null : r.stylist_id))} />
                ))}
              </div>
            </div>
          )}

          {/* One stylist's grid */}
          {openStylist && (
            <div>
              <p className={LABEL}>{report?.stylists.find((s) => s.stylist_id === openStylist)?.stylist_name.toUpperCase()} · LATEST RUN, ONE CELL PER TRIAL</p>
              {grid.loading && <p className={`mt-2 ${LABEL}`}>READING…</p>}
              {!grid.loading && !grid.cells.length && <p className="mt-2 text-[11px] text-[#6B6862]">Not run yet.</p>}
              {!!grid.cells.length && (
                <div className="mt-3 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                  {grid.cells.map((c) => <Cell key={c.run_id} c={c} />)}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
