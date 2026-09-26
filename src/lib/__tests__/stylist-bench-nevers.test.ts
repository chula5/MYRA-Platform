import { describe, it, expect } from 'vitest'
import { neverFromPiece, neverWordFor, appendNever } from '../stylist-bench'
import { parseBrief, judgeAgainstBrief, briefPull, briefBlocks } from '../stylist-brief'

const whiteSneaker = { item_type: 'sneaker', colour_family: 'white', brand_name: 'Veja' }
const piece = { product_name: 'V-10 sneaker', item_type: 'sneaker', colour_family: 'white', brand_name: 'Veja' }

describe('a NO on the bench becomes a never', () => {
  it('carries one word, as pieceText writes it', () => {
    expect(neverWordFor(whiteSneaker, 'item_type')).toBe('sneaker')
    expect(neverWordFor(whiteSneaker, 'colour_family')).toBe('white')
    expect(neverWordFor(whiteSneaker, 'brand')).toBe('veja')
    expect(neverWordFor({ item_type: 'structured_bag' }, 'item_type')).toBe('structured bag')
    expect(neverWordFor({}, 'brand')).toBeNull()
    expect(neverFromPiece({}, 'brand')).toBeNull()
  })

  it('can be the material, or a word of her own — "wrong bracelet style", not "no bracelets"', () => {
    const cuff = { product_name: 'Marbled resin cuff bracelet', item_type: 'bracelet', colour_family: 'cream', brand_name: 'Sessùn', material_primary: 'Resin' }
    const marble = neverFromPiece(cuff, 'word', new Date('2026-09-26T12:00:00Z'), 'Marble')!
    expect(marble).toEqual({ text: 'No marble — bench, 2026-09-26', kind: 'preference', match: ['marble'] })
    const resin = neverFromPiece(cuff, 'material', new Date('2026-09-26T12:00:00Z'), 'resin')!
    expect(resin.match).toEqual(['resin'])
    const brief = appendNever(appendNever(parseBrief({}, 'Chanel'), marble), resin)
    expect(judgeAgainstBrief([cuff], brief).violations.length).toBe(2)
    // A plain gold bracelet is untouched: the never is about the kind, not the type.
    expect(judgeAgainstBrief([{ product_name: 'Gold chain bracelet', item_type: 'bracelet', material_primary: 'Gold' }], brief).violations.length).toBe(0)
    expect(neverFromPiece(cuff, 'word', new Date(), '   ')).toBeNull()
  })

  it('is a preference the composer respects at once', () => {
    const never = neverFromPiece(whiteSneaker, 'item_type', new Date('2026-09-26T12:00:00Z'))!
    expect(never).toEqual({ text: 'No sneaker — bench, 2026-09-26', kind: 'preference', match: ['sneaker'] })
    const before = parseBrief({ brands: ['Toteme'] }, 'T')
    const after = appendNever(before, never)
    expect(judgeAgainstBrief([piece], after).violations.map((v) => v.never.text)).toEqual([never.text])
    expect(briefPull(piece, after)).toBe(briefPull(piece, before) - 1)
    expect(briefBlocks(piece, after)).toBe(false) // a preference is not a ban
  })

  it('does not add the same never twice', () => {
    const never = neverFromPiece(whiteSneaker, 'colour_family')!
    const once = appendNever(parseBrief({}, 'T'), never)
    const twice = appendNever(once, { ...never, text: 'said again' })
    expect(twice.nevers.length).toBe(1)
  })

  it('promoted to a ban, it keeps the piece out entirely', () => {
    const never = { ...neverFromPiece(whiteSneaker, 'brand')!, kind: 'ban' as const }
    expect(briefBlocks(piece, appendNever(parseBrief({}, 'T'), never))).toBe(true)
  })
})
