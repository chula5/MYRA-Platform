'use client'

// YOU — her own room for the things only she can tell MYRA: her name, her
// sizes, the colours she loves and won't wear, and the accounts she has
// connected (each one can be let go of here). Full width, big type, round pills.

import { useEffect, useMemo, useState } from 'react'
import { loadMySettings, myAssistantLink, saveMySettings, type YouSettingsView, type YouSizes } from './settings-actions'
import { disconnectInbox } from './dressing-room/email-actions'
import { disconnectMyCalendar } from './dressing-room/calendar-actions'
import { disconnectArchivalInstagram } from './dressing-room/archival-actions'
import { earlyAccessSignOut } from '@/app/earlyaccess/actions'
import { COLOUR_SHADES, COLOUR_FAMILY_IDS, OCCASION_TYPES, SHAPE_PREFERENCES, PIECE_PREFERENCES } from '@/lib/pilot-stylist'
import { SIZE_CATEGORIES, ladderFor, type SizeCategory } from '@/lib/size-canonical'
import { MirrorLoading } from '@/components/ArchiveCard'
import BrandPicker from '@/components/me/BrandPicker'

const SIZE_LABEL: Record<SizeCategory, string> = { tops: 'Tops & dresses', bottoms: 'Trousers & skirts', outerwear: 'Coats & jackets', shoes: 'Shoes' }

const card = 'rounded-[28px] bg-white/80 shadow-[0_18px_40px_-24px_rgba(43,43,43,0.35)] p-6 sm:p-9'
const heading = 'text-[clamp(26px,1.7vw,40px)] text-[#2B2B2B]'
const label = 'text-[clamp(20px,1.1vw,28px)] text-[#55534E]'
const field = 'w-full rounded-full bg-white px-6 py-4 text-[clamp(20px,1.1vw,28px)] text-[#2B2B2B] shadow-[0_10px_18px_-12px_rgba(120,120,120,0.6)] outline-none border-2 border-transparent focus:border-[#C9C9C9]'
const pill = (on: boolean) =>
  `rounded-full px-5 py-2.5 text-[clamp(18px,1vw,24px)] transition-colors ${on ? 'bg-[#2B2B2B] text-white' : 'bg-white text-[#55534E] hover:text-[#2B2B2B] shadow-[0_8px_16px_-12px_rgba(120,120,120,0.7)]'}`

