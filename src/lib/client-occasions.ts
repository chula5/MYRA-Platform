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

export const OCCASION_LABEL: Record<string, string> = {
  work_standard: 'Work', work_elevated: 'Work — client days',
  casual_day: 'Daytime', dinner_drinks: 'Dinners and drinks',
  event: 'Occasions', travel: 'Trips',
}
