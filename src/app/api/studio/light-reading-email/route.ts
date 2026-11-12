// The Data Fashion Brief light-reading email, as MYRA. Admin-gated, and for
// now a SAMPLE ONLY: one copy to one address so Chloe can approve the exact
// email in a real inbox before any member send is built.
//
//   /api/studio/light-reading-email?to=you@example.com&name=Chloe

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-server'
import { sendDataBriefEmail } from '@/lib/studio/data-brief-email'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.id !== process.env.ADMIN_USER_ID) return new NextResponse('Not found', { status: 404 })
  const to = req.nextUrl.searchParams.get('to')?.trim() ?? ''
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return NextResponse.json({ error: `Not a valid address: ${to || '(none)'} — add ?to=` }, { status: 400 })
  const result = await sendDataBriefEmail(to, req.nextUrl.searchParams.get('name')?.trim() || '', { sample: true })
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
}
