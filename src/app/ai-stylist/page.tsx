import type { Metadata } from 'next'
import Link from 'next/link'
import Navigation from '@/components/navigation/Navigation'
import { FAQ, ONE_LINER, SITE_URL, faqJsonLd, jsonLdScript } from '@/lib/seo'

// /ai-stylist — the page that answers "what is MYRA?" in words. The landing
// is mostly pictures and motion, which search engines and AI answer engines
// can't read; this page gives them the text, and gives people the full
// explanation. The FAQ below is also marked up as FAQPage.

export const metadata: Metadata = {
  title: { absolute: 'MYRA, the AI Stylist & Personal Styling Assistant' },
  description:
    'MYRA is an AI stylist and personal styling assistant. Name the occasion and get a complete outfit from curated brands, sourced in your size and checked by a stylist.',
  alternates: { canonical: '/ai-stylist' },
  openGraph: {
    title: 'MYRA, the AI Stylist & Personal Styling Assistant',
    description:
      'Name the occasion and MYRA builds the whole outfit, from curated brands, in your size, checked by a stylist.',
    url: `${SITE_URL}/ai-stylist`,
    type: 'article',
  },
}

const prose = 'normal-case [text-transform:none]'

const STEPS = [
  {
    title: 'TELL MYRA THE OCCASION',
    text: 'A wedding, a weekend away, date night, dinner with the girls. Say where you are going and MYRA starts from there, not from a search box.',
  },
  {
    title: 'SEE THE WHOLE OUTFIT',
    text: 'No piece arrives on its own. MYRA shows you a complete look, styled and in context, built from a curated set of brands and sourced in your size.',
  },
  {
    title: 'A STYLIST CHECKS IT',
    text: 'Every look is checked by a stylist before you see it. Each piece is judged on cost per wear: what you will still reach for in a year, not what you will wear once.',
  },
  {
    title: 'IT LEARNS YOUR TASTE',
    text: 'MYRA keeps your wardrobe and your taste profile. It styles the pieces you already own, and what it shows you changes as your style does.',
  },
]

const WHERE = [
  { title: 'ON THE WEB AND IPHONE', text: 'Your private stylist at myraassistant.co.uk and in the MYRA iPhone app.' },
  { title: 'IN CLAUDE AND CHATGPT', text: 'Connect MYRA to Claude or ChatGPT and ask for outfits there, with your own taste, size and wardrobe.' },
  { title: 'WHILE YOU SHOP', text: 'The MYRA Mirror extension for Chrome, and for Safari through the iPhone app, saves or styles any piece you find on another site.' },
]

export default function AiStylistPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLdScript(faqJsonLd())} />
      <Navigation showAuth={false} />
      <main className="myra-texture min-h-screen pt-[72px] md:pt-28 lg:pt-32 text-[#4A4E57]">
        <article className="w-full px-6 lg:px-16 pt-10 md:pt-14 pb-16 max-w-[1400px]">
          <p className="text-[14px] md:text-[18px] tracking-[0.14em] text-[#4A4E57]/70">YOUR STYLING ASSISTANT</p>
          <h1 className="mt-3 uppercase font-semibold text-[clamp(34px,5.2vw,82px)] leading-[1.02] tracking-[0.03em]">
            MYRA, the AI stylist
          </h1>
          <p className={`mt-6 max-w-[900px] text-[18px] md:text-[24px] leading-[1.5] tracking-[0.02em] ${prose}`}>
            {ONE_LINER} Instead of a hundred tabs and a basket you will never check out, MYRA shows you less, and more
            of what you will actually wear.
          </p>

          <section className="mt-14 md:mt-20">
            <h2 className="uppercase font-semibold text-[clamp(26px,3.4vw,52px)] tracking-[0.03em]">How MYRA works</h2>
            <ol className="mt-6 border-t border-[#4A4E57]/25">
              {STEPS.map((s, i) => (
                <li key={s.title} className="grid grid-cols-12 gap-x-4 sm:gap-x-6 gap-y-2 border-b border-[#4A4E57]/25 py-6 sm:py-8">
                  <span className="col-span-2 sm:col-span-1 text-[clamp(18px,2vw,32px)] tracking-[0.05em]">0{i + 1}</span>
                  <h3 className="col-span-10 sm:col-span-4 font-semibold text-[clamp(20px,2.2vw,34px)] leading-[1.1] tracking-[0.02em]">{s.title}</h3>
                  <p className={`col-span-12 sm:col-span-7 text-[17px] md:text-[20px] leading-[1.55] text-[#6B6B6B] ${prose}`}>{s.text}</p>
                </li>
              ))}
            </ol>
          </section>

          <section className="mt-14 md:mt-20">
            <h2 className="uppercase font-semibold text-[clamp(26px,3.4vw,52px)] tracking-[0.03em]">Where MYRA works</h2>
            <div className="mt-6 grid gap-8 md:grid-cols-3">
              {WHERE.map((w) => (
                <div key={w.title} className="border-t border-[#4A4E57]/25 pt-5">
                  <h3 className="font-semibold text-[18px] md:text-[22px] tracking-[0.04em]">{w.title}</h3>
                  <p className={`mt-3 text-[17px] md:text-[19px] leading-[1.55] text-[#6B6B6B] ${prose}`}>{w.text}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-14 md:mt-20">
            <h2 className="uppercase font-semibold text-[clamp(26px,3.4vw,52px)] tracking-[0.03em]">Questions</h2>
            <div className="mt-6 border-t border-[#4A4E57]/25">
              {FAQ.map(({ q, a }) => (
                <div key={q} className="border-b border-[#4A4E57]/25 py-6 sm:py-8 grid gap-3 md:grid-cols-12 md:gap-6">
                  <h3 className={`md:col-span-5 font-semibold text-[19px] md:text-[24px] leading-[1.25] ${prose}`}>{q}</h3>
                  <p className={`md:col-span-7 text-[17px] md:text-[19px] leading-[1.6] text-[#6B6B6B] ${prose}`}>{a}</p>
                </div>
              ))}
            </div>
          </section>

          <div className="mt-14 md:mt-20 flex flex-wrap items-center gap-6">
            <Link
              href="/"
              className="inline-block border border-[#4A4E57] px-8 py-4 text-[15px] md:text-[18px] tracking-[0.14em] hover:bg-[#4A4E57] hover:text-white transition-colors duration-300"
            >
              APPLY FOR ACCESS
            </Link>
            <Link href="/press" className="text-[15px] md:text-[18px] tracking-[0.14em] underline underline-offset-4 hover:opacity-70">
              READ THE PRESS
            </Link>
          </div>
        </article>
      </main>
      <footer className="myra-texture pt-16 pb-24 px-6 lg:px-16">
        <div className="w-full flex items-center justify-between gap-6">
          <Link href="/" className="tracking-[0.11em] text-[#4A4E57] hover:opacity-60 transition-opacity duration-300 text-[clamp(15px,1.4vw,22px)]">
            MYRA
          </Link>
          <a href="/privacy" className="tracking-[0.1em] text-[#6B6B6B] hover:text-[#4A4E57] transition-colors duration-300 text-[clamp(15px,1.4vw,22px)]">
            PRIVACY
          </a>
        </div>
      </footer>
    </>
  )
}
