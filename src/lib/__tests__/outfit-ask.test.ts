import { describe, it, expect } from 'vitest'
import { parseOutfitAsk, rankForPiece, matchesPiece } from '@/lib/outfit-ask'

const BRANDS = ['Isabel Marant', 'Rag & Bone', 'The Row', 'J.Crew', 'Toteme']

describe('parseOutfitAsk reads a sentence as the pieces of a look', () => {
  it('her own sentence, typos and all', () => {
    const { pieces } = parseOutfitAsk(
      'i want to piece together an outfit with a silk blue dress dress, bronw isable marant heels and a  leather jacket',
      BRANDS,
    )
    expect(pieces).toHaveLength(3)
    expect(pieces[0].itemTypes).toContain('midi_dress')
    expect(pieces[0].colours).toEqual(['blue'])
    expect(pieces[0].materials).toEqual(['silk'])
    expect(pieces[1].itemTypes).toEqual(['heel'])
    expect(pieces[1].colours).toEqual(['brown'])
    expect(pieces[1].brand).toBe('Isabel Marant')
    expect(pieces[2].itemTypes).toEqual(['jacket'])
    expect(pieces[2].materials).toEqual(['leather'])
  })

  it('a long dress to go with the anchor is one long dress', () => {
    const { pieces } = parseOutfitAsk('find a long dress to go with this anchor', BRANDS)
    expect(pieces).toHaveLength(1)
    expect(pieces[0].length).toBe('long')
    expect(pieces[0].itemTypes.sort()).toEqual(['maxi_dress', 'midi_dress', 'shirt_dress', 'slip_dress'])
  })

  it('keeps a brand with an ampersand whole', () => {
    const { pieces } = parseOutfitAsk('rag & bone jeans and a white shirt', BRANDS)
    expect(pieces.map((p) => p.brand)).toEqual(['Rag & Bone', null])
    expect(pieces[1].colours).toEqual(['white'])
  })

  it('a garment-less chunk describes the piece before it', () => {
    const { pieces } = parseOutfitAsk('a skirt with lace', BRANDS)
    expect(pieces).toHaveLength(1)
    expect(pieces[0].materials).toEqual(['lace'])
  })

  it('never reads a garment word as a brand', () => {
    const { pieces } = parseOutfitAsk('a tote bag', BRANDS)
    expect(pieces[0].brand).toBeNull()
  })
})

describe('rankForPiece', () => {
  const pool = [
    { item_id: 'a', product_name: 'Leather heeled boot', item_type: 'heel', colour_family: 'black', brand: { name: 'Isabel Marant' } },
    { item_id: 'b', product_name: 'Suede pump', item_type: 'heel', colour_family: 'brown', brand: { name: 'Toteme' } },
    { item_id: 'c', product_name: 'Long silk slip', item_type: 'slip_dress', colour_family: 'navy', material_primary: 'silk', brand: { name: 'The Row' } },
    { item_id: 'd', product_name: 'Mini dress', item_type: 'mini_dress', colour_family: 'blue', brand: { name: 'The Row' } },
  ]

  it('relaxes the colour before the brand, and says so', () => {
    const { pieces } = parseOutfitAsk('brown isabel marant heels', BRANDS)
    const r = rankForPiece(pool, pieces[0])
    expect(r.items.map((i) => i.item_id)).toEqual(['a'])
    expect(r.level).toBe('no-colour')
    expect(r.relaxed).toMatch(/without brown/)
  })

  it('a long blue dress finds the navy slip whose name says long, never the mini', () => {
    const { pieces } = parseOutfitAsk('a long blue dress', BRANDS)
    expect(matchesPiece(pool[3], pieces[0])).toBe(false)
    expect(rankForPiece(pool, pieces[0]).items.map((i) => i.item_id)).toEqual(['c'])
  })
})

describe('two garments with no joiner', () => {
  it('blue dress brown heels is two pieces; slip skirt stays one', () => {
    expect(parseOutfitAsk('blue dress brown heels').pieces.map((p) => p.colours)).toEqual([['blue'], ['brown']])
    expect(parseOutfitAsk('silk slip skirt').pieces).toHaveLength(1)
  })
})

describe('build an outfit around a fur jacket and trousers', () => {
  it('reads two pieces, the fur jacket first, with no filler words', () => {
    const { pieces } = parseOutfitAsk('build an outfit around a fur jacket and trousers')
    expect(pieces).toHaveLength(2)
    expect(pieces[0].materials).toEqual(['fur'])
    expect(pieces[0].descriptors).not.toContain('around')
    expect(pieces[1].itemTypes).toContain('trousers')
  })

  it('a jacket with fur in its name leads one only tagged fur', () => {
    const { pieces } = parseOutfitAsk('a fur jacket')
    const jackets = [
      { item_id: 'tagged', product_name: '1990s navy nylon set', item_type: 'jacket', material_primary: 'fur', created_at: '2026-10-20' },
      { item_id: 'mink', product_name: 'Long-haired mink fur round neck jacket', item_type: 'jacket', material_primary: 'fur', created_at: '2026-01-01' },
    ]
    expect(rankForPiece(jackets, pieces[0]).items[0].item_id).toBe('mink')
  })
})
