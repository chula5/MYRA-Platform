'use client'

// YOUR BRANDS — the grouped picker.
//
// Chloe's brief (2026-10-17): asking someone to think of brands on the spot is
// hard. So she is never asked to think of one. The brands MYRA knows are laid
// out in groups she will recognise — "Quiet luxury", "The houses", "Parisian",
// "Second-hand & vintage" — and she taps the ones she knows, or takes a whole
// group with LOVE ALL and drops the odd one with ×. The same screen has a
// second side, "✕ Not for me", for anything she would never wear.
//
// Two modes, one tap. In LOVE mode a tap loves a brand (black chip) and × on
// a loved chip drops it. In NOT FOR ME mode a tap marks a brand red; × clears
// it. A brand is in exactly one of the three states: loved, not for me, or
// neither. LOVE ALL / NONE OF THESE acts on the brands showing in that group.
//
// Every tap is saved at once — optimistically in the UI, then re-read from the
// server. A whole group is one server call, because each save re-seeds her
// brand model and twelve of them would take half a minute.
//
// Naming a brand MYRA does not stock is not an error and is never refused. It
// is filed as a request her stylist sees, marked with a small · on the chip,
// and she is told plainly that it is noted but cannot be shopped yet.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  loadMyBrands,
  addMyBrands,
  removeMyBrands,
  setMyBrandsNever,
  setMyBrandInputOnly,
  type MyBrandsView,
  type PickerBrand,
} from '@/app/me/brand-actions'

const card = 'rounded-[28px] bg-white/80 shadow-[0_18px_40px_-24px_rgba(43,43,43,0.35)] p-6 sm:p-9'
const heading = 'text-[clamp(26px,1.7vw,40px)] text-[#2B2B2B]'
const label = 'text-[clamp(18px,1.05vw,26px)] text-[#55534E]'
const field = 'w-full rounded-full bg-white px-6 py-4 text-[clamp(18px,1.1vw,26px)] text-[#2B2B2B] shadow-[0_10px_18px_-12px_rgba(120,120,120,0.6)] outline-none border-2 border-transparent focus:border-[#C9C9C9]'
const chipBase = 'inline-flex items-center gap-2.5 rounded-full px-[18px] py-[11px] text-[clamp(16px,1.02vw,23px)] leading-[1.1] transition-colors text-left'
const chipNone = `${chipBase} bg-white text-[#55534E] shadow-[0_8px_16px_-12px_rgba(120,120,120,0.7)]`
const chipLove = `${chipBase} bg-[#2B2B2B] text-white`
const chipNever = `${chipBase} bg-[#F3E3E3] text-[#9B3A3A] line-through decoration-1`
const groupBtn = 'shrink-0 rounded-full px-4 py-2.5 text-[clamp(15px,0.95vw,20px)] tracking-[0.08em] whitespace-nowrap transition-colors'

type Mode = 'love' | 'never'

