// Keeps white and cream honest on every piece the composers can use.
//
// A pale piece's stored colour is a guess until its photo is read
// (classifyPaleShade). Once read, its colour_hex is one of TONE_HEX — that is
// the "already read" marker, so running this again on the same piece costs
// nothing. Called where every usable piece passes: the nightly scoring sweep,
// before composing for a client, and Chloe's Composer.

import { classifyPaleShade } from '@/app/admin/ai/classify-colour'
import { toneOfShade, TONE_HEX } from '@/lib/pale-tone'

interface PaleCandidate {
  item_id: string
  colour_family?: string | null
  colour_hex?: string | null
  image_url?: string | null
}

const READ_MARKERS = new Set(Object.values(TONE_HEX).map((h) => h.toUpperCase()))

const needsRead = (it: PaleCandidate) =>
  (it.colour_family === 'white' || it.colour_family === 'cream') &&
  !!it.image_url &&
  !READ_MARKERS.has(String(it.colour_hex ?? '').toUpperCase())

/**
 * Read and correct unread pale pieces. Updates the passed objects in place so
 * the caller composes with the corrected colour. Never throws.
 */
export async function correctPaleColour(admin: any, items: PaleCandidate[], cap = 20): Promise<{ read: number; changed: number }> {
  const todo = items.filter(needsRead).slice(0, cap)
  let changed = 0
  try {
    for (let i = 0; i < todo.length; i += 5) {
      const chunk = todo.slice(i, i + 5)
      const reads = await Promise.all(chunk.map((it) => classifyPaleShade(String(it.image_url)).catch(() => ({ shade: null }))))
      for (let j = 0; j < chunk.length; j++) {
        const side = toneOfShade(reads[j].shade)
        if (!side) continue
        const update = { colour_family: side, colour_hex: TONE_HEX[side] }
        const { error } = await admin.from('item').update(update).eq('item_id', chunk[j].item_id)
        if (error) continue
        if (chunk[j].colour_family !== side) changed++
        Object.assign(chunk[j], update)
      }
    }
  } catch (err) {
    console.error('[correctPaleColour]', err)
  }
  return { read: todo.length, changed }
}

/** Same, for pieces known only by id (the nightly sweep). */
export async function correctPaleColourByIds(admin: any, ids: string[], cap = 40): Promise<{ read: number; changed: number }> {
  if (!ids.length) return { read: 0, changed: 0 }
  const { data } = await admin.from('item')
    .select('item_id, colour_family, colour_hex, image_url').in('item_id', ids).in('colour_family', ['white', 'cream'])
  return correctPaleColour(admin, (data ?? []) as PaleCandidate[], cap)
}
