'use client'

// THE BENCH — search a piece, hand it to every stylist, read the columns.
//
// Only the stylist changes between columns: same client (or none), same
// library, same occasion. Each column carries its scorecard — the free
// numbers a look can be measured on — and a verdict: YES teaches the stylist;
// NO names the wrong piece and can write a never into her brief at once.
// MYRA's eye (the photo check) costs money, so it runs when asked.

import { useEffect, useState } from 'react'
import { CLIENT_OCCASIONS } from '@/lib/client-occasions'
import type { LookCheck } from '@/lib/look-check'
import type { BenchItem, BenchColumn, BenchResult } from './bench-run'
import VerdictControls from './VerdictControls'
import {
  searchBenchItems, listBenchMembers, styleAcrossStylists, recordBenchVerdict, checkBenchLook,
} from './bench-actions'
import { saveAsTrial } from './trial-actions'

const LABEL = 'text-[9px] tracking-[0.12em] text-[#8B8880]'
const CARD = 'border border-[#E2E0DB] bg-white rounded-[14px]'
const SELECT = 'border border-[#E2E0DB] rounded-[8px] px-3 py-2 text-[13px] text-[#0A0A0A] bg-white'
const PILL = 'rounded-full px-4 py-2 text-[10px] tracking-[0.12em] disabled:opacity-40'
const CHIP = 'rounded-full border border-[#E2E0DB] px-2 py-0.5 text-[9px] tracking-[0.1em] text-[#6B6862]'
const EYE_KEY = 'myra.bench.eye'

type Eye = { state: 'idle' } | { state: 'loading' } | { state: 'done'; check: LookCheck; confidence: number | null } | { state: 'error'; error: string }
function Chip({ label, value, title, tone }: { label: string; value: number | string | null | undefined; title?: string; tone?: 'warn' }) {
  return (
    <span className={`${CHIP} ${tone === 'warn' ? 'border-[#C4A882] text-[#6B5636]' : ''}`} title={title}>
      {label} {value == null ? '—' : value}
    </span>
  )
}

