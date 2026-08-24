// The curated OUR PICKS collections — one definition shared by the landing
// section, the public /picks/[collection] page, and the admin curation screen,
// so adding a collection is a single edit here plus curating it in the studio.
//
// `art` is an optional hand-made cutout in /public (the Cult Gaia Amun is
// background-removed so it can hang off the S of PICKS). When a collection has
// no cutout, the landing tile falls back to the FIRST curated item's own
// product photo — so a new collection goes live the moment it's curated,
// without waiting on artwork.

export interface PickCollectionConfig {
  slug: string
  /** Heading on /picks/[slug]. */
  title: string
  /** Caption under the tile on the landing page. */
  label: string
  /** Optional background-removed cutout in /public. */
  art?: string
}

export const PICK_COLLECTIONS: PickCollectionConfig[] = [
  { slug: 'bags', title: 'Summer Bags', label: 'SUMMER BAGS', art: '/amun-cutout.png' },
  { slug: 'mint', title: 'Mint Green', label: 'MINT GREEN' },
]

export function pickCollection(slug: string): PickCollectionConfig | undefined {
  return PICK_COLLECTIONS.find((c) => c.slug === slug)
}

/** Slugs curatable in the admin studio, alongside the 'picks' grid itself. */
export const CURATABLE_COLLECTIONS = PICK_COLLECTIONS.map((c) => c.slug)
