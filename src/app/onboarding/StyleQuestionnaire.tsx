'use client'

// The style questionnaire — eight screens between the brand picker and the
// rating swipes. One question per screen, every one skippable, in the same
// visual language as the rest of onboarding.
//
// Four of these answers are HARD constraints (colours she won't wear, lengths
// she won't show, heels, spend) and mask inventory absolutely. The rest are
// soft and only nudge the taste vector — see lib/style-profile.ts.

import { useState } from 'react'
import type { ColourFamily } from '@/types/database'
import {
  PROFILE_COLOURS,
  LENGTH_NO_GO_OPTIONS,
  HEEL_OPTIONS,
  OCCASION_OPTIONS,
  FREQUENCY_OPTIONS,
  PRICE_BANDS,
  type ClientStyleProfile,
  type Frequency,
  type HeelPreference,
  type LengthNoGo,
  type OccasionKey,
} from '@/lib/style-profile'

export type StyleAnswers = Partial<Omit<ClientStyleProfile, 'user_id'>>

const TOTAL = 8

const cardBase =
  'rounded-[12px] border text-[13px] tracking-[0.045em] transition-all duration-200 px-4 py-4'
const cardOn = 'border-[#0A0A0A] bg-[#0A0A0A] text-white'
const cardOff = 'border-[#E2E0DB] bg-white text-[#4A4E57] hover:border-[#0A0A0A]'

function Screen({
  eyebrow,
  title,
  hint,
  children,
}: {
  eyebrow: string
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="text-center mb-10">
        <p className="text-[11px] tracking-[0.113em] text-[#6B6B6B] mb-3">{eyebrow}</p>
        <h1 className="text-[clamp(22px,3vw,32px)] tracking-[0.036em] text-[#4A4E57] leading-tight mb-3">{title}</h1>
        {hint && (
          <p className="text-[11px] tracking-[0.054em] text-[#A8A8A4] leading-relaxed max-w-[440px] mx-auto">{hint}</p>
        )}
      </div>
      {children}
    </div>
  )
}

// 1–5 scale with named ends — used for fit and pattern appetite.
function Scale({
  value,
  onChange,
  lowLabel,
  highLabel,
}: {
  value: number | null
  onChange: (v: number) => void
  lowLabel: string
  highLabel: string
}) {
  return (
    <div>
      <div className="grid grid-cols-5 gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            onClick={() => onChange(n)}
            className={`${cardBase} ${value === n ? cardOn : cardOff} text-center`}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="flex justify-between mt-2 px-1">
        <span className="text-[9px] tracking-[0.09em] text-[#A8A8A4]">{lowLabel}</span>
        <span className="text-[9px] tracking-[0.09em] text-[#A8A8A4]">{highLabel}</span>
      </div>
    </div>
  )
}

