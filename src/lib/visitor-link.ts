// Retro-attribution: claim a browser's earlier anonymous clicks for the account
// that browser turns out to belong to.
//
// Someone browses The Edit logged out, clicks through to three retailers, then
// signs up a week later. Those three clicks are real behaviour by a real person
// we can now name — they were only anonymous because we hadn't met them yet.
//
// The link is made on the visitor id (the browser), never on anything inferred.
// Only rows with a NULL user_id are ever touched, so a click already attributed
// to someone else can't be reassigned — a shared device stays honest.

import { createAdminClient } from '@/lib/supabase-server'

export async function linkVisitorClicks(userId: string, visitorId: string): Promise<number> {
  if (!userId || !visitorId) return 0
  try {
    const admin = createAdminClient()
    const { data, error } = await (admin.from('item_click') as any)
      .update({ user_id: userId })
      .eq('visitor_id', visitorId)
      .is('user_id', null)
      .select('click_id')
    if (error) return 0
    return (data ?? []).length
  } catch (err) {
    console.error('[linkVisitorClicks]', err)
    return 0
  }
}
