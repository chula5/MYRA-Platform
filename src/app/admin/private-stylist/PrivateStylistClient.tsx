'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { HIGGSFIELD_POSE_OPTIONS } from '@/lib/higgsfield-shoot'
import {
  ROOMS,
  ROOM_KEYS,
  OCCASION_TYPES,
  FREQUENCY_OPTIONS,
  WORK_DRESS_CODES,
  WORK_OCCASIONS,
  RESPONSE_REASONS,
  SYNTH_PERSONAS,
  DRY_RUN_SCRIPT,
  DRY_RUN_PASS_CRITERIA,
  effectiveWeights,
  roomWeightsFromBrands,
  formatRoomMix,
  normalise,
  isFastFashion,
  vectorRoomRead,
  coverageChecks,
  type RoomWeights,
  type RoomKey,
  type OccasionId,
  type WorkDressCode,
  type Frequency,
  type RankedBrand,
  type LookItem,
  type ResponseReason,
} from '@/lib/pilot-stylist'
import {
  createMember,
  updateMember,
  deleteMember,
  seedSyntheticPersonas,
  addKnownEvent,
  removeKnownEvent,
  addWardrobeItem,
  removeWardrobeItem,
  createDelivery,
  createCalibrationSet,
  deleteDelivery,
  saveLook,
  deleteLook,
  markStockChecked,
  sendDelivery,
  recordResponse,
  logActivity,
  recomputeWeights,
  assignMemberPersona,
  composeDeliveryLooks,
  lookAlternates,
  swapComposedLookItem,
  removeComposedLookItem,
  lookAddOptions,
  addComposedLookItem,
  approveComposedLook,
  skipComposedLook,
  restoreLookShoot,
  type SwapOption,
  type PilotData,
  type PilotMember,
  type PilotDelivery,
  type PilotLook,
} from './actions'

const ROOM_COLOUR: Record<RoomKey, string> = {
  tailored: '#0A0A0A',
  romantic: '#C4A882',
  ease: '#A8A8A4',
}

const TABS = ['MEMBERS', 'DELIVERIES', 'DRY RUN', 'EXIT ARTEFACT'] as const
type Tab = (typeof TABS)[number]

const OCCASION_LABEL: Record<string, string> = Object.fromEntries(
  OCCASION_TYPES.map((o) => [o.id, o.label]),
)

// Slots Chloe can add by hand. Bags/jewellery finish a look; outerwear and
// accessories are there when the occasion calls for them.
const ADD_SLOTS: { value: string; label: string }[] = [
  { value: 'bag', label: 'BAG' },
  { value: 'jewellery', label: 'JEWELLERY' },
  { value: 'outerwear', label: 'OUTERWEAR' },
  { value: 'accessory', label: 'ACCESSORY' },
  { value: 'shoe', label: 'SHOES' },
  { value: 'top', label: 'TOP' },
  { value: 'bottom', label: 'BOTTOM' },
]

const label = 'text-[9px] tracking-[0.18em] text-[#6B6B6B]'
const input =
  'border border-[#E2E0DB] bg-white px-3 py-2 text-[11px] tracking-[0.04em] text-[#0A0A0A] outline-none focus:border-[#0A0A0A] w-full'
const btnDark =
  'bg-[#0A0A0A] text-white text-[10px] tracking-[0.18em] px-5 py-2.5 hover:opacity-85 transition-opacity duration-300 disabled:opacity-40'
const btnLight =
  'border border-[#0A0A0A] text-[#0A0A0A] text-[10px] tracking-[0.18em] px-5 py-2.5 hover:bg-[#F2F2F2] transition-colors duration-300 disabled:opacity-40'
const btnTiny =
  'border border-[#E2E0DB] text-[#6B6B6B] text-[9px] tracking-[0.12em] px-2.5 py-1 hover:border-[#0A0A0A] hover:text-[#0A0A0A] transition-colors duration-300'

// ── Shared bits ─────────────────────────────────────────────────────────────

function WeightBar({ weights, compact }: { weights: RoomWeights; compact?: boolean }) {
  const w = normalise(weights)
  return (
    <div>
      <div className={`flex w-full overflow-hidden ${compact ? 'h-1.5' : 'h-2.5'}`}>
        {ROOM_KEYS.map((k) => (
          <div key={k} style={{ width: `${w[k] * 100}%`, background: ROOM_COLOUR[k] }} />
        ))}
      </div>
      {!compact && (
        <p className="text-[9px] tracking-[0.14em] text-[#6B6B6B] mt-1.5">{formatRoomMix(w)}</p>
      )}
    </div>
  )
}

