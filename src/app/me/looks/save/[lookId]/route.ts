// SAVE, from an email — /me/looks/save/<lookId>.
//
// Chloe, 2026-10-20: she wanted to keep one of the outfits MYRA emailed her.
// Every outfit picture in a note has SAVE under it, pointing here. Saving is
// her yes on the look — the same verdict as the thumbs in Looks, so it lands
// in SAVED OUTFITS and teaches her layer — then she is shown the look itself.
// Signed out: through the door and straight back here.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { reactToLook } from '@/app/me/looks/actions'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ lookId: string }> }) {
  const { lookId } = await params
  const here = `/me/looks/save/${encodeURIComponent(lookId)}`
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL(`/signin?next=${encodeURIComponent(here)}`, req.url))
  const r = await reactToLook(lookId, 'yes', null, '')
  const to = new URL('/me/looks', req.url)
  to.searchParams.set('look', lookId)
  to.searchParams.set(r.error ? 'unsaved' : 'saved', '1')
  return NextResponse.redirect(to)
}