export default function BenchPanel() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<BenchItem[]>([])
  const [showItems, setShowItems] = useState(true)
  const [hero, setHero] = useState<BenchItem | null>(null)
  const [occasion, setOccasion] = useState<string>('')
  const [members, setMembers] = useState<{ member_id: string; name: string }[]>([])
  const [memberId, setMemberId] = useState('')
  const [result, setResult] = useState<BenchResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [eyeAlways, setEyeAlways] = useState(false)
  const [eyes, setEyes] = useState<Record<string, Eye>>({})
  const [trialNote, setTrialNote] = useState<string | null>(null)

  useEffect(() => {
    try { setEyeAlways(localStorage.getItem(EYE_KEY) === '1') } catch { /* private window */ }
  }, [])
  useEffect(() => {
    if (!open || members.length) return
    void listBenchMembers().then((r) => { setMembers(r.members); if (r.error) setError(r.error) })
  }, [open, members.length])

  async function search() {
    setBusy(true); setError(null); setShowItems(true)
    const r = await searchBenchItems(query)
    setBusy(false)
    setItems(r.items)
    if (r.error) setError(r.error)
    else if (!r.items.length) setError('NOTHING IN READY OR LIVE MATCHES THAT')
  }

  async function checkColumn(c: BenchColumn) {
    if (!c.pieces.length) return
    setEyes((e) => ({ ...e, [c.stylist_id]: { state: 'loading' } }))
    const r = await checkBenchLook(c.stylist_id, c.pieces.map((p) => ({ image_url: p.image_url, item_type: p.item_type, product_name: p.product_name })))
    setEyes((e) => ({ ...e, [c.stylist_id]: r.check ? { state: 'done', check: r.check, confidence: r.confidence } : { state: 'error', error: r.error ?? 'No verdict' } }))
  }
  function checkAll(r: BenchResult | null) {
    for (const c of r?.columns ?? []) if (c.pieces.length) void checkColumn(c)
  }

  async function styleIt(item: BenchItem) {
    // The grid has done its job: the piece is chosen, the columns are the point.
    setHero(item); setShowItems(false); setResult(null); setEyes({}); setTrialNote(null); setBusy(true); setError(null)
    const r = await styleAcrossStylists(item.item_id, occasion || null, memberId || null)
    setBusy(false)
    setResult(r)
    if (r.error) setError(r.error.toUpperCase())
    else if (eyeAlways) checkAll(r)
  }

  function setEye(on: boolean) {
    setEyeAlways(on)
    try { localStorage.setItem(EYE_KEY, on ? '1' : '0') } catch { /* fine */ }
  }

  return (
    <div className={`${CARD} p-5`}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-3">
        <div className="text-left">
          <p className="text-[15px] tracking-[0.08em] text-[#0A0A0A]">THE BENCH</p>
          <p className="mt-1 text-[11px] text-[#6B6862]">One piece, every stylist, side by side.</p>
        </div>
        <span className={LABEL}>{open ? 'CLOSE' : 'OPEN'}</span>
      </button>

      {open && (
        <div className="mt-5 space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <select value={memberId} onChange={(e) => setMemberId(e.target.value)} className={SELECT} aria-label="Styled for">
              <option value="">The stylist alone</option>
              {members.map((m) => <option key={m.member_id} value={m.member_id}>{m.name}</option>)}
            </select>
            <select value={occasion} onChange={(e) => setOccasion(e.target.value)} className={SELECT} aria-label="Occasion">
              <option value="">No occasion</option>
              {CLIENT_OCCASIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void search() } }}
              placeholder="Search a piece"
              className={`flex-1 min-w-[200px] ${SELECT}`}
            />
            <button type="button" onClick={() => void search()} disabled={busy} className={`${PILL} bg-[#141414] text-[#F7F6F3]`}>
              {busy ? 'WORKING…' : 'SEARCH'}
            </button>
            <label className={`${LABEL} flex items-center gap-1.5 cursor-pointer`} title="MYRA's eye on every column after each run — about 2p and 10 seconds per column">
              <input type="checkbox" checked={eyeAlways} onChange={(e) => setEye(e.target.checked)} /> EYE ON EVERY RUN
            </label>
          </div>

          {error && <p className="text-[9px] tracking-[0.12em] text-[#9B3A3A]">{error}</p>}

          {showItems && !!items.length && (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {items.map((it) => (
                <button
                  key={it.item_id} type="button" onClick={() => void styleIt(it)}
                  title={`${it.brand_name ?? ''} — ${it.product_name}`}
                  className={`overflow-hidden rounded-[10px] border border-[#E2E0DB] bg-white text-left ${hero?.item_id === it.item_id ? 'ring-2 ring-[#141414]' : ''}`}
                >
                  {it.image_url ? <img src={it.image_url} alt="" className="aspect-[3/4] w-full object-cover" /> : <div className="aspect-[3/4] w-full bg-[#F2F1EE]" />}
                  <span className="block truncate px-2 py-1.5 text-[10px] text-[#0A0A0A]">{it.product_name}</span>
                </button>
              ))}
            </div>
          )}

          {hero && !showItems && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-4">
                {hero.image_url && <img src={hero.image_url} alt="" className="h-24 w-[72px] rounded-[8px] object-cover" />}
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] text-[#0A0A0A]">{hero.product_name}</p>
                  <p className={`mt-1 ${LABEL}`}>
                    {(hero.brand_name ?? '').toUpperCase()}
                    {result?.occasion_label ? ` · ${result.occasion_label.toUpperCase()}` : ''}
                    {result ? (result.member_name ? ` · FOR ${result.member_name.toUpperCase()}` : ' · THE STYLIST ALONE') : ''}
                  </p>
                  {result?.summary && (
                    <p className={`mt-1 ${LABEL}`}>
                      ACROSS THE HOUSE · BRIEF {result.summary.mean_on_brief ?? '—'} · OCCASION {result.summary.mean_occasion ?? '—'} · DISTINCT {result.summary.mean_distinct ?? '—'}
                      {result.summary.house_default_count ? ` · ${result.summary.house_default_count} HOUSE DEFAULT` : ''}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {trialNote && <span className={LABEL}>{trialNote}</span>}
                  {result && !result.error && (
                    <>
                      <button type="button" title="Keep this piece and occasion as a trial every stylist is re-styled on"
                        onClick={async () => { const r = await saveAsTrial(hero.item_id, result.occasion_id ?? null, hero.product_name); setTrialNote(r.error ? r.error.toUpperCase() : r.existed ? 'ALREADY A TRIAL' : 'SAVED AS TRIAL') }}
                        className={`${PILL} border border-[#E2E0DB] bg-white text-[#2B2B2B]`}>
                        SAVE AS TRIAL
                      </button>
                      <button type="button" onClick={() => checkAll(result)} className={`${PILL} border border-[#E2E0DB] bg-white text-[#2B2B2B]`} title="≈2p per column · ~10s">
                        CHECK ALL
                      </button>
                    </>
                  )}
                  <button type="button" onClick={() => setShowItems(true)} className={`${PILL} border border-[#E2E0DB] bg-white text-[#2B2B2B]`}>
                    CHANGE PIECE
                  </button>
                </div>
              </div>

              {busy && !result && (
                <div className="rounded-[16px] bg-white/70 px-6 py-10 text-center">
                  <img src="/myra-mirror-transparent.png" alt="" className="myra-mirror-wiggle h-24 w-auto mx-auto" />
                  <p className="mt-4 text-[13px] text-[#4A4E57]">Building outfits around it…</p>
                </div>
              )}

              {result?.identical && (
                <p className="rounded-[10px] border border-[#C4A882] bg-[#FBF7F0] px-4 py-3 text-[12px] text-[#6B5636]">
                  Every stylist returned the same pieces.
                </p>
              )}

              {result && <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                {result.columns.map((c) => {
                  const sc = c.scorecard
                  const eye = eyes[c.stylist_id] ?? { state: 'idle' }
                  const n = c.pieces.filter((p) => !p.is_hero).length
                  return (
                    <div key={c.stylist_id} className={`${CARD} p-4`}>
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-[13px] tracking-[0.06em] text-[#0A0A0A]">{c.stylist_name.toUpperCase()}</p>
                        <span className={LABEL}>
                          {!c.has_brief && !c.has_envelope
                            ? <span className="text-[#9B3A3A]">HOUSE DEFAULT</span>
                            : `${c.decisions} DECISION${c.decisions === 1 ? '' : 'S'}`}
                        </span>
                      </div>

                      {c.error
                        ? <p className="mt-3 text-[11px] text-[#9B3A3A]">{c.error}</p>
                        : (
                          <>
                            <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                              {c.pieces.map((p, i) => (
                                <div key={`${p.item_id}-${i}`} title={`${p.brand} — ${p.product_name}`}>
                                  {p.image_url
                                    ? <img src={p.image_url} alt="" className={`aspect-[3/4] w-full rounded-[8px] object-cover ${p.is_hero ? 'ring-2 ring-[#141414]' : ''}`} />
                                    : <div className="aspect-[3/4] w-full rounded-[8px] bg-[#F2F1EE]" />}
                                </div>
                              ))}
                            </div>
                            {!!c.brands.length && <p className={`mt-3 ${LABEL}`}>{c.brands.join(' · ').toUpperCase()}</p>}

                            {sc && (
                              <div className="mt-3 flex flex-wrap gap-1.5">
                                <Chip label="BRIEF" value={sc.on_brief} title={c.has_brief ? `${sc.brief_hits} of ${n} pieces the brief reaches for` : 'no brief'} />
                                <Chip label="BRANDS" value={sc.brand_share} title={c.has_brief ? `${c.brands_in_stock} of her brands in stock` : 'no brief'} tone={c.has_brief && !c.brands_in_stock ? 'warn' : undefined} />
                                <Chip label="PALETTE" value={sc.palette_share} title={c.has_brief ? 'pieces in her palette' : 'no brief'} />
                                <Chip label="OCCASION" value={sc.occasion} title={sc.occasion_avoided.length ? `avoids: ${sc.occasion_avoided.join(', ')}` : 'no occasion or nothing avoided'} tone={sc.occasion_avoided.length ? 'warn' : undefined} />
                                <Chip label="COHERENCE" value={sc.coherence} title={`composer score ${sc.score.toFixed(2)}`} />
                                <Chip label="ENVELOPE" value={sc.envelope} title={c.has_envelope ? (sc.unscored ? `${sc.unscored} piece(s) unscored` : 'fit to her reference pictures') : 'no envelope'} />
                                <Chip label="DISTINCT" value={sc.distinct} title="how far from the other columns" tone={sc.twins.length ? 'warn' : undefined} />
                              </div>
                            )}
                            {!!sc?.twins.length && <p className="mt-2 text-[9px] tracking-[0.12em] text-[#6B5636]">SAME AS {sc.twins.join(', ').toUpperCase()}</p>}
                            {!!sc?.violations.length && (
                              <p className="mt-2 text-[10px] leading-snug text-[#9B3A3A]">
                                {sc.violations.map((x) => `${x.kind === 'ban' ? 'NEVER' : 'AVOIDS'} · ${x.text} — ${x.piece}`).join(' · ')}
                              </p>
                            )}

                            {/* MYRA's eye */}
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              {eye.state === 'idle' && <button type="button" onClick={() => void checkColumn(c)} className={`${PILL} border border-[#E2E0DB] bg-white text-[#2B2B2B]`} title="≈2p · ~10s">CHECK</button>}
                              {eye.state === 'loading' && <span className={LABEL}>MYRA IS LOOKING…</span>}
                              {eye.state === 'error' && <span className="text-[9px] tracking-[0.12em] text-[#9B3A3A]">{eye.error.toUpperCase()}</span>}
                              {eye.state === 'done' && (
                                <span className={`text-[9px] tracking-[0.12em] ${eye.check.verdict === 'works' ? 'text-[#3D7A50]' : eye.check.verdict === 'clashes' ? 'text-[#9B3A3A]' : 'text-[#6B5636]'}`} title={eye.check.issues.join(' · ') || 'no issues'}>
                                  EYE · {eye.check.verdict.toUpperCase()} · COLOUR {eye.check.colourHarmony}/5 · TOGETHER {eye.check.piecesGoTogether}/5{eye.confidence != null ? ` · ${eye.confidence.toFixed(2)}` : ''}
                                </span>
                              )}
                            </div>
                            {eye.state === 'done' && !!eye.check.issues.length && <p className="mt-1 text-[10px] leading-snug text-[#6B6862]">{eye.check.issues.join(' · ')}</p>}

                            {/* The verdict */}
                            <div className="mt-3">
                              <VerdictControls
                                pieces={c.pieces}
                                onSave={(v) => recordBenchVerdict({
                                  stylistId: c.stylist_id, heroId: result.hero!.item_id, itemIds: c.item_ids,
                                  score: c.scorecard?.score ?? 0, verdict: v.verdict, wrongItemIds: v.wrongItemIds, nevers: v.nevers,
                                })}
                              />
                            </div>
                          </>
                        )}
                    </div>
                  )
                })}
              </div>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
