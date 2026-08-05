'use client'

import { useMemo, useRef, useState } from 'react'
import FallbackImage from '@/components/FallbackImage'
import { useRouter } from 'next/navigation'
import { BRAND_GROUPS, AGE_RANGES } from './brand-groups'
import { saveOnboarding } from './actions'

export interface OnboardingOutfit {
  id: string
  image: string
  label: string
  occasions: string[]
  ageRanges: string[]
}

const RATING_TARGET = 10

// Pick a varied spread of outfits for the user's age range, capped at RATING_TARGET.
// Outfits with no age tags are considered suitable for everyone.
function pickOutfits(all: OnboardingOutfit[], ageRange: string): OnboardingOutfit[] {
  const eligible = all.filter(
    (o) => o.ageRanges.length === 0 || o.ageRanges.includes(ageRange),
  )
  // Spread across occasions: round-robin by first occasion tag so the user
  // sees a range of styles, not 10 of the same thing.
  const byOccasion = new Map<string, OnboardingOutfit[]>()
  for (const o of eligible) {
    const key = o.occasions[0] ?? 'other'
    if (!byOccasion.has(key)) byOccasion.set(key, [])
    byOccasion.get(key)!.push(o)
  }
  const buckets = Array.from(byOccasion.values())
  const picked: OnboardingOutfit[] = []
  let i = 0
  while (picked.length < Math.min(RATING_TARGET, eligible.length)) {
    const bucket = buckets[i % buckets.length]
    if (bucket.length) picked.push(bucket.shift()!)
    i++
    if (buckets.every((b) => b.length === 0)) break
  }
  return picked
}

