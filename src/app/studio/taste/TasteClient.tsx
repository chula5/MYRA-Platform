'use client'

import { useMemo, useState, useTransition } from 'react'
import {
  addExclusion, addReferenceBrand, createFamily, deleteFamily, forceAddBrand,
  loadBrandDetail, loadMemberInspection, overrideAffinity, recomputeVectorsNow,
  removeExclusion, runHealthNow, seedMemberFromIntake, seedStarterFamily,
  setBrandHidden, setMembership, simulateOnboarding,
  type BrandDetail, type InspectorData, type MemberInspection, type SimulationResult,
} from './actions'
import type { HealthReport } from '@/lib/brand-affinity'

const CHIP = 'px-3 py-1.5 rounded-full text-[9px] tracking-[0.12em] border transition-colors'
const CHIP_ON = `${CHIP} bg-[#0A0A0A] text-white border-[#0A0A0A]`
const CHIP_OFF = `${CHIP} bg-white text-[#6B6B6B] border-[#E2E0DB] hover:border-[#0A0A0A]`
const BTN_DARK = 'bg-[#0A0A0A] text-white rounded-full px-4 py-2 text-[9px] tracking-[0.12em] hover:opacity-85 transition-opacity disabled:opacity-40'
const BTN_LIGHT = 'border border-[#0A0A0A] text-[#0A0A0A] rounded-full px-4 py-2 text-[9px] tracking-[0.12em] hover:bg-[#0A0A0A] hover:text-white transition-colors disabled:opacity-40'
const BTN_GHOST = 'border border-[#E2E0DB] text-[#6B6B6B] rounded-full px-3 py-1.5 text-[8px] tracking-[0.12em] hover:border-[#0A0A0A] hover:text-[#0A0A0A] transition-colors disabled:opacity-40'
const INPUT = 'border border-[#E2E0DB] rounded-[8px] px-3 py-2 text-[10px] tracking-[0.06em] outline-none focus:border-[#0A0A0A] bg-white'
const LABEL = 'text-[9px] tracking-[0.18em] text-[#6B6B6B]'
const H2 = 'text-[10px] tracking-[0.22em] text-[#4A4E57] mb-3'

