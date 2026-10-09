'use client'

// A piece she walked away from while MYRA was still styling it. The job
// carries on on the server; this keeps one quiet poll going in the browser so
// the tile she left can show a small "ready" mark the moment it lands, and
// the next open is instant. One watcher per piece, never more.

import { useEffect, useState } from 'react'
import { pollWaysToWear } from '@/app/me/ways/actions'
import type { WayMode } from '@/lib/styled-ways-core'

export const WAYS_READY_EVENT = 'myra:ways-ready'
const watching = new Set<string>()
const ready = new Set<string>()
const EVERY_MS = 3_000
const MAX_POLLS = 40

export function watchWays(itemId: string, mode: WayMode = 'blend', testMemberId?: string): void {
  const key = `${itemId}|${mode}`
  if (watching.has(key) || ready.has(key)) return
  watching.add(key)
  let n = 0
  const tick = async () => {
    n++
    let status: string = 'working'
    try { status = (await pollWaysToWear(itemId, mode, testMemberId)).status } catch { /* try again */ }
    if (status === 'working' && n < MAX_POLLS) { setTimeout(tick, EVERY_MS); return }
    watching.delete(key)
    if (status === 'ready') {
      ready.add(key)
      window.dispatchEvent(new CustomEvent(WAYS_READY_EVENT, { detail: { itemId, mode } }))
    }
  }
  setTimeout(tick, EVERY_MS)
}

/** True once the ways for this piece landed after she closed the sheet. */
export function useWaysReady(itemId: string | null | undefined, mode: WayMode = 'blend'): boolean {
  const key = itemId ? `${itemId}|${mode}` : ''
  const [is, setIs] = useState(() => (key ? ready.has(key) : false))
  useEffect(() => {
    if (!key) return
    setIs(ready.has(key))
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail
      if (d?.itemId === itemId && (d?.mode ?? 'blend') === mode) setIs(true)
    }
    window.addEventListener(WAYS_READY_EVENT, on)
    return () => window.removeEventListener(WAYS_READY_EVENT, on)
  }, [key, itemId, mode])
  return is
}

/** The mark is for the moment she comes back; opening the sheet clears it. */
export function clearWaysReady(itemId: string, mode: WayMode = 'blend'): void {
  ready.delete(`${itemId}|${mode}`)
}
