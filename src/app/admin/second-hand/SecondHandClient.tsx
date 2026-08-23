'use client'

import { useState } from 'react'
import { updateMerchantSourcing, pullFeedsNow, chooseRescueReplacement, setBrandSizeOffset } from './actions'

export interface MerchantSourcingRow {
  merchant_id: string
  name: string
  source_type: 'retail' | 'second_hand' | 'vintage'
  default_stock_class: 'replenishable' | 'unique'
  feed_url: string | null
  feed_format: 'shopify_json' | 'google_rss' | 'custom_json' | null
  feed_checked_at: string | null
  feed_error: string | null
  webhook_secret: string | null
}

const SOURCE_TYPES = ['retail', 'second_hand', 'vintage'] as const
const FEED_FORMATS = ['shopify_json', 'google_rss', 'custom_json'] as const

export default function SecondHandClient({
  merchants,
  brands,
  rescues,
}: {
  merchants: MerchantSourcingRow[]
  brands: BrandFitRow[]
  rescues: any[]
}) {
  return (
    <>
      <MerchantSourcing merchants={merchants} />
      <BrandFit brands={brands} />
      <RescueReview rescues={rescues} />
    </>
  )
}

// ── Merchant sourcing + feeds ────────────────────────────────────────────────

function MerchantSourcing({ merchants }: { merchants: MerchantSourcingRow[] }) {
  const [pulling, setPulling] = useState(false)
  const [pullResult, setPullResult] = useState<string | null>(null)

  return (
    <section className="mb-10">
      <div className="flex items-baseline justify-between gap-4 mb-1">
        <h2 className="text-[13px] tracking-[0.12em] text-[#4A4E57]">SOURCING &amp; FEEDS</h2>
        <button
          onClick={async () => {
            setPulling(true)
            const res = await pullFeedsNow()
            setPullResult(res.error ?? `${res.merchants} feeds pulled · ${res.sold} sold`)
            setPulling(false)
          }}
          disabled={pulling}
          className="text-[10px] tracking-[0.1em] text-[#0A0A0A] border border-[#E2E0DB] px-3 py-1.5 rounded-[8px] hover:border-[#0A0A0A] transition-colors disabled:opacity-40"
        >
          {pulling ? 'PULLING…' : 'PULL FEEDS NOW'}
        </button>
      </div>
      <p className="text-[10px] tracking-[0.06em] text-[#A8A8A4] mb-4 max-w-2xl leading-relaxed">
        FEED FIRST. A FEED ROW IS A STATEMENT ABOUT AVAILABILITY; A SCRAPE IS A GUESS. ASK EVERY
        SECOND-HAND PARTNER FOR <span className="text-[#8A7340]">SIZE-LEVEL AVAILABILITY</span> IN THE
        FEED, AND FOR A WEBHOOK ON SALE — THAT IS THE INSTANT SOLD-SIGNAL.
      </p>
      {pullResult && <p className="text-[10px] tracking-[0.06em] text-[#6B6B6B] mb-3">{pullResult}</p>}

      <div className="space-y-2">
        {merchants.map((m) => (
          <MerchantRow key={m.merchant_id} merchant={m} />
        ))}
        {merchants.length === 0 && (
          <p className="text-[11px] tracking-[0.04em] text-[#A8A8A4]">No merchants yet.</p>
        )}
      </div>
    </section>
  )
}