const TIER_LABELS = ['', 'HIGH STREET', 'CONTEMPORARY', 'PREMIUM', 'LUXURY', 'ULTRA-LUXURY']

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return <span className="text-[8px] text-[#A8A8A4]">—</span>
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 60},${16 - v * 14}`).join(' ')
  return (
    <svg width="60" height="16" className="inline-block">
      <polyline points={pts} fill="none" stroke="#C4A882" strokeWidth="1.5" />
    </svg>
  )
}

export default function TasteClient({ data }: { data: InspectorData }) {
  const [pending, start] = useTransition()
  const [tab, setTab] = useState<'map' | 'users' | 'simulator' | 'health'>('map')
  const [notice, setNotice] = useState<string | null>(null)

  // map state
  const [visibleFamilies, setVisibleFamilies] = useState<Set<string>>(new Set(data.families.map((f) => f.family_id)))
  const [selBrand, setSelBrand] = useState<string | null>(null)
  const [detail, setDetail] = useState<BrandDetail | null>(null)
  const [refOpen, setRefOpen] = useState(false)
  const [refName, setRefName] = useState('')
  const [refTier, setRefTier] = useState(2)
  const [refUrls, setRefUrls] = useState('')
  const [famName, setFamName] = useState('')
  const [exclOther, setExclOther] = useState('')

  // users state
  const [selMember, setSelMember] = useState<string | null>(null)
  const [inspection, setInspection] = useState<MemberInspection | null>(null)
  const [forceBrand, setForceBrand] = useState('')

  // simulator state
  const [simInput, setSimInput] = useState('Sézane\nToteme')
  const [sim, setSim] = useState<SimulationResult | null>(null)

  // health state
  const [report, setReport] = useState<HealthReport | null>(data.latestReport)

  const act = (fn: () => Promise<any>, done?: (r: any) => void) =>
    start(async () => {
      try { const r = await fn(); done?.(r) }
      catch (e) { setNotice(e instanceof Error ? e.message : String(e)) }
    })

  const brandById = useMemo(() => new Map(data.brands.map((b) => [b.brand_id, b])), [data.brands])
  const selectBrand = (id: string) => {
    setSelBrand(id)
    setDetail(null)
    act(() => loadBrandDetail(id), setDetail)
  }
  const selectMember = (id: string, logPreview = false) => {
    setSelMember(id)
    setInspection(null)
    act(() => loadMemberInspection(id, logPreview), (r) => ('error' in r ? setNotice(r.error) : setInspection(r)))
  }

  // map geometry
  const W = 1000; const H = 460
  const px = (x: number) => 50 + x * (W - 100)
  const py = (tier: number) => H - 60 - ((tier - 1) / 4) * (H - 120)
  const mapped = data.brands.filter((b) => b.x != null)
  const familyBoxes = data.families
    .filter((f) => visibleFamilies.has(f.family_id))
    .map((f) => {
      const pts = f.members.map((m) => brandById.get(m.brand_id)).filter((b) => b && b.x != null) as typeof mapped
      if (pts.length < 2) return null
      const xs = pts.map((b) => px(b.x!)); const ys = pts.map((b) => py(b.price_tier))
      return {
        name: f.name,
        x: Math.min(...xs) - 18, y: Math.min(...ys) - 18,
        w: Math.max(...xs) - Math.min(...xs) + 36, h: Math.max(...ys) - Math.min(...ys) + 36,
      }
    })
    .filter(Boolean) as Array<{ name: string; x: number; y: number; w: number; h: number }>

  const sel = selBrand ? brandById.get(selBrand) : null
  const selFamilies = sel ? data.families.filter((f) => f.members.some((m) => m.brand_id === sel.brand_id)) : []

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-6">
        {(['map', 'users', 'simulator', 'health'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={tab === t ? CHIP_ON : CHIP_OFF}>
            {t === 'map' ? 'BRAND MAP' : t === 'users' ? 'USER INSPECTOR' : t === 'simulator' ? 'SIMULATOR' : 'HEALTH'}
            {t === 'health' && (data.badges.orphans + data.badges.incoherent + data.badges.starved + data.badges.dead > 0) && (
              <span className="ml-1.5 text-[#B3202A]">· {data.badges.orphans + data.badges.incoherent + data.badges.starved + data.badges.dead}</span>
            )}
          </button>
        ))}
        {notice && <p className="text-[9px] tracking-[0.1em] text-[#C4A882] max-w-lg truncate">{notice}</p>}
        {pending && <span className="text-[9px] tracking-[0.14em] text-[#A8A8A4]">WORKING…</span>}
      </div>

      {/* ═══════════ BRAND MAP ═══════════ */}
      {tab === 'map' && (
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-6">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              {data.families.map((f) => (
                <button
                  key={f.family_id}
                  onClick={() => setVisibleFamilies((s) => { const n = new Set(s); n.has(f.family_id) ? n.delete(f.family_id) : n.add(f.family_id); return n })}
                  className={visibleFamilies.has(f.family_id) ? CHIP_ON : CHIP_OFF}
                >
                  {f.name.toUpperCase()} · {f.members.length}
                </button>
              ))}
              <span className="mx-1 h-4 w-px bg-[#E2E0DB]" />
              <button disabled={pending} className={BTN_GHOST} onClick={() => act(() => recomputeVectorsNow(), (r) => setNotice(`${r.updated} BRAND VECTORS RECOMPUTED — RELOAD TO SEE THE MAP MOVE`))}>RECOMPUTE VECTORS</button>
              <button disabled={pending} className={BTN_GHOST} onClick={() => act(() => seedStarterFamily(), () => setNotice('FRENCH CONTEMPORARY SEEDED — RELOAD'))}>SEED STARTER FAMILY</button>
              <span className="flex items-center gap-1.5">
                <input value={famName} onChange={(e) => setFamName(e.target.value)} placeholder="NEW FAMILY NAME" className={`${INPUT} w-40 uppercase placeholder:text-[#A8A8A4]`} />
                <button disabled={pending || !famName.trim()} className={BTN_GHOST} onClick={() => act(() => createFamily(famName, ''), (r) => { setNotice(r.error ?? 'FAMILY CREATED — RELOAD'); setFamName('') })}>ADD</button>
              </span>
            </div>

            <div className="border border-[#E2E0DB] rounded-[10px] bg-white overflow-x-auto">
              <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[720px]">
                {[1, 2, 3, 4, 5].map((t) => (
                  <g key={t}>
                    <line x1={40} x2={W - 20} y1={py(t)} y2={py(t)} stroke="#EFEDE9" strokeWidth={1} />
                    <text x={W - 16} y={py(t) + 3} fontSize={8} fill="#A8A8A4" letterSpacing={1}>{TIER_LABELS[t]}</text>
                  </g>
                ))}
                <text x={50} y={H - 14} fontSize={8} fill="#A8A8A4" letterSpacing={2}>← AESTHETIC POSITION (PCA OF BRAND VECTORS) →</text>
                {familyBoxes.map((f) => (
                  <g key={f.name}>
                    <rect x={f.x} y={f.y} width={f.w} height={f.h} fill="none" stroke="#C4A882" strokeWidth={1} strokeDasharray="5 4" rx={12} />
                    <text x={f.x + 6} y={f.y - 5} fontSize={9} fill="#C4A882" letterSpacing={1.5}>{f.name.toUpperCase()}</text>
                  </g>
                ))}
                {mapped.map((b) => (
                  <g key={b.brand_id} onClick={() => selectBrand(b.brand_id)} style={{ cursor: 'pointer' }}>
                    <circle
                      cx={px(b.x!)} cy={py(b.price_tier)} r={selBrand === b.brand_id ? 8 : 5.5}
                      fill={b.status === 'reference' ? 'white' : '#0A0A0A'}
                      stroke={selBrand === b.brand_id ? '#C4A882' : '#0A0A0A'}
                      strokeWidth={selBrand === b.brand_id ? 2.5 : 1.2}
                      strokeDasharray={b.thin ? '2 2' : undefined}
                    />
                    <title>{`${b.name} — tier ${b.price_tier}${b.thin ? ` · THIN VECTOR (${b.itemCount} items)` : ` · ${b.itemCount} items`}${b.status === 'reference' ? ' · reference' : ''}`}</title>
                    {selBrand === b.brand_id && (
                      <text x={px(b.x!) + 10} y={py(b.price_tier) - 8} fontSize={10} fill="#0A0A0A" letterSpacing={1}>{b.name.toUpperCase()}</text>
                    )}
                  </g>
                ))}
              </svg>
            </div>
            <p className="mt-2 text-[8px] tracking-[0.12em] text-[#A8A8A4]">
              FILLED = STOCKED · HOLLOW = REFERENCE · DASHED RING = THIN VECTOR (&lt;8 SCORED ITEMS — PLACEMENT NOT TRUSTWORTHY) · DASHED BOXES = CURATED FAMILIES
            </p>

            <div className="mt-4 border border-[#E2E0DB] rounded-[10px] bg-white p-4">
              <button onClick={() => setRefOpen(!refOpen)} className={LABEL}>+ ADD REFERENCE BRAND (NOT STOCKED — VECTOR FROM 5-10 PRODUCT IMAGES)</button>
              {refOpen && (
                <div className="mt-3 grid gap-2 max-w-xl">
                  <div className="flex gap-2">
                    <input value={refName} onChange={(e) => setRefName(e.target.value)} placeholder="BRAND NAME (E.G. ROUJE)" className={`${INPUT} flex-1 uppercase placeholder:text-[#A8A8A4]`} />
                    <select value={refTier} onChange={(e) => setRefTier(parseInt(e.target.value, 10))} className={INPUT}>
                      {[1, 2, 3, 4, 5].map((t) => <option key={t} value={t}>{TIER_LABELS[t]}</option>)}
                    </select>
                  </div>
                  <textarea value={refUrls} onChange={(e) => setRefUrls(e.target.value)} rows={5} placeholder="ONE REFERENCE PRODUCT IMAGE URL PER LINE (5-10)" className={`${INPUT} placeholder:text-[#A8A8A4]`} />
                  <button
                    disabled={pending || !refName.trim()}
                    className={`${BTN_DARK} w-fit`}
                    onClick={() => act(
                      () => addReferenceBrand(refName, refTier, refUrls.split('\n')),
                      (r) => setNotice(r.error ?? `${refName.toUpperCase()}: ${r.scored} IMAGES SCORED${r.failed ? `, ${r.failed} FAILED` : ''} — VECTOR SET, RELOAD`),
                    )}
                  >
                    VISION-SCORE &amp; SAVE
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* detail panel */}
          <aside className="self-start border border-[#E2E0DB] rounded-[10px] bg-white p-4">
            {!sel ? (
              <p className="text-[10px] tracking-[0.12em] text-[#A8A8A4]">CLICK A BRAND ON THE MAP.</p>
            ) : (
              <div className="grid gap-4">
                <div>
                  <p className="text-[13px] tracking-[0.1em] text-[#0A0A0A]">{sel.name.toUpperCase()}</p>
                  <p className="text-[8px] tracking-[0.12em] text-[#A8A8A4] mt-1">
                    {TIER_LABELS[sel.price_tier]} · {sel.status.toUpperCase()} · {sel.itemCount} SCORED ITEMS
                    {sel.thin && <span className="text-[#B3202A]"> · THIN VECTOR</span>}
                  </p>
                </div>

                <div>
                  <p className={H2}>FAMILIES</p>
                  {selFamilies.length === 0 && <p className="text-[9px] text-[#A8A8A4] tracking-[0.08em]">NONE</p>}
                  {selFamilies.map((f) => (
                    <div key={f.family_id} className="flex items-center justify-between gap-2 py-1">
                      <span className="text-[9px] tracking-[0.1em] text-[#4A4E57]">
                        {f.name.toUpperCase()} · {f.members.find((m) => m.brand_id === sel.brand_id)?.weight.toUpperCase()}
                      </span>
                      <button disabled={pending} className={BTN_GHOST} onClick={() => act(() => setMembership(f.family_id, sel.brand_id, null), () => setNotice('REMOVED — RELOAD'))}>REMOVE</button>
                    </div>
                  ))}
                  <div className="mt-2 flex gap-1.5 flex-wrap">
                    {data.families.filter((f) => !selFamilies.includes(f)).map((f) => (
                      <span key={f.family_id} className="flex gap-1">
                        <button disabled={pending} className={BTN_GHOST} onClick={() => act(() => setMembership(f.family_id, sel.brand_id, 'core'), () => setNotice('ADDED CORE — RELOAD'))}>+ {f.name.toUpperCase()} CORE</button>
                        <button disabled={pending} className={BTN_GHOST} onClick={() => act(() => setMembership(f.family_id, sel.brand_id, 'adjacent'), () => setNotice('ADDED ADJACENT — RELOAD'))}>ADJ</button>
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <p className={H2}>NEAREST BY VECTOR</p>
                  {(detail?.neighbours ?? []).map((n) => (
                    <div key={n.brand_id} className="flex justify-between py-0.5 text-[9px] tracking-[0.08em] text-[#4A4E57]">
                      <span>{n.name.toUpperCase()}</span><span className="text-[#A8A8A4]">{(n.score * 100).toFixed(0)}%</span>
                    </div>
                  ))}
                  {detail && !detail.neighbours.length && <p className="text-[9px] text-[#A8A8A4] tracking-[0.08em]">NO VECTOR YET</p>}
                </div>

                <div>
                  <p className={H2}>WHAT A CUSTOMER NAMING THIS BRAND GETS</p>
                  {(detail?.similar ?? []).map((s) => (
                    <div key={s.brand_id} className="flex justify-between py-0.5 text-[9px] tracking-[0.08em]">
                      <span className="text-[#4A4E57]">{s.name.toUpperCase()}</span>
                      <span className="text-[#A8A8A4]">
                        {s.mechanism === 'core_family' ? `CORE · ${s.family_name}` : s.mechanism === 'adjacent_family' ? `ADJ · ${s.family_name}` : `VECTOR ${s.score}`}
                      </span>
                    </div>
                  ))}
                  {detail && !detail.similar.length && <p className="text-[9px] text-[#A8A8A4] tracking-[0.08em]">NOTHING — ORPHAN BRAND</p>}
                </div>

                <div>
                  <p className={H2}>EXCLUSIONS</p>
                  {data.exclusions.filter((e) => e.brand_a === sel.brand_id || e.brand_b === sel.brand_id).map((e) => (
                    <div key={e.brand_a + e.brand_b} className="flex items-center justify-between gap-2 py-1">
                      <span className="text-[9px] tracking-[0.08em] text-[#B3202A]">NEVER WITH {(e.brand_a === sel.brand_id ? e.b_name : e.a_name).toUpperCase()}</span>
                      <button disabled={pending} className={BTN_GHOST} onClick={() => act(() => removeExclusion(e.brand_a, e.brand_b), () => setNotice('EXCLUSION REMOVED — RELOAD'))}>REMOVE</button>
                    </div>
                  ))}
                  <div className="mt-1.5 flex gap-1.5">
                    <select value={exclOther} onChange={(e) => setExclOther(e.target.value)} className={`${INPUT} flex-1`}>
                      <option value="">ADD EXCLUSION VS…</option>
                      {data.brands.filter((b) => b.brand_id !== sel.brand_id).map((b) => <option key={b.brand_id} value={b.brand_id}>{b.name}</option>)}
                    </select>
                    <button disabled={pending || !exclOther} className={BTN_GHOST} onClick={() => act(() => addExclusion(sel.brand_id, exclOther, ''), (r) => { setNotice(r.error ?? 'EXCLUDED — RELOAD'); setExclOther('') })}>ADD</button>
                  </div>
                </div>
              </div>
            )}
          </aside>
        </div>
      )}

      {/* ═══════════ USER INSPECTOR ═══════════ */}
      {tab === 'users' && (
        <div className="grid grid-cols-1 xl:grid-cols-[240px_1fr] gap-6">
          <aside className="self-start">
            <p className={H2}>PILOT MEMBERS</p>
            <div className="grid gap-1.5">
              {data.members.map((m) => (
                <button key={m.member_id} onClick={() => selectMember(m.member_id)} className={`${selMember === m.member_id ? CHIP_ON : CHIP_OFF} text-left`}>
                  {m.name.toUpperCase()}{m.is_synthetic ? ' · SYNTH' : ''}
                </button>
              ))}
              {!data.members.length && <p className="text-[9px] text-[#A8A8A4] tracking-[0.08em]">NO PILOT MEMBERS YET.</p>}
            </div>
          </aside>

          <section className="grid gap-6">
            {!inspection ? (
              <p className="text-[10px] tracking-[0.12em] text-[#A8A8A4]">{selMember ? 'LOADING…' : 'PICK A MEMBER.'}</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[13px] tracking-[0.1em] text-[#0A0A0A] mr-2">{inspection.member.name.toUpperCase()}</p>
                  <button disabled={pending} className={BTN_DARK} onClick={() => act(() => seedMemberFromIntake(inspection.member.member_id), (r) => { setNotice(r.error ?? `SEEDED: ${r.named} NAMED, ${r.expanded} EXPANDED, ${r.baseline} BASELINE${r.unmatched?.length ? `, UNMATCHED: ${r.unmatched.join(', ')}` : ''}`); selectMember(inspection.member.member_id) })}>
                    SEED FROM ONBOARDED BRANDS
                  </button>
                  <button disabled={pending} className={BTN_LIGHT} onClick={() => selectMember(inspection.member.member_id, true)}>
                    REFRESH + LOG DISCOVERY IMPRESSIONS
                  </button>
                  <span className="flex gap-1.5 items-center">
                    <input value={forceBrand} onChange={(e) => setForceBrand(e.target.value)} placeholder="FORCE-ADD BRAND" className={`${INPUT} w-40 uppercase placeholder:text-[#A8A8A4]`} />
                    <button disabled={pending || !forceBrand.trim()} className={BTN_GHOST} onClick={() => act(() => forceAddBrand(inspection.member.member_id, forceBrand), (r) => { setNotice(r.error ?? 'FORCE-ADDED AT 1.0'); setForceBrand(''); if (!r.error) selectMember(inspection.member.member_id) })}>ADD</button>
                  </span>
                </div>

                <div>
                  <p className={H2}>ONBOARDED — VERBATIM</p>
                  <div className="flex flex-wrap gap-1.5">
                    {inspection.onboarded.map((b, i) => (
                      <span key={i} className={`${CHIP} ${b.matched ? 'bg-white text-[#4A4E57] border-[#E2E0DB]' : 'bg-white text-[#B3202A] border-[#B3202A]'}`}>
                        {b.rank ? `${b.rank}. ` : ''}{b.name.toUpperCase()}{!b.matched && ' · UNMATCHED'}
                      </span>
                    ))}
                  </div>
                  {inspection.unmatched.length > 0 && (
                    <p className="mt-1.5 text-[8px] tracking-[0.1em] text-[#A8A8A4]">FREE-TEXT LOGGED FOR STOCKING INTEL: {inspection.unmatched.join(' · ').toUpperCase()}</p>
                  )}
                </div>

                <div>
                  <p className={H2}>AFFINITIES ABOVE BASELINE · {inspection.affinities.length}</p>
                  <div className="border border-[#E2E0DB] rounded-[10px] bg-white overflow-x-auto">
                    <table className="w-full text-[9px] tracking-[0.06em] text-[#4A4E57]">
                      <thead>
                        <tr className="text-left text-[8px] tracking-[0.16em] text-[#A8A8A4] border-b border-[#EFEDE9]">
                          <th className="px-3 py-2">BRAND</th><th className="px-2 py-2">AFFINITY</th><th className="px-2 py-2">SOURCE</th>
                          <th className="px-2 py-2">HISTORY</th><th className="px-2 py-2">+/−</th><th className="px-2 py-2">EXPANSION TRACE</th><th className="px-2 py-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {inspection.affinities.map((a) => (
                          <tr key={a.brand_id} className={`border-b border-[#EFEDE9] last:border-b-0 ${a.hidden ? 'opacity-40' : ''}`}>
                            <td className="px-3 py-1.5">{a.brand_name.toUpperCase()}{a.hidden && ' · HIDDEN'}</td>
                            <td className="px-2 py-1.5">
                              <input
                                type="number" step={0.05} min={0} max={1} defaultValue={a.affinity}
                                onBlur={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && Math.abs(v - a.affinity) > 0.001) act(() => overrideAffinity(inspection.member.member_id, a.brand_id, v), () => setNotice(`${a.brand_name.toUpperCase()} → ${v} (LOGGED)`)) }}
                                className="w-16 border border-[#E2E0DB] rounded px-1.5 py-0.5 outline-none focus:border-[#0A0A0A]"
                              />
                            </td>
                            <td className="px-2 py-1.5 text-[#A8A8A4]">{a.source.toUpperCase()}</td>
                            <td className="px-2 py-1.5"><Spark values={a.spark} /></td>
                            <td className="px-2 py-1.5 text-[#A8A8A4]">{a.positive_count}/{a.skip_count}</td>
                            <td className="px-2 py-1.5 text-[#A8A8A4] normal-case">{a.expansion_trace ?? ''}</td>
                            <td className="px-2 py-1.5">
                              <button disabled={pending} className={BTN_GHOST} onClick={() => act(() => setBrandHidden(inspection.member.member_id, a.brand_id, !a.hidden), () => selectMember(inspection.member.member_id))}>
                                {a.hidden ? 'UNHIDE' : 'HIDE'}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div>
                  <p className={H2}>DISCOVERY OUTCOMES · {inspection.discoveries.length}</p>
                  {!inspection.discoveries.length ? (
                    <p className="text-[9px] text-[#A8A8A4] tracking-[0.08em]">NO DISCOVERY IMPRESSIONS YET — THEY LOG WHEN A FEED IS SERVED OR PREVIEW-LOGGED.</p>
                  ) : (
                    <div className="grid gap-1">
                      {inspection.discoveries.map((d, i) => (
                        <p key={i} className="text-[9px] tracking-[0.06em] text-[#4A4E57]">
                          <span className={d.outcome === 'engaged' ? 'text-[#3D7A50]' : d.outcome === 'skipped' ? 'text-[#B3202A]' : 'text-[#A8A8A4]'}>{d.outcome.toUpperCase()}</span>
                          {' · '}{d.brand.toUpperCase()}{d.mechanism ? <span className="text-[#A8A8A4] normal-case"> — {d.mechanism}</span> : ''}
                          <span className="text-[#A8A8A4]"> · {d.context.toUpperCase()} · {d.created_at.slice(0, 10)}</span>
                        </p>
                      ))}
                    </div>
                  )}
                </div>

                <FeedPreview title="FEED PREVIEW — NEXT 12, EXACTLY AS RANKED" feed={inspection.feed} />
              </>
            )}
          </section>
        </div>
      )}

      {/* ═══════════ SIMULATOR ═══════════ */}
      {tab === 'simulator' && (
        <div className="grid gap-6 max-w-4xl">
          <div>
            <p className={H2}>TEST ONBOARDING — NO USER IS CREATED, NOTHING IS WRITTEN</p>
            <textarea value={simInput} onChange={(e) => setSimInput(e.target.value)} rows={5} placeholder="ONE FAVOURITE BRAND PER LINE" className={`${INPUT} w-full max-w-md placeholder:text-[#A8A8A4]`} />
            <div className="mt-2">
              <button disabled={pending} className={BTN_DARK} onClick={() => act(() => simulateOnboarding(simInput.split('\n')), setSim)}>RUN SIMULATION</button>
            </div>
          </div>
          {sim && (
            <>
              {sim.error && <p className="text-[9px] tracking-[0.1em] text-[#B3202A]">{sim.error.toUpperCase()}</p>}
              {sim.unmatched.length > 0 && <p className="text-[9px] tracking-[0.1em] text-[#B3202A]">UNMATCHED: {sim.unmatched.join(' · ').toUpperCase()}</p>}
              <div className="border border-[#E2E0DB] rounded-[10px] bg-white overflow-x-auto">
                <table className="w-full text-[9px] tracking-[0.06em] text-[#4A4E57]">
                  <thead>
                    <tr className="text-left text-[8px] tracking-[0.16em] text-[#A8A8A4] border-b border-[#EFEDE9]">
                      <th className="px-3 py-2">BRAND</th><th className="px-2 py-2">SEEDED</th><th className="px-2 py-2">SOURCE</th><th className="px-2 py-2">WHY</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sim.seeded.map((s, i) => (
                      <tr key={i} className="border-b border-[#EFEDE9] last:border-b-0">
                        <td className="px-3 py-1.5">{s.brand.toUpperCase()}</td>
                        <td className="px-2 py-1.5">{s.affinity}</td>
                        <td className="px-2 py-1.5 text-[#A8A8A4]">{s.source.toUpperCase()}</td>
                        <td className="px-2 py-1.5 text-[#A8A8A4] normal-case">{s.trace ?? 'named'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <FeedPreview title="SAMPLE FEED FOR THIS HYPOTHETICAL CUSTOMER" feed={sim.feed} />
            </>
          )}
        </div>
      )}

      {/* ═══════════ HEALTH ═══════════ */}
      {tab === 'health' && (
        <div className="grid gap-6 max-w-4xl">
          <div className="flex items-center gap-3">
            <button disabled={pending} className={BTN_DARK} onClick={() => act(() => runHealthNow(), (r) => { setReport(r); setNotice('HEALTH CHECKS COMPLETE') })}>RUN CHECKS NOW</button>
            <p className="text-[8px] tracking-[0.12em] text-[#A8A8A4]">ALSO RUNS EVERY MONDAY WITH THE CALIBRATION CRON · FAILURES LAND IN THE CALIBRATION EMAIL</p>
          </div>
          {!report ? (
            <p className="text-[10px] tracking-[0.12em] text-[#A8A8A4]">NO REPORT YET.</p>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              <HealthCard title="ORPHAN BRANDS" hint="stocked, no family, no vector neighbour ≥ 0.5 — naming these expands to almost nothing"
                rows={report.orphan_brands.map((r) => r.name)} />
              <HealthCard title="INCOHERENT FAMILIES" hint="members' pairwise similarity below 0.55 — curation and data disagree"
                rows={report.incoherent_families.map((r) => `${r.family} — avg ${r.avg_similarity}`)} />
              <HealthCard title="TIER VIOLATIONS" hint="family members >1 tier apart (allowed — curation overrides — but review)"
                rows={report.tier_violations.map((r) => `${r.family} (${r.tiers}): ${r.brands}`)} />
              <HealthCard title="STALE / THIN VECTORS" hint="not recomputed in 14+ days, or under 8 scored items"
                rows={report.stale_vectors.map((r) => `${r.name} — ${r.reason}`)} />
              <HealthCard title="STARVED FEEDS" hint="top-20 outfits from ≤3 brands — discovery is dead for these members"
                rows={report.starved_feeds.map((r) => `${r.user_id.slice(0, 8)} — ${r.brands} brands`)} />
              <HealthCard title="DEAD EXPANSIONS" hint="10+ impressions, zero positive signals across ALL users — the adjacency itself may be wrong"
                rows={report.dead_expansions.map((r) => `${r.brand} — ${r.impressions} impressions`)} />
              <HealthCard title="RUNAWAY LEARNING" hint="affinity moved >0.3 in a week — possible signal-weighting bug"
                rows={report.runaway_learning.map((r) => `${r.brand} for ${r.user_id.slice(0, 8)} — moved ${r.moved}`)} />
              <HealthCard title="FREE-TEXT BRAND LOG" hint="unmatched onboarding brands by frequency — the stocking / reference-brand to-do list"
                rows={report.free_text_brands.map((r) => `${r.raw_name} × ${r.count}`)} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function HealthCard({ title, hint, rows }: { title: string; hint: string; rows: string[] }) {
  return (
    <div className="border border-[#E2E0DB] rounded-[10px] bg-white p-4">
      <p className="text-[10px] tracking-[0.18em] text-[#4A4E57]">
        {title} <span className={rows.length ? 'text-[#B3202A]' : 'text-[#3D7A50]'}>· {rows.length}</span>
      </p>
      <p className="mt-1 text-[8px] tracking-[0.06em] text-[#A8A8A4] normal-case leading-relaxed">{hint}</p>
      <div className="mt-2 grid gap-0.5">
        {rows.slice(0, 12).map((r, i) => <p key={i} className="text-[9px] tracking-[0.05em] text-[#4A4E57] normal-case">{r}</p>)}
        {rows.length > 12 && <p className="text-[8px] text-[#A8A8A4]">+{rows.length - 12} more</p>}
        {!rows.length && <p className="text-[9px] tracking-[0.1em] text-[#3D7A50]">CLEAR</p>}
      </div>
    </div>
  )
}

function FeedPreview({ title, feed }: { title: string; feed: MemberInspection['feed'] }) {
  return (
    <div>
      <p className={H2}>{title}</p>
      {!feed.length ? (
        <p className="text-[9px] text-[#A8A8A4] tracking-[0.08em]">NO LIVE OUTFITS TO RANK.</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
          {feed.map((f, i) => (
            <div key={f.outfit_id} className={`border rounded-[10px] overflow-hidden bg-white ${f.discovery ? 'border-[#C4A882]' : 'border-[#EFEDE9]'}`}>
              <div className="aspect-[3/4] bg-[#F2F2F0] relative">
                {f.image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.image_url} alt="" loading="lazy" className="w-full h-full object-cover" />
                )}
                <span className="absolute top-1.5 left-1.5 bg-white/95 border border-[#E2E0DB] rounded px-1 py-0.5 text-[8px] text-[#4A4E57]">#{i + 1}</span>
                {f.discovery && <span className="absolute top-1.5 right-1.5 bg-[#C4A882] text-white rounded px-1 py-0.5 text-[7px] tracking-[0.1em]">DISCOVERY</span>}
              </div>
              <div className="p-2">
                <p className="text-[8px] tracking-[0.1em] text-[#A8A8A4]">{(f.hero ?? '?').toUpperCase()}{f.occasionMatch ? ' · OCC ✓' : ''}</p>
                <p className="text-[9px] tracking-[0.04em] text-[#4A4E57] mt-0.5">
                  {f.combined}{' = '}
                  {f.vecSim != null ? `0.6×${f.vecSim} + 0.4×${f.brandAff}` : `brand ${f.brandAff}`}
                </p>
                {f.discovery && f.attribution && (
                  <p className="text-[7.5px] tracking-[0.04em] text-[#C4A882] mt-0.5 normal-case">because you like — {f.attribution}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
