'use client'

// ADD BRANDS FOR HER — the fast way to onboard a member from the Taste
// Inspector. The same groups as her own picker (BRAND_GROUPS), each a
// dropdown: open one, SELECT ALL, untick what isn't her, then one save for the
// whole selection. Ticking across several groups and saving once is the point —
// every save re-seeds her brand model, so twelve single adds would take half a
// minute.
//
// Writes go through her own picker's actions (addMyBrands / setMyBrandsNever)
// with her member id, which resolveClientMember honours for the admin only. So
// this is the same write path as /me/welcome: her declared brands, the Zara
// rule for fast fashion, un-hiding, re-seeding — nothing parallel to drift.

import { useEffect, useMemo, useState, useTransition } from 'react'
import { BRAND_GROUPS } from '@/app/onboarding/brand-groups'
import { addMyBrands, loadMyBrands, setMyBrandsNever, type MyBrandsView } from '@/app/me/brand-actions'

const CHIP = 'px-3.5 py-2 rounded-full text-[16px] tracking-[0.06em] border transition-colors'
const CHIP_PICK = `${CHIP} bg-white text-[#4A4E57] border-[#E2E0DB] hover:border-[#0A0A0A]`
const CHIP_PICKED = `${CHIP} bg-[#4A4E57] text-white border-[#4A4E57]`
const CHIP_HERS = `${CHIP} bg-[#0A0A0A] text-white border-[#0A0A0A] cursor-default`
const CHIP_NEVER = `${CHIP} bg-white text-[#B3202A] border-[#B3202A] line-through cursor-default`
const BTN_DARK = 'bg-[#0A0A0A] text-white rounded-full px-5 py-2.5 text-[16px] tracking-[0.1em] hover:opacity-85 transition-opacity disabled:opacity-40'
const BTN_GHOST = 'border border-[#E2E0DB] text-[#4A4E57] rounded-full px-4 py-2 text-[16px] tracking-[0.1em] hover:border-[#0A0A0A] hover:text-[#0A0A0A] transition-colors disabled:opacity-40'
const BTN_NEVER = 'border border-[#B3202A] text-[#B3202A] rounded-full px-4 py-2 text-[16px] tracking-[0.1em] hover:bg-[#B3202A] hover:text-white transition-colors disabled:opacity-40'

const fold = (s: string) => s.trim().toLowerCase()

