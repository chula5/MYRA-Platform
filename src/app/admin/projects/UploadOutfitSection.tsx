'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { uploadOutfitToCloudinaryAndCreateProject } from './upload-actions'

interface Project { project_id: string; title: string }

export default function UploadOutfitSection({ projects }: { projects: Project[] }) {
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [imageData, setImageData] = useState<string | null>(null) // base64 data URL or http URL
  const [urlInput, setUrlInput] = useState('')
  const [dragging, setDragging] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)
  const formRef = useRef<HTMLFormElement>(null)

  // Read a File/Blob into a base64 data URL
  function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  // Handle paste anywhere on the page when section is expanded
  const handlePaste = useCallback(async (e: ClipboardEvent) => {
    if (!expanded) return
    const items = Array.from(e.clipboardData?.items ?? [])
    const imageItem = items.find(i => i.type.startsWith('image/'))
    if (imageItem) {
      const file = imageItem.getAsFile()
      if (!file) return
      e.preventDefault()
      const dataUrl = await readFileAsDataUrl(file)
      setImageData(dataUrl)
      setUrlInput('')
      setError(null)
    }
  }, [expanded])

  useEffect(() => {
    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [handlePaste])

  // Drag and drop handlers
  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    setDragging(true)
  }
  function handleDragLeave() {
    setDragging(false)
  }
  async function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file && file.type.startsWith('image/')) {
      const dataUrl = await readFileAsDataUrl(file)
      setImageData(dataUrl)
      setUrlInput('')
      setError(null)
    }
  }

  function handleUrlChange(e: React.ChangeEvent<HTMLInputElement>) {
    setUrlInput(e.target.value)
    setImageData(null)
  }

  function clearImage() {
    setImageData(null)
    setUrlInput('')
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const source = imageData ?? urlInput.trim()
    if (!source) { setError('Please paste an image or enter a URL.'); return }
    setLoading(true)
    setError(null)
    const fd = new FormData(e.currentTarget)
    fd.set('image_url', source)
    try {
      await uploadOutfitToCloudinaryAndCreateProject(fd)
    } catch (err: unknown) {
      // Next.js redirect() throws internally — let it propagate so navigation works
      if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
      setError(err instanceof Error ? err.message : 'Upload failed')
      setLoading(false)
    }
  }

  const hasImage = Boolean(imageData || urlInput.trim())

  return (
    <div className="border border-[#E2E0DB] bg-white mb-8">
      {/* Toggle header */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="flex items-center justify-between w-full px-6 py-5 hover:border-[#0A0A0A] transition-colors duration-300 group"
      >
        <div className="text-left">
          <p className="text-[11px] tracking-[0.25em] text-[#6B6B6B] mb-1">CLOUDINARY UPLOAD</p>
          <p className="text-[14px] tracking-[0.15em] text-[#0A0A0A]">UPLOAD OUTFIT IMAGE ↑</p>
          <p className="text-[10px] tracking-[0.12em] text-[#A8A8A4] mt-1">Paste, drag & drop, or enter a URL — uploads to Cloudinary and creates a new project</p>
        </div>
        <span className="text-[24px] text-[#E2E0DB] group-hover:text-[#0A0A0A] transition-colors duration-300">
          {expanded ? '−' : '+'}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-[#E2E0DB] px-6 py-6">
          <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-5">

            {/* Drop zone / preview */}
            <div>
              <label className="block text-[10px] tracking-[0.20em] text-[#6B6B6B] mb-2">
                IMAGE <span className="text-red-400">*</span>
              </label>

              {imageData ? (
                <div className="relative border border-[#0A0A0A] bg-[#F2F2F0] flex items-center justify-center overflow-hidden" style={{ minHeight: 200 }}>
                  <img src={imageData} alt="Preview" className="max-h-[320px] max-w-full object-contain" />
                  <button
                    type="button"
                    onClick={clearImage}
                    className="absolute top-3 right-3 bg-white border border-[#E2E0DB] text-[10px] tracking-[0.15em] text-[#6B6B6B] px-3 py-1.5 hover:border-[#0A0A0A] hover:text-[#0A0A0A] transition-colors"
                  >
                    CLEAR ×
                  </button>
                </div>
              ) : (
                <div
                  ref={dropRef}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`border-2 border-dashed flex flex-col items-center justify-center py-12 px-6 text-center transition-colors duration-200 ${
                    dragging ? 'border-[#0A0A0A] bg-[#F2F2F0]' : 'border-[#E2E0DB] bg-white'
                  }`}
                >
                  <p className="text-[11px] tracking-[0.20em] text-[#6B6B6B] mb-2">
                    DRAG & DROP OR PASTE AN IMAGE
                  </p>
                  <p className="text-[10px] tracking-[0.12em] text-[#A8A8A4]">
                    — or enter a URL below —
                  </p>
                </div>
              )}
            </div>

            {/* URL fallback */}
            {!imageData && (
              <div>
                <label className="block text-[10px] tracking-[0.20em] text-[#6B6B6B] mb-2">
                  IMAGE URL
                </label>
                <input
                  name="image_url_field"
                  type="text"
                  value={urlInput}
                  onChange={handleUrlChange}
                  placeholder="https://..."
                  className="w-full border border-[#E2E0DB] bg-white px-4 py-3 text-[12px] tracking-[0.08em] text-[#0A0A0A] placeholder-[#A8A8A4] focus:outline-none focus:border-[#0A0A0A] transition-colors"
                />
              </div>
            )}

            {/* Project selector */}
            <div>
              <label className="block text-[10px] tracking-[0.20em] text-[#6B6B6B] mb-2">
                ADD TO PROJECT
              </label>
              <select
                name="project_id"
                className="w-full border border-[#E2E0DB] bg-white px-4 py-3 text-[12px] tracking-[0.08em] text-[#0A0A0A] focus:outline-none focus:border-[#0A0A0A] transition-colors appearance-none"
              >
                <option value="">— Create new project —</option>
                {projects.map(p => (
                  <option key={p.project_id} value={p.project_id}>
                    {p.title.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>

            {/* Project title (only relevant when creating new) */}
            <div>
              <label className="block text-[10px] tracking-[0.20em] text-[#6B6B6B] mb-2">
                NEW PROJECT TITLE <span className="text-[#A8A8A4]">(IF CREATING NEW)</span>
              </label>
              <input
                name="project_title"
                type="text"
                placeholder="New Outfit Project"
                className="w-full border border-[#E2E0DB] bg-white px-4 py-3 text-[12px] tracking-[0.08em] text-[#0A0A0A] placeholder-[#A8A8A4] focus:outline-none focus:border-[#0A0A0A] transition-colors"
              />
            </div>

            {/* Celebrity name */}
            <div>
              <label className="block text-[10px] tracking-[0.20em] text-[#6B6B6B] mb-2">
                CELEBRITY NAME <span className="text-[#A8A8A4]">(OPTIONAL)</span>
              </label>
              <input
                name="celebrity_name"
                type="text"
                placeholder="e.g. Zendaya"
                className="w-full border border-[#E2E0DB] bg-white px-4 py-3 text-[12px] tracking-[0.08em] text-[#0A0A0A] placeholder-[#A8A8A4] focus:outline-none focus:border-[#0A0A0A] transition-colors"
              />
            </div>

            {error && (
              <p className="text-[11px] tracking-[0.12em] text-red-500">{error}</p>
            )}

            <div className="flex items-center gap-3 pt-2">
              <button
                type="submit"
                disabled={loading || !hasImage}
                className="bg-[#0A0A0A] text-white px-8 py-3 text-[11px] tracking-[0.20em] hover:bg-[#333] disabled:opacity-40 transition-colors whitespace-nowrap"
              >
                {loading ? 'UPLOADING...' : 'UPLOAD & CREATE PROJECT →'}
              </button>
              {loading && (
                <p className="text-[10px] tracking-[0.15em] text-[#A8A8A4] animate-pulse">
                  Uploading to Cloudinary...
                </p>
              )}
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