function OccasionPicker({
  value,
  dressCode,
  onChange,
  onDressCode,
}: {
  value: Partial<Record<OccasionId, Frequency>>
  dressCode: WorkDressCode | null
  onChange: (v: Partial<Record<OccasionId, Frequency>>) => void
  onDressCode: (v: WorkDressCode | null) => void
}) {
  const workActive = WORK_OCCASIONS.some((o) => value[o] && value[o] !== 'never')
  return (
    <div>
      <div className="space-y-1.5">
        {OCCASION_TYPES.map((o) => (
          <div key={o.id} className="flex items-center justify-between gap-3">
            <span className="text-[10px] tracking-[0.1em] text-[#0A0A0A] w-64 shrink-0">{o.label}</span>
            <div className="flex gap-1.5">
              {FREQUENCY_OPTIONS.map((f) => {
                const active = (value[o.id] ?? 'never') === f
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => onChange({ ...value, [o.id]: f })}
                    className={`text-[9px] tracking-[0.1em] px-2.5 py-1.5 border transition-colors duration-300 ${
                      active
                        ? 'border-[#0A0A0A] bg-[#0A0A0A] text-white'
                        : 'border-[#E2E0DB] text-[#6B6B6B] hover:border-[#0A0A0A]'
                    }`}
                  >
                    {f.toUpperCase()}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      {workActive && (
        <div className="mt-4">
          <p className={`${label} mb-2`}>WORK DRESS CODE — CLAMPS THE WEIGHTING ON WORK DAYS</p>
          <div className="flex gap-1.5">
            {WORK_DRESS_CODES.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => onDressCode(d.id)}
                className={`text-[9px] tracking-[0.1em] px-2.5 py-1.5 border transition-colors duration-300 ${
                  dressCode === d.id
                    ? 'border-[#0A0A0A] bg-[#0A0A0A] text-white'
                    : 'border-[#E2E0DB] text-[#6B6B6B] hover:border-[#0A0A0A]'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main client ─────────────────────────────────────────────────────────────

export default function PrivateStylistClient({ data }: { data: PilotData }) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('MEMBERS')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  async function run(key: string, fn: () => Promise<any>, ok: string) {
    setBusy(key)
    setMsg(null)
    try {
      const r = await fn()
      if (r?.error) setMsg(String(r.error).toUpperCase())
      else if (r?.errors?.length) setMsg(r.errors.join(' · '))
      else setMsg(ok)
      return r
    } catch (e) {
      // A thrown server-action error (stale page after a deploy, network drop)
      // used to vanish silently — the button just "did nothing".
      setMsg(`FAILED: ${e instanceof Error ? e.message : String(e)} — RELOAD THE PAGE AND TRY AGAIN`.toUpperCase())
      return { error: String(e) }
    } finally {
      setBusy(null)
      router.refresh()
    }
  }

  return (
    <div>
      <div className="flex gap-6 border-b border-[#E2E0DB] mb-8">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`pb-3 text-[10px] tracking-[0.18em] transition-colors duration-300 ${
              tab === t ? 'text-[#0A0A0A] border-b border-[#0A0A0A] -mb-px' : 'text-[#A8A8A4] hover:text-[#0A0A0A]'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {msg && <p className="text-[9px] tracking-[0.12em] text-[#C4A882] mb-6">{msg}</p>}

      {tab === 'MEMBERS' && <MembersTab data={data} run={run} busy={busy} />}
      {tab === 'DELIVERIES' && <DeliveriesTab data={data} run={run} busy={busy} />}
      {tab === 'DRY RUN' && <DryRunTab data={data} run={run} busy={busy} goDeliveries={() => setTab('DELIVERIES')} />}
      {tab === 'EXIT ARTEFACT' && <ArtefactTab data={data} />}
    </div>
  )
}

type Run = (key: string, fn: () => Promise<any>, ok: string) => Promise<any>

// ── MEMBERS ─────────────────────────────────────────────────────────────────

function parseBrandLines(text: string): RankedBrand[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line, idx) => {
      const [name, why] = line.split('—').map((s) => s.trim())
      return { name, rank: idx + 1, inferred_why: why || undefined }
    })
}

function MembersTab({ data, run, busy }: { data: PilotData; run: Run; busy: string | null }) {
  const [showNew, setShowNew] = useState(false)
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-[10px] tracking-[0.14em] text-[#6B6B6B]">
          {data.members.length} MEMBER{data.members.length === 1 ? '' : 'S'}
        </p>
        <button className={btnLight} onClick={() => setShowNew((s) => !s)}>
          {showNew ? 'CLOSE' : 'ONBOARD MEMBER'}
        </button>
      </div>

      {showNew && <NewMemberForm run={run} busy={busy} done={() => setShowNew(false)} />}

      {data.members.map((m) => (
        <MemberCard
          key={m.member_id}
          member={m}
          run={run}
          busy={busy}
          personas={data.personas}
          deliveries={data.deliveries.filter((d) => d.member_id === m.member_id)}
        />
      ))}

      {data.members.length === 0 && !showNew && (
        <p className="text-[10px] tracking-[0.1em] text-[#A8A8A4]">
          NO MEMBERS YET — ONBOARD A PILOT, OR SEED THE SYNTHETIC PERSONAS FROM THE DRY RUN TAB.
        </p>
      )}

      <div className="border border-[#E2E0DB] px-5 py-4">
        <p className={`${label} mb-3`}>THE THREE ROOMS</p>
        <div className="grid grid-cols-3 gap-4">
          {ROOM_KEYS.map((k) => (
            <div key={k}>
              <div className="flex items-center gap-2 mb-1">
                <span className="inline-block w-2 h-2" style={{ background: ROOM_COLOUR[k] }} />
                <span className="text-[11px] tracking-[0.14em] text-[#0A0A0A]">{ROOMS[k].label}</span>
              </div>
              <p className="text-[9px] tracking-[0.06em] text-[#6B6B6B]">{ROOMS[k].axis}</p>
              <p className="text-[9px] tracking-[0.06em] text-[#A8A8A4] mt-1">{ROOMS[k].palette.join(' · ')}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function NewMemberForm({ run, busy, done }: { run: Run; busy: string | null; done: () => void }) {
  const [name, setName] = useState('')
  const [brandText, setBrandText] = useState('')
  const [inputOnly, setInputOnly] = useState('Zara')
  const [occasions, setOccasions] = useState<Partial<Record<OccasionId, Frequency>>>({})
  const [dressCode, setDressCode] = useState<WorkDressCode | null>(null)
  const [sizes, setSizes] = useState({ top: '', bottom: '', shoe: '', dress: '' })
  const [budgets, setBudgets] = useState({ coat: '', dress: '', top: '' })
  const [neverWears, setNeverWears] = useState('')
  const [notes, setNotes] = useState('')

  const brands = useMemo(() => parseBrandLines(brandText), [brandText])
  const preview = useMemo(() => (brands.length ? roomWeightsFromBrands(brands) : null), [brands])

  return (
    <div className="border border-[#0A0A0A] px-6 py-6 space-y-5">
      <p className="text-[11px] tracking-[0.18em] text-[#0A0A0A]">ONBOARDING — DO IT IN PERSON, ~45 MIN</p>
      <div>
        <p className={`${label} mb-1.5`}>NAME</p>
        <input className={input} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <p className={`${label} mb-1.5`}>
          BRANDS — ONE PER LINE, RANKED, “BRAND — YOUR INFERRED WHY” (LOG THE WHY NOW, IT’S CHEAP INSURANCE)
        </p>
        <textarea
          className={`${input} h-28 font-mono`}
          placeholder={'ME+EM — sharp line without corporate stiffness\nSessùn — pulls her romantic'}
          value={brandText}
          onChange={(e) => setBrandText(e.target.value)}
        />
        {preview && (
          <div className="mt-2 max-w-sm">
            <p className={`${label} mb-1`}>COMPUTED WEIGHTING — SANITY-CHECK AGAINST YOUR OWN READ</p>
            <WeightBar weights={preview} />
          </div>
        )}
      </div>
      <div>
        <p className={`${label} mb-1.5`}>INPUT-ONLY BRANDS (SIGNAL + WARDROBE, NEVER RECOMMENDED) — COMMA SEPARATED</p>
        <input className={input} value={inputOnly} onChange={(e) => setInputOnly(e.target.value)} />
      </div>
      <div>
        <p className={`${label} mb-2`}>OCCASION DEMAND — CLICKABLE, NOT FREE TEXT</p>
        <OccasionPicker value={occasions} dressCode={dressCode} onChange={setOccasions} onDressCode={setDressCode} />
      </div>
      <div className="grid grid-cols-2 gap-5">
        <div>
          <p className={`${label} mb-1.5`}>SIZES</p>
          <div className="grid grid-cols-4 gap-2">
            {(['top', 'bottom', 'shoe', 'dress'] as const).map((k) => (
              <input
                key={k}
                className={input}
                placeholder={k.toUpperCase()}
                value={sizes[k]}
                onChange={(e) => setSizes({ ...sizes, [k]: e.target.value })}
              />
            ))}
          </div>
        </div>
        <div>
          <p className={`${label} mb-1.5`}>BUDGET CEILING £ (COAT / DRESS / TOP)</p>
          <div className="grid grid-cols-3 gap-2">
            {(['coat', 'dress', 'top'] as const).map((k) => (
              <input
                key={k}
                className={input}
                placeholder={k.toUpperCase()}
                value={budgets[k]}
                onChange={(e) => setBudgets({ ...budgets, [k]: e.target.value })}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-5">
        <div>
          <p className={`${label} mb-1.5`}>NEVER WEARS</p>
          <input className={input} value={neverWears} onChange={(e) => setNeverWears(e.target.value)} />
        </div>
        <div>
          <p className={`${label} mb-1.5`}>NOTES</p>
          <input className={input} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
      <button
        className={btnDark}
        disabled={!name || brands.length === 0 || busy === 'newMember'}
        onClick={async () => {
          const budget_ceiling: Record<string, number> = {}
          for (const [k, v] of Object.entries(budgets)) if (v) budget_ceiling[k] = Number(v)
          const sizesClean: Record<string, string> = {}
          for (const [k, v] of Object.entries(sizes)) if (v) sizesClean[k] = v
          const r = await run(
            'newMember',
            () =>
              createMember({
                name,
                brands,
                brands_input_only: inputOnly.split(',').map((s) => s.trim()).filter(Boolean),
                occasions,
                work_dress_code: dressCode,
                sizes: sizesClean,
                budget_ceiling,
                never_wears: neverWears || undefined,
                notes: notes || undefined,
              }),
            'MEMBER ONBOARDED — INTAKE SNAPSHOT SAVED',
          )
          if (!r?.error) done()
        }}
      >
        ONBOARD
      </button>
    </div>
  )
}

// The screenshot lookbook: every shot look for this member, presented the way
// the main outfit page does it — items on the left, editorial image on the
// right, no admin controls inside the frame. Screenshot a card, send it, come
// back with her yes/no.
function Lookbook({ deliveries, memberName }: { deliveries: PilotDelivery[]; memberName: string }) {
  const shot = deliveries
    .flatMap((d) => (d.looks ?? []).map((l) => ({ l, d })))
    .filter(({ l }) => l.image_url)
    .sort((a, b) => String(b.d.created_at ?? '').localeCompare(String(a.d.created_at ?? '')) || a.l.position - b.l.position)
  if (!shot.length) {
    return (
      <div>
        <p className="text-[9px] tracking-[0.18em] text-[#6B6B6B] mb-2">LOOKBOOK — SHARE &amp; SCREENSHOT</p>
        <p className="text-[9px] tracking-[0.08em] text-[#A8A8A4]">
          NO SHOT LOOKS YET — COMPOSE A DELIVERY, THEN ✦ HIGGSFIELD EACH LOOK AND THEY APPEAR HERE.
        </p>
      </div>
    )
  }
  return (
    <div>
      <p className="text-[9px] tracking-[0.18em] text-[#6B6B6B] mb-2">
        LOOKBOOK — SHARE &amp; SCREENSHOT · {shot.length} LOOK{shot.length === 1 ? '' : 'S'} FOR {memberName.toUpperCase()}
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {shot.map(({ l }, idx) => {
          const withImg = l.items.filter((it) => it.image_url)
          return (
            // Same frame as the live site: full-bleed shoot with the
            // Shop-the-Look panel floating top-left over it.
            <div key={l.look_id} className="relative aspect-[4/5] overflow-hidden bg-[#EDEDED]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={l.image_url!} alt="" className="absolute inset-0 w-full h-full object-cover" />
              <div className="absolute top-2.5 right-2.5 bg-black/55 text-white text-[9px] tracking-[0.1em] px-2 py-1 rounded-full">
                {idx + 1} / {shot.length}
              </div>
              <div className="absolute left-2.5 top-2.5 z-10 w-[27%] max-w-[110px] max-h-[calc(100%-1.25rem)] overflow-y-auto pr-1" data-lenis-prevent>
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="text-white text-[8px] sm:text-[9px] tracking-[0.081em] drop-shadow-[0_1px_3px_rgba(0,0,0,0.55)]">
                    LOOK {idx + 1}
                  </span>
                  <span className="bg-white/90 text-[#4A4E57] text-[8px] tracking-[0.036em] rounded-full px-1.5 py-0.5 leading-none">
                    {withImg.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {withImg.map((it, i) => (
                    <div key={i} className="relative w-full aspect-[3/4] overflow-hidden bg-[#EDEDED]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`${it.image_url}${it.image_url!.includes('?') ? '&' : '?'}width=500`} alt={it.product_name} loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                      {/* same caption treatment as the live site's item cards */}
                      <div className="absolute inset-x-0 bottom-0 z-10 pt-8 pb-1.5 px-1.5 bg-gradient-to-t from-black/70 via-black/25 to-transparent">
                        <p className="text-white/75 text-[6px] tracking-[0.06em] uppercase truncate">{it.brand ?? 'BRAND'}</p>
                        <p className="text-white text-[7px] leading-[1.15] line-clamp-2 mt-0.5">{it.product_name}</p>
                        {typeof it.price_gbp === 'number' && (
                          <p className="text-white/90 text-[7px] tracking-[0.03em] mt-0.5">£{it.price_gbp}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <p className="absolute bottom-2 right-2.5 text-white text-[7.5px] tracking-[0.14em] drop-shadow-[0_1px_3px_rgba(0,0,0,0.55)]">
                MYRA · STYLED FOR {memberName.split(' ')[0].toUpperCase()}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MemberCard({
  member: m,
  run,
  busy,
  personas = [],
  deliveries = [],
}: {
  member: PilotMember
  run: Run
  busy: string | null
  personas?: { stylist_id: string; name: string; hasEnvelope: boolean }[]
  deliveries?: PilotDelivery[]
}) {
  const [open, setOpen] = useState(false)
  const [occasions, setOccasions] = useState(m.occasions)
  const [dressCode, setDressCode] = useState(m.work_dress_code)
  const [previewOccasion, setPreviewOccasion] = useState<OccasionId>('dinner_drinks')
  const [newEvent, setNewEvent] = useState({ label: '', date: '' })
  const [newPiece, setNewPiece] = useState({ label: '', brand: '' })

  const eff = effectiveWeights(m.room_weights, previewOccasion, m.work_dress_code)

  return (
    <div className="border border-[#E2E0DB] px-6 py-5">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <p className="text-[13px] tracking-[0.12em] text-[#0A0A0A]">{m.name}</p>
            {m.is_synthetic && (
              <span className="text-[8px] tracking-[0.14em] text-[#8B5E00] border border-[#E8D9B8] px-2 py-0.5">
                SYNTHETIC — NEVER TRAINS TASTE
              </span>
            )}
          </div>
          <div className="mt-3 max-w-md">
            <p className={`${label} mb-1`}>ROOM WEIGHTING — LEARNED FROM HER SIGNALS</p>
            <WeightBar weights={m.room_weights} />
            {(() => {
              const read = vectorRoomRead(m.taste_vector)
              return read ? (
                <div className="mt-3">
                  <p className={`${label} mb-1`}>VECTOR READ — 34-DIM CROSS-CHECK, SHOULD BROADLY AGREE</p>
                  <WeightBar weights={read} />
                </div>
              ) : (
                <p className="text-[8px] tracking-[0.12em] text-[#A8A8A4] mt-2">
                  NO TASTE VECTOR YET — BUILDS FROM HER FIRST YES / SAVE / CLICK / PURCHASE
                </p>
              )
            })()}
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            className={btnTiny}
            disabled={busy === `calib-${m.member_id}`}
            title="3 scaffolded looks, one per room, for LIKE / DISLIKE — an extra taste-onboarding step"
            onClick={() =>
              run(
                `calib-${m.member_id}`,
                () => createCalibrationSet(m.member_id),
                'CALIBRATION SET CREATED — ASSEMBLE THE 3 LOOKS IN DELIVERIES',
              )
            }
          >
            CALIBRATION SET
          </button>
          <button
            className={btnTiny}
            disabled={busy === `recompute-${m.member_id}`}
            onClick={() =>
              run(`recompute-${m.member_id}`, () => recomputeWeights(m.member_id), 'WEIGHTS RECOMPUTED — SNAPSHOT SAVED')
            }
          >
            WEEKLY RECOMPUTE
          </button>
          <button className={btnTiny} onClick={() => setOpen((s) => !s)}>
            {open ? 'CLOSE' : 'OPEN'}
          </button>
          {/* Styled THROUGH a persona: its moodboard envelope shapes her looks
              while she is new, and fades as she responds. */}
          <select
            value={m.persona_id ?? ''}
            onChange={(e) =>
              run(`persona-${m.member_id}`, () => assignMemberPersona(m.member_id, e.target.value),
                e.target.value ? 'PERSONA ASSIGNED — LOOKS NOW COMPOSED THROUGH ITS MOODBOARD' : 'PERSONA REMOVED')
            }
            className="border border-[#E2E0DB] bg-white px-2 py-1.5 text-[9px] tracking-[0.08em] text-[#4A4E57] outline-none focus:border-[#0A0A0A]"
            title="Compose her looks through this persona's moodboard envelope"
          >
            <option value="">NO PERSONA</option>
            {personas.map((p) => (
              <option key={p.stylist_id} value={p.stylist_id}>
                {p.name.toUpperCase()}{p.hasEnvelope ? '' : ' (NO ENVELOPE)'}
              </option>
            ))}
          </select>
          {m.persona_id && (
            <span
              className={`text-[9px] tracking-[0.1em] ${m.persona_has_envelope ? 'text-[#4A6FA5]' : 'text-[#B83A3A]'}`}
              title={m.persona_has_envelope
                ? 'Persona weight — falls as she responds, until her own taste leads'
                : 'This persona has no envelope yet — confirm its moodboard images and compute the envelope, or it has no effect'}
            >
              {m.persona_has_envelope
                ? `LENS ${(m.persona_weight ?? 0.9).toFixed(2)}`
                : 'NO ENVELOPE — NO EFFECT'}
            </span>
          )}
        </div>
      </div>

      {open && (
        <div className="mt-6 space-y-6">
          <Lookbook deliveries={deliveries} memberName={m.name} />
          {/* Brands */}
          <div>
            <p className={`${label} mb-2`}>BRANDS — RANKED, WITH THE INFERRED WHY</p>
            <div className="space-y-1">
              {m.brands.map((b) => (
                <p key={b.rank} className="text-[10px] tracking-[0.06em] text-[#0A0A0A]">
                  {b.rank}. {b.name.toUpperCase()}
                  {b.inferred_why && <span className="text-[#6B6B6B]"> — {b.inferred_why.toUpperCase()}</span>}
                </p>
              ))}
            </div>
            {m.brands_input_only.length > 0 && (
              <p className="text-[9px] tracking-[0.1em] text-[#8B5E00] mt-2">
                INPUT ONLY (NEVER RECOMMENDED): {m.brands_input_only.join(' · ').toUpperCase()}
              </p>
            )}
          </div>

          {/* Occasion profile */}
          <div>
            <p className={`${label} mb-2`}>OCCASION PROFILE</p>
            <OccasionPicker value={occasions} dressCode={dressCode} onChange={setOccasions} onDressCode={setDressCode} />
            <button
              className={`${btnTiny} mt-3`}
              disabled={busy === `occ-${m.member_id}`}
              onClick={() =>
                run(
                  `occ-${m.member_id}`,
                  () => updateMember(m.member_id, { occasions, work_dress_code: dressCode }),
                  'OCCASION PROFILE SAVED',
                )
              }
            >
              SAVE OCCASION PROFILE
            </button>
          </div>

          {/* Effective-weights preview */}
          <div className="border border-[#E2E0DB] px-4 py-3 max-w-lg">
            <p className={`${label} mb-2`}>EFFECTIVE WEIGHTS BY OCCASION — WHAT THE MATHS SENDS</p>
            <div className="flex gap-1.5 flex-wrap mb-3">
              {OCCASION_TYPES.map((o) => (
                <button
                  key={o.id}
                  onClick={() => setPreviewOccasion(o.id)}
                  className={`text-[8px] tracking-[0.1em] px-2 py-1 border transition-colors duration-300 ${
                    previewOccasion === o.id
                      ? 'border-[#0A0A0A] bg-[#0A0A0A] text-white'
                      : 'border-[#E2E0DB] text-[#6B6B6B]'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <WeightBar weights={eff} />
            {WORK_OCCASIONS.includes(previewOccasion) && m.work_dress_code && (
              <p className="text-[8px] tracking-[0.1em] text-[#8B5E00] mt-1.5">FORMALITY FLOOR APPLIED — OVERRIDES TASTE</p>
            )}
          </div>

          {/* Data coverage — is this pilot generating enough signal? */}
          <div className="border border-[#E2E0DB] px-4 py-3 max-w-lg">
            <p className={`${label} mb-2`}>DATA COVERAGE — 4-WEEK TARGETS</p>
            <div className="grid grid-cols-3 gap-x-6 gap-y-2">
              {coverageChecks({
                respondedLooks: m.taste_event_counts.yes + m.taste_event_counts.no,
                tasteEvents: Object.values(m.taste_event_counts).reduce((a, b) => a + b, 0),
                clicks: m.taste_event_counts.click_out,
                saves: m.taste_event_counts.save,
                purchases: m.taste_event_counts.purchase,
                weeklySnapshots: m.snapshots.filter((s) => s.source === 'weekly').length,
              }).map((c) => (
                <p
                  key={c.label}
                  className={`text-[9px] tracking-[0.1em] ${c.have >= c.target ? 'text-[#3D7A50]' : 'text-[#6B6B6B]'}`}
                >
                  {c.have >= c.target ? '✓' : '·'} {c.label} {c.have}/{c.target}
                </p>
              ))}
            </div>
          </div>

          {/* Known events */}
          <div>
            <p className={`${label} mb-2`}>KNOWN EVENTS — THESE DRIVE THE ANTICIPATION MOVES</p>
            {m.events.map((e) => (
              <div key={e.event_id} className="flex items-center gap-3 mb-1">
                <p className="text-[10px] tracking-[0.06em] text-[#0A0A0A]">
                  {e.label.toUpperCase()} — {e.event_date}
                </p>
                <button className={btnTiny} onClick={() => run(`ev-${e.event_id}`, () => removeKnownEvent(e.event_id), 'EVENT REMOVED')}>
                  ×
                </button>
              </div>
            ))}
            <div className="flex gap-2 mt-2 max-w-md">
              <input className={input} placeholder="EVENT" value={newEvent.label} onChange={(e) => setNewEvent({ ...newEvent, label: e.target.value })} />
              <input className={input} placeholder="2026-09" value={newEvent.date} onChange={(e) => setNewEvent({ ...newEvent, date: e.target.value })} />
              <button
                className={btnTiny}
                disabled={!newEvent.label || !newEvent.date}
                onClick={async () => {
                  await run(`ev-add-${m.member_id}`, () => addKnownEvent(m.member_id, newEvent.label, newEvent.date), 'EVENT LOGGED')
                  setNewEvent({ label: '', date: '' })
                }}
              >
                ADD
              </button>
            </div>
          </div>

          {/* Wardrobe */}
          <div>
            <p className={`${label} mb-2`}>WARDROBE — MOST-WORN PIECES (STYLE AROUND WHAT SHE OWNS)</p>
            {m.wardrobe.map((w) => (
              <div key={w.wardrobe_id} className="flex items-center gap-3 mb-1">
                <p className="text-[10px] tracking-[0.06em] text-[#0A0A0A]">
                  {w.label.toUpperCase()}
                  {w.brand && <span className="text-[#6B6B6B]"> · {w.brand.toUpperCase()}</span>}
                </p>
                <button className={btnTiny} onClick={() => run(`wd-${w.wardrobe_id}`, () => removeWardrobeItem(w.wardrobe_id), 'PIECE REMOVED')}>
                  ×
                </button>
              </div>
            ))}
            <div className="flex gap-2 mt-2 max-w-md">
              <input className={input} placeholder="PIECE" value={newPiece.label} onChange={(e) => setNewPiece({ ...newPiece, label: e.target.value })} />
              <input className={input} placeholder="BRAND" value={newPiece.brand} onChange={(e) => setNewPiece({ ...newPiece, brand: e.target.value })} />
              <button
                className={btnTiny}
                disabled={!newPiece.label}
                onClick={async () => {
                  await run(`wd-add-${m.member_id}`, () => addWardrobeItem(m.member_id, { label: newPiece.label, brand: newPiece.brand || undefined }), 'PIECE ADDED')
                  setNewPiece({ label: '', brand: '' })
                }}
              >
                ADD
              </button>
            </div>
          </div>

          {/* Meta + delete */}
          <div className="flex items-end justify-between">
            <div className="text-[9px] tracking-[0.08em] text-[#6B6B6B] space-y-0.5">
              {Object.keys(m.sizes).length > 0 && (
                <p>SIZES: {Object.entries(m.sizes).map(([k, v]) => `${k.toUpperCase()} ${v}`).join(' · ')}</p>
              )}
              {Object.keys(m.budget_ceiling).length > 0 && (
                <p>BUDGET: {Object.entries(m.budget_ceiling).map(([k, v]) => `${k.toUpperCase()} £${v}`).join(' · ')}</p>
              )}
              {m.never_wears && <p>NEVER WEARS: {m.never_wears.toUpperCase()}</p>}
              {m.notes && <p className="max-w-xl">NOTES: {m.notes.toUpperCase()}</p>}
            </div>
            <button
              className="text-[8px] tracking-[0.12em] text-[#B83A3A] hover:underline"
              onClick={() => {
                if (window.confirm(`Delete ${m.name} and all their pilot data?`)) {
                  run(`del-${m.member_id}`, () => deleteMember(m.member_id), 'MEMBER DELETED')
                }
              }}
            >
              DELETE MEMBER
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── DELIVERIES ──────────────────────────────────────────────────────────────

function DeliveriesTab({ data, run, busy }: { data: PilotData; run: Run; busy: string | null }) {
  const [memberId, setMemberId] = useState<string>('all')
  const [showNew, setShowNew] = useState(false)
  const deliveries = data.deliveries.filter((d) => memberId === 'all' || d.member_id === memberId)
  const memberById = Object.fromEntries(data.members.map((m) => [m.member_id, m]))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex gap-1.5">
          <button
            onClick={() => setMemberId('all')}
            className={`${btnTiny} ${memberId === 'all' ? '!border-[#0A0A0A] !text-[#0A0A0A]' : ''}`}
          >
            ALL
          </button>
          {data.members.map((m) => (
            <button
              key={m.member_id}
              onClick={() => setMemberId(m.member_id)}
              className={`${btnTiny} ${memberId === m.member_id ? '!border-[#0A0A0A] !text-[#0A0A0A]' : ''}`}
            >
              {m.name}
            </button>
          ))}
        </div>
        <button className={btnLight} onClick={() => setShowNew((s) => !s)}>
          {showNew ? 'CLOSE' : 'NEW DELIVERY'}
        </button>
      </div>

      {showNew && <NewDeliveryForm members={data.members} run={run} busy={busy} done={() => setShowNew(false)} />}

      {/* Filter to one member → her screenshot lookbook sits right here on top */}
      {memberId !== 'all' && memberById[memberId] && (
        <Lookbook deliveries={deliveries} memberName={memberById[memberId].name} />
      )}

      {deliveries.map((d) => (
        <DeliveryCard key={d.delivery_id} delivery={d} member={memberById[d.member_id]} run={run} busy={busy} />
      ))}
      {deliveries.length === 0 && (
        <p className="text-[10px] tracking-[0.1em] text-[#A8A8A4]">NO DELIVERIES YET.</p>
      )}
    </div>
  )
}

function NewDeliveryForm({
  members,
  run,
  busy,
  done,
  preset,
}: {
  members: PilotMember[]
  run: Run
  busy: string | null
  done: () => void
  preset?: { member_id: string; occasion: OccasionId; request_text: string; dry_run_brief: string }
}) {
  const [memberId, setMemberId] = useState(preset?.member_id ?? members[0]?.member_id ?? '')
  const [trigger, setTrigger] = useState<'request' | 'anticipation'>('request')
  const [occasion, setOccasion] = useState<OccasionId>(preset?.occasion ?? 'dinner_drinks')
  const [text, setText] = useState(preset?.request_text ?? '')
  const member = members.find((m) => m.member_id === memberId)
  const eff = member ? effectiveWeights(member.room_weights, occasion, member.work_dress_code) : null

  return (
    <div className="border border-[#0A0A0A] px-6 py-5 space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <div>
          <p className={`${label} mb-1.5`}>MEMBER</p>
          <select className={input} value={memberId} onChange={(e) => setMemberId(e.target.value)}>
            {members.map((m) => (
              <option key={m.member_id} value={m.member_id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <p className={`${label} mb-1.5`}>TRIGGER</p>
          <div className="flex gap-1.5">
            {(['request', 'anticipation'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTrigger(t)}
                className={`text-[9px] tracking-[0.1em] px-3 py-2 border transition-colors duration-300 ${
                  trigger === t ? 'border-[#0A0A0A] bg-[#0A0A0A] text-white' : 'border-[#E2E0DB] text-[#6B6B6B]'
                }`}
              >
                {t === 'request' ? 'HER REQUEST' : 'ANTICIPATION MOVE'}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className={`${label} mb-1.5`}>OCCASION</p>
          <select className={input} value={occasion} onChange={(e) => setOccasion(e.target.value as OccasionId)}>
            {OCCASION_TYPES.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <p className={`${label} mb-1.5`}>{trigger === 'request' ? 'HER WORDS' : 'THE MOVE — E.G. “GREECE IS COMING — I’VE STARTED THREE LOOKS”'}</p>
        <input className={input} value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      {eff && (
        <div className="max-w-sm">
          <p className={`${label} mb-1`}>EFFECTIVE WEIGHTS FOR THIS DELIVERY</p>
          <WeightBar weights={eff} />
        </div>
      )}
      <button
        className={btnDark}
        disabled={!memberId || busy === 'newDelivery'}
        onClick={async () => {
          const r = await run(
            'newDelivery',
            () =>
              createDelivery({
                member_id: memberId,
                trigger,
                request_text: text,
                occasion,
                dry_run_brief: preset?.dry_run_brief,
              }),
            'DELIVERY CREATED — ASSEMBLE 3 LOOKS',
          )
          if (!r?.error) done()
        }}
      >
        CREATE DELIVERY
      </button>
    </div>
  )
}

const STATUS_TONE: Record<string, string> = {
  draft: 'text-[#8B5E00] border-[#E8D9B8]',
  sent: 'text-[#4A6FA5] border-[#C7D4E8]',
  responded: 'text-[#3D7A50] border-[#C9E0CF]',
}

function DeliveryCard({
  delivery: d,
  member,
  run,
  busy,
}: {
  delivery: PilotDelivery
  member?: PilotMember
  run: Run
  busy: string | null
}) {
  const [open, setOpen] = useState(d.status === 'draft')
  const [editingLook, setEditingLook] = useState<string | 'new' | null>(null)
  const [activityDetail, setActivityDetail] = useState('')

  const calibration = d.trigger === 'calibration'
  const ownedAnchor = d.looks.some((l) => l.items.some((it) => it.owned))
  const named = new Set((member?.brands ?? []).map((b) => b.name.toLowerCase()))
  const newBrand = d.looks.some((l) => l.items.some((it) => !it.owned && !named.has(it.brand.toLowerCase())))

  return (
    <div className="border border-[#E2E0DB] px-6 py-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <p className="text-[12px] tracking-[0.12em] text-[#0A0A0A]">{member?.name ?? '—'}</p>
            <span className={`text-[8px] tracking-[0.14em] border px-2 py-0.5 ${STATUS_TONE[d.status]}`}>{d.status.toUpperCase()}</span>
            {d.occasion && (
              <span className="text-[8px] tracking-[0.14em] text-[#6B6B6B] border border-[#E2E0DB] px-2 py-0.5">
                {OCCASION_LABEL[d.occasion]}
              </span>
            )}
            {calibration && (
              <span className="text-[8px] tracking-[0.14em] text-[#4A6FA5] border border-[#C7D4E8] px-2 py-0.5">
                TASTE CALIBRATION
              </span>
            )}
            {d.trigger === 'anticipation' && (
              <span className="text-[8px] tracking-[0.14em] text-[#C4A882] border border-[#E8D9B8] px-2 py-0.5">ANTICIPATION MOVE</span>
            )}
            {d.is_synthetic && (
              <span className="text-[8px] tracking-[0.14em] text-[#8B5E00] border border-[#E8D9B8] px-2 py-0.5">DRY RUN</span>
            )}
          </div>
          {d.request_text && <p className="text-[10px] tracking-[0.06em] text-[#6B6B6B] mt-1.5">“{d.request_text.toUpperCase()}”</p>}
          <p className="text-[9px] tracking-[0.14em] text-[#6B6B6B] mt-2">
            {formatRoomMix(d.effective_weights)}
            {calibration && ' — RAW WEIGHTING, NO OCCASION TILT'}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button className={btnTiny} onClick={() => setOpen((s) => !s)}>
            {open ? 'CLOSE' : `OPEN · ${d.looks.length} LOOK${d.looks.length === 1 ? '' : 'S'}`}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-5 space-y-4">
          {/* Non-negotiables tracker — calibration sets only need the 3 probes */}
          <div className="flex gap-4 text-[8px] tracking-[0.12em]">
            <span className={d.looks.length >= 3 ? 'text-[#3D7A50]' : 'text-[#B83A3A]'}>
              {d.looks.length >= 3 ? '✓' : '✗'} 3 LOOKS
            </span>
            {calibration ? (
              <span className="text-[#4A6FA5]">TASTE PROBES — NO SHOPPING RULES, LIKE / DISLIKE ONLY</span>
            ) : (
              <>
                <span className={ownedAnchor ? 'text-[#3D7A50]' : 'text-[#B83A3A]'}>
                  {ownedAnchor ? '✓' : '✗'} OWNED-ITEM ANCHOR
                </span>
                <span className={newBrand ? 'text-[#3D7A50]' : 'text-[#B83A3A]'}>
                  {newBrand ? '✓' : '✗'} NEW-BRAND SLOT
                </span>
              </>
            )}
          </div>

          {d.looks.map((l) =>
            editingLook === l.look_id ? (
              <LookEditor key={l.look_id} deliveryId={d.delivery_id} look={l} run={run} done={() => setEditingLook(null)} />
            ) : (
              <LookRow key={l.look_id} look={l} member={member} sent={d.status !== 'draft'} calibration={calibration} run={run} onEdit={() => setEditingLook(l.look_id)} />
            ),
          )}

          {editingLook === 'new' ? (
            <LookEditor deliveryId={d.delivery_id} position={d.looks.length + 1} run={run} done={() => setEditingLook(null)} />
          ) : (
            d.status === 'draft' && (
              <div className="flex gap-2">
                <button
                  className="text-[9px] tracking-[0.12em] px-3 py-1.5 bg-[#C4A882] text-white hover:opacity-85 disabled:opacity-40"
                  disabled={busy === `compose-${d.delivery_id}`}
                  title="Build 3 looks from the item library, weighted by her brand affinities, brand families and past swaps"
                  onClick={() =>
                    run(
                      `compose-${d.delivery_id}`,
                      () => composeDeliveryLooks(d.delivery_id),
                      'LOOKS COMPOSED — REVIEW, SWAP OR APPROVE',
                    )
                  }
                >
                  {busy === `compose-${d.delivery_id}` ? 'COMPOSING…' : '✦ COMPOSE 3 LOOKS'}
                </button>
                <button className={btnTiny} onClick={() => setEditingLook('new')}>
                  + ADD LOOK
                </button>
              </div>
            )
          )}

          {d.status === 'draft' && (
            <div className="flex gap-3 pt-2">
              {!calibration && (
                <button
                  className={btnLight}
                  disabled={busy === `stock-${d.delivery_id}`}
                  onClick={() =>
                    run(`stock-${d.delivery_id}`, () => markStockChecked(d.delivery_id), 'STOCK CHECKED — MOVES FAST, SEND SOON')
                  }
                >
                  STOCK CHECKED NOW
                </button>
              )}
              <button
                className={btnDark}
                disabled={busy === `send-${d.delivery_id}`}
                onClick={() =>
                  run(
                    `send-${d.delivery_id}`,
                    () => sendDelivery(d.delivery_id),
                    calibration ? 'MARKED SHOWN — LOG HER LIKES / DISLIKES' : 'SENT — OVER TO HER',
                  )
                }
              >
                {calibration ? 'MARK SHOWN' : 'SEND'}
              </button>
              <button
                className="text-[8px] tracking-[0.12em] text-[#B83A3A] hover:underline ml-auto"
                onClick={() => {
                  if (window.confirm('Delete this delivery?')) {
                    run(`deld-${d.delivery_id}`, () => deleteDelivery(d.delivery_id), 'DELIVERY DELETED')
                  }
                }}
              >
                DELETE
              </button>
            </div>
          )}

          {d.status !== 'draft' && member && (
            <div className="border-t border-[#E2E0DB] pt-3 flex items-center gap-2 flex-wrap">
              <p className={label}>LOG:</p>
              {(
                [
                  ['click_out', 'CLICK-OUT'],
                  ['purchase', 'PURCHASE'],
                  ['save', 'SAVE'],
                  ['unprompted_return', 'UNPROMPTED RETURN'],
                  ['stock_moved', 'STOCK MOVED'],
                ] as const
              ).map(([t, lab]) => (
                <button
                  key={t}
                  className={btnTiny}
                  onClick={async () => {
                    await run(
                      `act-${d.delivery_id}-${t}`,
                      () =>
                        logActivity({
                          member_id: member.member_id,
                          type: t,
                          detail: activityDetail,
                          delivery_id: d.delivery_id,
                        }),
                      `${lab} LOGGED`,
                    )
                    setActivityDetail('')
                  }}
                >
                  {lab}
                </button>
              ))}
              <input
                className={`${input} !w-56`}
                placeholder="DETAIL (OPTIONAL)"
                value={activityDetail}
                onChange={(e) => setActivityDetail(e.target.value)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function LookRow({
  look: l,
  member,
  sent,
  calibration,
  run,
  onEdit,
}: {
  look: PilotLook
  member?: PilotMember
  sent: boolean
  calibration?: boolean
  run: Run
  onEdit: () => void
}) {
  const [reason, setReason] = useState<ResponseReason>('not_my_style')
  const [swapIdx, setSwapIdx] = useState<number | null>(null)
  const [swapOptions, setSwapOptions] = useState<SwapOption[] | null>(null)
  const [swapBusy, setSwapBusy] = useState(false)
  const [addSlot, setAddSlot] = useState<string | null>(null)
  const [poseOpen, setPoseOpen] = useState(false)
  const [shooting, setShooting] = useState(false)
  const shootHistory = l.shoot_history ?? []

  // A shoot takes minutes — keep the picker locked while one is running so a
  // second click can't queue another generation over the top.
  async function shoot(fn: () => Promise<any>, ok: string) {
    setShooting(true)
    await run(`hf-${l.look_id}`, fn, ok)
    setShooting(false)
  }
  const composed = l.items.some((it) => it.item_id)
  const presentSlots = new Set(l.items.map((it) => it.slot).filter(Boolean) as string[])

  const [swapQuery, setSwapQuery] = useState('')

  async function openSwap(i: number) {
    setAddSlot(null)
    setSwapIdx(i)
    setSwapOptions(null)
    setSwapQuery('')
    setSwapBusy(true)
    const r = await lookAlternates(l.look_id, i)
    setSwapBusy(false)
    setSwapOptions(r.options ?? [])
  }

  async function openAdd(slot: string) {
    setSwapIdx(null)
    setAddSlot(slot)
    setSwapOptions(null)
    setSwapQuery('')
    setSwapBusy(true)
    const r = await lookAddOptions(l.look_id, slot)
    setSwapBusy(false)
    setSwapOptions(r.options ?? [])
  }

  return (
    <div className="border border-[#E2E0DB] px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] tracking-[0.14em] text-[#0A0A0A]">
            LOOK {l.position} — {formatRoomMix(l.room_mix) || 'NO ROOM MIX'}
            {l.approved_at && <span className="ml-2 text-[#3D7A50]">· APPROVED ✓</span>}
          </p>
          {composed ? (
            <div className="mt-3 flex gap-3 flex-wrap items-start">
              {l.items.map((it, i) => (
                <div key={i} className="w-56 border border-[#E2E0DB] bg-white">
                  {it.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={it.image_url as string} alt={it.product_name} className="w-full aspect-[3/4] object-cover bg-[#F8F8F6]" />
                  ) : (
                    <div className="w-full aspect-[3/4] bg-[#F8F8F6] flex items-center justify-center">
                      <span className="text-[9px] tracking-[0.1em] text-[#A8A8A4]">NO IMAGE</span>
                    </div>
                  )}
                  <div className="px-2.5 py-2">
                    <p className="text-[9px] tracking-[0.12em] text-[#A8A8A4]">{it.brand.toUpperCase()}</p>
                    <p className="text-[10px] tracking-[0.08em] text-[#0A0A0A] mt-0.5">
                      {it.owned ? '◈ OWNED — ' : ''}
                      {it.product_name.toUpperCase()}
                    </p>
                    <p className="text-[9px] tracking-[0.08em] text-[#6B6B6B] mt-0.5">
                      {typeof it.price_gbp === 'number' && `£${it.price_gbp}`}
                      {it.size && ` · ${it.size.toUpperCase()}`}
                      {!it.owned && (it.stock_checked_at ? ' · STOCK ✓' : ' · STOCK UNCHECKED')}
                    </p>
                    {!sent && it.item_id && (
                      <div className="mt-1.5 flex items-center gap-3">
                        {it.slot && (
                          <button
                            className="text-[9px] tracking-[0.12em] text-[#C4A882] hover:underline"
                            onClick={() => (swapIdx === i ? setSwapIdx(null) : openSwap(i))}
                          >
                            {swapIdx === i ? 'CLOSE' : '⇄ SWAP'}
                          </button>
                        )}
                        <button
                          className="text-[9px] tracking-[0.12em] text-[#B83A3A] hover:underline"
                          title="Remove from the look — teaches the system this piece was wrong for her"
                          onClick={() => {
                            setSwapIdx(null)
                            run(`rm-${l.look_id}-${i}`, () => removeComposedLookItem(l.look_id, i), 'REMOVED — TASTE UPDATED')
                          }}
                        >
                          ✕ REMOVE
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {!sent && (
                <div className="w-56 border border-dashed border-[#D8D5CE] bg-[#FCFCFA] px-3 py-3">
                  <p className="text-[9px] tracking-[0.14em] text-[#6B6B6B] mb-2">+ ADD TO THIS LOOK</p>
                  <div className="flex flex-wrap gap-1.5">
                    {ADD_SLOTS.map((sl) => (
                      <button
                        key={sl.value}
                        className={`text-[9px] tracking-[0.1em] px-2 py-1 border transition-colors ${
                          addSlot === sl.value
                            ? 'bg-[#0A0A0A] text-white border-[#0A0A0A]'
                            : presentSlots.has(sl.value)
                            ? 'border-[#E2E0DB] text-[#A8A8A4] hover:border-[#0A0A0A] hover:text-[#4A4E57]'
                            : 'border-[#C4A882] text-[#8B5E00] hover:bg-[#C4A882] hover:text-white'
                        }`}
                        title={presentSlots.has(sl.value) ? `Already has a ${sl.label.toLowerCase()} — adds another` : `Add a ${sl.label.toLowerCase()}`}
                        onClick={() => (addSlot === sl.value ? setAddSlot(null) : openAdd(sl.value))}
                      >
                        {sl.label}
                        {presentSlots.has(sl.value) ? ' ✓' : ''}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {l.image_url && (
                <div className="w-56 border-2 border-[#C4A882] bg-white">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={l.image_url} alt="Higgsfield shoot" className="w-full aspect-[3/4] object-cover" />
                  <p className="text-[9px] tracking-[0.12em] text-[#8B5E00] px-2.5 py-2">✦ HIGGSFIELD SHOOT</p>
                </div>
              )}
            </div>
          ) : (
            <div className="mt-1.5 space-y-0.5">
              {l.items.map((it, i) => (
                <p key={i} className="text-[9px] tracking-[0.06em] text-[#6B6B6B]">
                  {it.owned ? '◈ OWNED — ' : ''}
                  {it.brand.toUpperCase()} {it.product_name.toUpperCase()}
                  {typeof it.price_gbp === 'number' && ` · £${it.price_gbp}`}
                  {it.size && ` · ${it.size.toUpperCase()}`}
                  {!it.owned && (it.stock_checked_at ? ' · STOCK ✓' : ' · STOCK UNCHECKED')}
                </p>
              ))}
            </div>
          )}
          {(swapIdx !== null || addSlot !== null) && (
            <div className="mt-2 border border-[#E8D9B8] bg-[#FBF8F2] p-3">
              <p className="text-[8px] tracking-[0.14em] text-[#8B5E00] mb-2">
                {swapIdx !== null
                  ? `SWAP ${l.items[swapIdx]?.product_name?.toUpperCase()}`
                  : `ADD ${(ADD_SLOTS.find((x) => x.value === addSlot)?.label ?? addSlot ?? '').toUpperCase()}`}
                {' '}— RANKED FOR {member?.name?.toUpperCase() ?? 'HER'} (TASTE × COHERENCE × OCCASION). YOUR PICK TEACHES THE SYSTEM.
              </p>
              {swapBusy && <p className="text-[9px] tracking-[0.1em] text-[#A8A8A4]">FINDING ALTERNATES…</p>}
              {swapOptions && swapOptions.length === 0 && <p className="text-[9px] tracking-[0.1em] text-[#A8A8A4]">NOTHING IN STOCK FOR THIS SLOT IN THE LIBRARY.</p>}
              {swapOptions && swapOptions.length > 0 && (() => {
                const q = swapQuery.trim().toLowerCase()
                const shownOptions = q
                  ? swapOptions.filter((o) =>
                      [o.product_name, o.brand_name, o.colour_family].filter(Boolean).join(' ').toLowerCase().includes(q),
                    ).slice(0, 24)
                  : swapOptions.slice(0, 12)
                return (
                  <>
                    <input
                      value={swapQuery}
                      onChange={(e) => setSwapQuery(e.target.value)}
                      placeholder={`SEARCH ALL ${swapOptions.length} IN-STOCK OPTIONS — NAME, BRAND OR COLOUR`}
                      className="w-full max-w-md mb-3 border border-[#E2E0DB] bg-white px-3 py-2 text-[9px] tracking-[0.08em] outline-none focus:border-[#0A0A0A] uppercase placeholder:text-[#A8A8A4]"
                    />
                    {q && shownOptions.length === 0 && (
                      <p className="text-[9px] tracking-[0.1em] text-[#A8A8A4] mb-2">NO MATCH IN THIS SLOT — TRY A BRAND OR COLOUR WORD.</p>
                    )}
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {shownOptions.map((o) => (
                    <button
                      key={o.item_id}
                      className="text-left border border-[#E2E0DB] bg-white hover:border-[#0A0A0A] transition-colors"
                      onClick={() =>
                        run(`pick-${l.look_id}-${o.item_id}`, async () => {
                          const r =
                            swapIdx !== null
                              ? await swapComposedLookItem(l.look_id, swapIdx, o.item_id)
                              : await addComposedLookItem(l.look_id, o.item_id)
                          setSwapIdx(null)
                          setAddSlot(null)
                          return r
                        }, swapIdx !== null ? 'SWAPPED — TASTE UPDATED' : 'ADDED — TASTE UPDATED')
                      }
                    >
                      {o.image_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={o.image_url} alt={o.product_name} className="w-full aspect-[3/4] object-cover" />
                      )}
                      <p className="text-[9px] tracking-[0.1em] text-[#6B6B6B] px-1.5 py-1.5 truncate">
                        {(o.brand_name ?? '').toUpperCase()} {o.product_name.toUpperCase()}
                        {typeof o.price_gbp === 'number' && ` £${o.price_gbp}`}
                      </p>
                    </button>
                  ))}
                </div>
                  </>
                )
              })()}
            </div>
          )}
          {poseOpen && !sent && (
            <div className="mt-2 border border-[#E8D9B8] bg-[#FBF8F2] p-3">
              <p className="text-[8px] tracking-[0.14em] text-[#8B5E00] mb-2">
                {l.image_url ? 'SHOOT AGAIN — PICK A POSE AND LIGHTING. THE CURRENT SHOOT IS KEPT.' : 'PICK A POSE AND LIGHTING'}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {HIGGSFIELD_POSE_OPTIONS.map((c) => (
                  <button
                    key={c.key}
                    disabled={shooting}
                    className="text-left border border-[#E2E0DB] bg-white px-2.5 py-1.5 hover:border-[#0A0A0A] transition-colors disabled:opacity-40"
                    onClick={() => {
                      setPoseOpen(false)
                      // via the API route, NOT a server action — a running
                      // shoot must never queue-block the page's other buttons
                      void shoot(
                        () => fetch('/api/pilot/shoot', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ lookId: l.look_id, poseKey: c.key }),
                        }).then((r) => r.json()),
                        `HIGGSFIELD SHOOT (${c.label}) ATTACHED — TAKES A FEW MINUTES`)
                    }}
                  >
                    <span className="block text-[9px] tracking-[0.1em] text-[#0A0A0A]">{c.label}</span>
                    <span className="block text-[8px] tracking-[0.08em] text-[#A8A8A4]">{c.sublabel}</span>
                  </button>
                ))}
              </div>
              {shootHistory.length > 1 && (
                <>
                  <p className="text-[8px] tracking-[0.14em] text-[#8B5E00] mt-3 mb-1.5">
                    EARLIER SHOOTS — TAP TO PUT ONE BACK
                  </p>
                  <div className="flex gap-2 flex-wrap">
                    {shootHistory.map((h) => (
                      <button
                        key={h.url}
                        disabled={shooting || h.url === l.image_url}
                        onClick={() => run(`rs-${l.look_id}`, () => restoreLookShoot(l.look_id, h.url), 'SHOOT RESTORED')}
                        className={`border ${h.url === l.image_url ? 'border-[#C4A882]' : 'border-[#E2E0DB] hover:border-[#0A0A0A]'} transition-colors`}
                        title={h.url === l.image_url ? 'Currently showing' : `Restore this ${h.pose ?? ''} shoot`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={h.url} alt="" className="w-16 aspect-[3/4] object-cover" />
                        <span className="block text-[7px] tracking-[0.1em] text-[#6B6B6B] py-0.5">
                          {h.url === l.image_url ? 'CURRENT' : (h.pose ?? 'SHOOT')}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          {l.notes && <p className="text-[9px] tracking-[0.06em] text-[#A8A8A4] mt-1">{l.notes.toUpperCase()}</p>}
        </div>
        <div className="shrink-0 flex flex-col items-end gap-2">
          {!sent && (
            <div className="flex gap-2 flex-wrap justify-end">
              {composed && !l.approved_at && (
                <button
                  className="text-[9px] tracking-[0.12em] px-3 py-1.5 bg-[#0A0A0A] text-white hover:opacity-85"
                  title="Approve this composition — logs every item and brand pairing as a win for her taste"
                  onClick={() => run(`appr-${l.look_id}`, () => approveComposedLook(l.look_id), 'APPROVED — TASTE UPDATED')}
                >
                  APPROVE ✓
                </button>
              )}
              {composed && !l.approved_at && (
                <button
                  className="text-[9px] tracking-[0.12em] px-3 py-1.5 border border-[#0A0A0A] text-[#0A0A0A] hover:bg-[#0A0A0A] hover:text-white transition-colors"
                  title="Skip this composition — logs every item and brand pairing as a miss for her taste, then removes the look. × deletes without teaching anything."
                  onClick={() => run(`skip-${l.look_id}`, () => skipComposedLook(l.look_id), 'SKIPPED — TASTE UPDATED, LOOK REMOVED')}
                >
                  SKIP
                </button>
              )}
              {composed && (
                <button
                  className="text-[9px] tracking-[0.12em] px-3 py-1.5 border border-[#C4A882] text-[#8B5E00] hover:bg-[#C4A882] hover:text-white transition-colors"
                  title={l.image_url
                    ? 'Shoot it again — pick a different pose and lighting. The current shoot is kept.'
                    : 'Generate an editorial shoot of this look via the local Higgsfield CLI'}
                  onClick={() => setPoseOpen(!poseOpen)}
                >
                  {shooting ? 'SHOOTING…' : l.image_url ? '✦ REDO SHOOT' : '✦ HIGGSFIELD'}
                </button>
              )}
              <button className={btnTiny} onClick={onEdit}>
                EDIT
              </button>
              <button
                className={btnTiny}
                onClick={() => {
                  if (window.confirm('Delete this look?')) run(`dell-${l.look_id}`, () => deleteLook(l.look_id), 'LOOK DELETED')
                }}
              >
                ×
              </button>
            </div>
          )}
          {sent && !l.response && (
            <div className="flex items-center gap-1.5">
              <button
                className="text-[9px] tracking-[0.12em] px-3 py-1.5 bg-[#0A0A0A] text-white hover:opacity-85"
                onClick={() =>
                  run(`resp-${l.look_id}`, () => recordResponse(l.look_id, 'yes', null), `${calibration ? 'LIKE' : 'YES'} LOGGED — TASTE UPDATED`)
                }
              >
                {calibration ? 'LIKE' : 'YES'}
              </button>
              <select className={`${input} !w-auto !py-1.5 !text-[9px]`} value={reason} onChange={(e) => setReason(e.target.value as ResponseReason)}>
                {RESPONSE_REASONS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
              <button
                className="text-[9px] tracking-[0.12em] px-3 py-1.5 border border-[#0A0A0A] hover:bg-[#F2F2F2]"
                onClick={() =>
                  run(`resp-${l.look_id}`, () => recordResponse(l.look_id, 'no', reason), `${calibration ? 'DISLIKE' : 'NO'} LOGGED — TASTE UPDATED`)
                }
              >
                {calibration ? 'DISLIKE' : 'NO'}
              </button>
            </div>
          )}
          {l.response && (
            <p className={`text-[9px] tracking-[0.14em] ${l.response === 'yes' ? 'text-[#3D7A50]' : 'text-[#B83A3A]'}`}>
              {l.response.toUpperCase()}
              {l.response_reason && ` — ${l.response_reason.replace(/_/g, ' ').toUpperCase()}`}
            </p>
          )}
          {sent && member && (
            <div className="flex items-center gap-1.5">
              {(
                [
                  ['click_out', 'CLICK'],
                  ['save', 'SAVE'],
                  ['purchase', 'PURCHASE'],
                ] as const
              ).map(([t, lab]) => (
                <button
                  key={t}
                  className={btnTiny}
                  title="Logs against THIS look — feeds her taste vector"
                  onClick={() =>
                    run(
                      `looksig-${l.look_id}-${t}`,
                      () =>
                        logActivity({
                          member_id: member.member_id,
                          type: t,
                          detail: `look ${l.position}`,
                          delivery_id: l.delivery_id,
                          look_id: l.look_id,
                        }),
                      `${lab} LOGGED ON LOOK ${l.position} — TASTE UPDATED`,
                    )
                  }
                >
                  + {lab}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function LookEditor({
  deliveryId,
  look,
  position,
  run,
  done,
}: {
  deliveryId: string
  look?: PilotLook
  position?: number
  run: Run
  done: () => void
}) {
  const [mix, setMix] = useState<Record<RoomKey, string>>({
    tailored: String(Math.round((look?.room_mix?.tailored ?? 0) * 100)),
    romantic: String(Math.round((look?.room_mix?.romantic ?? 0) * 100)),
    ease: String(Math.round((look?.room_mix?.ease ?? 0) * 100)),
  })
  const [items, setItems] = useState<LookItem[]>(look?.items ?? [])
  const [imageUrl, setImageUrl] = useState(look?.image_url ?? '')
  const [notes, setNotes] = useState(look?.notes ?? '')

  const fastFashionWarning = items.some((it) => !it.owned && it.brand && isFastFashion(it.brand))

  return (
    <div className="border border-[#0A0A0A] px-4 py-4 space-y-3">
      <p className="text-[10px] tracking-[0.16em] text-[#0A0A0A]">LOOK {look?.position ?? position}</p>
      <div>
        <p className={`${label} mb-1.5`}>ROOM MIX % — EVERY OUTFIT NAMES ITS MIX</p>
        <div className="flex gap-2 max-w-sm">
          {ROOM_KEYS.map((k) => (
            <div key={k} className="flex-1">
              <input className={input} value={mix[k]} onChange={(e) => setMix({ ...mix, [k]: e.target.value })} />
              <p className="text-[8px] tracking-[0.12em] text-[#6B6B6B] mt-1">{ROOMS[k].label}</p>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className={`${label} mb-1.5`}>ITEMS — TICK OWNED FOR WARDROBE PIECES (FAST FASHION ALLOWED ONLY WHEN OWNED)</p>
        {items.map((it, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_70px_1fr_60px_60px_60px_24px] gap-1.5 mb-1.5 items-center">
            <input className={input} placeholder="BRAND" value={it.brand} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, brand: e.target.value } : x)))} />
            <input className={input} placeholder="PIECE" value={it.product_name} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, product_name: e.target.value } : x)))} />
            <input className={input} placeholder="£" value={it.price_gbp ?? ''} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, price_gbp: e.target.value ? Number(e.target.value) : null } : x)))} />
            <input className={input} placeholder="URL" value={it.url ?? ''} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
            <input className={input} placeholder="SIZE" value={it.size ?? ''} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, size: e.target.value } : x)))} />
            <label className="text-[8px] tracking-[0.1em] text-[#6B6B6B] flex items-center gap-1">
              <input type="checkbox" checked={it.owned} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, owned: e.target.checked } : x)))} />
              OWNED
            </label>
            <label className="text-[8px] tracking-[0.1em] text-[#6B6B6B] flex items-center gap-1">
              <input type="checkbox" checked={it.in_stock !== false} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, in_stock: e.target.checked } : x)))} />
              STOCK
            </label>
            <button className="text-[#B83A3A] text-[11px]" onClick={() => setItems(items.filter((_, j) => j !== i))}>
              ×
            </button>
          </div>
        ))}
        <button
          className={btnTiny}
          onClick={() => setItems([...items, { brand: '', product_name: '', price_gbp: null, url: '', owned: false, size: '', in_stock: true, stock_checked_at: null }])}
        >
          + ITEM
        </button>
        {fastFashionWarning && (
          <p className="text-[9px] tracking-[0.1em] text-[#B83A3A] mt-2">
            FAST FASHION IN A RECOMMENDED SLOT — INPUT, NEVER OUTPUT. TICK OWNED OR SWAP THE BRAND.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <input className={input} placeholder="IMAGE URL (OPTIONAL)" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} />
        <input className={input} placeholder="NOTES" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <div className="flex gap-2">
        <button
          className={btnDark}
          onClick={async () => {
            const r = await run(
              `savelook-${look?.look_id ?? 'new'}`,
              () =>
                saveLook({
                  look_id: look?.look_id,
                  delivery_id: deliveryId,
                  position: look?.position ?? position ?? 1,
                  room_mix: {
                    tailored: Number(mix.tailored) || 0,
                    romantic: Number(mix.romantic) || 0,
                    ease: Number(mix.ease) || 0,
                  },
                  items: items.filter((it) => it.brand || it.product_name),
                  image_url: imageUrl,
                  notes,
                }),
              'LOOK SAVED',
            )
            if (!r?.error) done()
          }}
        >
          SAVE LOOK
        </button>
        <button className={btnLight} onClick={done}>
          CANCEL
        </button>
      </div>
    </div>
  )
}

// ── DRY RUN ─────────────────────────────────────────────────────────────────

function DryRunTab({
  data,
  run,
  busy,
  goDeliveries,
}: {
  data: PilotData
  run: Run
  busy: string | null
  goDeliveries: () => void
}) {
  const synthByName = Object.fromEntries(data.members.filter((m) => m.is_synthetic).map((m) => [m.name, m]))
  const seeded = SYNTH_PERSONAS.every((p) => synthByName[p.name])
  const briefDeliveries = Object.fromEntries(
    data.deliveries.filter((d) => d.dry_run_brief).map((d) => [d.dry_run_brief as string, d]),
  )

  return (
    <div className="space-y-6">
      <div className="border border-[#E8D9B8] bg-[#FDFBF6] px-5 py-4">
        <p className="text-[10px] tracking-[0.14em] text-[#8B5E00] mb-1">CONTAMINATION RULE — THE ONE THAT BITES LATER</p>
        <p className="text-[9px] tracking-[0.06em] text-[#6B6B6B] leading-relaxed max-w-3xl">
          SYNTHETIC RESPONSES ARE YOUR GUESSES ABOUT THEIR TASTE, NOT THEIR TASTE. EVERYTHING HERE CARRIES
          IS_SYNTHETIC AND IS EXCLUDED FROM ALL REAL TASTE UPDATES AND ANY FUTURE TRAINING DATA. WHEN THE REAL
          DEVIKA ONBOARDS, SHE STARTS FROM THE INTAKE — NOT FROM THE SYNTHETIC PROFILE. KEEP THE RECORDS THOUGH:
          GUESSED WEIGHTS VS REAL INTAKE MEASURES YOUR OWN READ ON YOUR USERS.
        </p>
      </div>

      {!seeded ? (
        <button
          className={btnDark}
          disabled={busy === 'seed'}
          onClick={() => run('seed', () => seedSyntheticPersonas(), 'SYNTHETIC PERSONAS SEEDED')}
        >
          SEED SYNTHETIC PERSONAS — DEVIKA + MUM
        </button>
      ) : (
        <p className="text-[9px] tracking-[0.14em] text-[#3D7A50]">✓ SYNTHETIC PERSONAS SEEDED</p>
      )}

      <div>
        <p className={`${label} mb-3`}>DRY-RUN SCRIPT — RUN EVERY BRIEF THROUGH THE ASSEMBLY LOOP</p>
        <div className="space-y-2">
          {DRY_RUN_SCRIPT.map((b, i) => {
            const persona = synthByName[b.persona]
            const existing = briefDeliveries[b.id]
            const eff = persona ? effectiveWeights(persona.room_weights, b.occasion, persona.work_dress_code) : null
            return (
              <div key={b.id} className="border border-[#E2E0DB] px-4 py-3 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[10px] tracking-[0.1em] text-[#0A0A0A]">
                    {i + 1}. “{b.brief.toUpperCase()}” — {b.persona}
                  </p>
                  <p className="text-[9px] tracking-[0.06em] text-[#6B6B6B] mt-1">{b.tests.toUpperCase()}</p>
                  {eff && (
                    <p className="text-[9px] tracking-[0.14em] text-[#C4A882] mt-1.5">→ {formatRoomMix(eff)}</p>
                  )}
                </div>
                <div className="shrink-0">
                  {existing ? (
                    <button className={btnTiny} onClick={goDeliveries}>
                      {existing.status.toUpperCase()} · VIEW IN DELIVERIES
                    </button>
                  ) : (
                    <button
                      className={btnTiny}
                      disabled={!persona || busy === `brief-${b.id}`}
                      onClick={() =>
                        run(
                          `brief-${b.id}`,
                          () =>
                            createDelivery({
                              member_id: persona!.member_id,
                              trigger: b.id === 'greece' ? 'anticipation' : 'request',
                              request_text: b.brief,
                              occasion: b.occasion,
                              dry_run_brief: b.id,
                            }),
                          'DRAFT CREATED — ASSEMBLE IN DELIVERIES',
                        )
                      }
                    >
                      {persona ? 'CREATE DRAFT' : 'SEED PERSONAS FIRST'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="border border-[#E2E0DB] px-5 py-4">
        <p className={`${label} mb-2`}>PASS CRITERIA</p>
        {DRY_RUN_PASS_CRITERIA.map((c) => (
          <p key={c} className="text-[9px] tracking-[0.08em] text-[#0A0A0A] mb-1">
            — {c}
          </p>
        ))}
      </div>
    </div>
  )
}

// ── EXIT ARTEFACT ───────────────────────────────────────────────────────────

function ArtefactTab({ data }: { data: PilotData }) {
  const real = data.members.filter((m) => !m.is_synthetic)
  const members = real.length > 0 ? real : data.members
  return (
    <div className="space-y-6">
      <p className="text-[9px] tracking-[0.08em] text-[#6B6B6B] max-w-2xl leading-relaxed">
        THE ONE-PAGER PER PILOT. SUCCESS HIERARCHY: UNPROMPTED RETURN &gt; PURCHASE &gt; DISCOVERY-CLICK &gt;
        SAVES &gt; QUERY COUNT. IF THE PILOTS PRODUCE THE FIRST TWO, YOU HAVE A COMPANY.
      </p>
      {members.map((m) => {
        const a = data.artefacts[m.member_id]
        if (!a) return null
        const acceptance = a.looksResponded > 0 ? Math.round((a.acceptedOverall / a.looksResponded) * 100) : null
        const newBrandRate = a.newBrandLooksSent > 0 ? Math.round((a.newBrandLooksAccepted / a.newBrandLooksSent) * 100) : null
        const drift = a.stockChecks > 0 ? Math.round((a.stockMoved / a.stockChecks) * 100) : null
        return (
          <div key={m.member_id} className="border border-[#E2E0DB] px-6 py-5">
            <div className="flex items-center gap-3 mb-4">
              <p className="text-[13px] tracking-[0.12em] text-[#0A0A0A]">{m.name}</p>
              {m.is_synthetic && (
                <span className="text-[8px] tracking-[0.14em] text-[#8B5E00] border border-[#E8D9B8] px-2 py-0.5">SYNTHETIC</span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-8 mb-5 max-w-3xl">
              <div>
                <p className={`${label} mb-1.5`}>ROOM WEIGHTING AT INTAKE</p>
                {a.intakeWeights ? <WeightBar weights={a.intakeWeights} /> : <p className="text-[9px] text-[#A8A8A4]">NO INTAKE SNAPSHOT</p>}
              </div>
              <div>
                <p className={`${label} mb-1.5`}>NOW — DID THE READ OF HER MOVE?</p>
                <WeightBar weights={a.currentWeights} />
              </div>
              <div>
                <p className={`${label} mb-1.5`}>34-DIM VECTOR READ — AGREES?</p>
                {(() => {
                  const read = vectorRoomRead(m.taste_vector)
                  return read ? <WeightBar weights={read} /> : <p className="text-[9px] text-[#A8A8A4]">NO VECTOR YET</p>
                })()}
              </div>
            </div>
            <div className="grid grid-cols-4 gap-x-8 gap-y-3 max-w-3xl">
              <Stat label="UNPROMPTED RETURNS" value={String(a.unpromptedReturns)} rank="1" />
              <Stat label="PURCHASES" value={String(a.purchases)} rank="2" />
              <Stat label="DISCOVERY CLICKS" value={String(a.clicks)} rank="3" />
              <Stat label="SAVES" value={String(a.saves)} rank="4" />
              <Stat label="DELIVERIES SENT" value={String(a.deliveriesSent)} />
              <Stat label="ACCEPTANCE" value={acceptance == null ? '—' : `${acceptance}%`} sub={`${a.acceptedOverall}/${a.looksResponded} LOOKS`} />
              <Stat label="NEW-BRAND SLOT ACCEPTANCE" value={newBrandRate == null ? '—' : `${newBrandRate}%`} sub={`${a.newBrandLooksAccepted}/${a.newBrandLooksSent}`} />
              <Stat label="STOCK DRIFT" value={drift == null ? '—' : `${drift}%`} sub="MOVED BETWEEN ASSEMBLY AND CLICK" />
            </div>
          </div>
        )
      })}
      {members.length === 0 && <p className="text-[10px] tracking-[0.1em] text-[#A8A8A4]">NO MEMBERS YET.</p>}
    </div>
  )
}

function Stat({ label: l, value, sub, rank }: { label: string; value: string; sub?: string; rank?: string }) {
  return (
    <div>
      <p className="text-[8px] tracking-[0.16em] text-[#6B6B6B]">
        {rank && <span className="text-[#C4A882]">#{rank} </span>}
        {l}
      </p>
      <p className="text-[18px] tracking-[0.04em] text-[#0A0A0A] mt-0.5">{value}</p>
      {sub && <p className="text-[8px] tracking-[0.1em] text-[#A8A8A4]">{sub}</p>}
    </div>
  )
}