export default function BrandGroupAdder({ memberId, onSaved }: { memberId: string; onSaved: () => void }) {
  const [view, setView] = useState<MyBrandsView | null>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [picked, setPicked] = useState<Map<string, string>>(new Map())
  const [note, setNote] = useState<string | null>(null)
  const [pending, start] = useTransition()

  useEffect(() => {
    let alive = true
    setPicked(new Map())
    setNote(null)
    void loadMyBrands(memberId).then((v) => { if (alive) setView(v) })
    return () => { alive = false }
  }, [memberId])

  // A brand is hers if she loves it or wears it as input only (the Zara rule).
  const hers = useMemo(() => new Set([
    ...(view?.favourites ?? []).map((b) => fold(b.name)),
    ...(view?.inputOnly ?? []).map(fold),
  ]), [view])
  const never = useMemo(() => new Set((view?.never ?? []).map(fold)), [view])
  const free = (n: string) => !hers.has(fold(n)) && !never.has(fold(n))

  const toggle = (n: string) => setPicked((m) => {
    const next = new Map(m)
    if (next.has(fold(n))) next.delete(fold(n)); else next.set(fold(n), n)
    return next
  })
  const selectAll = (names: string[]) => setPicked((m) => {
    const next = new Map(m)
    for (const n of names) if (free(n)) next.set(fold(n), n)
    return next
  })
  const clearGroup = (names: string[]) => setPicked((m) => {
    const next = new Map(m)
    for (const n of names) next.delete(fold(n))
    return next
  })

  const save = (kind: 'love' | 'never') => {
    const names = Array.from(picked.values())
    if (!names.length) return
    start(async () => {
      const r = kind === 'love' ? await addMyBrands(names, memberId) : await setMyBrandsNever(names, true, memberId)
      if (r?.error) { setNote(r.error); return }
      const parts = [kind === 'love' ? `${names.length} ADDED TO HER BRANDS AND RE-SEEDED` : `${names.length} MARKED NOT FOR HER`]
      if (r?.requested) parts.push(`NOT STOCKED, FILED AS REQUESTS: ${r.requested}`)
      if (r?.signalOnly) parts.push(`TASTE SIGNAL ONLY (FAST FASHION): ${r.signalOnly}`)
      setNote(parts.join(' · ').toUpperCase())
      setPicked(new Map())
      setView(await loadMyBrands(memberId))
      onSaved()
    })
  }

  const selection = Array.from(picked.values())

  return (
    <div className="border border-[#E2E0DB] rounded-[10px] bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <p className="text-[15px] tracking-[0.14em] text-[#4A4E57]">ADD BRANDS FOR HER — BY GROUP</p>
        <p className="text-[14px] tracking-[0.08em] text-[#A8A8A4]">
          OPEN A GROUP · SELECT ALL · UNTICK WHAT ISN’T HER · ONE SAVE FOR EVERYTHING TICKED
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {BRAND_GROUPS.map((g) => {
          const all = [...g.brands, ...(g.more ?? [])]
          const count = all.filter((n) => picked.has(fold(n))).length
          const isOpen = open.has(g.key)
          return (
            <button
              key={g.key}
              onClick={() => setOpen((s) => { const n = new Set(s); isOpen ? n.delete(g.key) : n.add(g.key); return n })}
              className={isOpen ? CHIP_PICKED : CHIP_PICK}
            >
              {g.name.toUpperCase()}{count > 0 && ` · ${count}`} {isOpen ? '▴' : '▾'}
            </button>
          )
        })}
      </div>

      {BRAND_GROUPS.filter((g) => open.has(g.key)).map((g) => {
        const all = [...g.brands, ...(g.more ?? [])]
        const selectable = all.filter(free)
        const allPicked = selectable.length > 0 && selectable.every((n) => picked.has(fold(n)))
        return (
          <div key={g.key} className="mt-4 pt-3 border-t border-[#EFEDE9]">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <p className="text-[15px] tracking-[0.12em] text-[#0A0A0A] mr-1">{g.name.toUpperCase()}</p>
              <p className="text-[14px] tracking-[0.04em] text-[#A8A8A4] mr-2">{g.blurb}</p>
              <button className={BTN_GHOST} disabled={!selectable.length} onClick={() => (allPicked ? clearGroup(all) : selectAll(all))}>
                {allPicked ? 'CLEAR' : `SELECT ALL ${selectable.length}`}
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {all.map((n) => {
                if (hers.has(fold(n))) return <span key={n} className={CHIP_HERS} title="already hers">♥ {n.toUpperCase()}</span>
                if (never.has(fold(n))) return <span key={n} className={CHIP_NEVER} title="not for her">{n.toUpperCase()}</span>
                const on = picked.has(fold(n))
                return (
                  <button key={n} onClick={() => toggle(n)} className={on ? CHIP_PICKED : CHIP_PICK} aria-pressed={on}>
                    {on ? '✓ ' : ''}{n.toUpperCase()}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}

      <div className="mt-4 pt-3 border-t border-[#EFEDE9] flex flex-wrap items-center gap-2">
        <button className={BTN_DARK} disabled={pending || !selection.length} onClick={() => save('love')}>
          {pending ? 'SAVING…' : `ADD ${selection.length} TO HER BRANDS`}
        </button>
        <button className={BTN_NEVER} disabled={pending || !selection.length} onClick={() => save('never')}>
          MARK {selection.length} NOT FOR HER
        </button>
        <button className={BTN_GHOST} disabled={pending || !selection.length} onClick={() => setPicked(new Map())}>CLEAR ALL</button>
        {selection.length > 0 && (
          <p className="text-[14px] tracking-[0.06em] text-[#6B6B6B] basis-full">
            TICKED: {selection.map((n) => n.toUpperCase()).join(' · ')}
          </p>
        )}
        {note && <p className="text-[14px] tracking-[0.08em] text-[#7C838B] basis-full">{note}</p>}
      </div>
    </div>
  )
}
