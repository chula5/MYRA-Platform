// What a client can ask for, in her words rather than the taxonomy's.
//
// A plain module, not the actions file: a 'use server' file may only export
// async functions, and exporting these constants from there took the whole
// client area down with a build error.

export const CLIENT_OCCASIONS = [
  { id: 'casual_day', label: 'A normal day' },
  { id: 'dinner_drinks', label: 'Dinner or drinks' },
  { id: 'work_standard', label: 'Work' },
  { id: 'work_elevated', label: 'Something important at work' },
  { id: 'event', label: 'An occasion' },
  { id: 'travel', label: 'A trip' },
] as const

export const CLIENT_CLIMATES = [
  { id: 'hot', label: 'Somewhere hot' },
  { id: 'temperate', label: 'Mild' },
  { id: 'cold', label: 'Cold' },
] as const

// The fuller brief in her Ask MYRA pop-out. Each kind rides on one of the
// composer's occasions above; the rest travels as the brief.
export const ASK_KINDS: { id: string; label: string; occasion: string; where?: string[]; whereWithKids?: string[]; needs?: string; more?: boolean }[] = [
  { id: 'everyday', label: 'Everyday', occasion: 'casual_day', where: ['Errands', 'Lunch with friends', 'At home'], whereWithKids: ['School run'] },
  { id: 'work', label: 'Work', occasion: 'work_standard', where: ['Office', 'Client meeting', 'Presenting', 'Working from home'] },
  { id: 'dinner', label: 'Dinner or drinks', occasion: 'dinner_drinks', where: ['Local spot', 'Smart restaurant', "Members' club", "Someone's home"] },
  { id: 'date', label: 'A date', occasion: 'dinner_drinks', where: ['Local spot', 'Smart restaurant', 'Bar', 'Something outdoors'] },
  { id: 'kids', label: 'A kids\u2019 event', occasion: 'casual_day', needs: 'kids', where: ['School gate', 'Sports day', 'Kids\u2019 party', 'Nativity or concert', 'Parents\u2019 evening'] },
  { id: 'event', label: 'An event', occasion: 'event', where: ['Party', 'Gallery or show', 'Garden', 'Daytime do'] },
  { id: 'wedding', label: 'Wedding or celebration', occasion: 'event', where: ['Church or registry', 'Garden', 'Country house', 'Evening reception'] },
  { id: 'trip', label: 'A trip', occasion: 'travel', where: ['City break', 'Beach', 'Countryside', 'Skiing'] },
  { id: 'black_tie', label: 'Black tie', occasion: 'event' },
  // Behind "+ More occasions".
  { id: 'work_big', label: 'A big day at work', occasion: 'work_elevated', where: ['Interview', 'Presenting', 'Conference', 'Client dinner'], more: true },
  { id: 'birthday', label: 'A birthday', occasion: 'event', where: ['Lunch', 'Dinner', 'Party', 'At home'], more: true },
  { id: 'christening', label: 'Christening', occasion: 'event', more: true },
  { id: 'funeral', label: 'Funeral or memorial', occasion: 'event', more: true },
  { id: 'races', label: 'The races', occasion: 'event', more: true },
  { id: 'garden_party', label: 'Garden party', occasion: 'event', more: true },
  { id: 'graduation', label: 'Graduation', occasion: 'event', more: true },
  { id: 'theatre', label: 'Theatre or a show', occasion: 'dinner_drinks', more: true },
  { id: 'family_lunch', label: 'Family lunch', occasion: 'casual_day', where: ['Pub', 'Restaurant', 'At home', 'Outdoors'], more: true },
  { id: 'weekend_away', label: 'A weekend away', occasion: 'travel', where: ['City', 'Country house', 'By the sea'], more: true },
  { id: 'holiday', label: 'A holiday', occasion: 'travel', where: ['Beach', 'City', 'Villa', 'Skiing'], more: true },
]

/** The where options to offer for a kind — school-run answers only for a client with children at home. */
export function whereFor(kind: { where?: string[]; whereWithKids?: string[] } | null, offered: Set<string>): string[] {
  if (!kind) return []
  return [...(kind.whereWithKids && offered.has('kids') ? kind.whereWithKids : []), ...(kind.where ?? [])]
}

/** The brief's kind for something in her calendar: the title first, then the calendar's own read. */
export function askKindForEvent(title: string, occasion: string | null): string {
  const t = title.toLowerCase()
  const rules: [RegExp, string][] = [
    [/wedding|engagement|anniversary|hen (do|party)/, 'wedding'], [/black tie|gala|\bball\b/, 'black_tie'],
    [/christening|baptism/, 'christening'], [/funeral|memorial/, 'funeral'], [/races|ascot/, 'races'],
    [/graduation/, 'graduation'], [/garden party/, 'garden_party'], [/birthday/, 'birthday'],
    [/school|sports day|nativity|parents.? evening|kids|children|playdate/, 'kids'],
    [/theatre|theater|opera|ballet|concert|gig|show/, 'theatre'], [/date night|\bdate\b/, 'date'],
    [/interview|presentation|pitch|conference|keynote/, 'work_big'], [/holiday|villa|beach/, 'holiday'],
  ]
  for (const [re, id] of rules) if (re.test(t)) return id
  const byOccasion: Record<string, string> = { event: 'event', travel: 'trip', dinner_drinks: 'dinner', work_elevated: 'work_big', work_standard: 'work', casual_day: 'everyday' }
  return (occasion && byOccasion[occasion]) || 'event'
}

export const ASK_WHEN = ['Day', 'Day into night', 'Evening', 'Late'] as const
export const ASK_FEEL = ['Easy', 'Polished', 'Noticed'] as const
export const ASK_WEATHER = ['Hot', 'Mild', 'Cold', 'Rain', 'Mostly indoors'] as const
export const ASK_LIMITS = ['Flat shoes', 'Lots of walking', 'Sitting on the floor', 'Arms covered', 'Nothing dry-clean only'] as const
export const ASK_BUDGET = ['Only what I own', 'Under £150', '£150–£400', 'Worth investing'] as const

export const OCCASION_LABEL: Record<string, string> = {
  work_standard: 'Work', work_elevated: 'Work — client days',
  casual_day: 'Daytime', dinner_drinks: 'Dinners and drinks',
  event: 'Occasions', travel: 'Trips',
}

// How often she dresses for each occasion, most often first. 'never' (or not
// set) drops the occasion entirely — a client who does not work is never
// offered "Work".
const FREQUENCY_RANK: Record<string, number> = { 'most days': 3, 'weekly': 2, '1-2 / month': 1 }

/**
 * The occasion ids to offer this client, ordered by how often she dresses for
 * them. Falls back to every occasion only when no profile has been filled in
 * at all — an empty profile says nothing, where an explicit 'never' does.
 */
export function occasionsForMember(profile: Record<string, string> | null | undefined): string[] {
  const all = CLIENT_OCCASIONS.map((o) => o.id as string)
  if (!profile || !Object.keys(profile).length) return all
  const ranked = all
    .filter((id) => (FREQUENCY_RANK[profile[id]] ?? 0) > 0)
    .sort((a, b) => (FREQUENCY_RANK[profile[b]] ?? 0) - (FREQUENCY_RANK[profile[a]] ?? 0))
  // Not an occasion MYRA composes for — it says whether children's things belong in her brief at all.
  return (FREQUENCY_RANK[profile.kids ?? ''] ?? 0) > 0 ? [...ranked, 'kids'] : ranked
}
