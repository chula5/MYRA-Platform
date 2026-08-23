'use client'

import { useMemo, useState, useTransition } from 'react'
import {
  addExclusion, addReferenceBrand, createFamily, deleteFamily, forceAddBrand,
  loadBrandDetail, loadMemberInspection, overrideAffinity, recomputeVectorsNow,
  removeExclusion, runHealthNow, seedMemberFromIntake, seedStarterFamily,
  setBrandHidden, setMembership, simulateOnboarding,
  type BrandDetail, type InspectorData, type MemberInspection, type SimulationResult, type MapBrand,
} from './actions'
import type { HealthReport } from '@/lib/brand-affinity'
import { saveAffinityConfig } from './actions'

// Display copy of lib BAND_NAMES — brand-affinity.ts is server-only (it pulls
// in supabase-server → next/headers), so a client component may import its
// TYPES but never its values.
const BAND_NAMES = ['HIGH STREET', 'ACCESSIBLE', 'CONTEMPORARY', 'ADV. CONTEMPORARY', 'DESIGNER', 'LUXURY']

const CHIP = 'px-3.5 py-2 rounded-full text-[16px] tracking-[0.08em] border transition-colors'
const CHIP_ON = `${CHIP} bg-[#0A0A0A] text-white border-[#0A0A0A]`
const CHIP_OFF = `${CHIP} bg-white text-[#6B6B6B] border-[#E2E0DB] hover:border-[#0A0A0A]`
const BTN_DARK = 'bg-[#0A0A0A] text-white rounded-full px-5 py-2.5 text-[16px] tracking-[0.1em] hover:opacity-85 transition-opacity disabled:opacity-40'
const BTN_LIGHT = 'border border-[#0A0A0A] text-[#0A0A0A] rounded-full px-5 py-2.5 text-[16px] tracking-[0.1em] hover:bg-[#0A0A0A] hover:text-white transition-colors disabled:opacity-40'
const BTN_GHOST = 'border border-[#E2E0DB] text-[#4A4E57] rounded-full px-4 py-2 text-[16px] tracking-[0.1em] hover:border-[#0A0A0A] hover:text-[#0A0A0A] transition-colors disabled:opacity-40'
const INPUT = 'border border-[#E2E0DB] rounded-[8px] px-3 py-2.5 text-[16px] tracking-[0.04em] outline-none focus:border-[#0A0A0A] bg-white'
const LABEL = 'text-[16px] tracking-[0.12em] text-[#4A4E57]'
const H2 = 'text-[15px] tracking-[0.14em] text-[#4A4E57] mb-3'

