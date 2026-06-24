import type { Metadata } from 'next'
import { Manrope } from 'next/font/google'
import { FeedProvider } from '@/context/FeedContext'
import './globals.css'

// Site typeface — a clean, gently rounded grotesque close to Pragmatica.
const manrope = Manrope({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-manrope',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'MYRA',
  description: 'MYRA — Outfit-first fashion discovery, personalised to your taste.',
  openGraph: {
    title: 'MYRA',
    description: 'Outfit-first fashion discovery.',
    type: 'website',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={manrope.variable}>
      <body className="bg-background text-primary-text antialiased">
        <FeedProvider>
          {children}
        </FeedProvider>
      </body>
    </html>
  )
}
