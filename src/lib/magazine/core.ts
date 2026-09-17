// MYRA MAGAZINE — the pure parts: which emails could be fashion reading, and
// what a read of one may contain. No I/O, no server-only; tested.

import type { MailMessage } from '@/lib/email/purchase-core'

export interface MagazinePick {
  name: string
  brand: string | null
  price: number | null
  currency: string | null
  image_url: string | null
  url: string | null
  /** Why it is hers, in a handful of words. */
  why: string
}

export interface MagazineRead {
  is_newsletter: boolean
  publication: string | null
  headline: string | null
  hero_image: string | null
  picks: MagazinePick[]
}

// Order confirmations, receipts, deliveries and account mail are not reading.
const NOT_A_NEWSLETTER = /\b(order|receipt|invoice|dispatched|shipped|delivered|refund|return|password|verify|sign[- ]?in|security|statement|payment|booking|ticket|appointment)\b/i

/** Could this be a fashion newsletter? Sender and subject only, no AI. */
export function looksLikeNewsletter(m: Pick<MailMessage, 'subject' | 'from'>, ownAddress?: string | null): boolean {
  const subject = m.subject ?? ''
  const from = m.from ?? ''
  if (!subject.trim() || !from.trim()) return false
  if (ownAddress && from.toLowerCase().includes(ownAddress.toLowerCase())) return false
  return !NOT_A_NEWSLETTER.test(subject)
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null)
const url = (v: unknown): string | null => (typeof v === 'string' && /^https?:\/\//i.test(v.trim()) ? v.trim() : null)

export function parseMagazineRead(raw: unknown): MagazineRead {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const picks = (Array.isArray(r.picks) ? r.picks : [])
    .map((x) => (x && typeof x === 'object' ? x : {}) as Record<string, unknown>)
    .map((x): MagazinePick => ({
      name: str(x.name) ?? '',
      brand: str(x.brand),
      price: num(x.price),
      currency: str(x.currency)?.toUpperCase().slice(0, 3) ?? null,
      image_url: url(x.image_url),
      url: url(x.url),
      why: (str(x.why) ?? '').slice(0, 80),
    }))
    .filter((p) => p.name)
    .slice(0, 4)
  return {
    is_newsletter: r.is_newsletter === true,
    publication: str(r.publication),
    headline: str(r.headline),
    hero_image: url(r.hero_image),
    picks,
  }
}

