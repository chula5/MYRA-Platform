import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PRESS, pressBySlug, formatPressDate, type PressBlock } from '@/lib/press'

export function generateStaticParams() {
  return PRESS.map((a) => ({ slug: a.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const a = pressBySlug((await params).slug)
  if (!a) return {}
  return {
    title: `${a.title} · ${a.publication} · MYRA`,
    description: a.subtitle ?? a.summary[0],
  }
}

const prose = 'normal-case [text-transform:none]'

// A paragraph may carry [text](href) links; outside links open in a new tab.
function Inline({ text }: { text: string }) {
  const parts = text.split(/\[([^\]]+)\]\(([^)\s]+)\)/)
  return (
    <>
      {parts.map((p, i) => {
        if (i % 3 === 0) return p
        if (i % 3 === 2) return null
        const href = parts[i + 1]
        const outside = /^https?:/.test(href)
        return (
          <a
            key={i}
            href={href}
            {...(outside ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            className="underline underline-offset-4 decoration-[#4A4E57]/40 hover:decoration-[#4A4E57] transition-colors duration-300"
          >
            {p}
          </a>
        )
      })}
    </>
  )
}

function Block({ block }: { block: PressBlock }) {
  if (typeof block === 'string') return <p className={prose}><Inline text={block} /></p>
  if ('link' in block) {
    return (
      <a
        href={block.link}
        target="_blank"
        rel="noopener noreferrer"
        className="block border border-[#4A4E57]/25 px-6 py-5 hover:bg-[#4A4E57]/5 transition-colors duration-300"
      >
        <span className={`block text-[20px] md:text-[24px] leading-[1.3] ${prose}`}>{block.title}</span>
        <span className="mt-2 block text-[15px] md:text-[17px] tracking-[0.14em] text-[#4A4E57]/70">
          {block.source.toUpperCase()} · READ FULL STORY <span aria-hidden>↗</span>
        </span>
      </a>
    )
  }
  if ('heading' in block) {
    return <h2 className={`pt-6 text-[22px] md:text-[28px] leading-[1.3] ${prose}`}>{block.heading}</h2>
  }
  if ('quote' in block) {
    return (
      <blockquote className={`border-l-2 border-[#4A4E57] pl-6 text-[22px] md:text-[27px] leading-[1.5] ${prose}`}>
        {block.quote}
      </blockquote>
    )
  }
  return (
    <figure className="py-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={block.image} alt={block.caption ?? ''} className="w-full h-auto" />
      {block.caption && (
        <figcaption className={`mt-3 text-[16px] md:text-[18px] text-[#4A4E57]/70 ${prose}`}>{block.caption}</figcaption>
      )}
    </figure>
  )
}

export default async function PressArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const a = pressBySlug((await params).slug)
  if (!a) notFound()

  const blocks: PressBlock[] = a.body ?? a.summary
  const linkOut = (
    <a
      href={a.url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-3 bg-[#1A1A1A] text-white px-7 py-5 text-[16px] md:text-[18px] tracking-[0.14em] hover:opacity-80 transition-opacity duration-300"
    >
      READ ON {a.publication.toUpperCase()} <span aria-hidden>↗</span>
    </a>
  )

  return (
    <article className="w-full px-6 lg:px-16 pt-8 md:pt-12 pb-16">
      <Link
        href="/press"
        className="inline-flex items-center gap-3 text-[16px] md:text-[18px] tracking-[0.14em] text-[#4A4E57] hover:opacity-60 transition-opacity duration-300"
      >
        <span aria-hidden>←</span> ALL PRESS
      </Link>

      <div className="mt-8 md:mt-12 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-10 lg:gap-20 items-start">
        {a.image && (
          <div className="overflow-hidden bg-[#E2E0DB] lg:sticky lg:top-40">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={a.image} alt="" className="w-full h-auto" />
          </div>
        )}

        <div className="min-w-0 max-w-[880px]">
          <p className="text-[15px] md:text-[18px] tracking-[0.14em] text-[#4A4E57]/70">
            {a.publication.toUpperCase()} · {formatPressDate(a.date)}
          </p>
          <h1 className={`mt-5 text-[clamp(32px,3.6vw,56px)] leading-[1.12] tracking-[0.01em] text-[#4A4E57] ${prose}`}>
            {a.title}
          </h1>
          {a.subtitle && (
            <p className={`mt-5 text-[20px] md:text-[24px] leading-[1.45] text-[#4A4E57]/80 ${prose}`}>{a.subtitle}</p>
          )}
          <p className="mt-7 text-[15px] md:text-[18px] tracking-[0.12em] text-[#4A4E57]">
            WRITTEN BY {a.author.toUpperCase()}
          </p>
          <div className="mt-7">{linkOut}</div>

          <div className="mt-12 pt-12 border-t border-[#4A4E57]/20 space-y-6 text-[19px] md:text-[22px] leading-[1.7] text-[#4A4E57]">
            {blocks.map((b, i) => <Block key={i} block={b} />)}
          </div>

          <div className="mt-12">{linkOut}</div>
        </div>
      </div>
    </article>
  )
}
