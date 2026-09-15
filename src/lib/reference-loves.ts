// HER PICTURES TEACH HER LOVES LIST.
//
// A piece that keeps appearing in a client's own reference pictures goes on her
// PIECES "lives in" list — which the composer ranks up. Only additions, never
// removals, and never a piece on her "never touches" list: Alison's pictures
// include pointed heels, and she won't wear them.
//
// A piece is added only when pictures NEWLY push it over the bar, so one Chloe
// takes off the list does not come straight back on the next upload unless the
// new pictures earn it again.

/** The PIECES chips on her profile (PREF_TYPES in PrivateStylistClient) — clothes and shoes only. */
export const LOVABLE_TYPES = new Set([
  'coat', 'trench', 'jacket', 'blazer', 'gilet', 'shirt', 'blouse', 't-shirt', 'knitwear', 'bodysuit',
  'trousers', 'jeans', 'shorts', 'skirt', 'mini_dress', 'midi_dress', 'maxi_dress', 'shirt_dress', 'slip_dress',
  'boot', 'heel', 'flat', 'sneaker', 'mule', 'sandal',
])

/** Too few pictures say nothing about a pattern. */
export const LOVE_MIN_PICTURES = 5
/** A piece must be in at least this many pictures… */
export const LOVE_MIN_COUNT = 3
/** …and at least this share of them. */
export const LOVE_MIN_SHARE = 0.3

/** How many pictures each piece appears in (once per picture). */
export function typeCounts(pictures: string[][]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const types of pictures) for (const t of Array.from(new Set(types))) counts.set(t, (counts.get(t) ?? 0) + 1)
  return counts
}

export function qualifyingTypes(pictures: string[][]): Set<string> {
  if (pictures.length < LOVE_MIN_PICTURES) return new Set()
  const out = new Set<string>()
  typeCounts(pictures).forEach((n, t) => {
    if (LOVABLE_TYPES.has(t) && n >= LOVE_MIN_COUNT && n / pictures.length >= LOVE_MIN_SHARE) out.add(t)
  })
  return out
}

/** Pieces the new pictures earn a place on her loves list, most frequent first. */
export function lovesToAdd(
  before: string[][],
  after: string[][],
  prefs: { types_loved?: string[] | null; types_avoided?: string[] | null },
): string[] {
  const was = qualifyingTypes(before)
  const loved = new Set(prefs.types_loved ?? [])
  const avoided = new Set(prefs.types_avoided ?? [])
  const counts = typeCounts(after)
  return Array.from(qualifyingTypes(after))
    .filter((t) => !was.has(t) && !loved.has(t) && !avoided.has(t))
    .sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))
}

/**
 * Read her scored pictures and add what they earn to her loves list.
 * newImageIds: the pictures just added — everything else counts as "before".
 * Pass null to treat every picture as new (a first backfill).
 */
export async function updateLovesFromReferences(
  admin: any,
  memberId: string,
  newImageIds: string[] | null,
): Promise<{ added: string[]; error?: string }> {
  const { data: member, error: merr } = await admin
    .from('pilot_member').select('auth_user_id, types_loved, types_avoided').eq('member_id', memberId).single()
  if (merr || !member) return { added: [], error: merr?.message ?? 'Member not found' }
  const owners = [memberId, member.auth_user_id].filter(Boolean)
  const { data: pics, error } = await admin.from('inspiration_image')
    .select('image_id, scores').in('user_id', owners).in('status', ['scored', 'confirmed'])
  if (error) return { added: [], error: error.message }
  const isNew = new Set(newImageIds ?? [])
  const all = ((pics ?? []) as any[]).map((p) => ({ id: p.image_id, types: (p.scores?.item_types ?? []) as string[] }))
  const before = newImageIds === null ? [] : all.filter((p) => !isNew.has(p.id)).map((p) => p.types)
  const added = lovesToAdd(before, all.map((p) => p.types), member)
  if (!added.length) return { added }
  const { error: uerr } = await admin.from('pilot_member')
    .update({ types_loved: [...(member.types_loved ?? []), ...added] }).eq('member_id', memberId)
  return uerr ? { added: [], error: uerr.message } : { added }
}
