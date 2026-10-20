import { describe, it, expect } from 'vitest'
import { classifyUrl } from '@/lib/share/resolve'
import { captionNameWords, parseGarmentRead, parseInstagramEmbed, parseInstagramOg, parsePick, rankCandidates, type Candidate } from '@/lib/share/post-piece'

const EMBED = `<div class="Caption"><a class="CaptionUsername" href="https://www.instagram.com/meandem/?utm_source=ig_embed&amp;ig_rid=A1" data-ios-link="user?username=meandem&amp;utm_source=ig_embed" data-log-event="captionProfileClick" target="_blank">meandem</a><br /><br />The Pippa dress, back in navy &amp; cream<div class="CaptionComments"><a class="CaptionCommentsExpand" href="#">View all 12 comments</a></div></div>
<a href="#" data-ios-link="media?id=1"><img class="EmbeddedMediaImage" alt="Instagram post shared by &#064;meandem" src="https://instagram.flhr2-3.fna.fbcdn.net/v/t51.82787-15/851059254_n.jpg?stp=dst-jpg_e35_tt6&amp;_nc_cat=111" /></a>`

describe('classifyUrl — Instagram links with the account first', () => {
  it('reads /account/p/CODE/ and /account/reel/CODE/ as posts', () => {
    expect(classifyUrl('https://www.instagram.com/meandem/p/DeriH6QAc6n/')).toEqual({ kind: 'instagram-post', url: 'https://www.instagram.com/p/DeriH6QAc6n/' })
    expect(classifyUrl('https://www.instagram.com/meandem/reel/DeuUeL4EhXY/?igsh=abc')).toEqual({ kind: 'instagram-post', url: 'https://www.instagram.com/reel/DeuUeL4EhXY/' })
  })
  it('still turns away Instagram’s own pages', () => {
    expect(classifyUrl('https://www.instagram.com/explore/p/abc/').kind).toBe('invalid')
  })
})

describe('parseInstagramEmbed — the post as its embed shows it', () => {
  it('reads author, caption and picture, unescaping what Instagram escaped', () => {
    const post = parseInstagramEmbed(EMBED)
    expect(post.author).toBe('meandem')
    expect(post.caption).toBe('The Pippa dress, back in navy & cream')
    expect(post.image).toBe('https://instagram.flhr2-3.fna.fbcdn.net/v/t51.82787-15/851059254_n.jpg?stp=dst-jpg_e35_tt6&_nc_cat=111')
  })
  it('gives nulls on the login wall rather than guessing', () => {
    expect(parseInstagramEmbed('<html><title>Instagram</title><div class="loginPage"></div></html>')).toEqual({ author: null, caption: null, image: null })
  })
})

describe('parseInstagramOg — the post page as a crawler sees it', () => {
  it('reads the caption out of og:title and the author out of the JSON', () => {
    const html = `<meta property="og:title" content="ME+EM on Instagram: &quot;The finishing touches&quot;" /><meta property="og:image" content="https://scontent.cdninstagram.com/v/x.jpg?a=1&amp;b=2" /><script>{"username":"meandem"}</script>`
    expect(parseInstagramOg(html)).toEqual({ author: 'meandem', caption: 'The finishing touches', image: 'https://scontent.cdninstagram.com/v/x.jpg?a=1&b=2' })
  })
})

describe('parseGarmentRead — what the eye said is in the picture', () => {
  it('keeps only words from the vocabularies, and the shop words', () => {
    expect(parseGarmentRead('```json\n{"type":"blazer","colour":"navy","words":"the wool double breasted blazer"}\n```')).toEqual({ type: 'blazer', colour: 'navy', words: ['wool', 'double', 'breasted', 'blazer'] })
    expect(parseGarmentRead('{"type":"hat","colour":"teal","words":""}')).toBeNull()
    expect(parseGarmentRead('no json here')).toBeNull()
  })
})

describe('rankCandidates — the rail in the order the picture suggests', () => {
  const rail: Candidate[] = [
    { url: 'https://x.com/a', title: 'Cashmere Scarf', image: 'i', price: 1, type: 'knitwear', colour: 'grey' },
    { url: 'https://x.com/b', title: 'Wool Double Breasted Blazer', image: 'i', price: 1, type: 'blazer', colour: 'navy' },
    { url: 'https://x.com/c', title: 'Cord Jacket', image: 'i', price: 1, type: 'jacket', colour: 'navy' },
    { url: 'https://x.com/d', title: 'Pippa Dress', image: 'i', price: 1, type: 'midi_dress', colour: 'cream' },
  ]
  it('puts the same type and colour first, a cousin next, and drops what disagrees', () => {
    const out = rankCandidates(rail, { type: 'blazer', colour: 'navy', words: ['wool', 'blazer'] })
    expect(out.map((c) => c.title)).toEqual(['Wool Double Breasted Blazer', 'Cord Jacket'])
  })
  it('lets a caption that names the piece pull it up', () => {
    const out = rankCandidates(rail, { type: 'maxi_dress', colour: null, words: ['dress'] }, 'The Pippa dress is back')
    expect(out[0].title).toBe('Pippa Dress')
  })
  it('names the caption words a shop would use', () => {
    expect(captionNameWords('The Pippa dress, back in navy & cream — link in bio')).toEqual(['pippa', 'dress', 'back', 'navy', 'cream'])
  })
})

describe('parsePick — which numbered picture the eye chose', () => {
  it('reads a number inside the range and nothing else', () => {
    expect(parsePick('3', 5)).toBe(2)
    expect(parsePick('Picture 2.', 5)).toBe(1)
    expect(parsePick('0', 5)).toBeNull()
    expect(parsePick('9', 5)).toBeNull()
    expect(parsePick('none', 5)).toBeNull()
  })
})
