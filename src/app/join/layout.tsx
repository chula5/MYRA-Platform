import type { Metadata } from 'next'
import { NOINDEX } from '@/lib/site'

// Not for search results: members, partners and sign-in only.
export const metadata: Metadata = { ...NOINDEX }

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
