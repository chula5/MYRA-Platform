'use client'

// STYLE WORLDS — the brand step, a world at a time.
//
// Chloe, 2026-11-19: members ticked seven to fifteen brands by hand and then
// felt MYRA had little in it ("I didn't tick Sister Jane, but I'd have liked
// the dress"). Ticking brand by brand asks too much. So the first thing she
// sees is the worlds themselves — Parisian, The minimalists, Colour & print —
// each laid out with its brands, and one tap on a world takes ALL of it: the
// names she knows and the nicher labels behind them. Three or four worlds is
// eighty-odd brands, not ten.
//
// She is never walked through worlds she doesn't like: every world is on the
// page at once and she only touches the ones that are hers. A world she
// leaves alone records nothing.
//
// VIEW ALL on any world opens every brand in it, right there in the card.
// SELECT ALL takes the world; then unticking a brand is a real no — it goes
// to her "not for me" list (brands_never), so MYRA never sends it and never
// adds it back. Ticking it again undoes that. In a world she hasn't selected,
// tapping a brand simply loves it on its own.
//
// Choosing brand by brand is still there, for the woman who knows exactly
// what she wants: the grouped picker opens underneath.
//
// Saves run in order, one server call per tap (a whole world is ONE call —
// each save re-seeds her brand model), with the same "never let a stale read
// undo a queued tap" rule as BrandPicker.
//
// The look is the Mirror's: silver panels, round black and white buttons.

import { useEffect, useRef, useState } from 'react'
import {
  loadMyBrands,
  addMyBrands,
  removeMyBrands,
  setMyBrandsNever,
  type MyBrandsView,
  type PickerBrand,
} from '@/app/me/brand-actions'
import BrandPicker from '@/components/me/BrandPicker'

const fold = (s: string) => s.trim().toLowerCase()

const SILVER = 'bg-[linear-gradient(160deg,#F7F7F9_0%,#E9E9EC_55%,#DEDEE2_100%)]'
const PILL_DARK = 'rounded-full bg-[#141414] text-[#F7F6F3] px-[1.4em] py-[0.8em] text-[clamp(15px,0.95vw,20px)] tracking-[0.08em] uppercase hover:opacity-85 transition-opacity'
const PILL_LIGHT = 'rounded-full bg-white text-[#2B2B2B] px-[1.4em] py-[0.8em] text-[clamp(15px,0.95vw,20px)] tracking-[0.08em] uppercase shadow-[0_2px_10px_rgba(43,43,43,0.08)] hover:bg-[#141414] hover:text-[#F7F6F3] transition-colors'

type World = MyBrandsView['groups'][number]

const all = (w: World): PickerBrand[] => [...w.brands, ...w.more]

function Mark({ b, size = 'card' }: { b: PickerBrand; size?: 'card' | 'sheet' }) {
  const [broken, setBroken] = useState(false)
  if (b.logo && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={b.logo}
        alt={b.name}
        loading="lazy"
        onError={() => setBroken(true)}
        className={size === 'card' ? 'max-h-[22px] max-w-[88%] object-contain' : 'max-h-[20px] max-w-[110px] object-contain'}
      />
    )
  }
  return <span className="uppercase tracking-[0.06em] leading-[1.15] text-center">{b.name}</span>
}