export default function StyleQuestionnaire({
  onComplete,
  onBack,
}: {
  onComplete: (answers: StyleAnswers) => void
  onBack: () => void
}) {
  const [screen, setScreen] = useState(1)

  const [colourNever, setColourNever] = useState<ColourFamily[]>([])
  const [colourLoved, setColourLoved] = useState<ColourFamily[]>([])
  const [fitTop, setFitTop] = useState<number | null>(null)
  const [fitBottom, setFitBottom] = useState<number | null>(null)
  const [lengthNoGo, setLengthNoGo] = useState<LengthNoGo[]>([])
  const [heel, setHeel] = useState<HeelPreference | null>(null)
  const [pattern, setPattern] = useState<number | null>(null)
  const [occasions, setOccasions] = useState<Partial<Record<OccasionKey, Frequency>>>({})
  const [priceTiers, setPriceTiers] = useState<number[]>([])
  const [brandsMissed, setBrandsMissed] = useState('')
  const [notes, setNotes] = useState('')

  const toggle = <T,>(list: T[], v: T, set: (x: T[]) => void) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  function finish() {
    const tiers = priceTiers.slice().sort((a, b) => a - b)
    onComplete({
      colour_never: colourNever,
      colour_loved: colourLoved,
      fit_top: fitTop,
      fit_bottom: fitBottom,
      length_no_go: lengthNoGo,
      heel_preference: heel,
      pattern_appetite: pattern,
      occasion_mix: occasions,
      // Contiguous or not, the comfortable span is first-to-last selected band.
      price_comfort: tiers.length ? [tiers[0], tiers[tiers.length - 1]] : null,
      brands_missed: brandsMissed,
      notes,
    })
  }

  const next = () => (screen >= TOTAL ? finish() : setScreen(screen + 1))
  const back = () => (screen === 1 ? onBack() : setScreen(screen - 1))

  return (
    <div>
      {/* Sub-progress within the questionnaire */}
      <div className="flex items-center justify-center gap-1.5 mb-8">
        {Array.from({ length: TOTAL }, (_, i) => i + 1).map((s) => (
          <span
            key={s}
            className={`h-1 rounded-full transition-all duration-300 ${
              s === screen ? 'w-6 bg-[#4A4E57]' : s < screen ? 'w-1 bg-[#4A4E57]' : 'w-1 bg-[#E2E0DB]'
            }`}
          />
        ))}
      </div>

      {screen === 1 && (
        <Screen
          eyebrow="YOUR COLOURS"
          title="ANY COLOURS YOU NEVER REACH FOR?"
          hint="We'll keep these out of everything we show you. Skip if nothing's off the table."
        >
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5 max-w-[560px] mx-auto">
            {PROFILE_COLOURS.map((c) => {
              const active = colourNever.includes(c.value)
              return (
                <button
                  key={c.value}
                  onClick={() => toggle(colourNever, c.value, setColourNever)}
                  className={`${cardBase} ${active ? cardOn : cardOff} flex items-center gap-2 !text-[11px]`}
                >
                  <span
                    className="w-3.5 h-3.5 rounded-full border border-[#E2E0DB] shrink-0"
                    style={{ background: c.swatch }}
                  />
                  {c.label}
                </button>
              )
            })}
          </div>
        </Screen>
      )}

      {screen === 2 && (
        <Screen
          eyebrow="YOUR COLOURS"
          title="AND THE ONES YOU GRAVITATE TO?"
          hint="The colours you feel most yourself in."
        >
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5 max-w-[560px] mx-auto">
            {PROFILE_COLOURS.filter((c) => !colourNever.includes(c.value)).map((c) => {
              const active = colourLoved.includes(c.value)
              return (
                <button
                  key={c.value}
                  onClick={() => toggle(colourLoved, c.value, setColourLoved)}
                  className={`${cardBase} ${active ? cardOn : cardOff} flex items-center gap-2 !text-[11px]`}
                >
                  <span
                    className="w-3.5 h-3.5 rounded-full border border-[#E2E0DB] shrink-0"
                    style={{ background: c.swatch }}
                  />
                  {c.label}
                </button>
              )
            })}
          </div>
        </Screen>
      )}

      {screen === 3 && (
        <Screen
          eyebrow="THE WAY THINGS SIT"
          title="HOW DO YOU LIKE THINGS TO FIT?"
          hint="There's no right answer — it just tells us how to cut your feed."
        >
          <div className="max-w-[480px] mx-auto space-y-8">
            <div>
              <p className="text-[10px] tracking-[0.113em] text-[#6B6B6B] mb-3">ON TOP</p>
              <Scale value={fitTop} onChange={setFitTop} lowLabel="CLOSE TO THE BODY" highLabel="OVERSIZED" />
            </div>
            <div>
              <p className="text-[10px] tracking-[0.113em] text-[#6B6B6B] mb-3">ON THE BOTTOM</p>
              <Scale value={fitBottom} onChange={setFitBottom} lowLabel="FITTED" highLabel="FULL & RELAXED" />
            </div>
          </div>
        </Screen>
      )}

      {screen === 4 && (
        <Screen
          eyebrow="WHAT YOU'D RATHER NOT"
          title="ANYTHING YOU'D RATHER NOT WEAR?"
          hint="We'll never put these in front of you."
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-w-[520px] mx-auto">
            {LENGTH_NO_GO_OPTIONS.map((o) => {
              const active = lengthNoGo.includes(o.value)
              return (
                <button
                  key={o.value}
                  onClick={() => toggle(lengthNoGo, o.value, setLengthNoGo)}
                  className={`${cardBase} ${active ? cardOn : cardOff} !text-[12px] text-left`}
                >
                  {o.label}
                </button>
              )
            })}
          </div>
        </Screen>
      )}

      {screen === 5 && (
        <Screen eyebrow="ON YOUR FEET" title="WHERE DO YOU STAND ON HEELS?" hint="We'll shoe every outfit accordingly.">
          <div className="grid grid-cols-1 gap-2.5 max-w-[420px] mx-auto">
            {HEEL_OPTIONS.map((o) => {
              const active = heel === o.value
              return (
                <button
                  key={o.value}
                  onClick={() => setHeel(active ? null : o.value)}
                  className={`${cardBase} ${active ? cardOn : cardOff} text-left`}
                >
                  <span className="block">{o.label}</span>
                  <span className={`block text-[10px] tracking-[0.054em] mt-1 ${active ? 'text-white/60' : 'text-[#A8A8A4]'}`}>
                    {o.hint}
                  </span>
                </button>
              )
            })}
          </div>
        </Screen>
      )}

      {screen === 6 && (
        <Screen
          eyebrow="PRINT & PATTERN"
          title="HOW MUCH PATTERN DO YOU WEAR?"
          hint="From quietly plain to a print worth remembering."
        >
          <div className="max-w-[480px] mx-auto">
            <Scale value={pattern} onChange={setPattern} lowLabel="SOLID COLOUR ONLY" highLabel="LOVE A STATEMENT PRINT" />
          </div>
        </Screen>
      )}

      {screen === 7 && (
        <Screen
          eyebrow="YOUR WEEK"
          title="WHERE DO YOUR CLOTHES ACTUALLY GO?"
          hint="So the feed matches your life, not an imagined one."
        >
          <div className="max-w-[560px] mx-auto space-y-2.5">
            {OCCASION_OPTIONS.map((o) => (
              <div key={o.value} className="flex items-center justify-between gap-3 border border-[#E2E0DB] rounded-[12px] px-4 py-3">
                <span className="text-[12px] tracking-[0.045em] text-[#4A4E57]">{o.label}</span>
                <div className="flex gap-1.5 shrink-0">
                  {FREQUENCY_OPTIONS.map((f) => {
                    const active = occasions[o.value] === f.value
                    return (
                      <button
                        key={f.value}
                        onClick={() =>
                          setOccasions((prev) => {
                            const nextMix = { ...prev }
                            if (active) delete nextMix[o.value]
                            else nextMix[o.value] = f.value
                            return nextMix
                          })
                        }
                        className={`text-[9px] tracking-[0.09em] px-2.5 py-1.5 rounded-full border transition-colors ${
                          active
                            ? 'bg-[#0A0A0A] text-white border-[#0A0A0A]'
                            : 'bg-white text-[#6B6B6B] border-[#E2E0DB] hover:border-[#0A0A0A]'
                        }`}
                      >
                        {f.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </Screen>
      )}

      {screen === 8 && (
        <Screen
          eyebrow="THE LAST ONE"
          title="WHAT DO YOU USUALLY SPEND ON A DRESS OR COAT?"
          hint="Pick every band that feels comfortable. We'll stay inside it."
        >
          <div className="max-w-[480px] mx-auto space-y-2.5 mb-8">
            {PRICE_BANDS.map((b) => {
              const active = priceTiers.includes(b.tier)
              return (
                <button
                  key={b.tier}
                  onClick={() => toggle(priceTiers, b.tier, setPriceTiers)}
                  className={`${cardBase} ${active ? cardOn : cardOff} w-full flex items-center justify-between`}
                >
                  <span>{b.label}</span>
                  <span className={`text-[10px] tracking-[0.054em] ${active ? 'text-white/60' : 'text-[#A8A8A4]'}`}>
                    {b.hint}
                  </span>
                </button>
              )
            })}
          </div>

          <div className="max-w-[480px] mx-auto space-y-4">
            <div>
              <p className="text-[10px] tracking-[0.113em] text-[#6B6B6B] mb-2">BRANDS YOU LOVE THAT WE DIDN&rsquo;T LIST</p>
              <input
                value={brandsMissed}
                onChange={(e) => setBrandsMissed(e.target.value)}
                placeholder="Anything we missed"
                className="w-full border border-[#E2E0DB] rounded-[12px] px-4 py-3 text-[13px] tracking-[0.036em] text-[#4A4E57] outline-none focus:border-[#0A0A0A] transition-colors"
              />
            </div>
            <div>
              <p className="text-[10px] tracking-[0.113em] text-[#6B6B6B] mb-2">ANYTHING A STYLIST SHOULD KNOW</p>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Fit, a body you're dressing, something you're shopping for…"
                className="w-full border border-[#E2E0DB] rounded-[12px] px-4 py-3 text-[13px] tracking-[0.036em] text-[#4A4E57] outline-none focus:border-[#0A0A0A] transition-colors resize-none"
              />
            </div>
          </div>
        </Screen>
      )}

      {/* Every question is skippable — skipping records no constraint at all. */}
      <div className="flex items-center justify-center gap-4 mt-10">
        <button
          onClick={back}
          className="text-[11px] tracking-[0.09em] text-[#6B6B6B] hover:text-[#4A4E57] px-6 py-3.5 transition-colors"
        >
          ← BACK
        </button>
        <button
          onClick={next}
          className="bg-[#0A0A0A] text-white px-12 py-3.5 rounded-[12px] text-[11px] tracking-[0.099em] hover:opacity-85 transition-opacity"
        >
          {screen >= TOTAL ? 'CONTINUE →' : 'NEXT →'}
        </button>
        <button
          onClick={next}
          className="text-[11px] tracking-[0.09em] text-[#A8A8A4] hover:text-[#4A4E57] px-4 py-3.5 transition-colors"
        >
          SKIP
        </button>
      </div>
    </div>
  )
}
