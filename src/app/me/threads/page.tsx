import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

// THREADS — everything MYRA has learned about her, and where each part came from.
export default function ThreadsPage() {
  redirect('/me/profile?tab=threads')
}
