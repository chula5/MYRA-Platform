import type { Metadata, Viewport } from 'next'
import Script from 'next/script'
import localFont from 'next/font/local'
import { FeedProvider } from '@/context/FeedContext'
import SessionTracker from '@/components/analytics/SessionTracker'
import SmoothScroll from '@/components/SmoothScroll'
import './globals.css'
import { SITE_URL, SITE_NAME, SITE_TITLE, SITE_DESCRIPTION, SITE_KEYWORDS } from '@/lib/seo'

// Site typeface — a clean, gently rounded grotesque close to Pragmatica.
// Served from public/fonts (Manrope variable, 200–800) rather than fetched
// from Google at build time: the Google loader broke two production builds
// on 2026-11-03 and took the site's deploys down with it.
const manrope = localFont({
  src: [
    { path: '../../public/fonts/Manrope-latin.woff2', weight: '200 800', style: 'normal' },
    { path: '../../public/fonts/Manrope-latin-ext.woff2', weight: '200 800', style: 'normal' },
  ],
  variable: '--font-manrope',
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
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_TITLE, template: '%s · MYRA' },
  description: SITE_DESCRIPTION,
  keywords: SITE_KEYWORDS,
  applicationName: SITE_NAME,
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    siteName: SITE_NAME,
    locale: 'en_GB',
    type: 'website',
    images: [{ url: '/silver-hero-wide.webp', alt: 'MYRA, the AI styling assistant' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: ['/silver-hero-wide.webp'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 },
  },
  // Search Console / Bing ownership, once their tokens are set on Vercel.
  verification: {
    ...(process.env.GOOGLE_SITE_VERIFICATION ? { google: process.env.GOOGLE_SITE_VERIFICATION } : {}),
    ...(process.env.BING_SITE_VERIFICATION ? { other: { 'msvalidate.01': process.env.BING_SITE_VERIFICATION } } : {}),
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
  // suppressHydrationWarning on <html>: the script in <head> adds .myra-app
  // before React hydrates, which is intended, not a mismatch.
  return (
    <html lang="en" className={manrope.variable} suppressHydrationWarning>
      <head>
        <link rel="alternate" type="text/plain" href="/llms.txt" title="MYRA for AI assistants" />
        {/* THE APP NEVER SHOWS THE WEBSITE. Capacitor's bridge is in the page
            before its first byte, so this one line marks <html> as the app at
            document start; anything wrapped in <WebOnly> is then invisible from
            the first paint, long before the door hydrates over it. Safari and
            the desktop never carry the class and render exactly as before. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var c=window.Capacitor;if(c&&typeof c.isNativePlatform==='function'&&c.isNativePlatform())document.documentElement.classList.add('myra-app')}catch(e){}",
          }}
        />
      </head>
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
