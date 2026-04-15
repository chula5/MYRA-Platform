'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateProject } from '@/app/admin/projects/actions'

export default function EditableProjectTitle({
  projectId,
  title,
}: {
  projectId: string
  title: string
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(title)
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!value.trim() || value === title) { setEditing(false); return }
    setSaving(true)
    const fd = new FormData()
    fd.set('title', value.trim())
    await updateProject(projectId, fd)
    setSaving(false)
    setEditing(false)
    router.refresh()
  }

  if (editing) {
    return (
      <div className="flex items-center gap-3">
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setEditing(false) }}
          className="text-[28px] tracking-[0.10em] text-[#0A0A0A] border-b border-[#0A0A0A] bg-transparent focus:outline-none w-full max-w-[480px]"
        />
        <button
          onClick={handleSave}
          disabled={saving}
          className="text-[10px] tracking-[0.20em] text-white bg-[#0A0A0A] px-4 py-2 hover:bg-[#333] disabled:opacity-50 transition-colors"
        >
          {saving ? 'SAVING...' : 'SAVE'}
        </button>
        <button
          onClick={() => setEditing(false)}
          className="text-[10px] tracking-[0.20em] text-[#6B6B6B] hover:text-[#0A0A0A] transition-colors"
        >
          CANCEL
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="text-[28px] tracking-[0.10em] text-[#0A0A0A] hover:opacity-60 transition-opacity text-left group flex items-center gap-3"
    >
      {title.toUpperCase()}
      <span className="text-[10px] tracking-[0.20em] text-[#A8A8A4] group-hover:text-[#6B6B6B] transition-colors">EDIT</span>
    </button>
  )
}
