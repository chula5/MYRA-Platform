'use client'

// SPEAK INSTEAD OF TYPE — a microphone beside any box she would type into.
//
// Where the browser can hear for itself (Safari on an iPhone, Chrome on a
// desktop) the words arrive as she says them. Where it cannot — the MYRA app's
// web view, Firefox — the voice is recorded and sent to /api/me/voice, which
// has it written out and hands the text back. Either way the text lands in
// the box through `onText`; `final` is true once she has finished speaking.
//
// Nothing is kept: the recording goes only to be transcribed and is dropped.

import { useEffect, useRef, useState } from 'react'

type Mode = 'idle' | 'listening' | 'transcribing'
const MAX_SECONDS = 30

function recogniser(): any {
  if (typeof window === 'undefined') return null
  const w = window as any
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}
function canRecord(): boolean {
  return typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'
}

export default function MicButton({
  onText, size = 'md', className = '', lang,
}: {
  onText: (text: string, final: boolean) => void
  /** 'bar' is small on a phone and full size from sm up, for a search bar that grows. */
  size?: 'sm' | 'md' | 'bar'
  /** May place the button (`absolute right-2 …`); the wrapper then sits where it is told. */
  className?: string
  /** Defaults to the browser's own language. */
  lang?: string
}) {
  const [mode, setMode] = useState<Mode>('idle')
  const [supported, setSupported] = useState(true)
  const [note, setNote] = useState<string | null>(null)
  const rec = useRef<any>(null)
  const media = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const chunks = useRef<Blob[]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const live = useRef(true)

  useEffect(() => {
    live.current = true
    setSupported(!!recogniser() || canRecord())
    return () => { live.current = false; stopAll() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function stopAll() {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    try { rec.current?.stop() } catch { /* already stopped */ }
    rec.current = null
    try { if (media.current && media.current.state !== 'inactive') media.current.stop() } catch { /* already stopped */ }
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
  }

  function startRecognition(R: any) {
    const r = new R()
    r.lang = lang ?? (typeof navigator !== 'undefined' ? navigator.language : 'en-GB') ?? 'en-GB'
    r.interimResults = true
    r.continuous = false
    r.maxAlternatives = 1
    let heard = ''
    let finished = false
    r.onresult = (e: any) => {
      let text = ''
      let final = false
      for (let i = 0; i < e.results.length; i++) {
        text += e.results[i][0]?.transcript ?? ''
        if (e.results[i].isFinal) final = true
      }
      heard = text.trim()
      if (!heard || finished) return
      if (final) finished = true
      onText(heard, final)
    }
    r.onerror = (e: any) => {
      if (!live.current) return
      if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') setNote('MYRA was not allowed to use the microphone.')
      else if (e?.error !== 'aborted' && e?.error !== 'no-speech') setNote('MYRA could not hear that — try again.')
      setMode('idle')
    }
    r.onend = () => {
      if (!live.current) return
      rec.current = null
      setMode('idle')
      // Safari sometimes ends without marking the last result final.
      if (heard && !finished) { finished = true; onText(heard, true) }
    }
    rec.current = r
    r.start()
    setMode('listening')
  }

  async function startRecording() {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.current = s
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/wav']
      .find((m) => { try { return MediaRecorder.isTypeSupported(m) } catch { return false } })
    const m = new MediaRecorder(s, mime ? { mimeType: mime } : undefined)
    chunks.current = []
    m.ondataavailable = (e) => { if (e.data && e.data.size) chunks.current.push(e.data) }
    m.onstop = async () => {
      stream.current?.getTracks().forEach((t) => t.stop())
      stream.current = null
      if (!live.current) return
      const blob = new Blob(chunks.current, { type: m.mimeType || 'audio/webm' })
      chunks.current = []
      if (blob.size < 1000) { setMode('idle'); return }
      setMode('transcribing')
      try {
        const fd = new FormData()
        const ext = /mp4/.test(blob.type) ? 'mp4' : /ogg/.test(blob.type) ? 'ogg' : /wav/.test(blob.type) ? 'wav' : 'webm'
        fd.set('audio', blob, `voice.${ext}`)
        if (lang) fd.set('lang', lang)
        const res = await fetch('/api/me/voice', { method: 'POST', body: fd })
        const data = await res.json().catch(() => ({}))
        if (!live.current) return
        if (!res.ok || !data?.text) setNote(data?.error ?? 'MYRA could not make out the words — try again.')
        else onText(String(data.text).trim(), true)
      } catch {
        if (live.current) setNote('MYRA could not make out the words — try again.')
      } finally {
        if (live.current) setMode('idle')
      }
    }
    media.current = m
    m.start()
    setMode('listening')
    timer.current = setTimeout(() => stop(), MAX_SECONDS * 1000)
  }

  async function start() {
    setNote(null)
    try {
      const R = recogniser()
      if (R) startRecognition(R)
      else if (canRecord()) await startRecording()
      else setSupported(false)
    } catch (err) {
      const name = (err as any)?.name
      setNote(name === 'NotAllowedError' || name === 'SecurityError' ? 'MYRA was not allowed to use the microphone.' : 'MYRA could not start listening.')
      setMode('idle')
    }
  }

  function stop() {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    if (rec.current) { try { rec.current.stop() } catch { /* fine */ } return }
    if (media.current && media.current.state !== 'inactive') { media.current.stop(); return }
    setMode('idle')
  }

  if (!supported) return null
  const box = size === 'sm' ? 'w-10 h-10' : size === 'bar' ? 'w-10 h-10 sm:w-14 sm:h-14' : 'w-14 h-14'
  const icon = size === 'sm' ? 'w-5 h-5' : size === 'bar' ? 'w-5 h-5 sm:w-6 sm:h-6' : 'w-6 h-6'
  const listening = mode === 'listening'
  // The wrapper is only `relative` when nothing else positions it: Tailwind
  // emits `.relative` after `.absolute`, so saying both left the mic in flow,
  // sitting under the search pill instead of inside it (Chloe, 2026-10-17).
  const placed = /\b(absolute|fixed|sticky)\b/.test(className)
  return (
    <span className={`inline-flex ${placed ? '' : 'relative'} ${className}`}>
      <button
        type="button"
        onClick={() => (listening ? stop() : void start())}
        disabled={mode === 'transcribing'}
        aria-pressed={listening}
        aria-label={listening ? 'Stop listening' : 'Speak instead of typing'}
        title={listening ? 'Tap when you have finished' : 'Speak instead of typing'}
        className={`${box} rounded-full flex items-center justify-center transition-colors disabled:opacity-50 ${listening ? 'bg-[#B83A3A] text-white myra-mic-live' : 'bg-white text-[#2B2B2B] shadow-[0_6px_14px_-10px_rgba(43,43,43,0.6)] hover:bg-[#2B2B2B] hover:text-white'}`}
      >
        {mode === 'transcribing' ? (
          <svg viewBox="0 0 24 24" className={`${icon} animate-spin`} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="M12 3a9 9 0 1 0 9 9" strokeLinecap="round" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" className={icon} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
          </svg>
        )}
      </button>
      {note && (
        <span role="status" className="absolute right-0 top-full mt-2 whitespace-nowrap rounded-full bg-white px-3 py-1.5 text-[15px] text-[#B83A3A] shadow-[0_6px_14px_-10px_rgba(43,43,43,0.6)]">{note}</span>
      )}
    </span>
  )
}
