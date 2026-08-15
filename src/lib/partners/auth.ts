// Brand-user auth context (Part 4). A brand user is a Supabase auth user with
// a merchant_user mapping — a completely separate context from shoppers, who
// have no mapping and therefore resolve to null here.
//
// Reads in /partners go through the USER-scoped client wherever possible, so
// Postgres RLS enforces tenancy underneath the app layer (defence in depth).

import { createServerClient } from '@/lib/supabase-server'

export interface PartnerContext {
  userId: string
  email: string | null
  merchantId: string
  merchantName: string
  role: 'owner' | 'staff'
}

export async function getPartnerContext(): Promise<PartnerContext | null> {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    // RLS: merchant_user_self restricts this to the caller's own rows.
    const { data: mapping } = await supabase
      .from('merchant_user' as any)
      .select('merchant_id, role')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle()
    const m = mapping as any
    if (!m) return null

    // RLS: merchant_partner_read restricts to their own merchant.
    const { data: merchant } = await supabase
      .from('merchant' as any)
      .select('merchant_id, name')
      .eq('merchant_id', m.merchant_id)
      .maybeSingle()
    if (!merchant) return null

    return {
      userId: user.id,
      email: user.email ?? null,
      merchantId: m.merchant_id,
      merchantName: (merchant as any).name,
      role: m.role === 'owner' ? 'owner' : 'staff',
    }
  } catch {
    return null
  }
}