function MerchantRow({ merchant }: { merchant: MerchantSourcingRow }) {
  const [row, setRow] = useState(merchant)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function patch(next: Partial<MerchantSourcingRow>) {
    const merged = { ...row, ...next }
    setRow(merged)
    setSaving(true)
    const res = await updateMerchantSourcing(row.merchant_id, next as any)
    setError(res.error ?? null)
    setSaving(false)
  }

  const webhookUrl = `/api/webhooks/second-hand/${row.merchant_id}`

  return (
    <div className="border border-[#E2E0DB] bg-white rounded-[12px] p-4">
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <p className="text-[13px] tracking-[0.05em] text-[#0A0A0A] mr-auto">{row.name}</p>
        {saving && <span className="text-[9px] tracking-[0.1em] text-[#A8A8A4]">SAVING…</span>}
        {error && <span className="text-[9px] tracking-[0.06em] text-[#B83A3A]">{error}</span>}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="block text-[9px] tracking-[0.12em] text-[#A8A8A4] mb-1">SOURCE TYPE</span>
          <select
            value={row.source_type}
            onChange={(e) => patch({ source_type: e.target.value as any })}
            className="w-full border border-[#E2E0DB] rounded-[8px] px-3 py-2 text-[12px] text-[#4A4E57] bg-white"
          >
            {SOURCE_TYPES.map((t) => (
              <option key={t} value={t}>{t.replace('_', '-')}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="block text-[9px] tracking-[0.12em] text-[#A8A8A4] mb-1">
            DEFAULT STOCK CLASS — WHAT NEW ITEMS INHERIT
          </span>
          <select
            value={row.default_stock_class}
            onChange={(e) => patch({ default_stock_class: e.target.value as any })}
            className="w-full border border-[#E2E0DB] rounded-[8px] px-3 py-2 text-[12px] text-[#4A4E57] bg-white"
          >
            <option value="replenishable">replenishable — restocks</option>
            <option value="unique">unique — one of one, gone when sold</option>
          </select>
        </label>

        <label className="block md:col-span-2">
          <span className="block text-[9px] tracking-[0.12em] text-[#A8A8A4] mb-1">PRODUCT FEED URL</span>
          <input
            defaultValue={row.feed_url ?? ''}
            onBlur={(e) => patch({ feed_url: e.target.value.trim() || null })}
            placeholder="https://shop.example.com/products.json"
            className="w-full border border-[#E2E0DB] rounded-[8px] px-3 py-2 text-[12px] text-[#4A4E57] bg-white"
          />
        </label>

        <label className="block">
          <span className="block text-[9px] tracking-[0.12em] text-[#A8A8A4] mb-1">FEED FORMAT</span>
          <select
            value={row.feed_format ?? ''}
            onChange={(e) => patch({ feed_format: (e.target.value || null) as any })}
            className="w-full border border-[#E2E0DB] rounded-[8px] px-3 py-2 text-[12px] text-[#4A4E57] bg-white"
          >
            <option value="">— none —</option>
            {FEED_FORMATS.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="block text-[9px] tracking-[0.12em] text-[#A8A8A4] mb-1">
            WEBHOOK SECRET — SENT AS X-MYRA-SECRET
          </span>
          <input
            defaultValue={row.webhook_secret ?? ''}
            onBlur={(e) => patch({ webhook_secret: e.target.value.trim() || null })}
            placeholder="a long random string"
            className="w-full border border-[#E2E0DB] rounded-[8px] px-3 py-2 text-[12px] text-[#4A4E57] bg-white font-mono"
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4 text-[9px] tracking-[0.08em]">
        <span className="text-[#A8A8A4]">POST → <span className="font-mono text-[#6B6B6B]">{webhookUrl}</span></span>
        {row.feed_checked_at && (
          <span className="text-[#A8A8A4]">LAST PULL {new Date(row.feed_checked_at).toLocaleString('en-GB')}</span>
        )}
        {row.feed_error && <span className="text-[#B83A3A]">FEED ERROR: {row.feed_error}</span>}
      </div>
    </div>
  )
}

// ── Rescues waiting on a human ───────────────────────────────────────────────

function RescueReview({ rescues }: { rescues: any[] }) {
  if (!rescues.length) return null
  return (
    <section className="mb-10">
      <h2 className="text-[13px] tracking-[0.12em] text-[#4A4E57] mb-1">RESTYLES WAITING ON YOU</h2>
      <p className="text-[10px] tracking-[0.06em] text-[#A8A8A4] mb-4 max-w-2xl leading-relaxed">
        NOTHING PASSED THE CONSTITUTION FOR THESE. THE SAVED LOOKS SHOW INTACT WITH &ldquo;WE&rsquo;LL
        RESTYLE THIS WHEN WE FIND THE RIGHT REPLACEMENT&rdquo; — NO RENDER HAS BEEN SPENT.
      </p>
      <div className="space-y-2">
        {rescues.map((r) => (
          <RescueRow key={r.rescue_id} rescue={r} />
        ))}
      </div>
    </section>
  )
}

function RescueRow({ rescue }: { rescue: any }) {
  const [itemId, setItemId] = useState('')
  const [state, setState] = useState<'idle' | 'saving' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="border border-[#E2E0DB] bg-white rounded-[12px] p-4 flex flex-wrap items-center gap-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={rescue.outfit?.image_url || '/placeholder-outfit.jpg'}
        alt=""
        className="w-[46px] h-[61px] object-cover rounded-[6px] bg-[#F2F2F2]"
      />
      <div className="min-w-0">
        <p className="text-[12px] text-[#4A4E57] truncate">{rescue.outfit?.aesthetic_label ?? 'Untitled look'}</p>
        <p className="text-[10px] tracking-[0.05em] text-[#B83A3A] truncate">
          SOLD: {rescue.item?.brand?.name ? `${rescue.item.brand.name} — ` : ''}{rescue.item?.product_name ?? rescue.sold_item_id}
        </p>
        <p className="text-[10px] tracking-[0.05em] text-[#A8A8A4]">slot: {rescue.slot}</p>
      </div>
      <div className="flex items-center gap-2 ml-auto">
        <input
          value={itemId}
          onChange={(e) => setItemId(e.target.value)}
          placeholder="replacement item_id"
          className="border border-[#E2E0DB] rounded-[8px] px-3 py-2 text-[11px] text-[#4A4E57] font-mono w-[300px] max-w-full"
        />
        <button
          onClick={async () => {
            if (!itemId.trim()) return
            setState('saving')
            const res = await chooseRescueReplacement(rescue.rescue_id, itemId.trim())
            if (res.error) { setError(res.error); setState('idle') } else { setState('done') }
          }}
          disabled={state !== 'idle' || !itemId.trim()}
          className="text-[10px] tracking-[0.1em] text-white bg-[#0A0A0A] px-4 py-2 rounded-[8px] hover:opacity-85 transition-opacity disabled:opacity-30"
        >
          {state === 'saving' ? 'QUEUING…' : state === 'done' ? 'QUEUED' : 'RESTYLE WITH THIS'}
        </button>
      </div>
      {error && <p className="w-full text-[10px] tracking-[0.05em] text-[#B83A3A]">{error}</p>}
    </div>
  )
}

// ── Per-brand size offset ────────────────────────────────────────────────────

export interface BrandFitRow {
  brand_id: string
  name: string
  size_offset: Record<string, number>
  live_items: number
}

const OFFSET_OPTIONS = [
  { steps: -1, label: 'RUNS SMALL', hint: 'a labelled 10 fits like an 8' },
  { steps: 0, label: 'TRUE TO SIZE', hint: '' },
  { steps: 1, label: 'RUNS LARGE', hint: 'a labelled 10 fits like a 12' },
]

/**
 * Set what a brand's labels actually mean.
 *
 * Nothing infers this — it's a judgement about a brand's cut, and it changes
 * the canonical value every one of that brand's sizes resolves to. Which
 * matters most for one-of-ones, where the size gate hides rather than ranks.
 */
export function BrandFit({ brands }: { brands: BrandFitRow[] }) {
  const [query, setQuery] = useState('')
  const shown = brands
    .filter((b) => b.name.toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, query.trim() ? 40 : 12)

  return (
    <section className="mb-10">
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-1">
        <h2 className="text-[13px] tracking-[0.12em] text-[#4A4E57]">BRAND FIT</h2>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search brands"
          className="border border-[#E2E0DB] rounded-[8px] px-3 py-1.5 text-[11px] text-[#4A4E57] bg-white w-[220px]"
        />
      </div>
      <p className="text-[10px] tracking-[0.06em] text-[#A8A8A4] mb-4 max-w-2xl leading-relaxed">
        WHERE A BRAND IS KNOWN TO RUN SMALL OR LARGE, SAY SO HERE. IT SHIFTS EVERY SIZE THAT BRAND
        LISTS ONTO THE CANONICAL LADDER — WHICH IS WHAT THE ONE-OF-ONE SIZE FILTER MATCHES ON.
        {!query.trim() && ' SHOWING THE BUSIEST BRANDS; SEARCH FOR ANY OTHER.'}
      </p>
      <div className="space-y-2">
        {shown.map((b) => (
          <BrandFitRowView key={b.brand_id} brand={b} />
        ))}
      </div>
    </section>
  )
}

function BrandFitRowView({ brand }: { brand: BrandFitRow }) {
  const [offsets, setOffsets] = useState<Record<string, number>>(brand.size_offset ?? {})
  const [saving, setSaving] = useState(false)
  const current = offsets.default ?? 0

  async function set(steps: number) {
    setOffsets((o) => {
      const next = { ...o }
      if (steps === 0) delete next.default
      else next.default = steps
      return next
    })
    setSaving(true)
    await setBrandSizeOffset(brand.brand_id, 'default', steps)
    setSaving(false)
  }

  return (
    <div className="border border-[#E2E0DB] bg-white rounded-[12px] px-4 py-3 flex flex-wrap items-center gap-3">
      <div className="mr-auto min-w-0">
        <p className="text-[12px] tracking-[0.04em] text-[#0A0A0A] truncate">{brand.name}</p>
        <p className="text-[9px] tracking-[0.08em] text-[#A8A8A4]">{brand.live_items} live</p>
      </div>
      {saving && <span className="text-[9px] tracking-[0.1em] text-[#A8A8A4]">SAVING…</span>}
      <div className="flex gap-1.5">
        {OFFSET_OPTIONS.map((o) => (
          <button
            key={o.steps}
            onClick={() => set(o.steps)}
            title={o.hint}
            className={`text-[9px] tracking-[0.09em] px-3 py-1.5 rounded-[8px] border transition-colors ${
              current === o.steps
                ? 'border-[#0A0A0A] bg-[#0A0A0A] text-white'
                : 'border-[#E2E0DB] text-[#6B6B6B] hover:border-[#0A0A0A]'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}
