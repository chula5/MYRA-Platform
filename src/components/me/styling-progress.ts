'use client'

// THE STYLING MARK — what MYRA is styling for her right now, kept outside any
// one page so the dress form can follow her from room to room.
//
// FOR YOU publishes here while it is open (the pieces being styled, how many
// are done, the one she tapped that has just come back ready). When she
// leaves the page the count keeps itself: one quiet poll carries on until the
// last piece lands, so the mark in the corner stays true wherever she is, and
// a tap on it takes her back to the outfits.

import { useSyncExternalStore } from 'react'
import { pollWaysMany } from '@/app/me/ways/actions'
import type { WayMode } from '@/lib/styled-ways-core'

export interface StylingProgress {
  /** Pieces MYRA is styling on this visit. */
  total: number
  /** How many of them are done. */
  finished: number
  /** A piece she tapped herself whose outfits have just landed. */
  ready: string | null
  /** Where the styling started, as the address that opens it again ("/me?styled=1", "/me/browse?styled=…"). */
  origin: string | null
  /** The pool the pieces are styled in (what to poll). */
  mode: WayMode
}

/** FOR YOU listens for this: the mark was tapped while she was on the page. */
export const STYLING_OPEN_EVENT = 'myra:styling-open'

const EMPTY: StylingProgress = { total: 0, finished: 0, ready: null, origin: null, mode: 'blend' }
/** The page a progress belongs to: its path without the query. */
const ownerOf = (origin: string | null) => (origin ?? '').split('?')[0]
let state: StylingProgress = EMPTY
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function getStylingProgress(): StylingProgress { return state }

export function publishStyling(next: StylingProgress): void {
  // A page with nothing to say does not wipe what another page is styling.
  if (next.total === 0 && state.total > 0 && ownerOf(next.origin) !== ownerOf(state.origin)) return
  if (next.total === state.total && next.finished === state.finished && next.ready === state.ready && next.origin === state.origin) return
  state = next
  emit()
}

/** Opening the outfits clears the READY. */
export function clearStylingReady(): void {
  if (!state.ready) return
  state = { ...state, ready: null }
  emit()
}

export function useStylingProgress(): StylingProgress {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l) } },
    () => state,
    () => EMPTY,
  )
}

// ── Carrying on after FOR YOU has gone ───────────────────────────────────────

const EVERY_MS = 3_000
const MAX_POLLS = 40
let watcher = 0

/**
 * FOR YOU is unmounting with pieces still being styled: keep counting them
 * here. `tapped` are the pieces she asked for herself — one of those landing
 * turns the mark to READY.
 */
export function keepWatchingStyling(pending: string[], tapped: string[], testMemberId?: string, mode: WayMode = 'blend'): void {
  const id = ++watcher
  let left = Array.from(new Set(pending))
  if (!left.length) return
  let n = 0
  const tick = async () => {
    if (watcher !== id || !left.length || n++ >= MAX_POLLS) return
    let r: Awaited<ReturnType<typeof pollWaysMany>> = {}
    try { r = await pollWaysMany(left, testMemberId, mode) } catch { /* try again */ }
    if (watcher !== id) return
    let finished = state.finished
    let ready = state.ready
    for (const pid of [...left]) {
      const x = r[pid]
      if (!x || x.status === 'working') continue
      left = left.filter((l) => l !== pid)
      finished++
      if (x.looks.length && tapped.includes(pid)) ready = pid
    }
    state = { ...state, finished: Math.min(finished, state.total), ready }
    emit()
    if (left.length) setTimeout(tick, EVERY_MS)
  }
  setTimeout(tick, EVERY_MS)
}

/** The page that started the styling is back and counting for itself. */
export function stopWatchingStyling(owner?: string): void {
  if (owner && ownerOf(state.origin) !== owner) return
  watcher++
}
