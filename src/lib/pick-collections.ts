// The curated OUR PICKS collections — one definition shared by the landing
// section, the public /picks/[collection] page, and the admin curation screen,
// so adding a collection is a single edit here plus curating it in the studio.
//
// `art` is an optional hand-made cutout in /public (the Cult Gaia Amun is
// background-removed so it can hang off the S of PICKS). When a collection has
// no cutout, the landing tile falls back to the FIRST curated item's own
// product photo — so a new collection goes live the moment it's curated,
// without waiting on artwork.

/**
 * What a collection is made of. 'item' collections are shoppable products
 * (each links out to a retailer); 'outfit' collections are complete looks
 * (each opens the outfit page). One pick row can point at either — see
 * migration 0051.
 */
export type PickKind = 'item' | 'outfit'

export interface PickCollectionConfig {
  slug: string
  /** Heading on /picks/[slug]. */
  title: string
  /** Caption under the tile on the landing page. */
  label: string
  kind: PickKind
  /** Optional hand-made cutout in /public. */
  art?: string
  /**
   * Ask Cloudinary to strip the background from the lead item's photo, so the
   * tile reads as a cutout hanging on the page like the bag rather than a
   * product shot in a white box. Only applies to Cloudinary-hosted images, and
   * the tile falls back to the untouched photo if the transform doesn't
   * resolve — see the FallbackImage ladder in OurPicks.
   */
  cutout?: boolean
}

// Every collection is currently item-based. The 'outfit' kind is fully wired
// end to end — schema (migration 0051), the admin look picker, and the
// /picks/[slug] look grid — and switching a collection over is this one field.
// It's kept ready for the next collection that should hold whole looks.
export const PICK_COLLECTIONS: PickCollectionConfig[] = [
  { slug: 'bags', title: 'Summer Bags', label: 'SUMMER BAGS', kind: 'item', art: '/amun-cutout.png' },
  { slug: 'mint', title: 'Mint Green', label: 'MINT GREEN', kind: 'item', cutout: true },
]

export function pickKind(slug: string): PickKind {
  // 'picks' (the main grid) isn't in the list above but is item-based.
  return PICK_COLLECTIONS.find((c) => c.slug === slug)?.kind ?? 'item'
}

export function pickCollection(slug: string): PickCollectionConfig | undefined {
  return PICK_COLLECTIONS.find((c) => c.slug === slug)
}

/** Slugs curatable in the admin studio, alongside the 'picks' grid itself. */
export const CURATABLE_COLLECTIONS = PICK_COLLECTIONS.map((c) => c.slug)
