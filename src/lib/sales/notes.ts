// TELLING HER ABOUT A SALE — once per sale, at her own brands, never a flood.
//
// The moment one of her NAMED brands goes on sale with pieces she could buy
// in her size, she gets one note and a push: "ME+EM is on sale — 6 pieces in
// your size, up to 30% off." At most three a day; whatever is left waits for
// the evening round-up, all in one line. Each sale is told once (sale_note).
//
// The heads-up goes once, from the start of the Black Friday weeks: what her
// wardrobe is short of, and that WAIT FOR SALE will catch what she is eyeing.

import 'server-only'
import { notifyMember } from '@/lib/push/notify'
import { ukDay, ukHour } from '@/lib/saved-search'
import { salePicksFor, type SaleBrand } from './picks'
import { BLACK_FRIDAY, inBlackFriday } from './detect'
import type { WardrobeGap } from '@/lib/mirror/gaps'

export const MAX_SALE_NOTES_A_DAY = 3
/** Nothing on her phone before 8 or after 9 in the evening (UK). */
const QUIET = { from: 8, to: 21 }
const ROUNDUP_HOUR = 18
export const SALE_PATH = '/me?door=sale'

const SLOT_WORD: Record<string, string> = {
  top: 'tops', bottom: 'trousers and skirts', shoe: 'shoes', outerwear: 'a coat', dress: 'dresses', bag: 'a bag', jewellery: 'jewellery', accessory: 'accessories',
}

export function headsUpMessage(gaps: WardrobeGap[]): string {
  const short = gaps.slice(0, 2).map((g) => SLOT_WORD[g.slot] ?? g.slot)
  const lead = short.length ? `Your wardrobe is short of ${short.join(' and ')}. ` : ''
  return `Black Friday sales are starting early. ${lead}Ring WAIT FOR SALE on anything you're eyeing and MYRA will tell you the moment it drops.`
}

export function brandSaleMessage(b: SaleBrand): string {
  const n = `${b.count} ${b.count === 1 ? 'piece' : 'pieces'} in your size`
  return `${b.name} is on sale — ${n}, ${b.line.toLowerCase()}.`
}

export function roundupMessage(list: SaleBrand[]): string {
  const names = list.slice(0, 3).map((b) => b.name)
  const more = list.length > 3 ? ` and ${list.length - 3} more` : ''
  return `Also on sale today: ${names.join(', ')}${more}. Your picks are waiting in For You.`
}

export interface MemberSaleReport { member: string; told: string[]; skipped?: string; error?: string }

export async function tellMemberAboutSales(admin: any, m: { member_id: string; name?: string | null }, opts: { dry?: boolean; now?: Date; anyHour?: boolean } = {}): Promise<MemberSaleReport> {
  const now = opts.now ?? new Date()
  const report: MemberSaleReport = { member: m.name ?? m.member_id, told: [] }
  const hour = ukHour(now)
  if (!opts.anyHour && (hour < QUIET.from || hour >= QUIET.to)) { report.skipped = 'quiet hours'; return report }

  const view = await salePicksFor(admin, m.member_id, { limit: 0 })
  const { data: past } = await admin.from('sale_note').select('brand_id, sale_started_at, kind, told_at').eq('member_id', m.member_id)
  const notes = (past ?? []) as any[]
  const today = ukDay(now)
  const toldToday = notes.filter((n) => n.kind === 'brand_sale' && ukDay(n.told_at) === today).length
  const record = async (row: Record<string, unknown>) => { if (!opts.dry) await admin.from('sale_note').insert({ member_id: m.member_id, ...row }) }
  const send = async (body: string, title: string) => {
    if (opts.dry) return
    await notifyMember(admin, { memberId: m.member_id, kind: 'sale', body }, { title, url: SALE_PATH, collapseId: 'sale' })
  }

  // The heads-up: once, from the first day of the Black Friday weeks.
  if (inBlackFriday(now) && !notes.some((n) => n.kind === 'heads_up')) {
    const body = headsUpMessage(view.gaps)
    await send(body, 'Black Friday is coming')
    await record({ kind: 'heads_up', brand_id: null, sale_started_at: null })
    report.told.push(`heads-up: ${body}`)
  }

  // Her named brands' sales she has not heard of, preferred labels first.
  const told = new Set(notes.filter((n) => n.kind !== 'heads_up').map((n) => `${n.brand_id}|${n.sale_started_at ? Date.parse(n.sale_started_at) : 0}`))
  const fresh = view.brands.filter((b) => b.named && b.count > 0 && !told.has(`${b.brand_id}|${b.started_at ? Date.parse(b.started_at) : 0}`))
  let room = Math.max(0, MAX_SALE_NOTES_A_DAY - toldToday)
  const waiting: SaleBrand[] = []
  for (const b of fresh) {
    if (room <= 0) { waiting.push(b); continue }
    const body = brandSaleMessage(b)
    await send(body, `${b.name} is on sale`)
    await record({ kind: 'brand_sale', brand_id: b.brand_id, sale_started_at: b.started_at })
    report.told.push(body)
    room--
  }
  // The rest, in one line in the evening.
  if (waiting.length && hour >= ROUNDUP_HOUR) {
    const body = roundupMessage(waiting)
    await send(body, 'More of your brands are on sale')
    for (const b of waiting) await record({ kind: 'roundup', brand_id: b.brand_id, sale_started_at: b.started_at })
    report.told.push(body)
  }
  return report
}

export { BLACK_FRIDAY }
