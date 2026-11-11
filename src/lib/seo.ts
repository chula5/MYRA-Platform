// SEO + GEO (generative-engine optimisation) — the one place that says what
// MYRA is, in plain words, for Google, Google's AI Overviews, ChatGPT, Claude
// and Perplexity. The root metadata, the JSON-LD, /ai-stylist, /llms.txt and
// the sitemap all read from here, so every machine hears the same story.
//
// Keep every claim here true of the live product: AI answer engines quote it.

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.myraassistant.co.uk').replace(/\/+$/, '')

export const SITE_NAME = 'MYRA'

export const SITE_TITLE = 'MYRA: AI Stylist & Personal Styling Assistant'

export const SITE_DESCRIPTION =
  'MYRA is an AI styling assistant and personal stylist. Name the occasion and MYRA builds a complete outfit from curated brands, sourced in your size and checked by a stylist. It also styles pieces you already own.'

export const SITE_KEYWORDS = [
  'AI stylist',
  'AI styling assistant',
  'styling assistant',
  'personal stylist',
  'online personal stylist',
  'AI personal stylist',
  'virtual stylist',
  'style assistant',
  'shopping assistant',
  'AI fashion assistant',
  'outfit ideas',
  'outfit generator',
  'what to wear',
  'wedding guest outfit',
  'capsule wardrobe',
  'wardrobe stylist',
  'MYRA',
]

export const INSTAGRAM_URL = 'https://www.instagram.com/myraassistant/'

// The short answer to "what is MYRA?", written the way an answer engine
// would quote it.
export const ONE_LINER =
  'MYRA is an AI styling assistant: a private, membership-based personal stylist that builds complete outfits for real occasions from a curated set of brands.'

// Shown on /ai-stylist and marked up as FAQPage there. Google only honours FAQ
// markup that matches text on the page, so this list feeds both.
export const FAQ: { q: string; a: string }[] = [
  {
    q: 'What is MYRA?',
    a: 'MYRA is an AI styling assistant and private personal stylist. You tell MYRA where you are going, such as a wedding, a weekend away, date night or dinner with the girls, and it builds a complete outfit for it from a curated set of brands. Every look is sourced in your size and checked by a stylist before you see it.',
  },
  {
    q: 'What is an AI stylist?',
    a: 'An AI stylist is software that does what a personal stylist does: learns your taste, size and the occasions you dress for, then puts together outfits for you. MYRA works outfit-first. It shows you a whole look, styled and in context, instead of a long list of single items to sort through.',
  },
  {
    q: 'How is MYRA different from searching a shop or asking a chatbot?',
    a: 'Most shops and chatbots give you more options. MYRA gives you fewer, better ones. It only shows pieces it can actually source in your size, from brands it has chosen, and judges each one on cost per wear: what you will still reach for in a year, not what you will wear once. Your taste profile updates as your style changes.',
  },
  {
    q: 'Can MYRA style clothes I already own?',
    a: 'Yes. MYRA keeps your wardrobe and can style a piece you already own into a full outfit, so new pieces work with what is already in your wardrobe.',
  },
  {
    q: 'Does MYRA work in ChatGPT and Claude?',
    a: 'Yes. Members can connect MYRA to Claude or ChatGPT and ask it for outfits there, using their own taste, size and wardrobe.',
  },
  {
    q: 'Can I use MYRA while I shop on other sites?',
    a: 'Yes. The MYRA Mirror browser extension works in Chrome, and in Safari through the MYRA iPhone app. Save a piece you like while shopping, or have MYRA style it on the spot.',
  },
  {
    q: 'How do I join MYRA?',
    a: 'Membership is by application. Apply at myraassistant.co.uk and MYRA will be in touch once your application has been reviewed.',
  },
  {
    q: 'Where is MYRA based?',
    a: 'MYRA is based in the United Kingdom and run at myraassistant.co.uk.',
  },
]

export function organizationJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${SITE_URL}/#organization`,
        name: SITE_NAME,
        alternateName: ['MYRA Assistant', 'MYRA Styling Assistant', 'MYRA AI Stylist'],
        url: SITE_URL,
        logo: `${SITE_URL}/myra-logo-black.png`,
        description: ONE_LINER,
        email: 'info@myraassistant.co.uk',
        areaServed: 'GB',
        sameAs: [INSTAGRAM_URL],
      },
      {
        '@type': 'WebSite',
        '@id': `${SITE_URL}/#website`,
        url: SITE_URL,
        name: SITE_NAME,
        description: SITE_DESCRIPTION,
        publisher: { '@id': `${SITE_URL}/#organization` },
        inLanguage: 'en-GB',
      },
      {
        '@type': 'WebApplication',
        '@id': `${SITE_URL}/#app`,
        name: 'MYRA: AI Styling Assistant',
        url: SITE_URL,
        applicationCategory: 'LifestyleApplication',
        applicationSubCategory: 'AI stylist',
        operatingSystem: 'Web, iOS',
        description: SITE_DESCRIPTION,
        publisher: { '@id': `${SITE_URL}/#organization` },
        featureList: [
          'Complete outfits built for an occasion',
          'Pieces sourced in your size from curated brands',
          'Every look checked by a stylist',
          'Styles pieces you already own',
          'A taste profile that changes as your style does',
          'MYRA Mirror extension for Chrome and Safari',
          'Works inside Claude and ChatGPT',
        ],
      },
    ],
  }
}

export function faqJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  }
}

// JSON-LD goes in a <script> tag, so "<" is escaped to keep it from closing it.
export function jsonLdScript(data: unknown) {
  return { __html: JSON.stringify(data).replace(/</g, '\\u003c') }
}
