import { loadMyLooks, markNotificationsRead } from './actions'
import MyLooksClient from './MyLooksClient'

export const dynamic = 'force-dynamic'

export default async function MyLooksPage() {
  const view = await loadMyLooks()
  // Seeing the page is reading the notification.
  if (view.unread) await markNotificationsRead()
  return <MyLooksClient view={view} />
}
