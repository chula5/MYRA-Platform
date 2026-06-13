'use server'

import { createAdminClient } from '@/lib/supabase-server'

const ROLE = 'early_access'

// Bump login_count + last_login_at whenever an early-access person signs in.
export async function recordEarlyAccessLogin(userId: string): Promise<void> {
  if (!userId) return
  try {
    const admin = createAdminClient()
    const { data } = await admin.auth.admin.getUserById(userId)
    const meta = ((data?.user?.user_metadata as Record<string, unknown>) || {})
    if (meta.role !== ROLE) return
    const login_count = (Number(meta.login_count) || 0) + 1
    await admin.auth.admin.updateUserById(userId, {
      user_metadata: { ...meta, login_count, last_login_at: new Date().toISOString() },
    })
  } catch (err) {
    console.error('[recordEarlyAccessLogin]', err)
  }
}

// Bump visit_count when an early-access person opens the site, throttled so a
// fresh visit only counts after 30 min of inactivity (i.e. roughly "sessions",
// not raw page refreshes). last_seen_at always updates.
export async function recordEarlyAccessVisit(userId: string): Promise<void> {
  if (!userId) return
  try {
    const admin = createAdminClient()
    const { data } = await admin.auth.admin.getUserById(userId)
    const meta = ((data?.user?.user_metadata as Record<string, unknown>) || {})
    if (meta.role !== ROLE) return
    const now = Date.now()
    const last = meta.last_seen_at ? new Date(String(meta.last_seen_at)).getTime() : 0
    const THIRTY_MIN = 30 * 60 * 1000
    const isNewVisit = now - last > THIRTY_MIN
    const visit_count = (Number(meta.visit_count) || 0) + (isNewVisit ? 1 : 0)
    await admin.auth.admin.updateUserById(userId, {
      user_metadata: { ...meta, visit_count, last_seen_at: new Date().toISOString() },
    })
  } catch (err) {
    console.error('[recordEarlyAccessVisit]', err)
  }
}
