'use server'

import { createAdminClient } from '@/lib/supabase-server'

export interface ApplicationInput {
  name: string
  email: string
  brands: string
  priceRange: string
  inspiration: string
  note?: string
}

// Store a private-stylist application. Anonymous — written with the service-role
// admin client since the table is RLS-locked to server only.
export async function submitApplication(
  input: ApplicationInput,
): Promise<{ ok?: boolean; error?: string }> {
  const email = (input.email ?? '').trim()
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { error: 'Please enter a valid email so we can reach you.' }
  }
  try {
    const admin = createAdminClient() as any
    const { error } = await admin.from('application').insert({
      name: input.name?.trim() || null,
      email,
      brands: input.brands?.trim() || null,
      price_range: input.priceRange?.trim() || null,
      style_inspiration: input.inspiration?.trim() || null,
      note: input.note?.trim() || null,
    })
    if (error) return { error: error.message }
    return { ok: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not submit your application.' }
  }
}
