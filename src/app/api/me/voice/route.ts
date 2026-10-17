// SPEAK INSTEAD OF TYPE — the voice, written out.
//
// The browser sends a short recording (made by components/me/MicButton where
// it cannot hear for itself: the MYRA app's web view, Firefox); this has it
// transcribed and returns the words. The member must be signed in; nothing is
// stored — the audio goes to the transcriber and is gone.
//
//   OPENAI_API_KEY           the same key the wardrobe pipeline uses
//   OPENAI_TRANSCRIBE_MODEL  default whisper-1

import { NextResponse, type NextRequest } from 'next/server'
import { resolveClientMember } from '@/lib/client-member'
import { WARDROBE_CONFIG, openAiApiKey, openAiConfigured } from '@/lib/wardrobe/config'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_BYTES = 10 * 1024 * 1024

export async function POST(req: NextRequest) {
  const me = await resolveClientMember()
  if (!me) return NextResponse.json({ error: 'Sign in first' }, { status: 401 })
  if (!openAiConfigured()) return NextResponse.json({ error: 'Voice is not set up on the server yet' }, { status: 503 })

  let fd: FormData
  try { fd = await req.formData() } catch { return NextResponse.json({ error: 'No recording' }, { status: 400 }) }
  const audio = fd.get('audio')
  if (!(audio instanceof File) || audio.size === 0) return NextResponse.json({ error: 'No recording' }, { status: 400 })
  if (audio.size > MAX_BYTES) return NextResponse.json({ error: 'That recording is too long' }, { status: 413 })
  const lang = String(fd.get('lang') ?? '').slice(0, 2).toLowerCase()

  const out = new FormData()
  out.set('file', audio, audio.name || 'voice.webm')
  out.set('model', process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1')
  out.set('response_format', 'json')
  if (/^[a-z]{2}$/.test(lang)) out.set('language', lang)

  try {
    const res = await fetch(`${WARDROBE_CONFIG.apiBase}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${openAiApiKey()}` },
      body: out,
    })
    const data: any = await res.json().catch(() => ({}))
    if (!res.ok) {
      console.error('[voice] transcription failed', res.status, data?.error?.message ?? data)
      return NextResponse.json({ error: 'MYRA could not make out the words — try again' }, { status: 502 })
    }
    const text = String(data?.text ?? '').trim()
    if (!text) return NextResponse.json({ error: 'MYRA heard nothing — try again' }, { status: 422 })
    return NextResponse.json({ text })
  } catch (err) {
    console.error('[voice]', err)
    return NextResponse.json({ error: 'MYRA could not make out the words — try again' }, { status: 502 })
  }
}
