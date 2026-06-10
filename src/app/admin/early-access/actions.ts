'use server'

import { createAdminClient } from '@/lib/supabase-server'
import { revalidatePath } from 'next/cache'

export interface EarlyAccessUser {
  id: string
  email: string | null
  created_at: string
  last_sign_in_at: string | null
}

const ROLE = 'early_access'

export async function listEarlyAccessUsers(): Promise<{ users: EarlyAccessUser[]; error?: string }> {
  const admin = createAdminClient()
  try {
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
    if (error) throw error
    const users = data.users
      .filter((u) => (u.user_metadata as any)?.role === ROLE)
      .map((u) => ({
        id: u.id,
        email: u.email ?? null,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at ?? null,
      }))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    return { users }
  } catch (err: unknown) {
    console.error('[listEarlyAccessUsers]', err)
    return { users: [], error: err instanceof Error ? err.message : 'Failed to load users' }
  }
}

export async function createEarlyAccessUser(
  email: string,
  password: string,
): Promise<{ ok?: boolean; error?: string }> {
  const cleanEmail = (email || '').trim().toLowerCase()
  if (!cleanEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) {
    return { error: 'Enter a valid email address' }
  }
  if (!password || password.length < 8) {
    return { error: 'Password must be at least 8 characters' }
  }

  const admin = createAdminClient()
  try {
    const { error } = await admin.auth.admin.createUser({
      email: cleanEmail,
      password,
      email_confirm: true, // pre-confirmed — they can sign in immediately
      user_metadata: { role: ROLE },
    })
    if (error) {
      // Friendlier message for the common "already exists" case
      if (/already|exists|registered/i.test(error.message)) {
        return { error: 'An account with that email already exists' }
      }
      throw error
    }
    revalidatePath('/admin/early-access')
    return { ok: true }
  } catch (err: unknown) {
    console.error('[createEarlyAccessUser]', err)
    return { error: err instanceof Error ? err.message : 'Failed to create login' }
  }
}

export async function deleteEarlyAccessUser(userId: string): Promise<{ ok?: boolean; error?: string }> {
  if (!userId) return { error: 'No user id' }
  const admin = createAdminClient()
  try {
    // Safety: only delete if this user is actually an early-access account.
    const { data: got } = await admin.auth.admin.getUserById(userId)
    if (!got?.user || (got.user.user_metadata as any)?.role !== ROLE) {
      return { error: 'Not an early-access account' }
    }
    const { error } = await admin.auth.admin.deleteUser(userId)
    if (error) throw error
    revalidatePath('/admin/early-access')
    return { ok: true }
  } catch (err: unknown) {
    console.error('[deleteEarlyAccessUser]', err)
    return { error: err instanceof Error ? err.message : 'Failed to revoke login' }
  }
}