const fold = (s: string) => s.trim().toLowerCase()

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
  const [mode, setMode] = useState<Mode>('love')
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())
  // Optimistic state: what she has tapped, shown at once, reconciled from the
  // server after every save. Keys are folded names.
  const [loved, setLoved] = useState<Map<string, string>>(new Map())
  const [never, setNever] = useState<Map<string, string>>(new Map())
  const queue = useRef<Promise<unknown>>(Promise.resolve())

  const adopt = (v: MyBrandsView | null) => {
    setView(v)
    if (!v) return
    setLoved(new Map(v.favourites.map((b) => [fold(b.name), b.name])))
    setNever(new Map(v.never.map((n) => [fold(n), n])))
    onChange?.(v.favourites.length)
  }

  useEffect(() => {
    let alive = true
    void loadMyBrands(testMemberId).then((v) => { if (alive) adopt(v) })
    return () => { alive = false }
    // onChange is a parent callback; re-running on its identity would reload
    // her brands on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testMemberId])

  /** Saves run one after another in the order she tapped, and the list is
   *  re-read from the server after each — so a quick double tap never races. */
  function save(fn: () => Promise<any>) {
    setBusy(true)
    setNote(null)
    queue.current = queue.current.then(async () => {
      try {
        const r = await fn()
        if (r?.error) setNote(r.error)
        else if (r?.requested) setNote(`MYRA doesn’t have ${r.requested} yet — your stylist has been told you want it.`)
        else if (r?.signalOnly) setNote(`MYRA will learn from ${r.signalOnly}, but won’t send it to you.`)
        else if (r?.already) setNote(`${r.already} is already on your list.`)
        adopt(await loadMyBrands(testMemberId))
      } catch {
        setNote('Something went wrong — try again.')
      } finally {
        setBusy(false)
      }
    })
  }

  const isLoved = (n: string) => loved.has(fold(n))
  const isNever = (n: string) => never.has(fold(n))

  /** One tap on a chip. What it does depends on the chip's state and the mode. */
  function tap(name: string) {
    const k = fold(name)
    if (isLoved(name)) {
      // × on a loved chip. In NOT FOR ME mode the tap also marks it.
      setLoved((m) => { const n = new Map(m); n.delete(k); return n })
      if (mode === 'never') { setNever((m) => new Map(m).set(k, name)); save(() => setMyBrandsNever([name], true, testMemberId)) }
      else save(() => removeMyBrands([name], testMemberId))
      return
    }
    if (isNever(name)) {
      setNever((m) => { const n = new Map(m); n.delete(k); return n })
      if (mode === 'love') { setLoved((m) => new Map(m).set(k, name)); save(() => addMyBrands([name], testMemberId)) }
      else save(() => setMyBrandsNever([name], false, testMemberId))
      return
    }
    if (mode === 'love') { setLoved((m) => new Map(m).set(k, name)); save(() => addMyBrands([name], testMemberId)) }
    else { setNever((m) => new Map(m).set(k, name)); save(() => setMyBrandsNever([name], true, testMemberId)) }
  }

  /** LOVE ALL / NONE OF THESE on the brands showing in a group — one save. */
  function takeGroup(names: string[]) {
    const target = mode === 'love' ? isLoved : isNever
    const every = names.every(target)
    if (every) {
      // Second press undoes it.
      if (mode === 'love') { setLoved((m) => { const n = new Map(m); names.forEach((x) => n.delete(fold(x))); return n }); save(() => removeMyBrands(names, testMemberId)) }
      else { setNever((m) => { const n = new Map(m); names.forEach((x) => n.delete(fold(x))); return n }); save(() => setMyBrandsNever(names, false, testMemberId)) }
      return
    }
    const rest = names.filter((x) => !target(x))
    if (mode === 'love') {
      setLoved((m) => { const n = new Map(m); rest.forEach((x) => n.set(fold(x), x)); return n })
      setNever((m) => { const n = new Map(m); rest.forEach((x) => n.delete(fold(x))); return n })
      save(() => addMyBrands(rest, testMemberId))
    } else {
      setNever((m) => { const n = new Map(m); rest.forEach((x) => n.set(fold(x), x)); return n })
      setLoved((m) => { const n = new Map(m); rest.forEach((x) => n.delete(fold(x))); return n })
      save(() => setMyBrandsNever(rest, true, testMemberId))
    }
  }

  function addTyped() {
    const name = typed.trim()
    if (!name) return
    setTyped('')
    if (mode === 'love') { setLoved((m) => new Map(m).set(fold(name), name)); save(() => addMyBrands([name], testMemberId)) }
    else { setNever((m) => new Map(m).set(fold(name), name)); save(() => setMyBrandsNever([name], true, testMemberId)) }
  }

  const groups = useMemo(() => view?.groups ?? [], [view])
  const stockedByKey = useMemo(() => {
    const m = new Map<string, boolean>()
    for (const g of groups) for (const b of [...g.brands, ...g.more]) m.set(fold(b.name), b.stocked)
    for (const f of view?.favourites ?? []) m.set(fold(f.name), f.stocked)
    return m
  }, [groups, view])

  if (view === undefined) {
    return <p className={`${label} ${bare ? '' : 'p-6'}`}>Opening your brands…</p>
  }
  if (view === null) {
    return <p className={`${label} ${bare ? '' : 'p-6'}`}>Sign in to see your brands.</p>
  }

  const chip = (b: PickerBrand | { name: string }) => {
    const on = isLoved(b.name), off = isNever(b.name)
    const stocked = stockedByKey.get(fold(b.name)) ?? true
    return (
      <button
        key={b.name}
        type="button"
        onClick={() => tap(b.name)}
        aria-pressed={on || off}
        className={on ? chipLove : off ? chipNever : chipNone}
        title={!stocked && !on && !off ? 'MYRA doesn’t stock this one yet — naming it tells your stylist' : on && !stocked ? 'MYRA can’t shop this one yet — your stylist knows' : undefined}
      >
        {on && <span className="opacity-85">♥</span>}
        {off && <span className="opacity-85">✕</span>}
        <span>{b.name}</span>
        {(on || off) && <span className="text-[1.1em] leading-none opacity-60" aria-hidden>×</span>}
        {!on && !off && !stocked && <span className="text-[#A8A8A4] -ml-1" aria-hidden>·</span>}
      </button>
    )
  }

  const lovedList = Array.from(loved.values())
  const neverList = Array.from(never.values())

  const body = (
    <>
      {!bare && (
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <h2 className={heading}>Your brands</h2>
          <p className={label}>Saved as you go.</p>
        </div>
      )}

      {/* ── Mode ─────────────────────────────────────────────────────────── */}
      <div className={`${bare ? '' : 'mt-6'} flex flex-col items-center gap-3`}>
        <div className="inline-flex rounded-full bg-white/75 p-[5px] shadow-[0_10px_24px_-16px_rgba(43,43,43,0.5)]" role="tablist" aria-label="Love or not for me">
          <button type="button" role="tab" aria-selected={mode === 'love'} onClick={() => setMode('love')}
            className={`rounded-full px-5 py-3 text-[clamp(17px,1.05vw,24px)] transition-colors ${mode === 'love' ? 'bg-[#2B2B2B] text-white' : 'text-[#55534E]'}`}>
            ♥&nbsp; I love these
          </button>
          <button type="button" role="tab" aria-selected={mode === 'never'} onClick={() => setMode('never')}
            className={`rounded-full px-5 py-3 text-[clamp(17px,1.05vw,24px)] transition-colors ${mode === 'never' ? 'bg-[#9B3A3A] text-white' : 'text-[#55534E]'}`}>
            ✕&nbsp; Not for me
          </button>
        </div>
        <p className={`${label} myra-guide-text text-center`}>
          {mode === 'love' ? 'Tap a brand to love it, or take a whole group. Tap × to drop one.' : 'Tap anything you’d never wear. MYRA won’t send it.'}
        </p>
      </div>

      {/* ── Type one ─────────────────────────────────────────────────────── */}
      <div className="mt-5 flex gap-3">
        <input
          className={field}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTyped() } }}
          placeholder="Looking for one that isn’t here? Type it"
          aria-label="Add a brand"
        />
        <button
          type="button"
          onClick={addTyped}
          disabled={!typed.trim()}
          className={`shrink-0 rounded-full px-7 py-4 text-[clamp(18px,1.1vw,26px)] transition-all ${
            typed.trim() ? (mode === 'love' ? 'bg-[#2B2B2B]' : 'bg-[#9B3A3A]') + ' text-white hover:scale-[1.03]' : 'bg-white/70 text-[#A8A8A4]'
          }`}
        >
          Add
        </button>
      </div>

      {note && <p className={`${label} myra-guide-text mt-4`}>{note}</p>}

      {/* ── Groups ───────────────────────────────────────────────────────── */}
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
        {groups.map((g) => {
          const showMore = open.has(g.key)
          const showing = showMore ? [...g.brands, ...g.more] : g.brands
          const names = showing.map((b) => b.name)
          const target = mode === 'love' ? isLoved : isNever
          const every = names.length > 0 && names.every(target)
          const groupLabel = mode === 'love' ? (every ? '✓ ALL LOVED' : 'LOVE ALL') : (every ? '✓ NONE OF THESE' : 'NONE OF THESE')
          return (
            <section key={g.key} className="rounded-[24px] bg-white/80 shadow-[0_18px_40px_-28px_rgba(43,43,43,0.35)] p-5 sm:p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-[clamp(22px,1.45vw,32px)] leading-[1.15] text-[#2B2B2B]">{g.name}</h3>
                  <p className={`${label} myra-guide-text mt-1`}>{g.blurb}</p>
                </div>
                <button type="button" onClick={() => takeGroup(names)}
                  className={`${groupBtn} ${every ? 'bg-[#EFEFF1] text-[#7C838B]' : 'bg-white text-[#2B2B2B] shadow-[0_8px_16px_-12px_rgba(120,120,120,0.8)]'}`}>
                  {groupLabel}
                </button>
              </div>
              <div className="mt-4 flex flex-wrap gap-2.5">
                {showing.map(chip)}
                {g.more.length > 0 && (
                  <button type="button" onClick={() => setOpen((s) => { const n = new Set(s); showMore ? n.delete(g.key) : n.add(g.key); return n })}
                    className={`${chipBase} bg-transparent text-[#7C838B] underline underline-offset-4 decoration-[#C9C9C9]`}>
                    {showMore ? 'fewer' : `+ ${g.more.length} more`}
                  </button>
                )}
              </div>
            </section>
          )
        })}
      </div>

      {/* ── Hers ─────────────────────────────────────────────────────────── */}
      <div className="mt-7 rounded-[24px] bg-white/80 p-5 sm:p-6">
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <h3 className="text-[clamp(22px,1.45vw,32px)] text-[#2B2B2B]">Yours</h3>
          <p className={`${label} myra-guide-text`}>{busy ? 'Saving…' : 'Saved as you go. Change them any time in YOU.'}</p>
        </div>
        {lovedList.length || neverList.length ? (
          <div className="mt-4 flex flex-wrap gap-2.5">
            {lovedList.map((n) => chip({ name: n }))}
            {neverList.map((n) => chip({ name: n }))}
          </div>
        ) : (
          <p className={`${label} myra-guide-text mt-3`}>Nothing yet. Tap the brands you recognise above.</p>
        )}
        {lovedList.some((n) => stockedByKey.get(fold(n)) === false) && (
          <p className={`${label} myra-guide-text mt-3 text-[#8A8F95]`}>
            A brand with a · is one MYRA can’t shop yet. Your stylist has it on her list.
          </p>
        )}
      </div>

      {/* ── Wears but doesn't want sent ────────────────────────────────────── */}
      {view.inputOnly.length > 0 && (
        <div className="mt-7">
          <p className={`${label} myra-guide-text`}>You wear these, but don’t want them sent to you.</p>
          <div className="mt-3 flex flex-wrap gap-2.5">
            {view.inputOnly.map((n) => (
              <span key={n} className={`${chipBase} bg-[#F3E3E3] text-[#9B3A3A]`}>
                <span>{n}</span>
                <button type="button" onClick={() => save(() => setMyBrandInputOnly(n, false, testMemberId))}
                  className="text-[clamp(15px,0.8vw,19px)] hover:opacity-60" title={`Send me ${n} after all`}>
                  send it after all
                </button>
                <button type="button" onClick={() => save(() => removeMyBrands([n], testMemberId))}
                  className="text-[1.1em] leading-none hover:opacity-60" aria-label={`Remove ${n}`}>×</button>
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
            {view.suggested.filter((s) => !isLoved(s.name) && !isNever(s.name)).map((s) => (
              <button key={s.name} type="button" onClick={() => tap(s.name)} className={chipNone} title={s.trace ?? undefined}>
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
    </>
  )

  if (bare) return <div>{body}</div>
  return <section className={`${card} lg:col-span-2`} data-tour="brands">{body}</section>
}
