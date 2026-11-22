import type { Metadata, Viewport } from 'next'
import Script from 'next/script'
import localFont from 'next/font/local'
import { FeedProvider } from '@/context/FeedContext'
import SessionTracker from '@/components/analytics/SessionTracker'
import SmoothScroll from '@/components/SmoothScroll'
import KeyboardSettle from '@/components/KeyboardSettle'
import './globals.css'
import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, SITE_URL } from '@/lib/site'

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

// maximumScale 1 stops iPhone zooming in when a small field is focused, and
// keeps the app's pages still. Pinch-zoom is no longer switched off
// (userScalable: false was an accessibility fail); Safari on iPhone lets people
// pinch regardless. viewportFit cover handles the notch/safe area.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: '#FAFAF8',
}

// The App Store listing, once MYRA is live there (App Store Connect → App
// Information → Apple ID). Safari then offers the app in a banner.
const APP_STORE_ID = process.env.NEXT_PUBLIC_APP_STORE_ID

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_TITLE, template: '%s · MYRA' },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    title: SITE_TITLE,
    description: 'A private styling service: complete outfits built around your taste, your size and what you already own.',
    type: 'website',
    siteName: SITE_NAME,
    locale: 'en_GB',
    url: SITE_URL,
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_TITLE,
    description: 'A private styling service: complete outfits built around your taste, your size and what you already own.',
  },
  other: {
    // FlexOffers site-ownership verification.
    'fo-verify': '6fbaefff-4b83-4e34-8e14-2ec6650c31ee',
    ...(APP_STORE_ID ? { 'apple-itunes-app': `app-id=${APP_STORE_ID}` } : {}),
  },
}

// Who MYRA is, for search engines: the organisation and the site.
const STRUCTURED_DATA = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${SITE_URL}/#organization`,
      name: SITE_NAME,
      url: SITE_URL,
      logo: `${SITE_URL}/icons/myra-512.png`,
      description: SITE_DESCRIPTION,
      sameAs: ['https://www.instagram.com/myraassistant/', 'https://www.tiktok.com/@myra.assistant'],
    },
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      name: SITE_NAME,
      url: SITE_URL,
      publisher: { '@id': `${SITE_URL}/#organization` },
      inLanguage: 'en-GB',
    },
  ],
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // suppressHydrationWarning on <html>: the script in <head> adds .myra-app
  // before React hydrates, which is intended, not a mismatch.
  return (
    <html lang="en-GB" className={manrope.variable} suppressHydrationWarning>
      <head>
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
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA) }}
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
        {/* The page back in bounds once a phone keyboard closes. */}
        <KeyboardSettle />
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
