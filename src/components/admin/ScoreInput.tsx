'use client'

import { useState, useEffect } from 'react'

interface ScoreInputProps {
  label: string
  description: string
  name: string
  value: number | null
  onChange?: (val: number | null) => void
  required?: boolean
}

export default function ScoreInput({
  label,
  description,
  name,
  value,
  onChange,
  required = false,
}: ScoreInputProps) {
  const [selected, setSelected] = useState<number | null>(value)

  useEffect(() => {
    setSelected(value)
  }, [value])

  function handleSelect(n: number) {
    const next = selected === n && !required ? null : n
    setSelected(next)
    onChange?.(next)
  }

  function handleClear() {
    setSelected(null)
    onChange?.(null)
  }

  return (
    <div className="mb-5">
      <label className="text-[10px] tracking-[0.20em] text-[#6B6B6B] mb-1 block">
        {label}
      </label>
      {description && (
        <p className="text-[9px] tracking-[0.12em] text-[#A8A8A4] mb-2">{description}</p>
      )}
      <div className="flex items-center gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => handleSelect(n)}
            className={`w-9 h-9 text-[11px] tracking-[0.10em] transition-all duration-300 rounded-[2px] ${
              selected === n
                ? 'bg-[#0A0A0A] text-white'
                : 'border border-[#E2E0DB] bg-white text-[#6B6B6B] hover:border-[#0A0A0A]'
            }`}
          >
            {n}
          </button>
        ))}
        {!required && (
          <button
            type="button"
            onClick={handleClear}
            className="ml-2 text-[9px] tracking-[0.15em] text-[#A8A8A4] hover:text-[#6B6B6B] transition-colors duration-300"
          >
            {selected === null ? 'N/A' : 'CLEAR'}
          </button>
        )}
      </div>
      <input type="hidden" name={name} value={selected ?? ''} />
    </div>
  )
}
