// Canonical promotion: an approved candidate version becomes exactly ONE
// internal/non-live outfit linked once to every normalized candidate item.
// Retries return the same outfit; withdrawal marks the promotion withdrawn;
// a later re-approval reactivates the same row. Nothing ever auto-publishes.

import { describe, it, expect } from 'vitest'
import { promoteApprovedVersion, markPromotionWithdrawn, attachPromotedImage } from '@/lib/outfit-quality/promotion'
import { createFakeAdmin } from './fake-admin'

const STYLIST = '0d535772-8a4f-440f-9e46-f8d637bed0d3'

function seed(overrides: { items?: any[]; promotions?: any[] } = {}) {
  return createFakeAdmin({
    outfit_quality_candidate_version: [
      { candidate_version_id: 'v1', case_id: 'c1', version_no: 1, state: 'approved' },
    ],
    outfit_quality_case: [
      { case_id: 'c1', current_version_id: 'v1', selected_stylist_id: STYLIST, status: 'approved' },
    ],
    outfit_quality_candidate_item:
      overrides.items ??
      [
        { candidate_item_id: 'ci-1', candidate_version_id: 'v1', item_id: 'i1', slot: 'top', sort_order: 0, source_image_url: 'https://res.cloudinary.com/x/top.jpg', item_snapshot: {} },
        { candidate_item_id: 'ci-2', candidate_version_id: 'v1', item_id: 'i2', slot: 'bottom', sort_order: 1, source_image_url: 'https://res.cloudinary.com/x/bottom.jpg', item_snapshot: {} },
        { candidate_item_id: 'ci-3', candidate_version_id: 'v1', item_id: 'i3', slot: 'shoe', sort_order: 2, source_image_url: 'https://res.cloudinary.com/x/shoe.jpg', item_snapshot: {} },
      ],
    outfit_quality_promotion: overrides.promotions ?? [],
    outfit: [],
    outfit_item: [],
  })
}

describe('promoteApprovedVersion', () => {
  it('creates one internal/non-live outfit with the selected stylist and Quality Lab provenance', async () => {
    const db = seed()
    const r = await promoteApprovedVersion(db.admin, 'v1')
    expect(r).toMatchObject({ ok: true, reused: false })
    if (!r.ok) return

    expect(db.tables.outfit).toHaveLength(1)
    const outfit = db.tables.outfit[0]
    expect(outfit.stylist_id).toBe(STYLIST)
    // Internal/non-live: draft status, never published.
    expect(outfit.status).toBe('draft')
    expect(outfit.published_at).toBeNull()
    expect(outfit.admin_notes).toContain('v1')
    // The initial image is the first frozen source image until a render lands.
    expect(outfit.image_url).toBe('https://res.cloudinary.com/x/top.jpg')

    const promotion = db.tables.outfit_quality_promotion[0]
    expect(promotion).toMatchObject({ candidate_version_id: 'v1', outfit_id: outfit.outfit_id, status: 'active' })
    expect(r.promotionId).toBe(promotion.promotion_id)
    expect(r.outfitId).toBe(outfit.outfit_id)
  })

  it('links the outfit once to every normalized candidate item, preserving slot and order', async () => {
    const db = seed()
    await promoteApprovedVersion(db.admin, 'v1')
    const outfitId = db.tables.outfit[0].outfit_id
    const memberships = db.tables.outfit_item.filter((m) => m.outfit_id === outfitId)
    expect(memberships).toHaveLength(3)
    expect(memberships.map((m) => [m.item_id, m.slot, m.sort_order])).toEqual([
      ['i1', 'top', 0],
      ['i2', 'bottom', 1],
      ['i3', 'shoe', 2],
    ])
    // Never one outfit per item.
    expect(db.tables.outfit).toHaveLength(1)
  })

  it('is idempotent: a retry returns the same outfit and writes nothing new', async () => {
    const db = seed()
    const first = await promoteApprovedVersion(db.admin, 'v1')
    const second = await promoteApprovedVersion(db.admin, 'v1')
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(second).toMatchObject({ reused: true, promotionId: first.promotionId, outfitId: first.outfitId })
    expect(db.tables.outfit).toHaveLength(1)
    expect(db.tables.outfit_item).toHaveLength(3)
    expect(db.tables.outfit_quality_promotion).toHaveLength(1)
  })

  it('a lost race (unique conflict on insert) returns the winner’s promotion and cleans up its own orphan outfit', async () => {
    const db = seed()
    // Simulate: our existence check ran first, a concurrent promoter committed,
    // and our promotion insert then hits the unique constraint.
    db.failNextInsert('outfit_quality_promotion', 'duplicate key value violates unique constraint "outfit_quality_promotion_candidate_version_id_key"', (tables) => {
      tables.outfit_quality_promotion.push({ promotion_id: 'promo-winner', candidate_version_id: 'v1', outfit_id: 'outfit-winner', status: 'active', withdrawn_at: null })
    })

    const r = await promoteApprovedVersion(db.admin, 'v1')
    expect(r).toMatchObject({ ok: true, reused: true, promotionId: 'promo-winner', outfitId: 'outfit-winner' })
    // The loser's outfit and memberships were removed — exactly one outfit serves the version.
    expect(db.tables.outfit).toHaveLength(0)
    expect(db.tables.outfit_item).toHaveLength(0)
  })

  it('refuses an empty frozen manifest', async () => {
    const db = seed({ items: [] })
    const r = await promoteApprovedVersion(db.admin, 'v1')
    expect(r).toMatchObject({ ok: false, code: 'empty_manifest' })
    expect(db.tables.outfit).toHaveLength(0)
  })

  it('a withdrawn promotion reactivates on re-approval rather than duplicating', async () => {
    const db = seed({
      promotions: [{ promotion_id: 'p1', candidate_version_id: 'v1', outfit_id: 'o1', status: 'withdrawn', withdrawn_at: '2026-01-02T00:00:00.000Z' }],
    })
    const r = await promoteApprovedVersion(db.admin, 'v1')
    expect(r).toMatchObject({ ok: true, reused: true, promotionId: 'p1', outfitId: 'o1' })
    expect(db.tables.outfit_quality_promotion[0]).toMatchObject({ status: 'active', withdrawn_at: null })
    expect(db.tables.outfit).toHaveLength(0)
  })
})

describe('markPromotionWithdrawn / attachPromotedImage', () => {
  it('withdrawal marks the promotion without deleting provenance', async () => {
    const db = seed()
    await promoteApprovedVersion(db.admin, 'v1')
    await markPromotionWithdrawn(db.admin, 'v1')
    expect(db.tables.outfit_quality_promotion[0].status).toBe('withdrawn')
    expect(db.tables.outfit_quality_promotion[0].withdrawn_at).toBeTruthy()
    expect(db.tables.outfit).toHaveLength(1) // the outfit record remains
  })

  it('a fidelity-passed render attaches its durable image to the promoted outfit without publishing it', async () => {
    const db = seed()
    await promoteApprovedVersion(db.admin, 'v1')
    const durable = 'https://res.cloudinary.com/x/quality-lab-renders/oq-attempt-1.png'
    await attachPromotedImage(db.admin, 'v1', durable)
    expect(db.tables.outfit[0].image_url).toBe(durable)
    expect(db.tables.outfit[0].status).toBe('draft')
    expect(db.tables.outfit[0].published_at).toBeNull()
  })
})