function when(iso: string | null) {
  if (!iso) return 'not yet'
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export default function YouSettings({ testMemberId, initial }: { testMemberId?: string; initial?: YouSettingsView }) {
  const [view, setView] = useState<YouSettingsView | null | undefined>(initial)
  const [name, setName] = useState(initial?.name ?? '')
  const [sizes, setSizes] = useState<Record<SizeCategory, YouSizes> | null>(initial?.sizes ?? null)
  const [secondHand, setSecondHand] = useState(initial?.acceptsSecondHand ?? false)
  const [loved, setLoved] = useState<string[]>(initial?.coloursLoved ?? [])
  const [avoided, setAvoided] = useState<string[]>(initial?.coloursAvoided ?? [])
  const [shapesLoved, setShapesLoved] = useState<string[]>(initial?.shapesLoved ?? [])
  const [shapesAvoided, setShapesAvoided] = useState<string[]>(initial?.shapesAvoided ?? [])
  const [typesLoved, setTypesLoved] = useState<string[]>(initial?.typesLoved ?? [])
  const [typesAvoided, setTypesAvoided] = useState<string[]>(initial?.typesAvoided ?? [])
  const [neverWears, setNeverWears] = useState(initial?.neverWears ?? '')
  const [occasions, setOccasions] = useState<string[]>(initial?.occasions ?? [])
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  // MYRA inside an assistant: one link she pastes into Claude or ChatGPT.
  const [link, setLink] = useState<{ url: string; days?: number } | null>(null)
  const [linkBusy, setLinkBusy] = useState(false)
  async function makeLink() {
    setLinkBusy(true)
    const r = await myAssistantLink(testMemberId)
    setLinkBusy(false)
    if (r.error || !r.url) { setNote(r.error ?? 'Could not make the link'); return }
    setLink({ url: r.url, days: r.days })
    try { await navigator.clipboard.writeText(r.url) } catch { /* she can copy it herself */ }
  }

  const reset = (v: YouSettingsView) => {
    setName(v.name); setSizes(v.sizes); setSecondHand(v.acceptsSecondHand)
    setLoved(v.coloursLoved); setAvoided(v.coloursAvoided); setNeverWears(v.neverWears); setOccasions(v.occasions)
    setShapesLoved(v.shapesLoved); setShapesAvoided(v.shapesAvoided); setTypesLoved(v.typesLoved); setTypesAvoided(v.typesAvoided)
  }

  useEffect(() => {
    if (initial) return
    let live = true
    void loadMySettings(testMemberId).then((v) => { if (!live) return; setView(v); if (v) reset(v) })
    return () => { live = false }
  }, [testMemberId])

  const dirty = useMemo(() => !!view && (
    name !== view.name || secondHand !== view.acceptsSecondHand || neverWears !== view.neverWears ||
    JSON.stringify(sizes) !== JSON.stringify(view.sizes) ||
    JSON.stringify(occasions) !== JSON.stringify(view.occasions) ||
    JSON.stringify(loved) !== JSON.stringify(view.coloursLoved) || JSON.stringify(avoided) !== JSON.stringify(view.coloursAvoided) ||
    JSON.stringify(shapesLoved) !== JSON.stringify(view.shapesLoved) || JSON.stringify(shapesAvoided) !== JSON.stringify(view.shapesAvoided) ||
    JSON.stringify(typesLoved) !== JSON.stringify(view.typesLoved) || JSON.stringify(typesAvoided) !== JSON.stringify(view.typesAvoided)
  ), [view, name, sizes, secondHand, loved, avoided, neverWears, occasions, shapesLoved, shapesAvoided, typesLoved, typesAvoided])

  if (view === undefined) return <MirrorLoading label="OPENING YOUR SETTINGS" />
  if (view === null || !sizes) return <p className="px-6 sm:px-10 py-16 text-[24px] text-[#55534E]">Sign in to see your settings.</p>

  async function save() {
    setSaving(true); setNote(null)
    const r = await saveMySettings({ name, sizes: sizes!, acceptsSecondHand: secondHand, coloursLoved: loved, coloursAvoided: avoided, occasions, shapesLoved, shapesAvoided, typesLoved, typesAvoided, neverWears }, testMemberId)
    setSaving(false)
    if (r.error) { setNote(r.error); return }
    const fresh = await loadMySettings(testMemberId)
    if (fresh) { setView(fresh); reset(fresh) }
    setNote('Saved')
    setTimeout(() => setNote(null), 2500)
  }

  async function letGo(kind: 'inbox' | 'calendar' | 'instagram', id: string, what: string) {
    if (!window.confirm(`Disconnect ${what}? MYRA stops reading it straight away.`)) return
    setBusy(id)
    const r = kind === 'inbox' ? await disconnectInbox(id, testMemberId)
      : kind === 'calendar' ? await disconnectMyCalendar(id, testMemberId)
      : await disconnectArchivalInstagram(id, testMemberId)
    setBusy(null)
    if (r.error) { setNote(r.error); return }
    const fresh = await loadMySettings(testMemberId)
    if (fresh) setView(fresh)
  }

  const setSize = (c: SizeCategory, key: keyof YouSizes, v: string) =>
    setSizes((cur) => ({ ...cur!, [c]: { ...cur![c], [key]: v === '' ? null : Number(v) } }))

  // A colour is loved, avoided, or neither — tapping moves it along.
  const colourState = (id: string) => (loved.includes(id) ? 'loved' : avoided.includes(id) ? 'avoided' : 'none')
  const cycleColour = (id: string) => {
    const s = colourState(id)
    if (s === 'none') setLoved((l) => [...l, id])
    else if (s === 'loved') { setLoved((l) => l.filter((x) => x !== id)); setAvoided((a) => [...a, id]) }
    else setAvoided((a) => a.filter((x) => x !== id))
  }
  // Shapes and pieces move the same way: love → never → clear.
  const tri = (lovedL: string[], setL: (f: (x: string[]) => string[]) => void, avoidedL: string[], setA: (f: (x: string[]) => string[]) => void) => ({
    state: (id: string) => (lovedL.includes(id) ? 'loved' : avoidedL.includes(id) ? 'avoided' : 'none'),
    cycle: (id: string) => {
      if (lovedL.includes(id)) { setL((l) => l.filter((x) => x !== id)); setA((a) => [...a, id]) }
      else if (avoidedL.includes(id)) setA((a) => a.filter((x) => x !== id))
      else setL((l) => [...l, id])
    },
  })
  const shape = tri(shapesLoved, setShapesLoved, shapesAvoided, setShapesAvoided)
  const piece = tri(typesLoved, setTypesLoved, typesAvoided, setTypesAvoided)
  const titleCase = (t: string) => t.toLowerCase().replace(/(^|\s|\/|-)\S/g, (m) => m.toUpperCase())
  const chip = (st: string) => `rounded-full px-5 py-2.5 text-[clamp(18px,1vw,24px)] transition-colors ${
    st === 'loved' ? 'bg-[#2B2B2B] text-white' : st === 'avoided' ? 'bg-[#F3E3E3] text-[#9B3A3A] line-through' : 'bg-white text-[#55534E] shadow-[0_8px_16px_-12px_rgba(120,120,120,0.7)]'}`
  // Whole colour families she has (e.g. "black"), shown before the shades so saving never loses them.
  const families = COLOUR_FAMILY_IDS.filter((f) => loved.includes(f) || avoided.includes(f))

  const accounts = [
    ...view.inboxes.map((c) => ({ id: c.connection_id, kind: 'inbox' as const, title: c.provider === 'gmail' ? 'Gmail' : 'Email', who: c.email, when: `read ${when(c.last_scanned_at)}` })),
    ...view.calendars.map((c) => ({ id: c.connection_id, kind: 'calendar' as const, title: 'Calendar', who: c.email, when: `checked ${when(c.last_synced_at)}` })),
    ...view.instagram.map((c) => ({ id: c.connection_id, kind: 'instagram' as const, title: 'Instagram', who: c.username ? `@${c.username}` : 'Instagram', when: `synced ${when(c.last_synced_at)}` })),
  ]

  return (
    <div className="myra-pearl min-h-[80vh] px-6 sm:px-10 py-10 sm:py-14">
      <div className="flex items-end justify-between gap-6 flex-wrap mb-8 sm:mb-12">
        <h1 className="text-[clamp(44px,4vw,96px)] leading-none text-[#2B2B2B]">You</h1>
        <div className="flex items-center gap-4">
          {note && <span className="text-[clamp(20px,1.1vw,28px)] text-[#55534E]">{note}</span>}
          <button type="button" onClick={save} disabled={!dirty || saving}
            className={`rounded-full px-9 py-4 text-[clamp(20px,1.1vw,28px)] transition-all ${dirty ? 'bg-[#2B2B2B] text-white hover:scale-[1.03]' : 'bg-white/70 text-[#A8A8A4]'}`}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <div className="grid gap-6 sm:gap-8 lg:grid-cols-2">
        {/* Name */}
        <section className={card}>
          <h2 className={heading}>Your name</h2>
          <input className={`${field} mt-5`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
          <label className="mt-8 flex items-center justify-between gap-6 cursor-pointer">
            <span className={label}>Show me pre-loved and vintage pieces</span>
            <button type="button" role="switch" aria-checked={secondHand} onClick={() => setSecondHand((s) => !s)}
              className={`relative shrink-0 w-[76px] h-[42px] rounded-full transition-colors ${secondHand ? 'bg-[#2B2B2B]' : 'bg-[#D9D9D6]'}`}>
              <span className={`absolute top-[5px] w-[32px] h-[32px] rounded-full bg-white shadow transition-all ${secondHand ? 'left-[39px]' : 'left-[5px]'}`} />
            </button>
          </label>
        </section>

        {/* Sizes */}
        <section className={card}>
          <h2 className={heading}>Your sizes <span className="text-[#A8A8A4]">(UK)</span></h2>
          <div className="mt-5 space-y-4">
            {SIZE_CATEGORIES.map((c) => (
              <div key={c} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3">
                <span className={label}>{SIZE_LABEL[c]}</span>
                <select aria-label={`${SIZE_LABEL[c]} size`} className={`${field} !w-[132px] !px-5 !py-3`} value={sizes[c].value ?? ''} onChange={(e) => setSize(c, 'value', e.target.value)}>
                  <option value="">—</option>
                  {ladderFor(c).map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                <select aria-label={`${SIZE_LABEL[c]} — also wears`} className={`${field} !w-[168px] !px-5 !py-3`} value={sizes[c].adjacent ?? ''} onChange={(e) => setSize(c, 'adjacent', e.target.value)} disabled={sizes[c].value == null}>
                  <option value="">or also…</option>
                  {ladderFor(c).filter((n) => n !== sizes[c].value).map((n) => <option key={n} value={n}>also {n}</option>)}
                </select>
              </div>
            ))}
          </div>
        </section>

        {/* Brands — her own list, and MYRA's read of it. Saves on its own as
            she goes: adding a brand re-seeds her whole brand model server-side,
            which is far too slow to sit behind the Save button that writes her
            sizes. */}
        <BrandPicker testMemberId={testMemberId} />

        {/* What she dresses for — so MYRA never offers a school run to someone whose children are grown. */}
        <section className={`${card} lg:col-span-2`}>
          <div className="flex items-baseline justify-between gap-4 flex-wrap">
            <h2 className={heading}>What you dress for</h2>
            <p className={label}>Tap the ones that are part of your life.</p>
          </div>
          <div className="mt-6 flex flex-wrap gap-2.5">
            {OCCASION_TYPES.map((o) => {
              const on = occasions.includes(o.id)
              return (
                <button key={o.id} type="button" aria-pressed={on}
                  onClick={() => setOccasions((cur) => (cur.includes(o.id) ? cur.filter((x) => x !== o.id) : [...cur, o.id]))}
                  className={chip(on ? 'loved' : 'none')}>
                  {titleCase(o.label)}
                </button>
              )
            })}
          </div>
        </section>

        {/* Colours */}
        <section className={`${card} lg:col-span-2`}>
          <div className="flex items-baseline justify-between gap-4 flex-wrap">
            <h2 className={heading}>Colours</h2>
            <p className={label}>Tap once to love, twice to never see, three times to clear.</p>
          </div>
          <div className="mt-6 flex flex-wrap gap-2.5">
            {families.map((f) => {
              const st = colourState(f)
              return (
                <button key={f} type="button" onClick={() => cycleColour(f)} aria-pressed={st !== 'none'} className={chip(st)}>
                  {st === 'loved' ? '♥ ' : ''}Any {f}
                </button>
              )
            })}
            {COLOUR_SHADES.map((s) => {
              const st = colourState(s.id)
              return (
                <button key={s.id} type="button" onClick={() => cycleColour(s.id)} aria-pressed={st !== 'none'}
                  className={`rounded-full px-5 py-2.5 text-[clamp(18px,1vw,24px)] transition-colors ${
                    st === 'loved' ? 'bg-[#2B2B2B] text-white' : st === 'avoided' ? 'bg-[#F3E3E3] text-[#9B3A3A] line-through' : 'bg-white text-[#55534E] shadow-[0_8px_16px_-12px_rgba(120,120,120,0.7)]'}`}>
                  {st === 'loved' ? '♥ ' : ''}{s.label.toLowerCase().replace(/(^|\s|\/)\S/g, (m) => m.toUpperCase())}
                </button>
              )
            })}
          </div>
          <h3 className={`${label} mt-8`}>Anything you never wear</h3>
          <textarea className={`${field} !rounded-[28px] mt-3 min-h-[110px] resize-y myra-guide-text`} value={neverWears}
            onChange={(e) => setNeverWears(e.target.value)} placeholder="Crop tops, anything too tight on the arms…" />
        </section>

        {/* Shapes */}
        <section className={`${card} lg:col-span-2`}>
          <div className="flex items-baseline justify-between gap-4 flex-wrap">
            <h2 className={heading}>Shapes</h2>
            <p className={label}>Tap once to love, twice to never see, three times to clear.</p>
          </div>
          <div className="mt-6 flex flex-wrap gap-2.5">
            {SHAPE_PREFERENCES.map((s) => {
              const st = shape.state(s.id)
              return (
                <button key={s.id} type="button" onClick={() => shape.cycle(s.id)} aria-pressed={st !== 'none'} className={chip(st)}>
                  {st === 'loved' ? '♥ ' : ''}{titleCase(s.label)}
                </button>
              )
            })}
          </div>
        </section>

        {/* Pieces */}
        <section className={`${card} lg:col-span-2`}>
          <div className="flex items-baseline justify-between gap-4 flex-wrap">
            <h2 className={heading}>Pieces</h2>
            <p className={label}>What you live in, and what you never wear.</p>
          </div>
          <div className="mt-6 flex flex-wrap gap-2.5">
            {PIECE_PREFERENCES.map((p) => {
              const st = piece.state(p.value)
              return (
                <button key={p.value} type="button" onClick={() => piece.cycle(p.value)} aria-pressed={st !== 'none'} className={chip(st)}>
                  {st === 'loved' ? '♥ ' : ''}{titleCase(p.label)}
                </button>
              )
            })}
          </div>
        </section>

        {/* MYRA where she already talks — Claude, ChatGPT. */}
        <section className={`${card} lg:col-span-2`}>
          <div className="flex items-baseline justify-between gap-4 flex-wrap">
            <h2 className={heading}>MYRA in Claude or ChatGPT</h2>
            <p className={label}>Ask for outfits where you already chat.</p>
          </div>
          <p className={`${label} myra-guide-text mt-3 max-w-4xl`}>
            Add this link as a connector and you can ask things like &ldquo;find me an outfit for dinner&rdquo; or
            &ldquo;what can I wear with my navy blazer?&rdquo;. It answers from your wardrobe, your brands and your sizes.
            It can never buy anything, and it never says you liked a look — only you do that.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-4">
            <button type="button" onClick={makeLink} disabled={linkBusy} className={pill(true)}>
              {linkBusy ? 'Making it…' : link ? 'Make a new link' : 'Make my link'}
            </button>
            {link && <span className={label}>Copied. It works for {link.days ?? 30} days — making a new one retires the old.</span>}
          </div>
          {link && (
            <input
              readOnly
              value={link.url}
              onFocus={(e) => e.currentTarget.select()}
              className={`${field} mt-4 !text-[clamp(16px,0.9vw,20px)] myra-guide-text`}
            />
          )}
        </section>

        {/* Connected accounts */}
        <section className={`${card} lg:col-span-2`}>
          <h2 className={heading}>Connected accounts</h2>
          {accounts.length ? (
            <ul className="mt-5 divide-y divide-[#EDEDEA]">
              {accounts.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-4 py-4 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-[clamp(22px,1.2vw,30px)] text-[#2B2B2B]">{a.title}</p>
                    <p className="myra-guide-text text-[clamp(20px,1.05vw,26px)] text-[#55534E] truncate">{a.who} · {a.when}</p>
                  </div>
                  <button type="button" disabled={busy === a.id} onClick={() => letGo(a.kind, a.id, a.who)} className={pill(false)}>
                    {busy === a.id ? 'Disconnecting…' : 'Disconnect'}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className={`${label} mt-4`}>Nothing connected yet. Connect your email or Instagram from your Dressing Room.</p>
          )}
        </section>
      </div>

      {!view.test && (
        <form action={earlyAccessSignOut} className="mt-10 flex justify-end">
          <button type="submit" className={pill(false)}>Sign out</button>
        </form>
      )}
    </div>
  )
}
