import Link from 'next/link'
import Navigation from '@/components/navigation/Navigation'

// PRESS — the nav and footer around the press list and each article.
export default function PressLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Navigation showAuth={false} />
      <main className="myra-texture min-h-screen pt-[72px] md:pt-28 lg:pt-32">{children}</main>
      <footer className="myra-texture pt-16 pb-24 px-6 lg:px-16">
        <div className="w-full flex items-center justify-between gap-6">
          <Link href="/" className="tracking-[0.11em] text-[#4A4E57] hover:opacity-60 transition-opacity duration-300 text-[clamp(15px,1.4vw,22px)]">
            MYRA
          </Link>
          <div className="flex items-center gap-8 sm:gap-10">
            <a href="/privacy" className="tracking-[0.1em] text-[#6B6B6B] hover:text-[#4A4E57] transition-colors duration-300 text-[clamp(15px,1.4vw,22px)]">
              PRIVACY
            </a>
          </div>
        </div>
      </footer>
    </>
  )
}
