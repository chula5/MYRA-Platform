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
export const ASK_KINDS: { id: string; label: string; occasion: string; where?: string[] }[] = [
  { id: 'everyday', label: 'Everyday', occasion: 'casual_day', where: ['School run', 'Errands', 'Lunch with friends', 'At home'] },
  { id: 'work', label: 'Work', occasion: 'work_standard', where: ['Office', 'Client meeting', 'Presenting', 'Working from home'] },
  { id: 'work_big', label: 'A big day at work', occasion: 'work_elevated' },
  { id: 'dinner', label: 'Dinner or drinks', occasion: 'dinner_drinks', where: ['Local spot', 'Smart restaurant', "Members' club", "Someone's home"] },
  { id: 'date', label: 'A date', occasion: 'dinner_drinks', where: ['Local spot', 'Smart restaurant', 'Bar', 'Something outdoors'] },
  { id: 'event', label: 'An event', occasion: 'event', where: ['Party', 'Gallery or show', 'Garden', 'Daytime do'] },
  { id: 'wedding', label: 'Wedding or celebration', occasion: 'event', where: ['Church or registry', 'Garden', 'Country house', 'Evening reception'] },
  { id: 'black_tie', label: 'Black tie', occasion: 'event' },
  { id: 'trip', label: 'A trip', occasion: 'travel', where: ['City break', 'Beach', 'Countryside', 'Skiing'] },
]
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
  return all
    .filter((id) => (FREQUENCY_RANK[profile[id]] ?? 0) > 0)
    .sort((a, b) => (FREQUENCY_RANK[profile[b]] ?? 0) - (FREQUENCY_RANK[profile[a]] ?? 0))
}
