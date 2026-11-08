// SALES — Black Friday and every sale after it (Vercel cron; see vercel.json).
//
// Every hour: sweep the watched Shopify brands for today's price and was-price
// (lib/sales/sweep, stalest first, as many as the budget allows — every brand
// is read every few hours), then tell each member about sales at her own
// brands (lib/sales/notes): once per sale, three a day at most, the rest in
// the evening round-up; and the Black Friday heads-up, once.
//
//     curl -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/cron/sales?dry=1"
//
//   ?brand=<brand_id>   sweep one brand only
//   ?member=<id>        tell one member only
//   ?sweep=0            skip the sweep, only tell
//   ?tell=0             only sweep
//   ?dry=1              tell nobody (the sweep still writes prices — they are facts)
//   ?any_hour=1         ignore quiet hours

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { brandsToSweep, sweepBrand, type SweepResult } from '@/lib/sales/sweep'
import { tellMemberAboutSales, type MemberSaleReport } from '@/lib/sales/notes'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const SWEEP_BUDGET_MS = 200_000

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) return new NextResponse('Unauthorized', { status: 401 })
  const q = req.nextUrl.searchParams
  const dry = q.get('dry') === '1'
  const admin = createAdminClient() as any
  const started = Date.now()

  const swept: SweepResult[] = []
  if (q.get('sweep') !== '0') {
    for (const b of await brandsToSweep(admin, q.get('brand'))) {
      if (Date.now() - started > SWEEP_BUDGET_MS) break
      try { swept.push(await sweepBrand(admin, b)) }
      catch (err) { swept.push({ brand: b.name, read: 0, matched: 0, changed: 0, onSale: 0, active: false, told: 0, error: err instanceof Error ? err.message : String(err) }) }
    }
  }

  const told: MemberSaleReport[] = []
  if (q.get('tell') !== '0') {
    let members = admin.from('pilot_member').select('member_id, name').eq('is_synthetic', false).not('auth_user_id', 'is', null)
    if (q.get('member')) members = members.eq('member_id', q.get('member'))
    const { data: rows } = await members
    for (const m of (rows ?? []) as any[]) {
      if (Date.now() - started > 280_000) break
      try { told.push(await tellMemberAboutSales(admin, m, { dry, anyHour: q.get('any_hour') === '1' })) }
      catch (err) { told.push({ member: m.name ?? m.member_id, told: [], error: err instanceof Error ? err.message : String(err) }) }
    }
  }

  return NextResponse.json({
    dry,
    swept: swept.length,
    onSale: swept.filter((s) => s.active).map((s) => `${s.brand} (${s.onSale})`),
    started: swept.filter((s) => s.started).map((s) => s.brand),
    ended: swept.filter((s) => s.ended).map((s) => s.brand),
    errors: swept.filter((s) => s.error).map((s) => `${s.brand}: ${s.error}`),
    told,
  })
}
