'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { discoverFromTasteProfile } from '@/app/admin/items/discover-similar'

export default function BulkDiscoverButton() {
  const router = useRouter()
  const [running, setRunning] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  // Tick an elapsed-seconds counter while the discovery runs.
  useEffect(() => {
    if (running) {
      setElapsed(0)
      timer.current = setInterval(() => setElapsed((s) => s + 1), 1000)
    } else if (timer.current) {
      clearInterval(timer.current)
      timer.current = null
    }
    return () => { if (timer.current) clearInterval(timer.current) }
  }, [running])

  async function handleClick() {
    if (running) return
    setRunning(true)
    setMessage(null)
    setError(null)
    const result = await discoverFromTasteProfile()
    setRunning(false)
    if (result.error) { setError(result.error); return }
    setMessage(`✓ Found ${result.discovered ?? 0} new piece${result.discovered === 1 ? '' : 's'} from your taste profile.`)
    router.push('/admin/discoveries?status=new')
    router.refresh()
  }

  return (
    <div className="mb-6 border border-[#E2E0DB] bg-white p-5 rounded-[3px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] tracking-[0.20em] text-[#4A4E57] mb-1">DISCOVER FROM MY TASTE</p>
          <p className="text-[10px] tracking-[0.12em] text-[#6B6B6B]">
            Ask AI to find pieces matching your overall aesthetic — not tied to a single item.
          </p>
          {!running && message && (
            <p className="mt-2 text-[10px] tracking-[0.15em] text-[#3A6B3A]">{message}</p>
          )}
          {!running && error && (
            <p className="mt-2 text-[10px] tracking-[0.15em] text-red-500">{error}</p>
          )}
        </div>
        <button
          type="button"
          onClick={handleClick}
          disabled={running}
          className="shrink-0 bg-[#0A0A0A] text-white px-5 py-2.5 text-[10px] tracking-[0.20em] hover:bg-[#333] disabled:opacity-70 disabled:cursor-not-allowed transition-colors"
        >
          {running ? `SEARCHING… ${elapsed}s` : '✦ RUN DISCOVERY →'}
        </button>
      </div>

      {/* Prominent running banner so it's obvious the AI is working */}
      {running && (
        <div className="mt-4 flex items-center gap-3 border-t border-[#E2E0DB] pt-4">
          <div className="flex gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#0A0A0A] animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-1.5 h-1.5 rounded-full bg-[#0A0A0A] animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-1.5 h-1.5 rounded-full bg-[#0A0A0A] animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
          <p className="text-[10px] tracking-[0.15em] text-[#6B6B6B]">
            SEARCHING THE WEB FOR NEW PIECES THAT MATCH YOUR TASTE — THIS USUALLY TAKES 30–90 SECONDS. DON&rsquo;T NAVIGATE AWAY. ({elapsed}s)
          </p>
        </div>
      )}
    </div>
  )
}
