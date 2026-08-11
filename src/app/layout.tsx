import type { Metadata, Viewport } from 'next'
import Script from 'next/script'
import { Manrope, Caveat } from 'next/font/google'
import { FeedProvider } from '@/context/FeedContext'
import SessionTracker from '@/components/analytics/SessionTracker'
import SmoothScroll from '@/components/SmoothScroll'
import './globals.css'

// Site typeface — a clean, gently rounded grotesque close to Pragmatica.
const manrope = Manrope({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-manrope',
  display: 'swap',
})

// SECONDARY face only — the handwritten values on the run-of-show cards. It
// must never take over anywhere else, so it is exposed as its own variable and
// applied through a single .myra-hand class rather than any base style.
const caveat = Caveat({
  subsets: ['latin'],
  weight: ['500'],
  variable: '--font-caveat',
  display: 'swap',
})

// Prevent iOS from zooming in when a small-font input is focused (and disable
// pinch-zoom) for an app-like feel. viewportFit cover handles the notch/safe area.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
}

export const metadata: Metadata = {
  title: 'MYRA',
  description: 'MYRA — Outfit-first fashion discovery, personalised to your taste.',
  openGraph: {
    title: 'MYRA',
    description: 'Outfit-first fashion discovery.',
    type: 'website',
  },
  // FlexOffers site-ownership verification.
  other: {
    'fo-verify': '6fbaefff-4b83-4e34-8e14-2ec6650c31ee',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${manrope.variable} ${caveat.variable}`}>
      <body className="bg-background text-primary-text antialiased">
        {/* Paper grain over the whole page — above the background, below every
            piece of content, and inert to the pointer. */}
        <div className="myra-grain" aria-hidden />
        <SmoothScroll>
          <FeedProvider>
            {children}
          </FeedProvider>
        </SmoothScroll>
        <SessionTracker />
        {/* Awin Publisher MasterTag (pub 2988015) — powers Awin affiliate
            tracking + Convert-a-Link, which auto-converts outbound merchant
            links (e.g. Da Luna) into trackable affiliate links. Rakuten still
            handles Isabel Marant / Diesel / Twinset via affiliateUrl(). */}
        <Script
          src="https://www.dwin2.com/pub.2988015.min.js"
          strategy="afterInteractive"
        />
        {/* Google Analytics (gtag.js) */}
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-0G4EXD8T8B"
          strategy="afterInteractive"
        />
        <Script id="ga-gtag" strategy="afterInteractive">
          {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', 'G-0G4EXD8T8B');`}
        </Script>
      </body>
    </html>
  )
}
