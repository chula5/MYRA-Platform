import 'server-only'

// YOU — what her settings room shows, read for one member. The browser-callable
// surface (settings-actions.ts) resolves the member before calling this.

import { createAdminClient } from '@/lib/supabase-server'
import { loadMemberSizeProfile } from '@/lib/size-availability'
import { SIZE_CATEGORIES, type SizeCategory } from '@/lib/size-canonical'
import { listConnections, type EmailConnectionView } from '@/lib/email/connections'
import { listCalendarConnections, type CalendarConnectionView } from '@/lib/calendar/store'
import { listInstagramConnections, type InstagramConnectionView } from '@/lib/archival/store'

export interface YouSizes { value: number | null; adjacent: number | null }

export interface YouSettingsView {
  memberId: string | null
  test: boolean
  name: string
  sizes: Record<SizeCategory, YouSizes>
  acceptsSecondHand: boolean
  coloursLoved: string[]
  coloursAvoided: string[]
  shapesLoved: string[]
  shapesAvoided: string[]
  typesLoved: string[]
  typesAvoided: string[]
  neverWears: string
  inboxes: EmailConnectionView[]
  calendars: CalendarConnectionView[]
  instagram: InstagramConnectionView[]
}

// Before a connection's migration has run its table is missing: show nothing, not an error.
const quiet = async <T,>(p: Promise<T>, fallback: T): Promise<T> => { try { return await p } catch { return fallback } }

export async function buildYouSettings(memberId: string, test: boolean, fallbackName = ''): Promise<YouSettingsView> {
  const admin = createAdminClient() as any
  const [{ data: row }, sizeCtx, inboxes, calendars, instagram] = await Promise.all([
    admin.from('pilot_member').select('name, colours_loved, colours_avoided, shapes_loved, shapes_avoided, types_loved, types_avoided, never_wears').eq('member_id', memberId).maybeSingle(),
    loadMemberSizeProfile(memberId),
    quiet(listConnections(memberId), [] as EmailConnectionView[]),
    quiet(listCalendarConnections(memberId), [] as CalendarConnectionView[]),
    quiet(listInstagramConnections(memberId), [] as InstagramConnectionView[]),
  ])
  const sizes = Object.fromEntries(SIZE_CATEGORIES.map((c) => [c, {
    value: sizeCtx.profile[c]?.value ?? null,
    adjacent: sizeCtx.profile[c]?.adjacent ?? null,
  }])) as Record<SizeCategory, YouSizes>
  return {
    memberId,
    test,
    name: row?.name ?? fallbackName,
    sizes,
    acceptsSecondHand: sizeCtx.acceptsSecondHand,
    coloursLoved: row?.colours_loved ?? [],
    coloursAvoided: row?.colours_avoided ?? [],
    shapesLoved: row?.shapes_loved ?? [],
    shapesAvoided: row?.shapes_avoided ?? [],
    typesLoved: row?.types_loved ?? [],
    typesAvoided: row?.types_avoided ?? [],
    neverWears: row?.never_wears ?? '',
    inboxes, calendars, instagram,
  }
}

