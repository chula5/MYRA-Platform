import { describe, it, expect } from 'vitest'
import { looksLikeNewsletter, parseMagazineRead } from '@/lib/magazine/core'

describe('looksLikeNewsletter', () => {
  it('keeps brand and publication reading', () => {
    for (const m of [
      { subject: 'The new season, in one edit', from: 'Sézane <hello@sezane.com>' },
      { subject: 'What to wear when nothing fits', from: 'The Fashion Letter <substack@substack.com>' },
    ]) expect(looksLikeNewsletter(m)).toBe(true)
  })

  it('leaves out order, account and her own mail', () => {
    expect(looksLikeNewsletter({ subject: 'Your order has been dispatched', from: 'Zara <no-reply@zara.com>' })).toBe(false)
    expect(looksLikeNewsletter({ subject: 'Verify your sign-in', from: 'Google <no-reply@google.com>' })).toBe(false)
    expect(looksLikeNewsletter({ subject: 'Notes to self', from: 'CC <ccotter31@gmail.com>' }, 'ccotter31@gmail.com')).toBe(false)
  })
})

describe('parseMagazineRead', () => {
  it('keeps at most four picks and drops the ones with no name', () => {
    const pick = (name: string) => ({ name, brand: 'Sézane', price: 180, currency: 'gbp', image_url: 'https://media.sezane.com/a.jpg', url: 'https://sezane.com/a', why: 'Your neckline, in your navy' })
    const r = parseMagazineRead({
      is_newsletter: true, publication: 'Sézane', headline: 'The navy edit', hero_image: 'https://media.sezane.com/hero.jpg',
      picks: [pick('Gaspard Jumper'), pick('Will Coat'), pick('Aristide Blouse'), pick('Nina Skirt'), pick('Lou Dress'), { ...pick(''), name: '' }],
    })
    expect(r.picks).toHaveLength(4)
    expect(r.picks[0]).toMatchObject({ currency: 'GBP', price: 180, brand: 'Sézane' })
    expect(r.publication).toBe('Sézane')
  })

  it('drops a made-up image url and keeps the piece', () => {
    const r = parseMagazineRead({ is_newsletter: true, picks: [{ name: 'Wool Coat', image_url: 'see above', url: null, why: 'Your shape' }] })
    expect(r.picks[0].image_url).toBeNull()
    expect(r.picks[0].name).toBe('Wool Coat')
  })

  it('a newsletter with nothing for her reads as no picks', () => {
    expect(parseMagazineRead({ is_newsletter: true, picks: [] }).picks).toEqual([])
    expect(parseMagazineRead(null).is_newsletter).toBe(false)
  })
})