export default function OnboardingFlow({
  outfits,
  preview = false,
}: {
  outfits: OnboardingOutfit[]
  preview?: boolean
}) {
  const router = useRouter()
  const [step, setStep] = useState<1 | 2 | 3>(1)

  const [brandGroups, setBrandGroups] = useState<string[]>([])
  const [ageRange, setAgeRange] = useState<string>('')

  const [liked, setLiked] = useState<string[]>([])
  const [disliked, setDisliked] = useState<string[]>([])
  const [cardIdx, setCardIdx] = useState(0)
  const [submitting, setSubmitting] = useState(false)

  // Touch-swipe tracking for the rating cards.
  const touchStartX = useRef<number | null>(null)
  const [dragX, setDragX] = useState(0)

  const ratingOutfits = useMemo(
    () => (ageRange ? pickOutfits(outfits, ageRange) : []),
    [outfits, ageRange],
  )

  function toggleBrandGroup(key: string) {
    setBrandGroups((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    )
  }

  async function finish(likedFinal: string[], dislikedFinal: string[]) {
    setSubmitting(true)
    // Preview mode (admin): don't persist anything, just return to the admin area.
    if (preview) {
      router.push('/admin/the-edit')
      return
    }
    await saveOnboarding({
      ageRange,
      brandGroups,
      likedOutfitIds: likedFinal,
      dislikedOutfitIds: dislikedFinal,
    })
    router.push('/edit')
    router.refresh()
  }

  function rate(decision: 'like' | 'dislike') {
    const outfit = ratingOutfits[cardIdx]
    if (!outfit) return
    const nextLiked = decision === 'like' ? [...liked, outfit.id] : liked
    const nextDisliked = decision === 'dislike' ? [...disliked, outfit.id] : disliked
    setLiked(nextLiked)
    setDisliked(nextDisliked)
    setDragX(0)

    if (cardIdx + 1 >= ratingOutfits.length) {
      finish(nextLiked, nextDisliked)
    } else {
      setCardIdx(cardIdx + 1)
    }
  }

  // ── Progress dots ──
  const progress = (
    <div className="flex items-center justify-center gap-2 mb-10">
      {[1, 2, 3].map((s) => (
        <span
          key={s}
          className={`h-1.5 rounded-full transition-all duration-300 ${
            s === step ? 'w-8 bg-[#0A0A0A]' : s < step ? 'w-1.5 bg-[#0A0A0A]' : 'w-1.5 bg-[#E2E0DB]'
          }`}
        />
      ))}
    </div>
  )

  return (
    <div className="min-h-screen bg-white">
      {preview && (
        <div className="flex items-center justify-between gap-4 px-6 py-2.5 bg-[#0A0A0A] text-white">
          <span className="text-[9px] tracking-[0.099em] text-[#C4A882]">
            ADMIN PREVIEW · THIS IS THE NEW-USER SIGN-UP FLOW · NOTHING IS SAVED
          </span>
          <button
            onClick={() => router.push('/admin/the-edit')}
            className="text-[9px] tracking-[0.09em] text-white/70 hover:text-white border border-white/30 hover:border-white px-3 py-1 transition-colors"
          >
            EXIT PREVIEW ✕
          </button>
        </div>
      )}
      <header className="flex items-center justify-center px-8 h-14 border-b border-[#E2E0DB]">
        <p className="text-[13px] tracking-[0.135em] text-[#4A4E57]">MYRA</p>
      </header>

      <div className="max-w-[760px] mx-auto px-6 py-12 sm:py-16">
        {progress}

        {/* ── STEP 1 — BRAND TASTE ─────────────────────────────── */}
        {step === 1 && (
          <div>
            <div className="text-center mb-10">
              <p className="text-[11px] tracking-[0.113em] text-[#6B6B6B] mb-3">A FEW QUESTIONS</p>
              <h1 className="text-[clamp(22px,3vw,32px)] tracking-[0.036em] text-[#4A4E57] leading-tight mb-3">
                WHICH OF THESE FEEL LIKE YOU?
              </h1>
              <p className="text-[11px] tracking-[0.054em] text-[#A8A8A4] leading-relaxed max-w-[440px] mx-auto">
                Pick the worlds you love — choose as many as you like. This helps us learn your taste.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-10">
              {BRAND_GROUPS.map((g) => {
                const active = brandGroups.includes(g.key)
                return (
                  <button
                    key={g.key}
                    onClick={() => toggleBrandGroup(g.key)}
                    className={`text-left p-5 rounded-[12px] border transition-all duration-200 ${
                      active
                        ? 'border-[#0A0A0A] bg-[#0A0A0A] text-white'
                        : 'border-[#E2E0DB] bg-white hover:border-[#0A0A0A]'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <span className={`text-[12px] tracking-[0.045em] ${active ? 'text-white' : 'text-[#4A4E57]'}`}>
                        {g.name.toUpperCase()}
                      </span>
                      <span className={`text-[14px] leading-none ${active ? 'text-white' : 'text-[#C4A882]'}`}>
                        {active ? '✓' : '+'}
                      </span>
                    </div>
                    <p className={`text-[10px] tracking-[0.036em] mb-3 ${active ? 'text-white/70' : 'text-[#A8A8A4]'}`}>
                      {g.blurb}
                    </p>
                    <p className={`text-[9px] tracking-[0.045em] leading-relaxed ${active ? 'text-white/60' : 'text-[#6B6B6B]'}`}>
                      {g.brands.join(' · ')}
                    </p>
                  </button>
                )
              })}
            </div>

            <div className="flex justify-center">
              <button
                disabled={brandGroups.length === 0}
                onClick={() => setStep(2)}
                className="bg-[#0A0A0A] text-white px-12 py-3.5 rounded-[12px] text-[11px] tracking-[0.099em] hover:opacity-85 transition-opacity disabled:opacity-25"
              >
                CONTINUE →
              </button>
            </div>
            {brandGroups.length === 0 && (
              <p className="text-center text-[9px] tracking-[0.072em] text-[#A8A8A4] mt-4">
                SELECT AT LEAST ONE TO CONTINUE
              </p>
            )}
          </div>
        )}

        {/* ── STEP 2 — AGE RANGE ───────────────────────────────── */}
        {step === 2 && (
          <div>
            <div className="text-center mb-10">
              <p className="text-[11px] tracking-[0.113em] text-[#6B6B6B] mb-3">A FEW QUESTIONS</p>
              <h1 className="text-[clamp(22px,3vw,32px)] tracking-[0.036em] text-[#4A4E57] leading-tight mb-3">
                WHICH AGE RANGE ARE YOU IN?
              </h1>
              <p className="text-[11px] tracking-[0.054em] text-[#A8A8A4] leading-relaxed max-w-[440px] mx-auto">
                So we show you outfits styled for you. This stays private.
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-10 max-w-[520px] mx-auto">
              {AGE_RANGES.map((r) => {
                const active = ageRange === r
                return (
                  <button
                    key={r}
                    onClick={() => setAgeRange(r)}
                    className={`py-6 rounded-[12px] border text-[14px] tracking-[0.045em] transition-all duration-200 ${
                      active
                        ? 'border-[#0A0A0A] bg-[#0A0A0A] text-white'
                        : 'border-[#E2E0DB] bg-white text-[#4A4E57] hover:border-[#0A0A0A]'
                    }`}
                  >
                    {r}
                  </button>
                )
              })}
            </div>

            <div className="flex items-center justify-center gap-4">
              <button
                onClick={() => setStep(1)}
                className="text-[11px] tracking-[0.09em] text-[#6B6B6B] hover:text-[#4A4E57] px-6 py-3.5 transition-colors"
              >
                ← BACK
              </button>
              <button
                disabled={!ageRange}
                onClick={() => setStep(3)}
                className="bg-[#0A0A0A] text-white px-12 py-3.5 rounded-[12px] text-[11px] tracking-[0.099em] hover:opacity-85 transition-opacity disabled:opacity-25"
              >
                CONTINUE →
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3 — RATE OUTFITS (optional) ─────────────────── */}
        {step === 3 && (
          <div>
            <div className="text-center mb-8">
              <p className="text-[11px] tracking-[0.113em] text-[#6B6B6B] mb-3">LAST STEP — OPTIONAL</p>
              <h1 className="text-[clamp(22px,3vw,32px)] tracking-[0.036em] text-[#4A4E57] leading-tight mb-3">
                LOVE IT OR LEAVE IT?
              </h1>
              <p className="text-[11px] tracking-[0.054em] text-[#A8A8A4] leading-relaxed max-w-[440px] mx-auto">
                Swipe or tap to tell us what you like. The more you rate, the better your edit.
              </p>
            </div>

            {ratingOutfits.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-[11px] tracking-[0.09em] text-[#A8A8A4] mb-8">
                  NO OUTFITS TO RATE RIGHT NOW
                </p>
                <button
                  onClick={() => finish(liked, disliked)}
                  disabled={submitting}
                  className="bg-[#0A0A0A] text-white px-12 py-3.5 rounded-[12px] text-[11px] tracking-[0.099em] hover:opacity-85 transition-opacity disabled:opacity-50"
                >
                  {submitting ? 'FINISHING…' : 'ENTER THE EDIT →'}
                </button>
              </div>
            ) : (
              <>
                {/* Progress */}
                <p className="text-center text-[10px] tracking-[0.09em] text-[#6B6B6B] mb-4">
                  {Math.min(cardIdx + 1, ratingOutfits.length)} / {ratingOutfits.length}
                </p>

                {/* Card */}
                <div className="relative max-w-[340px] mx-auto mb-8" style={{ height: '454px' }}>
                  {ratingOutfits[cardIdx] && (
                    <div
                      className="absolute inset-0 rounded-[14px] overflow-hidden border border-[#E2E0DB] bg-[#FAFAF8] select-none"
                      style={{
                        transform: `translateX(${dragX}px) rotate(${dragX * 0.04}deg)`,
                        transition: touchStartX.current === null ? 'transform 0.25s ease' : 'none',
                      }}
                      onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX }}
                      onTouchMove={(e) => {
                        if (touchStartX.current !== null) setDragX(e.touches[0].clientX - touchStartX.current)
                      }}
                      onTouchEnd={() => {
                        if (dragX > 80) { touchStartX.current = null; rate('like') }
                        else if (dragX < -80) { touchStartX.current = null; rate('dislike') }
                        else { touchStartX.current = null; setDragX(0) }
                      }}
                    >
                      <FallbackImage
                        src={ratingOutfits[cardIdx].image}
                        thumbWidth={680}
                        alt={ratingOutfits[cardIdx].label}
                        className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                      />
                      {/* Swipe hint overlays */}
                      {dragX > 30 && (
                        <div className="absolute top-5 left-5 border-2 border-[#3A6B3A] text-[#3A6B3A] px-3 py-1 rounded text-[12px] tracking-[0.081em] rotate-[-12deg] bg-white/80">
                          LOVE
                        </div>
                      )}
                      {dragX < -30 && (
                        <div className="absolute top-5 right-5 border-2 border-[#B83A3A] text-[#B83A3A] px-3 py-1 rounded text-[12px] tracking-[0.081em] rotate-[12deg] bg-white/80">
                          PASS
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Like / Dislike buttons */}
                <div className="flex items-center justify-center gap-5 mb-8">
                  <button
                    onClick={() => rate('dislike')}
                    disabled={submitting}
                    aria-label="Pass"
                    className="w-16 h-16 rounded-full border border-[#E2E0DB] bg-white text-[#B83A3A] text-[24px] flex items-center justify-center hover:border-[#B83A3A] transition-colors disabled:opacity-50"
                  >
                    ✕
                  </button>
                  <button
                    onClick={() => rate('like')}
                    disabled={submitting}
                    aria-label="Love"
                    className="w-16 h-16 rounded-full border border-[#E2E0DB] bg-white text-[#3A6B3A] text-[24px] flex items-center justify-center hover:border-[#3A6B3A] transition-colors disabled:opacity-50"
                  >
                    ♥
                  </button>
                </div>

                {/* Skip the rest */}
                <div className="text-center">
                  <button
                    onClick={() => finish(liked, disliked)}
                    disabled={submitting}
                    className="text-[10px] tracking-[0.09em] text-[#A8A8A4] hover:text-[#4A4E57] underline underline-offset-4 transition-colors disabled:opacity-50"
                  >
                    {submitting ? 'FINISHING…' : 'SKIP & ENTER THE EDIT →'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
