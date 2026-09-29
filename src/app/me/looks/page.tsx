import { loadMyLooks, markNotificationsRead } from './actions'
import MyLooksClient from './MyLooksClient'

export const dynamic = 'force-dynamic'

// Her ask composes in the background once the response has gone out; the
// route needs the minutes for that, not the seconds a page normally gets.
export const maxDuration = 60

export default async function MyLooksPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const view = await loadMyLooks()
  // Seeing the page is reading the notification.
  if (view.unread) await markNotificationsRead()
  return <MyLooksClient view={view} initialQuery={typeof searchParams?.q === 'string' ? searchParams.q : ''} />
}
