'use client'

import { createContext, useContext, useState, useCallback, ReactNode } from 'react'
import type { Outfit } from '@/types/database'

interface FeedContextValue {
  occasion: string | null
  setOccasion: (occasion: string) => void
  seenOutfitIds: string[]
  addSeenOutfit: (id: string) => void
  scrollPosition: number
  setScrollPosition: (pos: number) => void
  currentFeedOutfits: Outfit[]
  setCurrentFeedOutfits: (outfits: Outfit[]) => void
}

const FeedContext = createContext<FeedContextValue | null>(null)

export function FeedProvider({ children }: { children: ReactNode }) {
  const [occasion, setOccasionState] = useState<string | null>(null)
  const [seenOutfitIds, setSeenOutfitIds] = useState<string[]>([])
  const [scrollPosition, setScrollPosition] = useState(0)
  const [currentFeedOutfits, setCurrentFeedOutfits] = useState<Outfit[]>([])

  const setOccasion = useCallback((occ: string) => {
    setOccasionState(occ)
    setSeenOutfitIds([])
  }, [])

  const addSeenOutfit = useCallback((id: string) => {
    setSeenOutfitIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
  }, [])

  return (
    <FeedContext.Provider
      value={{
        occasion,
        setOccasion,
        seenOutfitIds,
        addSeenOutfit,
        scrollPosition,
        setScrollPosition,
        currentFeedOutfits,
        setCurrentFeedOutfits,
      }}
    >
      {children}
    </FeedContext.Provider>
  )
}

export function useFeed() {
  const ctx = useContext(FeedContext)
  if (!ctx) throw new Error('useFeed must be used inside FeedProvider')
  return ctx
}
