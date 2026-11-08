import { describe, it, expect } from 'vitest'
import { parseScreenshotRead, parseSearchedUrls, pieceName, readLine } from '@/lib/screenshot-save'

describe('screenshot read', () => {
  it('holds the eye to the vocabularies and reads a price', () => {
    const r = parseScreenshotRead('Sure: {"fashion": true, "brand": "ME+EM", "name": "Merino Crew Neck Jumper", "price_gbp": "£150", "type": "knitwear", "colour": "camel", "words": "merino crew neck jumper"}')
    expect(r).toMatchObject({ fashion: true, brand: 'ME+EM', name: 'Merino Crew Neck Jumper', price_gbp: 150, type: 'knitwear', colour: 'camel' })
    expect(r!.words).toEqual(['merino', 'crew', 'neck', 'jumper'])
  })
  it('drops types and colours it does not know', () => {
    const r = parseScreenshotRead('{"fashion": true, "type": "poncho", "colour": "teal", "words": "wool poncho"}')
    expect(r).toMatchObject({ type: null, colour: null, words: ['wool', 'poncho'], brand: null, name: null, price_gbp: null })
  })
  it('says nothing for a non-answer', () => {
    expect(parseScreenshotRead('I cannot see an image')).toBeNull()
  })
  it('names the piece with the label when MYRA does not stock it', () => {
    const r = parseScreenshotRead('{"fashion": true, "brand": "Toteme", "name": "Signature wool scarf coat", "type": "coat", "colour": "camel", "words": "wool scarf coat"}')!
    expect(pieceName(r, false)).toBe('Toteme Signature wool scarf coat')
    expect(pieceName(r, true)).toBe('Signature wool scarf coat')
    expect(readLine(r)).toBe('Toteme · Signature wool scarf coat')
  })
  it('falls back to the eye\'s words when no name is written', () => {
    const r = parseScreenshotRead('{"fashion": true, "type": "crossbody", "colour": "black", "words": "leather crossbody bag"}')!
    expect(pieceName(r, false)).toBe('Leather crossbody bag')
    expect(readLine(r)).toBe('black crossbody')
  })
})

describe('searched product pages', () => {
  it('reads the URLs out of a fenced answer and drops the rest', () => {
    expect(parseSearchedUrls('```json\n{"urls": ["https://shop.example.com/products/a", "not a url", "https://b.example.com/p/2"]}\n```')).toEqual(['https://shop.example.com/products/a', 'https://b.example.com/p/2'])
    expect(parseSearchedUrls('{"urls": []}')).toEqual([])
    expect(parseSearchedUrls('no idea')).toEqual([])
  })
})
