// Which way a piece goes on in when nobody has said. Shared by the room (client), the
// wardrobe queue and try-on, so a bag is worn the same way everywhere.
//
// A way is the default for every type it lists, unless its default_rule names the types it
// is the default for: the bag ways are all defaults, each for its own kinds of bag (a clutch
// in the hand, a shoulder bag on the shoulder, a crossbody across the body).

type WayLike = { way_key: string; item_types: string[]; is_default: boolean; needs_way?: string | null; default_rule?: Record<string, unknown> | null }

export function isDefaultFor(way: WayLike, itemType: string): boolean {
  if (!way.is_default) return false
  const only = way.default_rule?.default_for
  return Array.isArray(only) ? only.includes(itemType) : true
}

/** The type's default way, else its first. Ways are expected in sort order. */
export function defaultWayFor<W extends WayLike>(ways: W[], itemType: string | null | undefined): W | null {
  if (!itemType) return null
  const fits = ways.filter((w) => w.item_types.includes(itemType) && !w.needs_way)
  return fits.find((w) => isDefaultFor(w, itemType)) ?? fits[0] ?? null
}

/** Families whose other ways are shot only when she asks (each is a paid picture). */
export const ON_ASK_FAMILIES = new Set(['bag'])
export const BAG_TYPES = ['tote', 'shoulder_bag', 'clutch', 'crossbody', 'structured_bag']
