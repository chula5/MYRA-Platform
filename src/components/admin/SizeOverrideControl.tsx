'use client'

import { useState } from 'react'
import { setSizeOverride } from '@/app/admin/second-hand/actions'

/**
 * Deliberately keep a piece in a look that's outside the client's size.
 *
 * The size gate is absolute for one-of-ones — without this there'd be no way to
 * express an intentional decision like "sized up on purpose — oversized fit",
 * and the composer would keep quietly removing the look. The note is shown to
 * her in the sourcing panel, so it has to say something true.
 */
export default function SizeOverrideControl({
  outfitItemId,
  initialOn = false,
  initialNote = null,
}: {
  outfitItemId: string
  initialOn?: boolean
  initialNote?: string | null
}) {
  const [on, setOn] = useState(initialOn)
  const [note, setNote] = useState(initialNote ?? '')
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  async function commit(nextOn: boolean, nextNote: string) {
    setSaving(true)
    await setSizeOverride(outfitItemId, nextOn, nextNote)
    setSaving(false)
  }

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => {
          if (on) { setOn(false); setOpen(false); void commit(false, '') }
          else setOpen((o) => !o)
        }}
        className={`text-[9px] tracking-[0.068em] transition-colors ${
          on ? 'text-[#8A7340]' : 'text-[#A8A8A4] hover:text-[#4A4E57]'
        }`}
      >
        {saving ? 'SAVING…' : on ? 'SIZE OVERRIDE ON ✓' : 'SIZE OVERRIDE'}
      </button>

      {open && !on && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. sized up on purpose — oversized fit"
            className="flex-1 border border-[#E2E0DB] px-2 py-1 text-[9px] tracking-[0.045em] text-[#4A4E57] bg-white"
          />
          <button
            type="button"
            onClick={() => { setOn(true); setOpen(false); void commit(true, note) }}
            disabled={!note.trim()}
            className="text-[9px] tracking-[0.09em] text-white bg-[#0A0A0A] px-2.5 py-1 disabled:opacity-30"
          >
            KEEP IT
          </button>
        </div>
      )}
    </div>
  )
}
