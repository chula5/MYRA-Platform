// Which calendar events are something to DRESS for — and what kind of dressing.
// Pure and deterministic: a title and a place, read against plain words. Most of
// a calendar is not an outfit (dentist, school run, bin day), so anything that
// matches nothing is simply left out. Maps onto the pilot's own occasion ids.

export type CalendarOccasion = 'event' | 'dinner_drinks' | 'travel' | 'work_elevated' | 'casual_day'

const RULES: { occasion: CalendarOccasion; label: string; re: RegExp }[] = [
  { occasion: 'event', label: 'An occasion', re: /\b(wedding|hen (do|party|weekend)|christening|baptism|bar mitzvah|bat mitzvah|engagement|anniversary|birthday|party|gala|ball|black tie|ceremony|graduation|funeral|memorial|races|ascot|henley|wimbledon|premiere|opening night|awards?|reception|baby shower|bridal shower|garden party|fundraiser|charity (dinner|lunch|ball))\b/i },
  { occasion: 'travel', label: 'A trip', re: /\b(flight|fly(ing)? to|holiday|vacation|trip|city break|weekend away|getaway|hotel|airbnb|villa|eurostar|check[- ]?in|honeymoon|ski(ing)?|safari|cruise)\b/i },
  { occasion: 'dinner_drinks', label: 'Dinner or drinks', re: /\b(dinner|supper|drinks|cocktails?|date night|restaurant|lunch|brunch|afternoon tea|theatre|theater|opera|ballet|concert|gig|show|exhibition|private view|tasting|bar|pub)\b/i },
  { occasion: 'work_elevated', label: 'Work, visible', re: /\b(interview|presentation|presenting|pitch|keynote|panel|conference|client (meeting|lunch|dinner)|board meeting|speaking|talk|photoshoot|photo shoot|headshots?|launch|networking|summit|offsite|away day)\b/i },
  { occasion: 'casual_day', label: 'A day out', re: /\b(picnic|bbq|barbecue|festival|fete|fair|match|game day|spa day|walk with|coffee with|playdate|school (play|concert|sports day)|parents.? evening)\b/i },
]

// Never an outfit, whatever else the title says.
const NOT_AN_OUTFIT = /\b(dentist|doctor|gp|hospital|vet|mot|service|delivery|collection|bin|bins|reminder|pay|invoice|renew|call|zoom|teams|standup|stand-up|1:1|sync|webinar|deadline|school run|pick ?up|drop ?off|gym|pilates|yoga|class|physio|hair|nails|wax|blood test|vaccin|boiler|plumber|electrician|window cleaner|cleaner)\b/i

export function readCalendarOccasion(title: string, location?: string | null): { occasion: CalendarOccasion; label: string } | null {
  const text = `${title} ${location ?? ''}`
  if (NOT_AN_OUTFIT.test(title)) {
    // "Dinner after the dentist" is still dinner — only bail when nothing dressy is named.
    if (!RULES.some((r) => r.occasion !== 'casual_day' && r.re.test(title))) return null
  }
  for (const r of RULES) if (r.re.test(text)) return { occasion: r.occasion, label: r.label }
  return null
}
