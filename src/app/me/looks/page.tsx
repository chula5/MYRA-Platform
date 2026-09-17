import { loadMyLooks, markNotificationsRead } from './actions'
import MyLooksClient from './MyLooksClient'

export const dynamic = 'force-dynamic'

export default async function MyLooksPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const view = await loadMyLooks()
  // Seeing the page is reading the notification.
  if (view.unread) await markNotificationsRead()
  return <MyLooksClient view={view} initialQuery={typeof searchParams?.q === 'string' ? searchParams.q : ''} />
}
