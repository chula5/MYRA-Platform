import { describe, it, expect } from 'vitest'
import {
  effectiveWeights,
  roomWeightsFromBrands,
  calibrationPlan,
  replayEvents,
  lookTasteVector,
  vectorRoomRead,
  validateDelivery,
  formatRoomMix,
  normalise,
  isFastFashion,
  PILOT_SIGNAL_WEIGHTS,
  ROOM_CENTROIDS,
  SYNTH_PERSONAS,
  type RoomWeights,
} from '../pilot-stylist'
import { accumulate, zeroVector, VECTOR_DIM } from '../taste-vector'

const devika = SYNTH_PERSONAS[0]
const mum = SYNTH_PERSONAS[1]

describe('effectiveWeights', () => {
  it('clamps Devika toward tailored on work days (the Dōen prairie dress test)', () => {
    const w = effectiveWeights(devika.room_weights, 'work_standard', devika.work_dress_code)
    // smart_unwritten floor = 0.5 — romantic taste must not survive the clamp
    expect(w.tailored).toBeGreaterThanOrEqual(0.5)
    expect(w.romantic).toBeLessThan(0.3)
    expect(w.tailored + w.romantic + w.ease).toBeCloseTo(1, 6)
  })

  it('does not clamp non-work occasions', () => {
    const w = effectiveWeights(devika.room_weights, 'dinner_drinks', devika.work_dress_code)
    // dinner tilts romantic — Devika should be romantic-led here
    expect(w.romantic).toBeGreaterThan(w.tailored)
    expect(w.romantic).toBeGreaterThan(w.ease)
  })

  it('the two personas never get interchangeable weights for the same brief (core test)', () => {
    const d = effectiveWeights(devika.room_weights, 'dinner_drinks', devika.work_dress_code)
    const m = effectiveWeights(mum.room_weights, 'dinner_drinks', mum.work_dress_code)
    // Devika romantic-led, Mum tailored-led — visibly different
    expect(d.romantic).toBeGreaterThan(0.5)
    expect(m.tailored).toBeGreaterThan(0.4)
    expect(Math.abs(d.romantic - m.romantic)).toBeGreaterThan(0.25)
  })

  it('casual weekend is ease-dominant for Mum', () => {
    const w = effectiveWeights(mum.room_weights, 'casual_day', mum.work_dress_code)
    expect(w.ease).toBeGreaterThan(w.tailored)
    expect(w.ease).toBeGreaterThan(w.romantic)
  })
})

describe('roomWeightsFromBrands', () => {
  it("places Mum's brand list tailored-led with romantic lowest", () => {
    const w = roomWeightsFromBrands(mum.brands)
    expect(w.tailored).toBeGreaterThan(w.romantic)
    expect(w.tailored).toBeGreaterThan(0.3)
    expect(w.tailored + w.romantic + w.ease).toBeCloseTo(1, 6)
  })

  it("places Devika's brand list romantic-led", () => {
    const w = roomWeightsFromBrands(devika.brands)
    expect(w.romantic).toBeGreaterThan(w.tailored)
    expect(w.romantic).toBeGreaterThan(w.ease)
  })

  it('handles accents and case in brand names', () => {
    const w = roomWeightsFromBrands([
      { name: 'SÉZANE', rank: 1 },
      { name: 'dōen', rank: 2 },
    ])
    expect(w.romantic).toBeGreaterThan(0.5)
  })
})

describe('replayEvents', () => {
  const intake: RoomWeights = { tailored: 0.34, romantic: 0.33, ease: 0.33 }
  const tailoredMix: RoomWeights = { tailored: 1, romantic: 0, ease: 0 }
  const ev = (event_type: keyof typeof PILOT_SIGNAL_WEIGHTS, room_mix: RoomWeights) => ({
    event_type,
    signal_weight: PILOT_SIGNAL_WEIGHTS[event_type],
    room_mix,
  })

  it('yes pulls toward the room mix, no pushes away', () => {
    const afterYes = replayEvents(intake, [ev('yes', tailoredMix)])
    expect(afterYes.tailored).toBeGreaterThan(intake.tailored)
    const afterNo = replayEvents(intake, [ev('no', tailoredMix)])
    expect(afterNo.tailored).toBeLessThan(intake.tailored)
  })

  it('a purchase moves taste harder than a yes (signal hierarchy)', () => {
    const afterYes = replayEvents(intake, [ev('yes', tailoredMix)])
    const afterPurchase = replayEvents(intake, [ev('purchase', tailoredMix)])
    expect(afterPurchase.tailored).toBeGreaterThan(afterYes.tailored)
    // and save > click > yes
    const afterSave = replayEvents(intake, [ev('save', tailoredMix)])
    const afterClick = replayEvents(intake, [ev('click_out', tailoredMix)])
    expect(afterSave.tailored).toBeGreaterThan(afterClick.tailored)
    expect(afterClick.tailored).toBeGreaterThan(afterYes.tailored)
  })

  it('never zeroes a room out entirely (convergence guard)', () => {
    const w = replayEvents(
      intake,
      Array.from({ length: 50 }, () => ev('no', tailoredMix)),
    )
    expect(w.tailored).toBeGreaterThan(0)
    expect(w.tailored + w.romantic + w.ease).toBeCloseTo(1, 6)
  })
})

