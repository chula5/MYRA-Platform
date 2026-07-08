'use client'

import { useState } from 'react'
import { updateOutfitTags } from '@/app/admin/projects/actions'

// Inline occasion-tag editor: chips with × to delete, quick-add from the most-
// used tags across the catalogue, and a free-text add (with autocomplete of the
// full tag vocabulary). Persists immediately via updateOutfitTags. `suggestions`
// (catalogue tag frequency) makes tagging faster and reflects the growing
// vocabulary — so tagging gets quicker/smarter as the catalogue grows.
export default function TagChips({
  outfitId,
  initialTags,
  suggestions,
}: {
  outfitId: string
  initialTags: string[]
  suggestions: string[]
}) {
  const [tags, setTags] = useState<string[]>(initialTags)
  const [adding, setAdding] = useState(false)
  const [input, setInput] = useState('')

  function commit(next: string[]) {
    const clean = Array.from(new Set(next.map((t) => t.trim().toLowerCase()).filter(Boolean)))
    setTags(clean)
    void updateOutfitTags(outfitId, clean)
  }
  function remove(t: string) { commit(tags.filter((x) => x !== t)) }
  function add(t: string) {
    const v = t.trim().toLowerCase()
    if (!v || tags.includes(v)) { setInput(''); return }
    commit([...tags, v])
    setInput('')
  }

  // Quick-add: top catalogue tags not already on this outfit.
  const quick = suggestions.filter((s) => !tags.includes(s)).slice(0, 6)

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 bg-[#FAFAF8] border border-[#E2E0DB] rounded-full pl-2.5 pr-1.5 py-1 text-[9px] tracking-[0.05em] text-[#4A4E57]">
            {t.toUpperCase()}
            <button onClick={() => remove(t)} aria-label={`Remove ${t}`} className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-[#A8A8A4] hover:bg-[#B83A3A] hover:text-white text-[10px] leading-none">×</button>
          </span>
        ))}
        {adding ? (
          <input
            autoFocus
            list="myra-tag-vocab"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(input) } if (e.key === 'Escape') { setAdding(false); setInput('') } }}
            onBlur={() => { if (input.trim()) add(input); setAdding(false) }}
            placeholder="tag…"
            className="w-[92px] border border-[#0A0A0A] rounded-full px-2.5 py-1 text-[9px] tracking-[0.05em] text-[#4A4E57] focus:outline-none"
          />
        ) : (
          <button onClick={() => setAdding(true)} className="inline-flex items-center border border-dashed border-[#C9C7C2] rounded-full px-2.5 py-1 text-[9px] tracking-[0.08em] text-[#A8A8A4] hover:border-[#0A0A0A] hover:text-[#4A4E57] transition-colors">+ TAG</button>
        )}
      </div>
      {adding && quick.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {quick.map((s) => (
            <button key={s} onClick={() => add(s)} className="text-[8px] tracking-[0.05em] text-[#8A7A4E] bg-[#FBF6EA] border border-[#E8D9B8] rounded-full px-2 py-0.5 hover:bg-[#F3E9CF] transition-colors">+ {s.toUpperCase()}</button>
          ))}
        </div>
      )}
    </div>
  )
}
