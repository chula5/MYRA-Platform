import { loadMyLooks, markNotificationsRead } from './actions'
import MyLooksClient, { type LooksLanding } from './MyLooksClient'

export const dynamic = 'force-dynamic'

// Her ask composes in the background once the response has gone out; the
// route needs the minutes for that, not the seconds a page normally gets.
export const maxDuration = 60

const SHELF_KEYS = ['emailed', 'asked', 'new', 'saved'] as const

export default async function MyLooksPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = (await searchParams) ?? {}
  const one = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : undefined)
  const view = await loadMyLooks()
  // Seeing the page is reading the notification.
  if (view.unread) await markNotificationsRead()
  // A link from an email: ?look=<id> opens that outfit, ?emailed=<delivery>&piece=<item>
  // opens that note's outfits for one piece, ?saved=1 says SAVE worked.
  const shelf = SHELF_KEYS.find((k) => k === one('shelf'))
  const landing: LooksLanding | undefined = one('look') || one('emailed') || shelf || one('saved')
    ? { look: one('look'), emailed: one('emailed'), piece: one('piece'), shelf, saved: one('saved') === '1' }
    : undefined
  return <MyLooksClient view={view} initialQuery={one('q') ?? ''} landing={landing} />
}
