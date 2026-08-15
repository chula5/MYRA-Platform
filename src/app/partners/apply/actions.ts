'use server'

// Public brand application (Part 6). Brands can START without Chloe; nothing
// goes further without her. Auto-qualification runs at submit; obvious
// non-fits are auto-rejected politely, the rest land in the admin queue.

import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase-server'
import { probeStore, autoRejectReason } from '@/lib/partners/qualify'

export async function submitApplication(formData: FormData) {
  const brandName = String(formData.get('brand') ?? '').trim()
  const storeUrl = String(formData.get('store') ?? '').trim()
  const contactName = String(formData.get('name') ?? '').trim()
  const contactEmail = String(formData.get('email') ?? '').trim().toLowerCase()
  const category = String(formData.get('category') ?? '').trim()
  const priceRange = String(formData.get('price_range') ?? '').trim()
  const pitch = String(formData.get('pitch') ?? '').trim()

  if (!brandName || !storeUrl || !contactEmail) redirect('/partners/apply?error=missing')
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail)) redirect('/partners/apply?error=email')

  const qualification = await probeStore(storeUrl)
  const reject = autoRejectReason(qualification)

  const admin = createAdminClient()
  await admin.from('brand_application' as any).insert({
    brand_name: brandName,
    store_url: storeUrl,
    contact_name: contactName || null,
    contact_email: contactEmail,
    category: category || null,
    price_range: priceRange || null,
    pitch: pitch || null,
    qualification: qualification as any,
    status: reject ? 'auto_rejected' : 'pending',
    review_note: reject,
  } as any)

  redirect('/partners/apply?submitted=1')
}
