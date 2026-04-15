import type { Metadata } from 'next'
import { FeedProvider } from '@/context/FeedContext'
import './globals.css'

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
    <html lang="en">
      <body className="bg-background text-primary-text antialiased">
        <FeedProvider>
          {children}
        </FeedProvider>
      </body>
    </html>
  )
}
