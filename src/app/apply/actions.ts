'use server'

import { createAdminClient } from '@/lib/supabase-server'
import { sendApplicationReceivedEmail } from '@/lib/studio/application-received-email'
import { readSwitch } from '@/lib/site-switch'
import { acceptApplicationCore } from '@/lib/applications/accept'

/**
 * AUTO-ACCEPT (Chloe's switch on /admin/applications): at most this many
 * sign-ups a day are let in by themselves — past it they wait for ACCEPT as
 * before, so a burst of fake sign-ups cannot send a stream of invitations.
 */
const AUTO_ACCEPT_PER_DAY = 25

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
    const { data: saved, error } = await admin.from('application').insert({
      name: input.name?.trim() || null,
      email,
      brands: input.brands?.trim() || null,
      price_range: input.priceRange?.trim() || null,
      style_inspiration: input.inspiration?.trim() || null,
      note: input.note?.trim() || null,
    }).select('id').single()
    if (error) return { error: error.message }

    // AUTO-ACCEPT: she becomes a member and her invitation goes out now. A
    // failure here never fails her sign-up: the application stays NEW for
    // Chloe to ACCEPT by hand.
    let accepted = false
    try {
      if (saved?.id && (await readSwitch(admin, 'auto_accept_applications'))) {
        const since = new Date(Date.now() - 864e5).toISOString()
        const { count } = await admin.from('application').select('id', { count: 'exact', head: true })
          .eq('status', 'accepted').gte('reviewed_at', since).is('review_note', null)
        if ((count ?? 0) < AUTO_ACCEPT_PER_DAY) {
          const res = await acceptApplicationCore(admin, saved.id, process.env.ADMIN_USER_ID ?? 'auto', { auto: true })
          accepted = !!res.ok
          if (res.error) console.error('[submitApplication] auto-accept failed', res.error)
        } else {
          console.warn('[submitApplication] auto-accept cap reached; left for ACCEPT')
        }
      }
    } catch (err) {
      console.error('[submitApplication] auto-accept failed', err)
    }
    // Tell Chloe at once. Her thank-you never waits on this, and a failed
    // send is only logged: the application is already saved.
    try {
      await sendApplicationReceivedEmail({
        name: input.name?.trim() || null,
        email,
        brands: input.brands?.trim() || null,
        priceRange: input.priceRange?.trim() || null,
        inspiration: input.inspiration?.trim() || null,
        note: input.note?.trim() || null,
        accepted,
      })
    } catch (err) {
      console.error('[submitApplication] notification email failed', err)
    }
    return { ok: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not submit your application.' }
  }
}