const TIER_LABELS = ['', 'HIGH STREET', 'CONTEMPORARY', 'PREMIUM', 'LUXURY', 'ULTRA-LUXURY']

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return <span className="text-[16px] text-[#A8A8A4]">—</span>
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
  const [refPrice, setRefPrice] = useState('')
  const [railOpen, setRailOpen] = useState(false)
  const [cfgBounds, setCfgBounds] = useState(data.config.bandBounds.join(', '))
  const [cfgK, setCfgK] = useState(String(data.config.priceK))
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [drag, setDrag] = useState<{ sx: number; sy: number; px: number; py: number } | null>(null)

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

  // ── map geometry: X = PCA of brand codes, Y = continuous log price ──
  // ONE scale drives dots, gridlines and band stripes. A brand renders ONLY
  // with a real position: an X (codes or provisional centroid PCA) AND a
  // computed/manual price_position — no placeholder fallbacks, ever.
  const [brandQuery, setBrandQuery] = useState('')
  const W = 1000; const H = 520
  // left margin holds the band names — 'ADV. CONTEMPORARY' is the widest at
  // ~127 units, so anything narrower runs it into the £ gridline labels
  const M = { left: 145, right: 24, top: 16, bottom: 44 }
  const bounds = data.config.bandBounds
  const bandEdges = [40, ...bounds, 8000] // full band ladder; domain clamps below

  const positioned = data.brands.filter((b) => b.x != null && b.price_position != null)
  const unpositioned = data.brands.filter((b) => b.x == null || b.price_position == null)

  // visible domain = data range padded by one band each side
  const prices = positioned.map((b) => Math.exp(b.price_position!))
  const minP = prices.length ? Math.min(...prices) : 100
  const maxP = prices.length ? Math.max(...prices) : 3000
  let loIdx = 0; let hiIdx = bandEdges.length - 1
  for (let i = 0; i < bandEdges.length; i++) { if (bandEdges[i] <= minP) loIdx = i }
  for (let i = bandEdges.length - 1; i >= 0; i--) { if (bandEdges[i] >= maxP) hiIdx = i }
  loIdx = Math.max(0, loIdx - 1); hiIdx = Math.min(bandEdges.length - 1, hiIdx + 1)
  const LN_MIN = Math.log(bandEdges[loIdx]); const LN_MAX = Math.log(bandEdges[hiIdx])

  const px = (x: number) => M.left + x * (W - M.left - M.right)
  const py = (pricePos: number) => {
    const t = (Math.min(Math.max(pricePos, LN_MIN), LN_MAX) - LN_MIN) / (LN_MAX - LN_MIN)
    return H - M.bottom - t * (H - M.top - M.bottom)
  }

  // beeswarm: X-ONLY separation — Y always stays true to price, so dots can
  // never drift across a band stripe
  const mapped = useMemo(() => {
    const pts = positioned.map((b) => ({ b, px: px(b.x!), py: py(b.price_position!) }))
    const MIN = 11
    for (let iter = 0; iter < 40; iter++) {
      let moved = false
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
        const dy = pts[j].py - pts[i].py
        if (Math.abs(dy) >= MIN) continue
        const dx = pts[j].px - pts[i].px
        const d = Math.sqrt(dx * dx + dy * dy)
        if (d >= MIN) continue
        const push = (MIN - d) / 2 + 0.2
        const dir = dx === 0 ? (i % 2 ? 1 : -1) : Math.sign(dx)
        pts[i].px = Math.max(M.left + 6, pts[i].px - dir * push)
        pts[j].px = Math.min(W - M.right - 6, pts[j].px + dir * push)
        moved = true
      }
      if (!moved) break
    }
    return pts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.brands, LN_MIN, LN_MAX])

  const GRID_PRICES = [150, 400, 800, 1500, 3000].filter((p) => Math.log(p) >= LN_MIN && Math.log(p) <= LN_MAX)
  const visibleBandEdges = bandEdges.filter((e) => Math.log(e) >= LN_MIN && Math.log(e) <= LN_MAX)

  const familyInfo = data.families.map((f) => {
    const pts = mapped.filter((p) => f.members.some((m) => m.brand_id === p.b.brand_id))
    const unpos = f.members.length - pts.length
    if (pts.length < 2) return { name: f.name, family_id: f.family_id, box: null, unpos }
    const xs = pts.map((p) => p.px); const ys = pts.map((p) => p.py)
    return {
      name: f.name, family_id: f.family_id, unpos,
      box: {
        x: Math.min(...xs) - 16, y: Math.min(...ys) - 16,
        w: Math.max(...xs) - Math.min(...xs) + 32, h: Math.max(...ys) - Math.min(...ys) + 32,
      },
    }
  })
  const familyBoxes = familyInfo
    .filter((f) => f.box && visibleFamilies.has(f.family_id))
    .map((f) => ({ name: f.name, ...f.box! }))

  // zoom/pan → viewBox
  const vw = W / zoom; const vh = H / zoom
  const vx = Math.min(Math.max(pan.x, 0), W - vw)
  const vy = Math.min(Math.max(pan.y, 0), H - vh)

  const sel = selBrand ? brandById.get(selBrand) : null
  const selFamilies = sel ? data.families.filter((f) => f.members.some((m) => m.brand_id === sel.brand_id)) : []

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <a href="/studio/taste/codes" className={CHIP_OFF}>BRAND CODES →</a>
        {(['map', 'users', 'simulator', 'health'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={tab === t ? CHIP_ON : CHIP_OFF}>
            {t === 'map' ? 'BRAND MAP' : t === 'users' ? 'USER INSPECTOR' : t === 'simulator' ? 'SIMULATOR' : 'HEALTH'}
            {t === 'health' && (data.badges.orphans + data.badges.incoherent + data.badges.starved + data.badges.dead > 0) && (
              <span className="ml-1.5 text-[#B3202A]">· {data.badges.orphans + data.badges.incoherent + data.badges.starved + data.badges.dead}</span>
            )}
          </button>
        ))}
        {notice && <p className="text-[16px] tracking-[0.1em] text-[#C4A882] max-w-lg truncate">{notice}</p>}
        {pending && <span className="text-[16px] tracking-[0.14em] text-[#A8A8A4]">WORKING…</span>}
      </div>

      {/* ═══════════ BRAND MAP ═══════════ */}
      {tab === 'map' && (
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-6">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              {data.families.map((f) => {
                const info = familyInfo.find((x) => x.family_id === f.family_id)
                return (
                  <button
                    key={f.family_id}
                    onClick={() => setVisibleFamilies((s) => { const n = new Set(s); n.has(f.family_id) ? n.delete(f.family_id) : n.add(f.family_id); return n })}
                    className={visibleFamilies.has(f.family_id) ? CHIP_ON : CHIP_OFF}
                    title={info?.box ? undefined : 'Fewer than 2 members positioned — no hull drawn'}
                  >
                    {f.name.toUpperCase()} · {f.members.length}
                    {(info?.unpos ?? 0) > 0 && <span className="text-[#B3202A]"> · {info!.unpos} UNPOSITIONED</span>}
                  </button>
                )
              })}
              <span className="mx-1 h-4 w-px bg-[#E2E0DB]" />
              <button disabled={pending} className={BTN_GHOST} onClick={() => act(() => recomputeVectorsNow(), (r) => setNotice(`${r.updated} BRAND VECTORS RECOMPUTED — RELOAD TO SEE THE MAP MOVE`))}>RECOMPUTE VECTORS</button>
              <button disabled={pending} className={BTN_GHOST} onClick={() => act(() => seedStarterFamily(), () => setNotice('FRENCH CONTEMPORARY SEEDED — RELOAD'))}>SEED STARTER FAMILY</button>
              <span className="flex items-center gap-1.5">
                <input value={famName} onChange={(e) => setFamName(e.target.value)} placeholder="NEW FAMILY NAME" className={`${INPUT} w-40 uppercase placeholder:text-[#A8A8A4]`} />
                <button disabled={pending || !famName.trim()} className={BTN_GHOST} onClick={() => act(() => createFamily(famName, ''), (r) => { setNotice(r.error ?? 'FAMILY CREATED — RELOAD'); setFamName('') })}>ADD</button>
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 mb-3 text-[16px] tracking-[0.14em] text-[#A8A8A4]">
              BAND BOUNDS £
              <input value={cfgBounds} onChange={(e) => setCfgBounds(e.target.value)} className={`${INPUT} w-56`} title="5 ascending GBP boundaries, comma-separated" />
              PRICE DECAY K
              <input value={cfgK} onChange={(e) => setCfgK(e.target.value)} className={`${INPUT} w-16`} title="price_proximity = exp(-|Δ ln price| / k) — smaller k punishes price gaps harder" />
              <button
                disabled={pending}
                className={BTN_GHOST}
                onClick={() => act(() => saveAffinityConfig(cfgBounds.split(',').map((s) => parseFloat(s.trim())), parseFloat(cfgK)), (r) => setNotice(r.error ?? 'CONFIG SAVED — RELOAD TO RE-RANK'))}
              >
                SAVE CONFIG
              </button>
            </div>

            <p className="mb-1.5 text-[16px] tracking-[0.16em] text-[#6B6B6B]">
              POSITIONED: {positioned.length} OF {data.brands.length} BRANDS
              {unpositioned.length > 0 && <span className="text-[#A8A8A4]"> · {unpositioned.length} IN THE RAIL BELOW</span>}
            </p>
            <div className="border border-[#E2E0DB] rounded-[10px] bg-white overflow-hidden relative">
              <div className="absolute top-2 right-2 flex gap-1 z-10">
                <button className={BTN_GHOST} onClick={() => setZoom((z) => Math.min(4, z * 1.4))}>+</button>
                <button className={BTN_GHOST} onClick={() => setZoom((z) => Math.max(1, z / 1.4))}>−</button>
                <button className={BTN_GHOST} onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }}>RESET</button>
              </div>
              <svg
                viewBox={`${vx} ${vy} ${vw} ${vh}`}
                className="w-full min-w-[720px]"
                style={{ cursor: drag ? 'grabbing' : zoom > 1 ? 'grab' : 'default', touchAction: 'none' }}
                onPointerDown={(e) => { if (zoom > 1) { (e.target as Element).setPointerCapture?.(e.pointerId); setDrag({ sx: e.clientX, sy: e.clientY, px: vx, py: vy }) } }}
                onPointerMove={(e) => {
                  if (!drag) return
                  const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
                  const scale = vw / rect.width
                  setPan({ x: drag.px - (e.clientX - drag.sx) * scale, y: drag.py - (e.clientY - drag.sy) * scale })
                }}
                onPointerUp={() => setDrag(null)}
                onDoubleClick={() => setZoom((z) => Math.min(4, z * 1.6))}
              >
                {/* positioning bands — stripes derived from the SAME scale as
                    dots and gridlines, clipped to the visible domain */}
                {visibleBandEdges.slice(0, -1).map((lo, i) => {
                  const hi = visibleBandEdges[i + 1]
                  const yTop = py(Math.log(hi)); const yBot = py(Math.log(lo))
                  const bandIdx = bandEdges.indexOf(lo)
                  return (
                    <g key={lo}>
                      <rect x={M.left} y={yTop} width={W - M.left - M.right} height={yBot - yTop} fill={bandIdx % 2 ? '#FAFAF8' : '#FFFFFF'} />
                      {yBot - yTop > 14 && (
                        <text x={8} y={(yTop + yBot) / 2 + 4} fontSize={9.5} fill="#7A7A75" letterSpacing={1.4}>{BAND_NAMES[Math.min(bandIdx, BAND_NAMES.length - 1)]}</text>
                      )}
                    </g>
                  )
                })}
                {/* £ gridlines, labels INSIDE the plot on the left */}
                {GRID_PRICES.map((p) => (
                  <g key={p}>
                    <line x1={M.left} x2={W - M.right} y1={py(Math.log(p))} y2={py(Math.log(p))} stroke="#E2E0DB" strokeWidth={0.8} />
                    <text x={M.left + 6} y={py(Math.log(p)) - 4} fontSize={9.5} fill="#7A7A75" letterSpacing={1}>£{p.toLocaleString()}</text>
                  </g>
                ))}
                <text x={M.left + 8} y={H - 12} fontSize={9.5} fill="#7A7A75" letterSpacing={1.8}>← AESTHETIC POSITION (PCA OF BRAND VECTORS) →</text>
                {familyBoxes.map((f) => (
                  <g key={f.name}>
                    <rect x={f.x} y={f.y} width={f.w} height={f.h} fill="none" stroke="#C4A882" strokeWidth={1} strokeDasharray="5 4" rx={12} />
                    <text x={f.x + 6} y={f.y - 6} fontSize={10} fill="#C4A882" letterSpacing={1.5}>{f.name.toUpperCase()}</text>
                  </g>
                ))}
                {mapped.map(({ b, px: cx, py: cy }) => (
                  <g key={b.brand_id} onClick={() => selectBrand(b.brand_id)} style={{ cursor: 'pointer' }}>
                    <circle
                      cx={cx} cy={cy} r={selBrand === b.brand_id ? 5 : 3}
                      fill={b.coded ? (b.status === 'reference' ? '#C4A882' : '#0A0A0A') : 'white'}
                      stroke={selBrand === b.brand_id ? '#C4A882' : b.coded ? '#0A0A0A' : b.thin ? '#A8A8A4' : '#6B6B6B'}
                      strokeWidth={selBrand === b.brand_id ? 2.5 : 1}
                      strokeDasharray={b.thin && !b.coded ? '2 2' : undefined}
                    />
                    {/* name under every dot — paint-order keeps the halo behind
                        the glyphs so overlapping labels stay readable */}
                    <text
                      x={cx} y={cy + 9} textAnchor="middle"
                      fontSize={6.6} letterSpacing={0.3}
                      fill={selBrand === b.brand_id ? '#0A0A0A' : '#6B6B6B'}
                      stroke="#FFFFFF" strokeWidth={1.6} paintOrder="stroke"
                      style={{ pointerEvents: 'none' }}
                    >
                      {b.name.toUpperCase()}
                    </text>
                    <title>{`${b.name} — ${b.medianPrice != null ? `median £${Math.round(b.medianPrice)}` : `no price data (tier ${b.price_tier} assumed)`}${b.coreCategory ? ` · core: ${b.coreCategory}` : ''}${b.band != null ? ` · ${BAND_NAMES[b.band]}` : ''}${b.coded ? '' : ' · CODES INCOMPLETE (provisional position)'}${b.thin ? ` · THIN VECTOR (${b.itemCount} items)` : ` · ${b.itemCount} items`}${b.status === 'reference' ? ' · reference' : ''}`}</title>
                    {selBrand === b.brand_id && (() => {
                      const wEst = b.name.length * 7 + 10
                      const flip = cx + 10 + wEst > W - M.right
                      const lx = flip ? cx - 10 - wEst : cx + 10
                      const ly = Math.max(M.top + 12, Math.min(H - M.bottom - 4, cy - 9))
                      return (
                        <g>
                          <rect x={lx - 3} y={ly - 10} width={wEst} height={14} fill="white" opacity={0.92} rx={3} />
                          <text x={lx} y={ly} fontSize={10} fill="#0A0A0A" letterSpacing={1}>{b.name.toUpperCase()}</text>
                        </g>
                      )
                    })()}
                  </g>
                ))}
                {!mapped.length && (
                  <text x={W / 2} y={H / 2} fontSize={11} fill="#A8A8A4" letterSpacing={2} textAnchor="middle">
                    NOTHING POSITIONED YET — RECOMPUTE VECTORS, THEN RELOAD
                  </text>
                )}
              </svg>
            </div>
            <p className="mt-2 text-[16px] tracking-[0.12em] text-[#A8A8A4]">
              EVERY DOT IS LABELLED — ZOOM IN WHERE THEY CROWD · FILLED = FULLY CODED (X = PCA OF BRAND CODES) · HOLLOW = CODES INCOMPLETE, PROVISIONAL ITEM-CENTROID POSITION · GOLD = REFERENCE · Y = LOG MEDIAN PRICE, REAL DATA ONLY · DASHED BOXES = FAMILIES · DOUBLE-CLICK/± TO ZOOM, DRAG TO PAN
            </p>

            {/* not-yet-positioned rail — brands stay OFF the map until they
                have a real X and a real price; no placeholder positions */}
            <div className="mt-3 border border-[#E2E0DB] rounded-[10px] bg-white">
              <button onClick={() => setRailOpen(!railOpen)} className="w-full text-left px-4 py-2.5 text-[16px] tracking-[0.16em] text-[#6B6B6B] hover:text-[#0A0A0A] transition-colors">
                NOT YET POSITIONED ({unpositioned.length} BRANDS) {railOpen ? '▾' : '▸'}
              </button>
              {railOpen && (
                <div className="px-4 pb-3 grid gap-1 max-h-64 overflow-y-auto" data-lenis-prevent>
                  {unpositioned.map((b) => {
                    const reasons = [
                      b.x == null ? (b.itemCount < 5 ? 'thin vector' : 'no identity') : null,
                      b.price_position == null ? 'no price data' : null,
                    ].filter(Boolean).join(' + ')
                    return (
                      <div key={b.brand_id} className="flex items-center justify-between gap-2 py-0.5 border-b border-[#EFEDE9] last:border-b-0">
                        <button onClick={() => selectBrand(b.brand_id)} className="text-[16px] tracking-[0.08em] text-[#4A4E57] hover:underline text-left truncate">
                          {b.name.toUpperCase()}
                          <span className="text-[#A8A8A4] normal-case"> — {reasons} · {b.itemCount} items</span>
                        </button>
                        <button
                          className={BTN_GHOST}
                          onClick={() => { setRefName(b.name); setRefTier(b.price_tier); setRefOpen(true); setNotice('REFERENCE-SCORING FORM OPENED BELOW — IMAGES SET THE VECTOR, TYPICAL £ SETS THE PRICE') }}
                        >
                          REFERENCE-SCORE
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="mt-4 border border-[#E2E0DB] rounded-[10px] bg-white p-4">
              <button onClick={() => setRefOpen(!refOpen)} className={LABEL}>+ ADD REFERENCE BRAND (NOT STOCKED — VECTOR FROM 5-10 PRODUCT IMAGES)</button>
              {refOpen && (
                <div className="mt-3 grid gap-2 max-w-xl">
                  <div className="flex gap-2">
                    <input value={refName} onChange={(e) => setRefName(e.target.value)} placeholder="BRAND NAME (E.G. ROUJE)" className={`${INPUT} flex-1 uppercase placeholder:text-[#A8A8A4]`} />
                    <select value={refTier} onChange={(e) => setRefTier(parseInt(e.target.value, 10))} className={INPUT}>
                      {[1, 2, 3, 4, 5].map((t) => <option key={t} value={t}>{TIER_LABELS[t]}</option>)}
                    </select>
                    <input value={refPrice} onChange={(e) => setRefPrice(e.target.value)} placeholder="TYPICAL £ (DRESS/BAG)" className={`${INPUT} w-40 placeholder:text-[#A8A8A4]`} />
                  </div>
                  <textarea value={refUrls} onChange={(e) => setRefUrls(e.target.value)} rows={5} placeholder="ONE REFERENCE PRODUCT IMAGE URL PER LINE (5-10)" className={`${INPUT} placeholder:text-[#A8A8A4]`} />
                  <button
                    disabled={pending || !refName.trim()}
                    className={`${BTN_DARK} w-fit`}
                    onClick={() => act(
                      () => addReferenceBrand(refName, refTier, refUrls.split('\n'), parseFloat(refPrice) || null),
                      (r) => setNotice(r.error ?? `${refName.toUpperCase()}: ${r.scored} IMAGES SCORED${r.failed ? `, ${r.failed} FAILED` : ''} — VECTOR SET, RELOAD`),
                    )}
                  >
                    VISION-SCORE &amp; SAVE
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="self-start grid gap-4">
          {/* every brand, clickable — the map is dense, so the list is the
              reliable way to find one and light it up */}
          <aside className="border border-[#E2E0DB] rounded-[10px] bg-white p-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className={H2}>ALL BRANDS · {data.brands.length}</p>
              <input
                value={brandQuery}
                onChange={(e) => setBrandQuery(e.target.value)}
                placeholder="SEARCH"
                className={`${INPUT} w-28 uppercase placeholder:text-[#A8A8A4]`}
              />
            </div>
            <div className="max-h-72 overflow-y-auto grid" data-lenis-prevent>
              {data.brands
                .filter((b) => b.name.toLowerCase().includes(brandQuery.trim().toLowerCase()))
                .map((b) => {
                  const on = selBrand === b.brand_id
                  const placed = b.x != null && b.price_position != null
                  return (
                    <button
                      key={b.brand_id}
                      onClick={() => selectBrand(b.brand_id)}
                      className={`flex items-center justify-between gap-2 text-left px-1.5 py-1 border-b border-[#F2F0EC] last:border-b-0 transition-colors ${
                        on ? 'bg-[#FBF6EC]' : 'hover:bg-[#FAFAF8]'
                      }`}
                    >
                      <span className={`text-[16px] tracking-[0.08em] truncate ${on ? 'text-[#0A0A0A]' : 'text-[#4A4E57]'}`}>
                        {b.name.toUpperCase()}
                      </span>
                      <span className="text-[16px] tracking-[0.06em] text-[#A8A8A4] shrink-0">
                        {placed ? (b.medianPrice ? `£${Math.round(b.medianPrice)}` : '—') : 'NOT ON MAP'}
                      </span>
                    </button>
                  )
                })}
            </div>
          </aside>

          {/* detail panel */}
          <aside className="border border-[#E2E0DB] rounded-[10px] bg-white p-4">
            {!sel ? (
              <p className="text-[16px] tracking-[0.12em] text-[#A8A8A4]">CLICK A BRAND ON THE MAP.</p>
            ) : (
              <div className="grid gap-4">
                <div>
                  <p className="text-[16px] tracking-[0.1em] text-[#0A0A0A]">{sel.name.toUpperCase()}</p>
                  <p className="text-[16px] tracking-[0.12em] text-[#A8A8A4] mt-1">
                    {TIER_LABELS[sel.price_tier]} · {sel.status.toUpperCase()} · {sel.itemCount} SCORED ITEMS
                    {sel.thin && <span className="text-[#B3202A]"> · THIN VECTOR</span>}
                  </p>
                </div>

                <div>
                  <p className={H2}>FAMILIES</p>
                  {selFamilies.length === 0 && <p className="text-[16px] text-[#A8A8A4] tracking-[0.08em]">NONE</p>}
                  {selFamilies.map((f) => (
                    <div key={f.family_id} className="flex items-center justify-between gap-2 py-1">
                      <span className="text-[16px] tracking-[0.1em] text-[#4A4E57]">
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

                {detail?.thin ? (
                  <div className="border border-[#E2E0DB] rounded-[8px] p-3 bg-[#FAFAF8]">
                    <p className="text-[16px] tracking-[0.12em] text-[#B3202A]">NOT ENOUGH DATA — {sel.itemCount} SCORED ITEM{sel.itemCount === 1 ? '' : 'S'}</p>
                    <p className="mt-1 text-[16px] tracking-[0.05em] text-[#6B6B6B] normal-case leading-relaxed">
                      Neighbour lists and similarity scores are suppressed until this brand has 5+ scored items,
                      or a reference-image vector. Only curated family membership can expand from it meanwhile.
                    </p>
                    <button
                      className={`${BTN_DARK} mt-2`}
                      onClick={() => { setRefName(sel.name); setRefTier(sel.price_tier); setRefOpen(true); setNotice('REFERENCE-SCORING FORM OPENED BELOW THE MAP — PASTE 5-10 PRODUCT IMAGE URLS') }}
                    >
                      REFERENCE-SCORE THIS BRAND
                    </button>
                  </div>
                ) : (
                  <>
                    <div>
                      <p className={H2}>NEAREST — AESTHETIC × PRICE = COMBINED</p>
                      {(detail?.neighbours ?? []).map((n) => (
                        <div key={n.brand_id} className="flex justify-between gap-2 py-0.5 text-[16px] tracking-[0.08em] text-[#4A4E57]">
                          <span className="truncate">{n.name.toUpperCase()}{n.basis === 'vector' && <span className="text-[#B3202A]"> · PROV.</span>}</span>
                          <span className="text-[#A8A8A4] whitespace-nowrap">{n.aesthetic.toFixed(2)} × {n.priceFactor.toFixed(2)} = <span className="text-[#4A4E57]">{n.combined.toFixed(2)}</span></span>
                        </div>
                      ))}
                      {detail && !detail.neighbours.length && <p className="text-[16px] text-[#A8A8A4] tracking-[0.08em]">NO VECTOR YET</p>}
                    </div>

                    <div>
                      <p className={H2}>WHAT A CUSTOMER NAMING THIS BRAND GETS</p>
                      {(detail?.similar ?? []).map((s) => (
                        <div key={s.brand_id} className="flex justify-between gap-2 py-0.5 text-[16px] tracking-[0.08em]">
                          <span className="text-[#4A4E57] truncate">{s.name.toUpperCase()}</span>
                          <span className="text-[#A8A8A4] whitespace-nowrap">
                            {s.mechanism === 'core_family' ? `CORE · ${s.family_name}` : s.mechanism === 'adjacent_family' ? `ADJ · ${s.family_name}` :
                              s.aesthetic != null ? `${s.basis === 'vector' ? 'PROV. ' : ''}${s.aesthetic.toFixed(2)} × ${s.priceFactor?.toFixed(2)} = ${s.score?.toFixed(2)}` : `VECTOR ${s.score}`}
                          </span>
                        </div>
                      ))}
                      {detail && !detail.similar.length && <p className="text-[16px] text-[#A8A8A4] tracking-[0.08em]">NOTHING — ORPHAN BRAND</p>}
                    </div>
                  </>
                )}

                <div>
                  <p className={H2}>EXCLUSIONS</p>
                  {data.exclusions.filter((e) => e.brand_a === sel.brand_id || e.brand_b === sel.brand_id).map((e) => (
                    <div key={e.brand_a + e.brand_b} className="flex items-center justify-between gap-2 py-1">
                      <span className="text-[16px] tracking-[0.08em] text-[#B3202A]">NEVER WITH {(e.brand_a === sel.brand_id ? e.b_name : e.a_name).toUpperCase()}</span>
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
              {!data.members.length && <p className="text-[16px] text-[#A8A8A4] tracking-[0.08em]">NO PILOT MEMBERS YET.</p>}
            </div>
          </aside>

          <section className="grid gap-6">
            {!inspection ? (
              <p className="text-[16px] tracking-[0.12em] text-[#A8A8A4]">{selMember ? 'LOADING…' : 'PICK A MEMBER.'}</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[16px] tracking-[0.1em] text-[#0A0A0A] mr-2">{inspection.member.name.toUpperCase()}</p>
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
                    <p className="mt-1.5 text-[16px] tracking-[0.1em] text-[#A8A8A4]">FREE-TEXT LOGGED FOR STOCKING INTEL: {inspection.unmatched.join(' · ').toUpperCase()}</p>
                  )}
                </div>

                <MemberScatter
                  inspection={inspection}
                  brands={data.brands}
                  px={px}
                  py={py}
                  W={W}
                  H={H}
                  M={M}
                  gridPrices={GRID_PRICES}
                />

                <div>
                  <p className={H2}>AFFINITIES ABOVE BASELINE · {inspection.affinities.length} — THE NUMBERS BEHIND THE MAP</p>
                  <div className="border border-[#E2E0DB] rounded-[10px] bg-white overflow-x-auto">
                    <table className="w-full text-[16px] tracking-[0.06em] text-[#4A4E57]">
                      <thead>
                        <tr className="text-left text-[16px] tracking-[0.16em] text-[#A8A8A4] border-b border-[#EFEDE9]">
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
                    <p className="text-[16px] text-[#A8A8A4] tracking-[0.08em]">NO DISCOVERY IMPRESSIONS YET — THEY LOG WHEN A FEED IS SERVED OR PREVIEW-LOGGED.</p>
                  ) : (
                    <div className="grid gap-1">
                      {inspection.discoveries.map((d, i) => (
                        <p key={i} className="text-[16px] tracking-[0.06em] text-[#4A4E57]">
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
              {sim.error && <p className="text-[16px] tracking-[0.1em] text-[#B3202A]">{sim.error.toUpperCase()}</p>}
              {sim.unmatched.length > 0 && <p className="text-[16px] tracking-[0.1em] text-[#B3202A]">UNMATCHED: {sim.unmatched.join(' · ').toUpperCase()}</p>}
              <div className="border border-[#E2E0DB] rounded-[10px] bg-white overflow-x-auto">
                <table className="w-full text-[16px] tracking-[0.06em] text-[#4A4E57]">
                  <thead>
                    <tr className="text-left text-[16px] tracking-[0.16em] text-[#A8A8A4] border-b border-[#EFEDE9]">
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
            <p className="text-[16px] tracking-[0.12em] text-[#A8A8A4]">ALSO RUNS EVERY MONDAY WITH THE CALIBRATION CRON · FAILURES LAND IN THE CALIBRATION EMAIL</p>
          </div>
          {!report ? (
            <p className="text-[16px] tracking-[0.12em] text-[#A8A8A4]">NO REPORT YET.</p>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              <HealthCard title="ORPHAN BRANDS" hint="stocked, no family, no vector neighbour ≥ 0.5 — naming these expands to almost nothing"
                rows={report.orphan_brands.map((r) => r.name)} />
              <HealthCard title="INCOHERENT FAMILIES" hint="members' pairwise similarity below 0.55 — curation and data disagree"
                rows={report.incoherent_families.map((r) => `${r.family} — avg ${r.avg_similarity}`)} />
              <HealthCard title="BAND VIOLATIONS" hint="family spanning 3+ positioning bands (allowed — curation overrides — but review)"
                rows={report.tier_violations.map((r) => `${r.family} (${r.tiers}): ${r.brands}`)} />
              <HealthCard title="PRICE OUTLIERS IN FAMILY" hint="member more than 1 band from the family's median band"
                rows={(report.price_outliers ?? []).map((r) => `${r.family}: ${r.brand} — ${r.detail}`)} />
              <HealthCard title="PRICE EXTRACTION FAILURES" hint="5+ items but no median — per-item reasons from the exact job logic; never silent"
                rows={(report.price_extraction_failures ?? []).map((r) => `${r.brand} (${r.items} items): ${r.reasons}`)} />
              <HealthCard title="CODE DRIFT — BUY VS IDENTITY" hint="stocked-item profile disagrees strongly with the authored codes on a mappable dimension. Curation intelligence — never auto-corrected."
                rows={(report.code_drift ?? []).map((r) => r.message)} />
              <HealthCard title="STALE / THIN VECTORS" hint="not recomputed in 14+ days, or under 5 scored items"
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

// Her brand world as a map rather than a table: the same axes as the brand
// map, showing only the brands she has a relationship with. Gold = she named
// it, teal = MYRA expanded to it from one she named, black = confirmed by her
// own yes/no. Everything positioned here is what her composer can draw on.
const MEMBER_ROLES: { key: string; label: string; colour: string }[] = [
  { key: 'onboarded', label: 'SHE NAMED', colour: '#C4A882' },
  { key: 'expanded', label: 'MYRA SUGGESTS', colour: '#3E8E8C' },
  { key: 'learned', label: 'CONFIRMED BY HER', colour: '#0A0A0A' },
]

function MemberScatter({
  inspection, brands, px, py, W, H, M, gridPrices,
}: {
  inspection: MemberInspection
  brands: MapBrand[]
  px: (x: number) => number
  py: (p: number) => number
  W: number
  H: number
  M: { left: number; right: number; top: number; bottom: number }
  gridPrices: number[]
}) {
  const [showRoles, setShowRoles] = useState<Set<string>>(new Set(['onboarded', 'expanded', 'learned']))
  const byId = useMemo(() => new Map(brands.map((b) => [b.brand_id, b])), [brands])

  const dots = useMemo(() => {
    const out: Array<{ id: string; name: string; x: number; y: number; role: string; aff: number; trace: string | null; hidden: boolean }> = []
    for (const a of inspection.affinities) {
      const b = byId.get(a.brand_id)
      if (!b || b.x == null || b.price_position == null) continue
      const role = a.source === 'onboarded' ? 'onboarded' : a.source === 'learned' ? 'learned' : 'expanded'
      out.push({
        id: a.brand_id, name: a.brand_name, x: px(b.x), y: py(b.price_position),
        role, aff: a.affinity, trace: a.expansion_trace, hidden: a.hidden,
      })
    }
    // named last so their labels sit on top of the crowd
    return out.sort((p, q) => (p.role === 'onboarded' ? 1 : 0) - (q.role === 'onboarded' ? 1 : 0))
  }, [inspection, byId, px, py])

  const counts = dots.reduce<Record<string, number>>((acc, d) => ({ ...acc, [d.role]: (acc[d.role] ?? 0) + 1 }), {})
  const offMap = inspection.affinities.length - dots.length
  const visible = dots.filter((d) => showRoles.has(d.role))
  const H2S = 'text-[16px] tracking-[0.16em] text-[#6B6B6B]'

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
        <p className={H2S}>HER BRAND WORLD — WHAT HER COMPOSER CAN DRAW ON</p>
        <div className="flex flex-wrap items-center gap-3">
          {MEMBER_ROLES.map((r) => (
            <button
              key={r.key}
              onClick={() => setShowRoles((s) => { const n = new Set(s); n.has(r.key) ? n.delete(r.key) : n.add(r.key); return n })}
              className={`flex items-center gap-1.5 text-[16px] tracking-[0.12em] text-[#4A4E57] transition-opacity ${showRoles.has(r.key) ? '' : 'opacity-35'}`}
            >
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: r.colour }} />
              {r.label} · {counts[r.key] ?? 0}
            </button>
          ))}
        </div>
      </div>

      <div className="border border-[#E2E0DB] rounded-[10px] bg-white overflow-hidden">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[720px]">
          {gridPrices.map((p) => (
            <g key={p}>
              <line x1={M.left} x2={W - M.right} y1={py(Math.log(p))} y2={py(Math.log(p))} stroke="#E2E0DB" strokeWidth={0.8} />
              <text x={M.left + 6} y={py(Math.log(p)) - 4} fontSize={9.5} fill="#7A7A75" letterSpacing={1}>£{p.toLocaleString()}</text>
            </g>
          ))}
          <text x={M.left + 8} y={H - 12} fontSize={9.5} fill="#7A7A75" letterSpacing={1.8}>← AESTHETIC POSITION (SAME AXES AS THE BRAND MAP) →</text>

          {visible.map((d) => {
            const colour = MEMBER_ROLES.find((r) => r.key === d.role)!.colour
            const named = d.role === 'onboarded'
            return (
              <g key={d.id} opacity={d.hidden ? 0.3 : 1}>
                <circle
                  cx={d.x} cy={d.y} r={named ? 4.5 : 3}
                  fill={colour}
                  stroke={named ? '#8A6D1F' : 'none'}
                  strokeWidth={named ? 1.2 : 0}
                />
                <text
                  x={d.x} y={d.y + (named ? 11 : 9)} textAnchor="middle"
                  fontSize={named ? 7.6 : 6.6} letterSpacing={0.3}
                  fill={named ? '#0A0A0A' : '#6B6B6B'}
                  stroke="#FFFFFF" strokeWidth={1.6} paintOrder="stroke"
                >
                  {d.name.toUpperCase()}
                </text>
                <title>{`${d.name} — affinity ${d.aff.toFixed(2)} · ${MEMBER_ROLES.find((r) => r.key === d.role)!.label}${d.trace ? ` · ${d.trace}` : ''}${d.hidden ? ' · HIDDEN' : ''}`}</title>
              </g>
            )
          })}

          {!visible.length && (
            <text x={W / 2} y={H / 2} fontSize={11} fill="#A8A8A4" letterSpacing={2} textAnchor="middle">
              NOTHING TO PLOT — SEED FROM ONBOARDED BRANDS FIRST
            </text>
          )}
        </svg>
      </div>
      <p className="mt-1.5 text-[16px] tracking-[0.12em] text-[#A8A8A4]">
        GOLD RING = A BRAND SHE NAMED · {offMap} OF HER {inspection.affinities.length} BRANDS HAVE NO MAP POSITION YET (NO CODES OR NO PRICE) AND ARE LISTED BELOW ONLY
      </p>
    </div>
  )
}

function HealthCard({ title, hint, rows }: { title: string; hint: string; rows: string[] }) {
  return (
    <div className="border border-[#E2E0DB] rounded-[10px] bg-white p-4">
      <p className="text-[16px] tracking-[0.18em] text-[#4A4E57]">
        {title} <span className={rows.length ? 'text-[#B3202A]' : 'text-[#3D7A50]'}>· {rows.length}</span>
      </p>
      <p className="mt-1 text-[16px] tracking-[0.06em] text-[#A8A8A4] normal-case leading-relaxed">{hint}</p>
      <div className="mt-2 grid gap-0.5">
        {rows.slice(0, 12).map((r, i) => <p key={i} className="text-[16px] tracking-[0.05em] text-[#4A4E57] normal-case">{r}</p>)}
        {rows.length > 12 && <p className="text-[16px] text-[#A8A8A4]">+{rows.length - 12} more</p>}
        {!rows.length && <p className="text-[16px] tracking-[0.1em] text-[#3D7A50]">CLEAR</p>}
      </div>
    </div>
  )
}

function FeedPreview({ title, feed }: { title: string; feed: MemberInspection['feed'] }) {
  return (
    <div>
      <p className={H2}>{title}</p>
      {!feed.length ? (
        <p className="text-[16px] text-[#A8A8A4] tracking-[0.08em]">NO LIVE OUTFITS TO RANK.</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
          {feed.map((f, i) => (
            <div key={f.outfit_id} className={`border rounded-[10px] overflow-hidden bg-white ${f.discovery ? 'border-[#C4A882]' : 'border-[#EFEDE9]'}`}>
              <div className="aspect-[3/4] bg-[#F2F2F0] relative">
                {f.image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.image_url} alt="" loading="lazy" className="w-full h-full object-cover" />
                )}
                <span className="absolute top-1.5 left-1.5 bg-white/95 border border-[#E2E0DB] rounded px-1 py-0.5 text-[16px] text-[#4A4E57]">#{i + 1}</span>
                {f.discovery && <span className="absolute top-1.5 right-1.5 bg-[#C4A882] text-white rounded px-1 py-0.5 text-[7px] tracking-[0.1em]">DISCOVERY</span>}
              </div>
              <div className="p-2">
                <p className="text-[16px] tracking-[0.1em] text-[#A8A8A4]">{(f.hero ?? '?').toUpperCase()}{f.occasionMatch ? ' · OCC ✓' : ''}</p>
                <p className="text-[16px] tracking-[0.04em] text-[#4A4E57] mt-0.5">
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