describe('34-dim vector learning', () => {
  it('room centroids are valid, distinct 34-dim vectors', () => {
    for (const k of ['tailored', 'romantic', 'ease'] as const) {
      expect(ROOM_CENTROIDS[k]).toHaveLength(VECTOR_DIM)
      expect(ROOM_CENTROIDS[k].every((x) => x >= 0 && x <= 1)).toBe(true)
    }
    // each centroid must be closest to itself under the room read
    for (const k of ['tailored', 'romantic', 'ease'] as const) {
      const read = vectorRoomRead(ROOM_CENTROIDS[k])!
      const top = (Object.entries(read) as [string, number][]).sort((a, b) => b[1] - a[1])[0][0]
      expect(top).toBe(k)
    }
  })

  it('a pure-room look vector equals that room centroid', () => {
    const v = lookTasteVector({ tailored: 1, romantic: 0, ease: 0 })
    expect(v).toEqual(ROOM_CENTROIDS.tailored)
  })

  it('a blended look sits between its rooms', () => {
    const v = lookTasteVector({ tailored: 0.5, romantic: 0, ease: 0.5 })
    for (let i = 0; i < VECTOR_DIM; i++) {
      const lo = Math.min(ROOM_CENTROIDS.tailored[i], ROOM_CENTROIDS.ease[i])
      const hi = Math.max(ROOM_CENTROIDS.tailored[i], ROOM_CENTROIDS.ease[i])
      expect(v[i]).toBeGreaterThanOrEqual(lo - 1e-9)
      expect(v[i]).toBeLessThanOrEqual(hi + 1e-9)
    }
  })

  it('accumulated signals move the vector read toward what she says yes to', () => {
    // simulate: she keeps saying yes to (and buying) romantic looks
    let acc = zeroVector()
    const romanticLook = lookTasteVector({ tailored: 0.1, romantic: 0.8, ease: 0.1 })
    acc = accumulate(acc, romanticLook, PILOT_SIGNAL_WEIGHTS.yes)
    acc = accumulate(acc, romanticLook, PILOT_SIGNAL_WEIGHTS.save)
    acc = accumulate(acc, romanticLook, PILOT_SIGNAL_WEIGHTS.purchase)
    const read = vectorRoomRead(acc)!
    expect(read.romantic).toBeGreaterThan(read.tailored)
    expect(read.romantic).toBeGreaterThan(read.ease)
  })

  it('returns null for empty or missing vectors', () => {
    expect(vectorRoomRead(null)).toBeNull()
    expect(vectorRoomRead(zeroVector())).toBeNull()
  })
})

describe('validateDelivery — the non-negotiables', () => {
  const memberBrands = mum.brands.map((b) => b.name)
  const checked = new Date().toISOString()
  const goodLooks = [
    {
      room_mix: { tailored: 0.7, romantic: 0, ease: 0.3 } as RoomWeights,
      items: [
        { brand: 'Zara', product_name: 'wide-leg trousers', owned: true },
        { brand: 'ME+EM', product_name: 'merino knit', owned: false, in_stock: true, stock_checked_at: checked },
      ],
    },
    {
      room_mix: { tailored: 0.2, romantic: 0.3, ease: 0.5 } as RoomWeights,
      items: [
        // Toast is NOT in mum's named brands — the new-brand slot
        { brand: 'Toast', product_name: 'linen shirt', owned: false, in_stock: true, stock_checked_at: checked },
      ],
    },
    {
      room_mix: { tailored: 0.5, romantic: 0.2, ease: 0.3 } as RoomWeights,
      items: [
        { brand: 'Sessùn', product_name: 'cropped jacket', owned: false, in_stock: true, stock_checked_at: checked },
      ],
    },
  ]

  it('passes a compliant delivery', () => {
    expect(validateDelivery(goodLooks, memberBrands)).toEqual([])
  })

  it('blocks Zara as a recommendation but allows it owned (input, never output)', () => {
    const withZaraRec = [
      { ...goodLooks[0] },
      goodLooks[1],
      {
        room_mix: goodLooks[2].room_mix,
        items: [{ brand: 'Zara', product_name: 'blazer', owned: false, in_stock: true, stock_checked_at: checked }],
      },
    ]
    const errors = validateDelivery(withZaraRec, memberBrands)
    expect(errors.some((e) => e.includes('FAST FASHION'))).toBe(true)
  })

  it('requires the owned-item anchor and the new-brand slot', () => {
    const noAnchor = goodLooks.map((l) => ({
      ...l,
      items: l.items.filter((it) => !it.owned),
    }))
    expect(validateDelivery(noAnchor, memberBrands).some((e) => e.includes('OWNS'))).toBe(true)

    const noNewBrand = validateDelivery(
      [goodLooks[0], goodLooks[0], goodLooks[2]],
      memberBrands,
    )
    expect(noNewBrand.some((e) => e.includes('DIDN’T NAME'))).toBe(true)
  })

  it('blocks unchecked or out-of-stock items at send', () => {
    const unchecked = [
      goodLooks[0],
      goodLooks[1],
      {
        room_mix: goodLooks[2].room_mix,
        items: [{ brand: 'Sessùn', product_name: 'cropped jacket', owned: false }],
      },
    ]
    expect(validateDelivery(unchecked, memberBrands).some((e) => e.includes('STOCK NOT CHECKED'))).toBe(true)
  })

  it('requires exactly-formed deliveries: 3 looks, every look has a room mix', () => {
    expect(validateDelivery([goodLooks[0]], memberBrands).some((e) => e.includes('3'))).toBe(true)
    const noMix = [
      { ...goodLooks[0], room_mix: { tailored: 0, romantic: 0, ease: 0 } as RoomWeights },
      goodLooks[1],
      goodLooks[2],
    ]
    expect(validateDelivery(noMix, memberBrands).some((e) => e.includes('ROOM MIX'))).toBe(true)
  })
})

