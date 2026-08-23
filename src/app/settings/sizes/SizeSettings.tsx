'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import SizePicker, { toSizeAnswers, type SizePickerValue } from '@/components/SizePicker'
import { saveSizes } from '@/app/onboarding/actions'

export default function SizeSettings({ initial }: { initial: SizePickerValue }) {
  const router = useRouter()
  const [value, setValue] = useState<SizePickerValue>(initial)
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [message, setMessage] = useState<string | null>(null)

  async function save() {
    setState('saving')
    const res = await saveSizes(toSizeAnswers(value))
    if (res.error) {
      setState('error')
      setMessage(res.error)
      return
    }
    setState('saved')
    setMessage(null)
    // The feed is masked server-side, so it has to be re-fetched for a size
    // change to mean anything.
    router.refresh()
  }

  return (
    <div>
      <SizePicker value={value} onChange={(v) => { setValue(v); setState('idle') }} />

      <div className="mt-10 flex items-center gap-4">
        <button
          onClick={save}
          disabled={state === 'saving'}
          className="bg-[#0A0A0A] text-white px-10 py-3.5 rounded-[12px] text-[15px] tracking-[0.099em] hover:opacity-85 transition-opacity disabled:opacity-40"
        >
          {state === 'saving' ? 'SAVING…' : 'SAVE'}
        </button>
        {state === 'saved' && (
          <span className="text-[15px] tracking-[0.05em] text-[#3A6B3A]">Saved — your edit has been updated.</span>
        )}
        {state === 'error' && (
          <span className="text-[15px] tracking-[0.05em] text-[#B83A3A]">{message ?? 'Could not save.'}</span>
        )}
      </div>
    </div>
  )
}
