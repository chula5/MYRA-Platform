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

function Block({ block }: { block: PressBlock }) {
  if (typeof block === 'string') return <p className={prose}>{block}</p>
  if ('heading' in block) {
    return <h2 className={`pt-4 text-[19px] md:text-[23px] leading-[1.3] ${prose}`}>{block.heading}</h2>
  }
  if ('quote' in block) {
    return (
      <blockquote className={`border-l-2 border-[#4A4E57] pl-5 text-[19px] md:text-[23px] leading-[1.5] ${prose}`}>
        {block.quote}
      </blockquote>
    )
  }
  return (
    <figure className="py-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={block.image} alt={block.caption ?? ''} className="w-full h-auto" />
      {block.caption && (
        <figcaption className={`mt-2 text-[15px] text-[#4A4E57]/70 ${prose}`}>{block.caption}</figcaption>
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
      className="inline-flex items-center gap-3 bg-[#1A1A1A] text-white px-6 py-4 text-[15px] tracking-[0.14em] hover:opacity-80 transition-opacity duration-300"
    >
      {a.body ? 'VIEW' : 'READ'} ON {a.publication.toUpperCase()} <span aria-hidden>↗</span>
    </a>
  )

  return (
    <article className="w-full px-6 lg:px-16 pt-8 md:pt-12 pb-16">
      <Link
        href="/press"
        className="inline-flex items-center gap-3 text-[15px] tracking-[0.14em] text-[#4A4E57] hover:opacity-60 transition-opacity duration-300"
      >
        <span aria-hidden>←</span> ALL PRESS
      </Link>

      <div className="mt-8 md:mt-10 grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-8 lg:gap-16 items-start">
        {a.image && (
          <div className="overflow-hidden bg-[#E2E0DB] max-w-[520px] lg:sticky lg:top-40">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={a.image} alt="" className="w-full h-auto" />
          </div>
        )}

        <div className="min-w-0 max-w-[760px]">
          <p className="text-[13px] md:text-[15px] tracking-[0.14em] text-[#4A4E57]/70">
            {a.publication.toUpperCase()} · {formatPressDate(a.date)}
          </p>
          <h1 className={`mt-4 text-[clamp(24px,2.6vw,38px)] leading-[1.15] tracking-[0.01em] text-[#4A4E57] ${prose}`}>
            {a.title}
          </h1>
          {a.subtitle && (
            <p className={`mt-4 text-[17px] md:text-[19px] leading-[1.5] text-[#4A4E57]/80 ${prose}`}>{a.subtitle}</p>
          )}
          <p className="mt-6 text-[13px] md:text-[15px] tracking-[0.12em] text-[#4A4E57]">
            WRITTEN BY {a.author.toUpperCase()}
          </p>
          <div className="mt-6">{linkOut}</div>

          <div className="mt-10 pt-10 border-t border-[#4A4E57]/20 space-y-5 text-[17px] md:text-[19px] leading-[1.75] text-[#4A4E57]">
            {blocks.map((b, i) => <Block key={i} block={b} />)}
          </div>

          <div className="mt-12">{linkOut}</div>
        </div>
      </div>
    </article>
  )
}