describe('calibrationPlan — taste-onboarding sets', () => {
  it('creates 3 looks, one probe per room, dominant room first', () => {
    const plan = calibrationPlan(mum.brands, mum.room_weights)
    expect(plan).toHaveLength(3)
    // mum is tailored-dominant, romantic-weakest
    expect(plan[0].room_mix.tailored).toBe(0.7)
    expect(plan[2].room_mix.romantic).toBe(0.7)
    for (const look of plan) {
      const sum = look.room_mix.tailored + look.room_mix.romantic + look.room_mix.ease
      expect(sum).toBeCloseTo(1, 6)
    }
  })

  it('hints her own brands in their home rooms and unnamed brands to discover', () => {
    const plan = calibrationPlan(mum.brands, mum.room_weights)
    const tailoredProbe = plan[0]
    expect(tailoredProbe.note).toContain('MASSIMO DUTTI')
    // Devika's romantic probe should suggest her Reformation/Dōen/Sézane
    const dPlan = calibrationPlan(devika.brands, devika.room_weights)
    expect(dPlan[0].room_mix.romantic).toBe(0.7)
    expect(dPlan[0].note).toContain('REFORMATION')
  })

  it('marks the weakest room as the most informative probe', () => {
    const plan = calibrationPlan(mum.brands, mum.room_weights)
    expect(plan[2].note).toContain('MOST INFORMATIVE')
  })
})

describe('validateDelivery — calibration mode', () => {
  it('only requires 3 looks with room mixes — no shopping rules', () => {
    const probes = [
      { room_mix: { tailored: 0.7, romantic: 0.2, ease: 0.1 } as RoomWeights, items: [] },
      { room_mix: { tailored: 0.2, romantic: 0.1, ease: 0.7 } as RoomWeights, items: [] },
      // even a fast-fashion, unchecked-stock item passes — it's shown, not sold
      {
        room_mix: { tailored: 0.1, romantic: 0.7, ease: 0.2 } as RoomWeights,
        items: [{ brand: 'Zara', product_name: 'floral dress', owned: false }],
      },
    ]
    expect(validateDelivery(probes, [], { calibration: true })).toEqual([])
  })

  it('still requires 3 looks and room mixes', () => {
    expect(validateDelivery([{ room_mix: { tailored: 1, romantic: 0, ease: 0 }, items: [] }], [], { calibration: true }).some((e) => e.includes('3'))).toBe(true)
    const noMix = [
      { room_mix: { tailored: 0, romantic: 0, ease: 0 } as RoomWeights, items: [] },
      { room_mix: { tailored: 1, romantic: 0, ease: 0 } as RoomWeights, items: [] },
      { room_mix: { tailored: 1, romantic: 0, ease: 0 } as RoomWeights, items: [] },
    ]
    expect(validateDelivery(noMix, [], { calibration: true }).some((e) => e.includes('ROOM MIX'))).toBe(true)
  })
})

describe('formatting & helpers', () => {
  it('formats room mix like the spec: "70% TAILORED / 30% EASE"', () => {
    expect(formatRoomMix({ tailored: 0.7, romantic: 0, ease: 0.3 })).toBe('70% TAILORED / 30% EASE')
  })
  it('normalises degenerate weights to even thirds', () => {
    const w = normalise({ tailored: 0, romantic: 0, ease: 0 })
    expect(w.tailored).toBeCloseTo(1 / 3, 6)
  })
  it('flags fast fashion regardless of case', () => {
    expect(isFastFashion('ZARA')).toBe(true)
    expect(isFastFashion('Sessùn')).toBe(false)
  })
})
