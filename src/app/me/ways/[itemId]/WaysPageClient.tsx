'use client'

// WAYS TO WEAR IT — one piece, straight from a link (the morning note, a
// message from her stylist). The same sheet every surface opens, full screen;
// closing it takes her to FOR YOU.

import { useRouter } from 'next/navigation'
import WaysToWear from '@/components/me/WaysToWear'
import type { WaysPiece } from '@/app/me/ways/actions'

export default function WaysPageClient({ itemId, piece }: { itemId: string; piece: WaysPiece | null }) {
  const router = useRouter()
  return <WaysToWear itemId={itemId} piece={piece} onClose={() => router.push('/me')} />
}
