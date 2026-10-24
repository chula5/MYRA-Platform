// Press — every article written about MYRA. To add one, put a new entry at
// the TOP of PRESS (newest first); /press lists it and /press/<slug> shows it.
//
// `body` is the full article, shown on MYRA with a READ ON button to the original.
// Only put an article's text here when the writer has said MYRA may run it in
// full; until then the page shows `summary` (MYRA's own words) and the link.

export type PressBlock =
  | string // a paragraph; [text](href) makes a link
  | { heading: string }
  | { quote: string }
  | { image: string; caption?: string }
  | { link: string; title: string; source: string } // a card to another article

export type PressArticle = {
  slug: string
  title: string
  subtitle?: string
  publication: string
  author: string
  date: string // ISO, YYYY-MM-DD
  url: string
  image?: string
  summary: string[] // MYRA's own words, a paragraph per entry
  body?: PressBlock[] // the full article, with the writer's OK
}

export const PRESS: PressArticle[] = [
  {
    slug: 'the-data-fashion-brief-cant-get-dressed',
    title: 'I’m A Fashion Data Analyst, But Still Can’t Get Dressed',
    subtitle:
      'The data behind decision fatigue, and the decision that got me dressed for Milan Fashion Week and a wedding back to back',
    publication: 'The Data Fashion Brief',
    author: 'Carmen',
    date: '2026-06-30',
    url: 'https://thedatafashionbrief.substack.com/p/i-make-my-living-studying-trends',
    image: '/press/16arlington-flora-skirt-looks.jpg',
    summary: [
      'A fashion data analyst on why knowing the trends still doesn’t make getting dressed any easier, and what the numbers say about decision fatigue.',
      'With Milan Fashion Week and a wedding back to back, Carmen turned to an early-access MYRA: describe the occasion, get a complete look from a curated set of brands, each one signed off by a stylist.',
    ],
    // Commissioned by MYRA; Carmen OK'd running it in full (2026-10-24).
    body: [
      'I have to confess something… I suffer from shopping paralysis, specifically when I found myself last week having to pick my outfits for Milan Fashion Week and a wedding straight after it.',
      'You’ve probably heard the term before, but if you haven’t:',
      'It’s the decision fatigue that kicks in when you’re faced with too many options that all look roughly as good as each other. Instead of choosing, you freeze. You buy nothing at all.',
      'I don’t think I’m the only one, though. Searches for “shopping assistant” and “style assistant” back that up. Both terms sat flat and low on Google Trends for four straight years, from 2021 through mid-2025.',
      'Then, starting in June 2025, both broke out. Climbing sharply, accelerating into 2026, peaking around May at +4900% vs June 2025. People started actively searching for something to decide for them, in volumes the previous four years never came close to.',
      { image: '/press/tdfb-search-interest-chart.jpg', caption: 'Shopping assistant & style assistant search interest, June 2021 to June 2026. Source: Google Trends.' },
      'The precise term for what’s driving that is decision fatigue. The most famous demonstration of it is the so-called “jam study”, [a 2000 paper by psychologists Sheena Iyengar and Mark Lepper](https://pmc.ncbi.nlm.nih.gov/articles/PMC11111947/).',
      'They found that a tasting table offering 24 jams attracted more browsers than one offering just six, 60% of passersby stopped versus 40%. But it converted far fewer of them into buyers, just 3% bought, against 30% at the smaller table.',
      'The finding has been debated since, later research suggests the effect is smaller and more context-dependent than the original study implied. But the core idea has stuck for a reason: past a certain point, more choice doesn’t make people happier with what they choose, but instead makes them less likely to choose at all.',
      'So there I was a week ago, sitting in my flat in London, Milan Fashion Week a few days out and a wedding straight after it, simply not decisive enough to buy anything.',
      'Not sure if you can relate to this, but I had a dozen tabs open across three retailers, a cart with four things I’ll never actually buy, hours of scrolling comparing the same five options against each other.',
      'Then, when none of that works, I’ll turn to AI for a second opinion, and I end up with suggestions I don’t fully trust because I have no idea what they’re weighing to get there, or whether they’re even looking at the whole market. My only thought is that I need to get the right option, which somehow frustrates me even more.',
      'It’s a bit ironic, considering my actual job is analysing fashion data, telling other people what they’ll want to wear next season before they know it themselves and people actually assume that means I’ve got my own outfits figured out.',
      { quote: 'But I regret to inform you that it’s closer to the opposite.' },
      'There’s also a question in here I don’t think gets asked enough: why do women carry so much more of this weight than men? I can’t, or feel I can’t, wear the same dress to two weddings, while a man can wear the same suit to every single one and nobody will ever notice.',
      'At the same time, access to good, well-curated brands has never been easier than it is right now. What’s changed is that “easier access” and “easier decisions” turned out to be two completely unrelated problems.',
      'There are plenty of shopping platforms in fashion retail, but very few are actually built to solve the second one rather than just add to the first. If you’re like me, a savvy fashion shopper with limited time who genuinely cares about trends backed by data, it’s now non-negotiable to have a curated shopping stack: platforms built precisely to save you the decision, not just hand you more to decide between.',
      '[MYRA](/) recently became one of mine. I got access ahead of its public launch, and it’s an outfit-led platform that starts from the occasion rather than the product: you tell it what you’re dressing for, wedding guest, date night, casual summer weekend, and it returns a built outfit from a curated set of brands. Every single one signed off by an actual stylist before it ever reaches you.',
      { image: '/press/tdfb-myra-what-are-you-dressing-for.jpg' },
      'For Milan, I picked Casual Summer Weekend. What came back was a cream lace top and matching shorts, styled with a raffia Isabel Marant bag and the Cult Gaia Abi sandal in a beaded burnt orange.',
      { image: '/press/tdfb-myra-casual-summer-weekend.jpg' },
      'That orange detail I knew wasn’t coincidental because [I actually posted separately about orange being the colour of this summer](https://www.instagram.com/reel/DZz7vi3sEjt/), and seeing it show up here, as the one pop of colour in an otherwise neutral look, felt like exactly the kind of signal I usually have to go digging for, just handed to me.',
      { image: '/press/tdfb-myra-cult-gaia-abi-sandal.jpg' },
      'For the wedding, the result that stopped me scrolling entirely was the 16Arlington Flora Skirt in Chiffon, a blush pink piece finished in a feathered hem, styled with a Magda Butrym lace-trim cami, Aeyde patent sandals, and a beaded Staud bag.',
      { image: '/press/16arlington-flora-skirt-looks.jpg' },
      'That timing isn’t a coincidence either. I wrote separately about [romance trending as a reaction to an increasingly automated, optimised world, with searches for “romance” up 170% since late 2025](https://thedatafashionbrief.substack.com/p/romance-is-trending-and-is-a-reaction). The catwalk evidence behind that piece was full of garments that feel composed, deliberate, almost devotional rather than stripped back.',
      {
        link: 'https://thedatafashionbrief.substack.com/p/romance-is-trending-and-is-a-reaction',
        title: 'Romance Is Trending And Is A Reaction Of An Emotionless Age',
        source: 'The Data Fashion Brief · 19 Feb',
      },
      'It’s the [same instinct behind Olivia Dean’s current run of red carpet looks](https://www.instagram.com/p/DZfTw57CBkD/), styled by Simone Beyene ([@simonebeyene](https://www.instagram.com/simonebeyene/)), all soft, classic, romantic silhouettes that lean into feeling over minimalism. A feathered, romantic skirt like this one is exactly the kind of piece I didn’t know I wanted until I saw it (have to confess I’m obsessed with her and Simone).',
      'The skirt and the sandals are pieces I’d actually buy. The rest of each look I’ll source myself, piece by piece, treating MYRA as a styling reference rather than a checkout, an answer to “what would actually work here” that I didn’t have to build from scratch.',
      'One decision instead of forty, even if the smaller ones are still mine to make afterward, but that is SUCH a relief.',
      'It’s a small shift, but it makes a real difference: less “here’s a thousand options, good luck”, more “here’s the answer to the question you actually asked.”',
      'MYRA launched publicly this weekend, so if any of this sounds familiar, [join here](/).',
    ],
  },
]

export function pressBySlug(slug: string) {
  return PRESS.find((a) => a.slug === slug) ?? null
}

export function formatPressDate(iso: string) {
  return new Date(`${iso}T12:00:00Z`)
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    .toUpperCase()
}