export default function StyleWorlds({
  testMemberId,
  onChange,
}: {
  testMemberId?: string
  onChange?: (count: number) => void
}) {
  const [view, setView] = useState<MyBrandsView | null | undefined>(undefined)
  const [loved, setLoved] = useState<Set<string>>(new Set())
  const [never, setNever] = useState<Set<string>>(new Set())
  // Worlds opened with VIEW ALL BRANDS.
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [byBrand, setByBrand] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const pending = useRef(0)

  const adopt = (v: MyBrandsView | null) => {
    setView(v)
    if (!v || pending.current > 0) return
    setLoved(new Set(v.favourites.map((b) => fold(b.name))))
    setNever(new Set(v.never.map(fold)))
    onChange?.(v.favourites.length)
  }

  const reload = () => loadMyBrands(testMemberId).then(adopt).catch(() => undefined)

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testMemberId])

  // Her count follows her taps, not the server's last read.
  useEffect(() => { if (view) onChange?.(loved.size) }, [loved]) // eslint-disable-line react-hooks/exhaustive-deps

  function save(fn: () => Promise<any>) {
    setBusy(true)
    setNote(null)
    pending.current += 1
    queue.current = queue.current.then(async () => {
      try {
        const r = await fn()
        if (r?.error) setNote(r.error)
      } catch {
        setNote('Something went wrong. Try that again.')
      } finally {
        pending.current -= 1
      }
      if (pending.current > 0) return
      try { adopt(await loadMyBrands(testMemberId)) } catch { /* keep what she sees */ }
      if (pending.current === 0) setBusy(false)
    })
  }

  const isLoved = (n: string) => loved.has(fold(n))
  const isNever = (n: string) => never.has(fold(n))
  const lovedIn = (w: World) => all(w).filter((b) => isLoved(b.name)).length
  /** A world is hers once everything in it is either loved or turned down. */
  const chosen = (w: World) => lovedIn(w) > 0 && all(w).every((b) => isLoved(b.name) || isNever(b.name))

  function toggleWorld(w: World) {
    const names = all(w).map((b) => b.name)
    if (chosen(w)) {
      // Taking the world back: its brands leave her list. The ones she turned
      // down stay turned down — that was a real no.
      const drop = names.filter(isLoved)
      setLoved((s) => { const n = new Set(s); drop.forEach((x) => n.delete(fold(x))); return n })
      save(() => removeMyBrands(drop, testMemberId))
      return
    }
    const take = names.filter((x) => !isLoved(x) && !isNever(x))
    setLoved((s) => { const n = new Set(s); take.forEach((x) => n.add(fold(x))); return n })
    if (take.length) save(() => addMyBrands(take, testMemberId))
  }

  /** One brand inside a world. In a world she selected, unticking is a real
   *  no ("not for me"); in one she didn't, a tap just loves or un-loves it. */
  function toggleBrand(name: string, inChosen: boolean) {
    const k = fold(name)
    if (isLoved(name)) {
      setLoved((s) => { const n = new Set(s); n.delete(k); return n })
      if (inChosen) {
        setNever((s) => new Set(s).add(k))
        save(() => setMyBrandsNever([name], true, testMemberId))
      } else {
        save(() => removeMyBrands([name], testMemberId))
      }
    } else {
      setNever((s) => { const n = new Set(s); n.delete(k); return n })
      setLoved((s) => new Set(s).add(k))
      save(() => addMyBrands([name], testMemberId))
    }
  }

  if (view === undefined) return <p className="text-center text-[clamp(18px,1.05vw,26px)] text-[#55534E]">Opening the worlds…</p>
  if (view === null) return <p className="text-center text-[clamp(18px,1.05vw,26px)] text-[#55534E]">Sign in to choose your brands.</p>

  const worlds = view.groups
  const chosenCount = worlds.filter(chosen).length
  const flip = (key: string) => setExpanded((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n })

  return (
    <div className="space-y-6">
      {/* Her count, and the nudge towards more than one world. */}
      <div className="flex items-center justify-center gap-3 flex-wrap">
        <span className={`${SILVER} rounded-full px-5 py-2.5 shadow-[0_8px_20px_-14px_rgba(43,43,43,0.5)] text-[clamp(17px,1.05vw,24px)] text-[#2B2B2B]`}>
          <b className="font-semibold">{loved.size}</b> {loved.size === 1 ? 'brand' : 'brands'} yours
        </span>
        <span className="text-[clamp(16px,1vw,22px)] text-[#6E6B65]">
          {chosenCount === 0 ? 'Most women choose three or four worlds.' : chosenCount < 3 ? `${chosenCount} chosen. Most women choose three or four.` : busy ? 'Saving…' : 'Saved as you go.'}
        </span>
      </div>
      {note && <p className="text-center text-[clamp(16px,1vw,22px)] text-[#9B3A3A]">{note}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
        {worlds.map((w) => {
          const on = chosen(w)
          const list = all(w)
          const some = lovedIn(w)
          const off = list.filter((b) => isNever(b.name)).length
          const isOpen = expanded.has(w.key)
          return (
            <section
              key={w.key}
              className={`${SILVER} relative rounded-[24px] p-5 sm:p-6 flex flex-col gap-4 transition-shadow ${on ? 'ring-2 ring-[#141414] shadow-[0_22px_44px_-26px_rgba(20,20,20,0.6)]' : 'shadow-[0_18px_40px_-28px_rgba(43,43,43,0.45)]'}`}
            >
              <button type="button" onClick={() => toggleWorld(w)} aria-pressed={on} className="text-left flex flex-col gap-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-[clamp(24px,1.6vw,34px)] leading-[1.1] text-[#2B2B2B]">{w.name}</h3>
                    <p className="mt-1 text-[clamp(16px,1vw,22px)] text-[#55534E]">{w.blurb}</p>
                    <p className="mt-1 text-[clamp(15px,0.95vw,20px)] text-[#6E6B65]">
                      {on
                        ? `${some} of ${list.length} yours${off ? ` · ${off} not for you` : ''}`
                        : some ? `${some} of ${list.length} already yours` : `${list.length} brands`}
                    </p>
                  </div>
                  <span
                    aria-hidden
                    className={`shrink-0 grid h-9 w-9 place-items-center rounded-full ${on ? 'bg-[#141414] text-[#F7F6F3]' : 'bg-white text-transparent shadow-[0_2px_10px_rgba(43,43,43,0.1)]'}`}
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16"><path d="M3 8.5l3.2 3.2L13 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </span>
                </div>
                {!isOpen && (
                  <div className="grid grid-cols-3 gap-1.5">
                    {list.slice(0, 6).map((b) => (
                      <div key={b.name} className="h-[52px] rounded-[12px] bg-white/85 grid place-items-center px-2 text-[12px] text-[#2B2B2B]">
                        <Mark b={b} />
                      </div>
                    ))}
                  </div>
                )}
              </button>

              {/* VIEW ALL BRANDS — every brand in the world, tappable. */}
              {isOpen && (
                <div className="flex flex-col gap-3">
                  <p className="text-[clamp(15px,0.95vw,20px)] text-[#55534E]">
                    {on ? 'Untick any brand you don’t like and MYRA won’t send it.' : 'Tap the ones you love, or select them all.'}
                  </p>
                  <div className="flex flex-wrap gap-2" data-lenis-prevent>
                    {list.map((b) => {
                      const yes = isLoved(b.name), no = isNever(b.name)
                      return (
                        <button
                          key={b.name}
                          type="button"
                          onClick={() => toggleBrand(b.name, on)}
                          aria-pressed={yes}
                          className={`inline-flex items-center gap-2 rounded-full min-h-[44px] px-[15px] py-[8px] text-[clamp(15px,0.95vw,20px)] transition-colors ${
                            yes ? 'bg-[#141414] text-[#F7F6F3]' : no ? 'bg-white/60 text-[#8A8F95] line-through decoration-1' : 'bg-white text-[#2B2B2B] shadow-[0_2px_10px_rgba(43,43,43,0.08)]'
                          }`}
                        >
                          {yes && (
                            <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden><path d="M3 8.5l3.2 3.2L13 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          )}
                          <span>{b.name}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between gap-2 flex-wrap">
                <button type="button" onClick={() => flip(w.key)} className={PILL_LIGHT}>
                  {isOpen ? 'Show less' : `View all ${list.length}`}
                </button>
                <button type="button" onClick={() => toggleWorld(w)} aria-pressed={on} className={on ? PILL_DARK : PILL_LIGHT}>
                  {on ? '✓ All selected' : 'Select all'}
                </button>
              </div>
            </section>
          )
        })}
      </div>

      {/* Brand by brand, for the woman who knows exactly which. */}
      <div className="flex flex-col items-center gap-3 pt-2">
        <button type="button" onClick={() => { if (byBrand) void reload(); setByBrand((v) => !v) }} className={PILL_LIGHT}>
          {byBrand ? 'Close the brand list' : 'Rather choose brand by brand?'}
        </button>
      </div>
      {byBrand && (
        <div className={`${SILVER} rounded-[28px] p-6 sm:p-9 shadow-[0_18px_40px_-24px_rgba(43,43,43,0.35)]`}>
          <BrandPicker bare testMemberId={testMemberId} onChange={(n) => { onChange?.(n); if (pending.current === 0) void reload() }} />
        </div>
      )}
    </div>
  )
}
