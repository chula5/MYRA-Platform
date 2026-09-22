'use client'

// YOUR BRANDS.
//
// The one screen in the client area that shows her what MYRA thinks it knows
// about her taste and lets her argue with it. Three things, in this order,
// because that is the order she cares about them:
//
//   1. THE BRANDS SHE LOVES     hers, oldest first, each removable.
//   2. WHAT MYRA FOUND FROM THEM each with the reason it came — "core family
//                               'Quiet luxury' via Totême". This is the part
//                               that earns trust: it shows the naming did
//                               something, rather than filling a text field.
//   3. SOMEWHERE TO ADD MORE    type a name, or browse by aesthetic.
//
// Saving is immediate, not batched behind the page's Save button. Adding a
// brand re-seeds her whole brand model server-side, which takes a second or
// two — so it needs its own busy state, and batching it into a Save that also
// writes her sizes would make that Save feel broken.
//
// Naming a brand MYRA does not stock is not an error and is never refused. It
// is filed as a request her stylist sees, and she is told plainly that it is
// noted but cannot be shopped yet — because the alternative is a brand sitting
// in her list doing nothing while she believes it is working.

import { useEffect, useMemo, useState } from 'react'
import {
  loadMyBrands,
  addMyBrand,
  removeMyBrand,
  setMyBrandInputOnly,
  type MyBrandsView,
} from '@/app/me/brand-actions'

const card = 'rounded-[28px] bg-white/80 shadow-[0_18px_40px_-24px_rgba(43,43,43,0.35)] p-6 sm:p-9'
const heading = 'text-[clamp(26px,1.7vw,40px)] text-[#2B2B2B]'
const label = 'text-[clamp(20px,1.1vw,28px)] text-[#55534E]'
const field = 'w-full rounded-full bg-white px-6 py-4 text-[clamp(20px,1.1vw,28px)] text-[#2B2B2B] shadow-[0_10px_18px_-12px_rgba(120,120,120,0.6)] outline-none border-2 border-transparent focus:border-[#C9C9C9]'
const chipBase = 'rounded-full px-5 py-2.5 text-[clamp(18px,1vw,24px)] transition-colors'
const quiet = `${chipBase} bg-white text-[#55534E] shadow-[0_8px_16px_-12px_rgba(120,120,120,0.7)]`

