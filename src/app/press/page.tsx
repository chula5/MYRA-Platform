import Link from 'next/link'
import { PRESS, formatPressDate } from '@/lib/press'

export const metadata = {
  title: 'Press · MYRA',
  description: 'What people are writing about MYRA.',
}

export default function PressPage() {
  return (
    <div className="w-full px-6 lg:px-16 pt-10 md:pt-14 pb-16">
      <h1 className="text-[clamp(26px,3vw,40px)] leading-none tracking-[0.1em] text-[#4A4E57]">PRESS</h1>
      <p className="mt-3 text-[15px] md:text-[19px] tracking-[0.04em] text-[#4A4E57]/80 normal-case [text-transform:none]">
        What people are writing about MYRA.
      </p>

      <ul className="mt-10 md:mt-12 border-t border-[#4A4E57]/20">
        {PRESS.map((a) => (
          <li key={a.slug} className="border-b border-[#4A4E57]/20">
            <Link
              href={`/press/${a.slug}`}
              className="group grid grid-cols-[96px_minmax(0,1fr)] md:grid-cols-[180px_minmax(0,1fr)] items-center gap-5 md:gap-10 py-6 md:py-8"
            >
              <div className="overflow-hidden bg-[#E2E0DB] aspect-[4/5]">
                {a.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={a.image}
                    alt=""
                    className="w-full h-full object-cover object-top transition-transform duration-700 group-hover:scale-[1.03]"
                  />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-[13px] md:text-[15px] tracking-[0.14em] text-[#4A4E57]/70">
                  {a.publication.toUpperCase()} · {formatPressDate(a.date)}
                </p>
                <h2 className="mt-2 md:mt-3 text-[clamp(18px,1.9vw,28px)] leading-[1.2] tracking-[0.01em] text-[#4A4E57] normal-case [text-transform:none]">
                  {a.title}
                </h2>
                <p className="mt-2 md:mt-3 text-[13px] md:text-[15px] tracking-[0.12em] text-[#4A4E57]">
                  BY {a.author.toUpperCase()}
                </p>
                <span className="mt-4 hidden md:inline-flex items-center gap-3 text-[15px] tracking-[0.14em] text-[#4A4E57] group-hover:opacity-60 transition-opacity duration-300">
                  READ <span aria-hidden>→</span>
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
