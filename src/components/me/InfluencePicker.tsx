'use client'

// WHOSE STYLE DO YOU LOVE — a dropdown between PEOPLE and HOUSE STYLES, then
// portraits (or a brand's mark) she recognises and taps, like the brand
// picker. Each one chosen sits on top of her stylist and pulls her looks
// towards that eye. A name that isn't there can be typed: it is kept as hers
// and Chloe writes it up.

import { useEffect, useRef, useState } from 'react'
import FallbackImage from '@/components/FallbackImage'
import {
  addMyInfluence, loadMyInfluences, setMyInfluence,
  type InfluencePickerPerson, type InfluencePickerView, type InfluenceShelf,
} from '@/app/me/influence-actions'

const SHELVES: { id: InfluenceShelf; label: string; blurb: string; placeholder: string }[] = [
  { id: 'people', label: 'PEOPLE', blurb: 'Celebrities, influencers, anyone whose style you love.', placeholder: 'A name or an @handle' },
  { id: 'houses', label: 'HOUSE STYLES', blurb: 'Brands whose whole look you love — MYRA styles you in their spirit, from any shop.', placeholder: 'A brand, e.g. ME+EM' },
]

export default function InfluencePicker({ testMemberId, heading = true, className }: { testMemberId?: string; heading?: boolean; className?: string }) {
  const [view, setView] = useState<InfluencePickerView | null>(null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [shelf, setShelf] = useState<InfluenceShelf>('people')
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    void loadMyInfluences(testMemberId).then((v) => { if (alive) { setView(v); setChosen(new Set(v.chosen)) } })
    return () => { alive = false }
  }, [testMemberId])

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  if (!view || view.error) return null

  const current = SHELVES.find((s) => s.id === shelf)!
  const onShelf = view.people.filter((p) => p.shelf === shelf)
  const countOn = (s: InfluenceShelf) => view.people.filter((p) => p.shelf === s && chosen.has(p.id)).length

  async function toggle(id: string) {
    const on = !chosen.has(id)
    const before = chosen
    const next = new Set(chosen)
    if (on) next.add(id); else next.delete(id)
    setChosen(next)
    setNote(null)
    const r = await setMyInfluence(id, on, testMemberId)
    if (r.error) { setChosen(before); setNote(r.error) } // put it back; nothing was saved
  }

  async function add() {
    if (!typed.trim() || busy) return
    setBusy(true); setNote(null)
    const r = await addMyInfluence(typed, shelf, testMemberId)
    setBusy(false)
    if (r.error || !r.person) { setNote(r.error ?? 'Could not save that — try again'); return }
    const person: InfluencePickerPerson = r.person
    setView((v) => v && ({ ...v, people: [...v.people.filter((p) => p.id !== person.id), person].sort((a, b) => a.name.localeCompare(b.name)) }))
    setChosen((c) => new Set(c).add(person.id))
    if (person.shelf !== shelf) setShelf(person.shelf)
    setTyped('')
    setNote(person.pending ? `${person.name} is saved. MYRA will learn their style shortly.` : `${person.name} added.`)
  }

  return (
    <div className={className}>
      {heading && (
        <div className="text-center mb-6">
          <h2 className="text-[clamp(26px,2.2vw,48px)] text-[#2B2B2B]">Whose style do you love?</h2>
          <p className="text-[clamp(18px,1.1vw,28px)] text-[#4A4E57] mt-2">Tap the people and the brands that inspire you. MYRA styles you with their eye, in pieces you can buy.</p>
        </div>
      )}

      {/* The dropdown: people, or brands' house styles. */}
      <div ref={menuRef} className="relative flex justify-center mb-3">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}
          className="inline-flex items-center gap-3 rounded-full bg-[#2B2B2B] text-white px-7 py-3.5 text-[17px] xl:text-[20px] tracking-[0.14em]">
          {current.label}
          {countOn(shelf) > 0 && <span className="text-white/70">· {countOn(shelf)}</span>}
          <svg viewBox="0 0 12 8" className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden>
            <path d="M1 1l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </button>
        {open && (
          <ul role="listbox" className="absolute top-full mt-2 z-20 min-w-[280px] rounded-[16px] bg-white shadow-[0_18px_40px_-16px_rgba(43,43,43,0.45)] ring-1 ring-[rgba(43,43,43,0.1)] overflow-hidden">
            {SHELVES.map((s) => (
              <li key={s.id}>
                <button type="button" role="option" aria-selected={s.id === shelf}
                  onClick={() => { setShelf(s.id); setOpen(false); setNote(null) }}
                  className={`w-full flex items-center justify-between gap-6 px-6 py-4 text-left text-[17px] xl:text-[19px] tracking-[0.12em] ${s.id === shelf ? 'bg-[#F2F1EE] text-[#2B2B2B]' : 'text-[#4A4E57] hover:bg-[#F7F6F4]'}`}>
                  {s.label}
                  <span className="text-[#7C838B] tracking-normal">{countOn(s.id) ? `${countOn(s.id)} chosen` : ''}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-center text-[16px] xl:text-[19px] text-[#6E6B65] mb-6">{current.blurb}</p>

      {onShelf.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-4">
          {onShelf.map((p) => {
            const on = chosen.has(p.id)
            return (
              <button key={p.id} type="button" onClick={() => toggle(p.id)} aria-pressed={on}
                className={`group text-left rounded-[16px] overflow-hidden bg-white transition-shadow ${on ? 'ring-2 ring-[#2B2B2B] shadow-[0_12px_28px_-16px_rgba(43,43,43,0.6)]' : 'ring-1 ring-[rgba(43,43,43,0.12)] hover:ring-[#7C838B]'}`}>
                <div className="relative aspect-[3/4] bg-[#E4E2DD]">
                  {p.image_url ? (
                    <FallbackImage src={p.image_url} thumbWidth={500} alt="" className="absolute inset-0 w-full h-full object-cover object-top" />
                  ) : p.logo_url ? (
                    <div className="absolute inset-0 grid place-items-center bg-[#F2F1EE] p-8">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.logo_url} alt="" className="max-w-full max-h-[40%] object-contain" />
                    </div>
                  ) : (
                    <div className="absolute inset-0 grid place-items-center bg-[linear-gradient(160deg,#ECEDEF,#D5D8DC)] px-4 text-center">
                      <span className="text-[22px] xl:text-[26px] tracking-[0.12em] uppercase text-[#2B2B2B] leading-tight">{p.name}</span>
                    </div>
                  )}
                  <span className={`absolute top-3 right-3 grid place-items-center w-10 h-10 rounded-full text-[20px] ${on ? 'bg-[#2B2B2B] text-white' : 'bg-white/90 text-[#7C838B]'}`}>
                    {on ? '♥' : '♡'}
                  </span>
                </div>
                <p className="px-3 pt-3 pb-1 text-[19px] xl:text-[20px] text-[#2B2B2B] leading-tight">{p.name}</p>
                <p className="px-3 pb-3 text-[15px] text-[#7C838B]">{p.pending ? 'MYRA is learning their style' : ' '}</p>
              </button>
            )
          })}
        </div>
      )}

      {/* Not there? Type it. */}
      <form onSubmit={(e) => { e.preventDefault(); void add() }}
        className="mt-6 flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 max-w-[720px] mx-auto">
        <label className="sr-only" htmlFor="influence-add">{shelf === 'houses' ? 'Add a brand' : 'Add a person'}</label>
        <input id="influence-add" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={current.placeholder} maxLength={60}
          className="flex-1 rounded-full bg-white ring-1 ring-[rgba(43,43,43,0.18)] focus:ring-[#2B2B2B] outline-none px-6 py-3.5 text-[17px] xl:text-[19px] text-[#2B2B2B] placeholder:text-[#9A9EA4]" />
        <button type="submit" disabled={busy || !typed.trim()}
          className="rounded-full bg-white ring-1 ring-[#2B2B2B] px-7 py-3.5 text-[16px] xl:text-[18px] tracking-[0.14em] text-[#2B2B2B] disabled:opacity-40 hover:bg-[#2B2B2B] hover:text-white transition-colors">
          {busy ? 'ADDING…' : shelf === 'houses' ? 'ADD THIS BRAND' : 'ADD THIS PERSON'}
        </button>
      </form>
      {note && <p className="text-center mt-3 text-[16px] xl:text-[18px] text-[#4A4E57]" role="status">{note}</p>}
    </div>
  )
}