export default function BrandPicker({
  testMemberId,
  /** Onboarding drops the card chrome and the "Your brands" title. */
  bare = false,
  onChange,
}: {
  testMemberId?: string
  bare?: boolean
  onChange?: (count: number) => void
}) {
  const [view, setView] = useState<MyBrandsView | null | undefined>(undefined)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [browsing, setBrowsing] = useState(false)

  const refresh = async () => {
    const v = await loadMyBrands(testMemberId)
    setView(v)
    if (v) onChange?.(v.favourites.length)
    return v
  }

  useEffect(() => {
    let alive = true
    void loadMyBrands(testMemberId).then((v) => {
      if (!alive) return
      setView(v)
      if (v) onChange?.(v.favourites.length)
    })
    return () => { alive = false }
    // onChange is a parent callback; re-running on its identity would reload
    // her brands on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testMemberId])

  /** Every write goes through here so exactly one thing is busy at a time and
   *  the list is always re-read from the server afterwards. */
  async function run(key: string, fn: () => Promise<any>) {
    setBusy(key)
    setNote(null)
    try {
      const r = await fn()
      if (r?.error) setNote(r.error)
      else if (r?.requested) setNote(`MYRA doesn’t have ${r.requested} yet — your stylist has been told you want it.`)
      // Fast fashion is real taste signal and MYRA keeps it, but it is never
      // sent — saying so here is the only place she would find that out.
      else if (r?.signalOnly) setNote(`MYRA will learn from ${r.signalOnly}, but won’t send it to you. It’s below.`)
      else if (r?.already) setNote(`${r.already} is already on your list.`)
      await refresh()
    } catch {
      setNote('Something went wrong — try again.')
    } finally {
      setBusy(null)
    }
  }

  const add = (name: string) => {
    const clean = name.trim()
    if (!clean) return
    setTyped('')
    void run(`add:${clean.toLowerCase()}`, () => addMyBrand(clean, testMemberId))
  }

  // A brand already hers shouldn't sit in the browse list offering to be added.
  const groups = useMemo(() => view?.groups ?? [], [view])

  if (view === undefined) {
    return <p className={`${label} ${bare ? '' : 'p-6'}`}>Opening your brands…</p>
  }
  if (view === null) {
    return <p className={`${label} ${bare ? '' : 'p-6'}`}>Sign in to see your brands.</p>
  }

  const body = (
    <>
      {!bare && (
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <h2 className={heading}>Your brands</h2>
          <p className={label}>Saved as you go.</p>
        </div>
      )}

      {/* ── Add ────────────────────────────────────────────────────────────── */}
      <div className="mt-6 flex gap-3 flex-wrap sm:flex-nowrap">
        <input
          className={field}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(typed) } }}
          placeholder="Add a brand you love"
          aria-label="Add a brand you love"
        />
        <button
          type="button"
          onClick={() => add(typed)}
          disabled={!typed.trim() || !!busy}
          className={`shrink-0 rounded-full px-9 py-4 text-[clamp(20px,1.1vw,28px)] transition-all ${
            typed.trim() && !busy ? 'bg-[#2B2B2B] text-white hover:scale-[1.03]' : 'bg-white/70 text-[#A8A8A4]'
          }`}
        >
          {busy?.startsWith('add:') ? 'Adding…' : 'Add'}
        </button>
      </div>

      {note && <p className={`${label} myra-guide-text mt-4`}>{note}</p>}

      {/* ── Hers ───────────────────────────────────────────────────────────── */}
      <div className="mt-7">
        {view.favourites.length ? (
          <div className="flex flex-wrap gap-2.5">
            {view.favourites.map((b) => {
              const working = busy === `rm:${b.name.toLowerCase()}` || busy === `io:${b.name.toLowerCase()}`
              return (
                <span
                  key={b.name}
                  className={`${chipBase} inline-flex items-center gap-3 bg-[#2B2B2B] text-white ${working ? 'opacity-50' : ''}`}
                  title={b.why ?? undefined}
                >
                  <span>♥ {b.name}</span>
                  {/* A brand MYRA has no row for cannot reach her looks. Saying
                      so on the chip is the only honest place: everywhere else
                      it looks identical to one that works. */}
                  {!b.stocked && (
                    <span className="text-[clamp(15px,0.8vw,19px)] text-[#D9D9D6]" title="MYRA can’t shop this one yet — your stylist knows">
                      not stocked yet
                    </span>
                  )}
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => void run(`io:${b.name.toLowerCase()}`, () => setMyBrandInputOnly(b.name, true, testMemberId))}
                    className="text-[clamp(15px,0.8vw,19px)] text-[#D9D9D6] hover:text-white"
                    title={`I wear ${b.name}, but don’t send it to me`}
                  >
                    don’t send
                  </button>
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => void run(`rm:${b.name.toLowerCase()}`, () => removeMyBrand(b.name, testMemberId))}
                    className="text-[clamp(18px,1vw,24px)] leading-none hover:opacity-60"
                    aria-label={`Remove ${b.name}`}
                  >
                    ×
                  </button>
                </span>
              )
            })}
          </div>
        ) : (
          <p className={`${label} myra-guide-text`}>
            No brands yet. Add the ones you already love — MYRA works out the rest from them.
          </p>
        )}
      </div>

      {/* ── Wears but doesn't want sent ────────────────────────────────────── */}
      {view.inputOnly.length > 0 && (
        <div className="mt-7">
          <p className={`${label} myra-guide-text`}>You wear these, but don’t want them sent to you.</p>
          <div className="mt-3 flex flex-wrap gap-2.5">
            {view.inputOnly.map((n) => (
              <span key={n} className={`${chipBase} inline-flex items-center gap-3 bg-[#F3E3E3] text-[#9B3A3A]`}>
                <span>{n}</span>
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => void run(`io:${n.toLowerCase()}`, () => setMyBrandInputOnly(n, false, testMemberId))}
                  className="text-[clamp(15px,0.8vw,19px)] hover:opacity-60"
                  title={`Send me ${n} after all`}
                >
                  send it after all
                </button>
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => void run(`rm:${n.toLowerCase()}`, () => removeMyBrand(n, testMemberId))}
                  className="text-[clamp(18px,1vw,24px)] leading-none hover:opacity-60"
                  aria-label={`Remove ${n}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── What MYRA found ───────────────────────────────────────────────── */}
      {view.suggested.length > 0 && (
        <div className="mt-8">
          <p className={`${label} myra-guide-text`}>
            From those, MYRA also looks at these for you. Tap one to make it a favourite too.
          </p>
          <div className="mt-3 flex flex-wrap gap-2.5">
            {view.suggested.map((s) => (
              <button
                key={s.name}
                type="button"
                disabled={!!busy}
                onClick={() => add(s.name)}
                className={quiet}
                title={s.trace ?? undefined}
              >
                + {s.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Asked for, not stocked ────────────────────────────────────────── */}
      {view.requested.length > 0 && (
        <div className="mt-8">
          <p className={`${label} myra-guide-text`}>
            You’ve asked for these and MYRA doesn’t have them yet. Your stylist has them on her list.
          </p>
          <div className="mt-3 flex flex-wrap gap-2.5">
            {view.requested.map((n) => (
              <span key={n} className={`${chipBase} bg-white/60 text-[#8A8F95]`}>{n}</span>
            ))}
          </div>
        </div>
      )}

      {/* ── Browse ────────────────────────────────────────────────────────── */}
      <div className="mt-8">
        <button
          type="button"
          onClick={() => setBrowsing((b) => !b)}
          className={quiet}
        >
          {browsing ? 'Close' : 'Not sure? Browse by look'}
        </button>

        {browsing && (
          <div className="mt-6 space-y-7">
            {groups.map((g) => (
              <div key={g.key}>
                <p className="text-[clamp(22px,1.2vw,30px)] text-[#2B2B2B]">{g.name}</p>
                <p className={`${label} myra-guide-text`}>{g.blurb}</p>
                <div className="mt-3 flex flex-wrap gap-2.5">
                  {g.brands.map((b) => (
                    <button
                      key={b.name}
                      type="button"
                      disabled={b.mine || !!busy}
                      onClick={() => add(b.name)}
                      className={b.mine ? `${chipBase} bg-[#2B2B2B] text-white opacity-60` : quiet}
                      title={b.stocked ? undefined : 'MYRA doesn’t stock this one yet — adding it tells your stylist'}
                    >
                      {b.mine ? '♥ ' : '+ '}{b.name}
                      {!b.stocked && !b.mine && <span className="text-[clamp(14px,0.75vw,18px)] text-[#A8A8A4]"> ·</span>}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )

  if (bare) return <div>{body}</div>
  return <section className={`${card} lg:col-span-2`} data-tour="brands">{body}</section>
}
