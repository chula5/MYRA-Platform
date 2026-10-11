// ONE LEARNING BASE.
//
// Chloe: "outfit review, quality lab and deliveries should all be learning
// from the same dataset — the system should be getting smarter from every
// outfit accepted by me." So every outfit SHE accepts or turns down, wherever
// she does it — Outfit Review, the Composer, the Quality Lab for any stylist,
// the Bench, a delivery she approves, swaps or passes over — teaches the house
// base (Chloe's Style Brain) and, when a stylist or persona is in play, that
// layer too. A member's OWN yes/no teaches her layer and her persona only
// (teachHouseStyle in the private-stylist actions), never the base.
//
// Not a 'use server' module: plain functions for the surfaces' own actions.

import { recordStyleDecision } from '@/lib/style-brain-store'
import { recordMaterialPairings } from '@/lib/house-style-store'
import { CHLOE_STYLIST_ID } from '@/lib/outfit-quality/identities'
import type { HouseItem } from '@/lib/house-style'

type Decision = Parameters<typeof recordStyleDecision>[0]

export interface TeachFromChloeInput extends Omit<Decision, 'stylistId'> {
  /** The stylist or persona the look was composed through — her layer on the base. */
  layerStylistId?: string | null
  /** When given, the look's material pairings are recorded too (approve) — leave out if the caller records them itself. */
  houseItems?: HouseItem[]
}

/** Record Chloe's decision on the house base, and on the layer in play when it is not the base itself. */
export async function teachFromChloe(input: TeachFromChloeInput): Promise<void> {
  const { layerStylistId, houseItems, ...decision } = input
  await recordStyleDecision({ ...decision, stylistId: CHLOE_STYLIST_ID })
  if (layerStylistId && layerStylistId !== CHLOE_STYLIST_ID) {
    await recordStyleDecision({ ...decision, stylistId: layerStylistId })
  }
  if (houseItems && houseItems.length >= 2 && decision.decision === 'approve') {
    await recordMaterialPairings(houseItems, 'approve')
  }
}
