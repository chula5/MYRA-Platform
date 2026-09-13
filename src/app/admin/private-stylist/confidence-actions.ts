'use server'

// WOULD THIS LOOK HAVE PASSED?
//
// The confidence score exists to decide what a client can be sent without
// review. Before it decides anything it has to be visible, and checkable
// against looks whose outcome is already known — a score nobody can see is a
// claim, not a measurement.
//
// Everything here is derived on read from her own history. Nothing is stored,
// so the number can never disagree with the looks it came from.

import { createAdminClient } from '@/lib/supabase-server'
import {
  lookConfidence, calibrateThreshold, indexHistory, historySignals,
  HIGH_CONFIDENCE, type LookRecord, type Calibration,
} from '@/lib/look-confidence'

export interface LookConfidenceRow {
  look_id: string
  score: number
  high: boolean
  reasons: string[]
  /** Known outcome, where there is one — so the score can be judged. */
  wasClean: boolean | null
}

export interface MemberConfidence {
  byLook: Record<string, LookConfidenceRow>
  calibration: Calibration
  threshold: number
  error?: string
}

/**
 * Score every look she has, each from the looks that came before it.
 *
 * Walking forward matters: scoring a look with its own outcome in the index
 * would make the number look far better than it is, and the whole purpose is
 * to know whether it can be trusted on a look nobody has seen yet.
 */
export async function loadMemberConfidence(memberId: string): Promise<MemberConfidence> {
  const empty: MemberConfidence = {
    byLook: {},
    calibration: { threshold: HIGH_CONFIDENCE, separation: 0, cleanMean: 0, editedMean: 0, sample: 0, precision: 0, lift: 0, reaching: 0, usable: false },
    threshold: HIGH_CONFIDENCE,
  }
  try {
    const admin = createAdminClient() as any
    const { data: dels } = await admin.from('pilot_delivery').select('delivery_id').eq('member_id', memberId)
    const ids = (dels ?? []).map((d: any) => d.delivery_id)
    if (!ids.length) return empty

    const [{ data: looks }, { data: fb }] = await Promise.all([
      admin.from('pilot_look').select('look_id, items, approved_at, response, created_at').in('delivery_id', ids).order('created_at'),
      admin.from('pilot_look_feedback').select('look_id, action, item_out, item_in').eq('member_id', memberId).limit(10000),
    ])
    const edited = new Set((fb ?? []).filter((f: any) => f.look_id && f.action !== 'accept').map((f: any) => f.look_id))
    const rejected = new Set((fb ?? [])
      .map((f: any) => (f.action !== 'accept' ? (f.item_out ?? f.item_in) : null)).filter(Boolean))

    // Which pieces the composer was blind on — no scored dimensions.
    const allIds = new Set<string>()
    for (const l of looks ?? []) for (const it of ((l.items ?? []) as any[])) if (it.item_id) allIds.add(it.item_id)
    const scored = new Set<string>()
    const arr = Array.from(allIds)
    for (let i = 0; i < arr.length; i += 100) {
      const { data } = await admin.from('item').select('item_id, structure').in('item_id', arr.slice(i, i + 100))
      for (const r of data ?? []) if (r.structure != null) scored.add(r.item_id)
    }

    const past: LookRecord[] = []
    const byLook: Record<string, LookConfidenceRow> = {}
    const history: { score: number; wasClean: boolean }[] = []

    for (const l of (looks ?? []) as any[]) {
      const items = (l.items ?? []) as any[]
      const itemIds = items.map((i) => i.item_id).filter(Boolean)
      const brandIds = items.map((i) => i.brand_id).filter(Boolean)
      const decided = !!l.approved_at || edited.has(l.look_id)
      const wasClean = decided ? !edited.has(l.look_id) : null

      if (itemIds.length) {
        const h = indexHistory(past)
        const c = lookConfidence({
          constitutionPassed: true,
          containsRejected: itemIds.some((id: string) => rejected.has(id)),
          containsBlockedTrait: false,
          ...historySignals(h, itemIds, brandIds),
          usedFallbackPool: false,
          unscoredShare: itemIds.filter((id: string) => !scored.has(id)).length / itemIds.length,
        })
        byLook[l.look_id] = { look_id: l.look_id, score: c.score, high: c.high, reasons: c.reasons, wasClean }
        // Only decided looks can judge the gate, and only from past evidence.
        if (decided && past.length >= 3) history.push({ score: c.score, wasClean: wasClean === true })
      }

      if (decided) past.push({ itemIds, brandIds, kept: wasClean === true && (!!l.approved_at || l.response === 'yes') })
    }

    return { byLook, calibration: calibrateThreshold(history), threshold: HIGH_CONFIDENCE }
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : 'Could not score her looks' }
  }
}
