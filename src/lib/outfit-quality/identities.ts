// Immutable identity references for the Outfit Quality Lab.
//
// Every identity here is resolved by its immutable UUID and never by a mutable
// display name. The values were reconciled read-only against the connected MYRA
// Platform project. They are identifiers, not secrets.
//
// Member Chloe and stylist Chloe are deliberately different identities with
// different IDs: the member is a real person in `pilot_member`; the stylist is
// a configured aesthetic in `stylist`. Nothing may collapse them by name.

/** The immutable Chloe *stylist* ID. The 444 legacy canonical outfits attribute here. */
export const CHLOE_STYLIST_ID = '0d535772-8a4f-440f-9e46-f8d637bed0d3'

/** The three real (non-synthetic) pilot members, by immutable ID. Pairwise distinct. */
export const REAL_MEMBER_IDS = {
  chloe: '9593c768-cd52-4bf2-99bc-5a44ae2bc8e2',
  alison: 'df918c45-3063-484e-b83b-dc41d25ac804',
  devika: '02c8a944-c507-4647-8a78-7e4607b14778',
} as const

export type RealMemberKey = keyof typeof REAL_MEMBER_IDS

/** All configured real-member IDs, for membership checks. */
export const REAL_MEMBER_ID_LIST: readonly string[] = Object.values(REAL_MEMBER_IDS)
