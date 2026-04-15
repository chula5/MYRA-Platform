'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createProject } from '@/app/admin/projects/actions'

const inputClass =
  'w-full border border-[#E2E0DB] bg-white px-4 py-2.5 text-[12px] tracking-[0.10em] text-[#0A0A0A] focus:outline-none focus:border-[#0A0A0A] transition-colors duration-300'
const labelClass = 'text-[10px] tracking-[0.20em] text-[#6B6B6B] mb-1.5 block'

export default function NewProjectPage() {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const formData = new FormData(e.currentTarget)
    const result = await createProject(formData)
    setSubmitting(false)
    if (result?.error) {
      setError(result.error)
      return
    }
    if (result?.projectId) {
      router.push(`/admin/projects/${result.projectId}`)
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <Link
          href="/admin/projects"
          className="text-[10px] tracking-[0.20em] text-[#6B6B6B] hover:text-[#0A0A0A] transition-colors duration-300 mb-4 inline-block"
        >
          ← PROJECTS
        </Link>
        <div>
          <p className="text-[11px] tracking-[0.25em] text-[#6B6B6B] mb-2">ADMIN STUDIO</p>
          <h1 className="text-[28px] tracking-[0.10em] text-[#0A0A0A]">NEW PROJECT</h1>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="max-w-xl">
        <div className="mb-6">
          <label className={labelClass}>PROJECT TITLE</label>
          <input
            name="title"
            type="text"
            required
            placeholder="E.G. AUTUMN EDIT 2026"
            className={inputClass}
          />
        </div>

        <div className="mb-6">
          <label className={labelClass}>COVER IMAGE URL</label>
          <input
            name="cover_image_url"
            type="url"
            placeholder="HTTPS://..."
            className={inputClass}
          />
        </div>

        <div className="mb-8">
          <label className={labelClass}>NOTES</label>
          <textarea
            name="notes"
            rows={4}
            placeholder="BRIEF, INTENT, REFERENCES..."
            className={`${inputClass} resize-none`}
          />
        </div>

        {error && (
          <div className="mb-6 p-4 border border-red-200 bg-red-50">
            <p className="text-[10px] tracking-[0.15em] text-red-600">{error}</p>
          </div>
        )}

        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={submitting}
            className="bg-[#0A0A0A] text-white px-8 py-3.5 text-[11px] tracking-[0.20em] transition-colors duration-400 hover:bg-[#333] disabled:opacity-50"
          >
            {submitting ? 'CREATING...' : 'CREATE PROJECT'}
          </button>
          <Link
            href="/admin/projects"
            className="border border-[#0A0A0A] bg-transparent text-[#0A0A0A] px-8 py-3.5 text-[11px] tracking-[0.20em] transition-colors duration-400 hover:bg-[#F2F2F0]"
          >
            CANCEL
          </Link>
        </div>
      </form>
    </div>
  )
}
