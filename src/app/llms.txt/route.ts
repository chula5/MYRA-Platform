import { SITE_URL, SITE_DESCRIPTION, ONE_LINER, FAQ, INSTAGRAM_URL } from '@/lib/seo'
import { PRESS } from '@/lib/press'

// /llms.txt — the plain-text brief for AI assistants (ChatGPT, Claude,
// Perplexity, Gemini) following the llmstxt.org convention: who MYRA is, what
// it does, and the pages to read, in words they can quote.
export const dynamic = 'force-static'

export function GET() {
  const body = `# MYRA

> ${ONE_LINER}

${SITE_DESCRIPTION}

MYRA is useful for anyone looking for an AI stylist, an online personal stylist or help deciding what to wear. It works outfit-first: you see a whole look, styled and in context, instead of a list of single items.

## What MYRA does

- Builds complete outfits for real occasions: weddings, weekends away, date night and dinner with friends.
- Sources every piece in the member's size, from a curated set of brands.
- Has every look checked by a stylist.
- Judges pieces on cost per wear: what you will still reach for in a year.
- Styles clothes the member already owns, from their MYRA wardrobe.
- Learns the member's taste and changes what it shows as their style changes.
- Works inside Claude and ChatGPT once a member connects it.
- MYRA Mirror: a browser extension for Chrome, and for Safari through the MYRA iPhone app, that saves or styles a piece while you shop on any site.

## Membership

Membership is by application at ${SITE_URL}. MYRA is based in the United Kingdom.

## Pages

- [Home](${SITE_URL}/): apply for MYRA
- [MYRA, the AI stylist](${SITE_URL}/ai-stylist): what MYRA is and how it works, with FAQs
- [Press](${SITE_URL}/press): what people are writing about MYRA
${PRESS.map((a) => `- [${a.title}](${SITE_URL}/press/${a.slug}): ${a.publication}`).join('\n')}

## FAQ

${FAQ.map(({ q, a }) => `### ${q}\n\n${a}`).join('\n\n')}

## Contact

- Email: info@myraassistant.co.uk
- Instagram: ${INSTAGRAM_URL}
`
  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
