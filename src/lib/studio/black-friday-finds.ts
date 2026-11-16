// BLACK FRIDAY AT YOUR BRANDS — one email with only the Black Friday finds at
// her favourite brands (the ones she named), in her size, under her budget at
// the sale price, with the original and the sale price. Chloe's ask, 2026-11-16:
// "send just the black friday finds from their favourite brands tomorrow".
//
// Same sale pass as the Monday edit (lib/sales/picks: her taste graph, size,
// bands, the reach gate, loves → taste → markdown), kept to named brands and
// shown by brand. A member whose named brands have nothing gets her nearest
// brands instead, and the intro says so.

import 'server-only'
import { salePicksFor, type SalePiece, type SaleBrand } from '@/lib/sales/picks'
import { memberCardShell, siteUrl } from './email'
import { greetingName } from './black-friday-email'
import { esc, p, h, b, sectionLink, pieceLink, rows, salePriceHtml, isHomeware } from './monday-edit'

export const FINDS_BRANDS = 4
export const FINDS_PER_BRAND = 4

export interface FindsMember { member_id: string; name: string | null; auth_user_id: string | null }
export interface FindsBrand extends SaleBrand { pieces: SalePiece[] }
export interface BlackFridayFinds { brands: FindsBrand[]; favourites: boolean; total: number; onSale: number }

export async function gatherBlackFridayFinds(admin: any, m: FindsMember): Promise<BlackFridayFinds> {
  const sale = await salePicksFor(admin, m.member_id, { limit: 500 })
  const pieces = sale.pieces.filter((sp) => !isHomeware(sp.product_name))
  const group = (brands: SaleBrand[]): FindsBrand[] => brands
    .map((sb) => ({ ...sb, pieces: pieces.filter((sp) => sp.brand === sb.name).slice(0, FINDS_PER_BRAND) }))
    .filter((fb) => fb.pieces.length)
    .slice(0, FINDS_BRANDS)
  const named = group(sale.brands.filter((sb) => sb.named))
  const favourites = named.reduce((n, fb) => n + fb.pieces.length, 0) >= 3
  const brands = favourites ? named : group(sale.brands)
  return { brands, favourites, total: pieces.length, onSale: sale.brands.length }
}

export const noFinds = (f: BlackFridayFinds) => !f.brands.length

const listOf = (parts: string[]) => parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`

export function findsSubject(f: BlackFridayFinds): string {
  const names = f.brands.map((fb) => fb.name)
  return `Black Friday at ${f.favourites ? 'your brands' : 'brands near yours'}: ${listOf(names)}`
}

export function findsHtml(member: FindsMember, f: BlackFridayFinds, site?: string): string {
  const base = site ?? siteUrl('')
  const first = greetingName(member.name)
  const parts: string[] = []
  const count = f.total >= 500 ? 'more than 500 pieces' : `${f.total} ${f.total === 1 ? 'piece' : 'pieces'}`
  parts.push(p(f.favourites
    ? `${first ? `${esc(first)}, ` : ''}${f.onSale === 1 ? 'one of your brands is' : `${f.onSale} of your brands are`} in Black Friday sale now, ${b(count)} of it in your size and under your budget at the sale price. Your favourites first.`
    : `${first ? `${esc(first)}, ` : ''}your own brands have not started their Black Friday yet, so here is what is on at the brands nearest yours: ${b(count)} in your size and under your budget at the sale price.`))
  for (const fb of f.brands) {
    parts.push(h(`${esc(fb.name.toUpperCase())} &middot; ${esc(fb.line.toUpperCase())}`))
    parts.push(rows(fb.pieces.map((sp) => ({
      href: pieceLink(sp.item_id, base), image_url: sp.image_url, brand: null, name: sp.product_name,
      priceHtml: salePriceHtml(sp), note: sp.reason, action: 'SEE IT',
    }))))
  }
  parts.push(sectionLink(`${base}/me?door=sale`, 'SEE YOUR WHOLE BLACK FRIDAY EDIT'))
  parts.push(h('NOT ON SALE YET?'))
  parts.push(p('Save the piece you are waiting for and tap WAIT FOR SALE. MYRA watches the price and tells you the day it drops, in your size.'))
  parts.push(sectionLink(`${base}/me/dressing-room?tab=saved`, 'YOUR SAVED PIECES'))
  parts.push(p('Reply to this email and it comes straight to Chloe.', 'margin-top:26px;'))
  return memberCardShell('Black Friday at your brands', parts.join('\n'))
}
