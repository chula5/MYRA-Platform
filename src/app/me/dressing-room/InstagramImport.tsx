'use client'

// IMPORT FROM INSTAGRAM — for every account, personal included.
//
// Instagram closed its API to personal accounts, but anyone can ask Instagram
// for their own photos and gets a file by email. This walks her through it one
// step at a time, in plain words: MYRA opens the right Instagram page, notices
// when she comes back, watches her connected inbox for Instagram's "ready"
// email, and then takes the file. The file is opened HERE, in her browser —
// only her post photos are sent to MYRA; her messages and everything else in
// the download never leave her computer.
//
// Where she is in the steps is remembered on this device, because step two can
// take a day.

import { useEffect, useRef, useState } from 'react'
import { isPostsList, pickPostPhotos, readPostsList, type ExportPhoto } from '@/lib/archival/instagram-export'
import { findInstagramExportEmail, uploadArchivalPhoto } from './archival-actions'

const INSTAGRAM_EXPORT_PAGE = 'https://accountscenter.instagram.com/info_and_permissions/dyi/'
const BATCH = 40

const T = 'text-[22px] xl:text-[24px] 2xl:text-[28px]'
const T_SMALL = 'text-[20px] xl:text-[22px] 2xl:text-[25px]'
const BTN = 'text-[22px] xl:text-[25px] 2xl:text-[29px] px-8 py-4 rounded-full bg-[#2B2B2B] text-white disabled:opacity-40'
const BTN_QUIET = 'text-[22px] xl:text-[25px] 2xl:text-[29px] px-8 py-4 rounded-full border border-[#2B2B2B] text-[#2B2B2B] disabled:opacity-40'

type Step = 1 | 2 | 3

const mimeFor = (path: string) => (/\.png$/i.test(path) ? 'image/png' : /\.webp$/i.test(path) ? 'image/webp' : 'image/jpeg')

export default function InstagramImport({ testMemberId, onClose, onImported }: { testMemberId?: string; onClose: () => void; onImported: () => void }) {
  const storeKey = `myra_ig_import_${testMemberId ?? 'me'}`
  const [step, setStepState] = useState<Step>(1)
  const [mail, setMail] = useState<{ inbox: boolean; ready: boolean; link?: string } | null>(null)
  const [checking, setChecking] = useState(false)
  const [work, setWork] = useState<{ found: number; done: number; total: number; added: number; already: number; failed: number; why?: string } | null>(null)
  const [finished, setFinished] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const awaitingReturn = useRef(false)
  const fileRef = useRef<HTMLInputElement>(null)
  // What is left in the file after the first batch, for "bring in more".
  const remaining = useRef<{ files: File[]; photos: ExportPhoto[]; from: number } | null>(null)

  const setStep = (s: Step) => {
    setStepState(s)
    try { localStorage.setItem(storeKey, String(s)) } catch { /* private window */ }
  }

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(storeKey))
      if (saved === 2 || saved === 3) setStepState(saved as Step)
    } catch { /* private window */ }
  }, [storeKey])

  // She went to Instagram; the moment she is back, move on for her.
  useEffect(() => {
    const back = () => {
      if (!awaitingReturn.current || document.visibilityState !== 'visible') return
      awaitingReturn.current = false
      setStep(2)
    }
    window.addEventListener('focus', back)
    document.addEventListener('visibilitychange', back)
    return () => { window.removeEventListener('focus', back); document.removeEventListener('visibilitychange', back) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // While she waits, MYRA watches her inbox for Instagram's email.
  useEffect(() => {
    if (step !== 2) return
    let live = true
    const check = async () => {
      setChecking(true)
      const r = await findInstagramExportEmail(testMemberId).catch(() => null)
      if (!live) return
      setChecking(false)
      if (r) setMail(r)
    }
    void check()
    const every = setInterval(check, 90_000)
    return () => { live = false; clearInterval(every) }
  }, [step, testMemberId])

  function openInstagram() {
    awaitingReturn.current = true
    window.open(INSTAGRAM_EXPORT_PAGE, '_blank', 'noopener,noreferrer')
  }

  /** Open her download here, in the browser, and send MYRA only her post photos. */
  async function takeFiles(list: FileList | File[] | null) {
    const files = Array.from(list ?? []).filter((f) => /\.zip$/i.test(f.name) || f.type.includes('zip'))
    if (!files.length) { setError('That does not look like the file from Instagram. It ends in .zip and is usually in your Downloads folder.'); return }
    setError(null)
    setFinished(false)
    try {
      const { BlobReader, TextWriter, ZipReader, configure } = await import('@zip.js/zip.js')
      configure({ useWebWorkers: false })
      const paths: { file: File; path: string }[] = []
      const listed = new Map<string, { takenAt: string | null; caption: string | null }>()
      for (const file of files) {
        const reader = new ZipReader(new BlobReader(file))
        for (const entry of await reader.getEntries()) {
          if (entry.directory) continue
          paths.push({ file, path: entry.filename })
          if (isPostsList(entry.filename)) {
            try {
              const text = await entry.getData(new TextWriter())
              readPostsList(JSON.parse(text)).forEach((v, k) => listed.set(k, v))
            } catch { /* an unreadable list only costs the exact dates */ }
          }
        }
        await reader.close()
      }
      const photos = pickPostPhotos(paths.map((p) => p.path), listed, 100_000)
      if (!photos.length) { setError('MYRA could not find any posts in that file. When you ask Instagram, make sure "Posts" is ticked.'); return }
      remaining.current = { files, photos, from: 0 }
      await bringIn()
    } catch (err) {
      setError(err instanceof Error ? `That file could not be opened: ${err.message}` : 'That file could not be opened.')
    }
  }

  /** The next batch of photos from the file she gave. */
  async function bringIn() {
    const rest = remaining.current
    if (!rest) return
    const { BlobReader, BlobWriter, ZipReader } = await import('@zip.js/zip.js')
    const batch = rest.photos.slice(rest.from, rest.from + BATCH)
    const want = new Map(batch.map((p) => [p.path, p]))
    let done = 0, added = 0, already = 0, failed = 0
    let why: string | undefined
    setFinished(false)
    setWork({ found: rest.photos.length, done: 0, total: batch.length, added: 0, already: 0, failed: 0 })
    for (const file of rest.files) {
      const reader = new ZipReader(new BlobReader(file))
      for (const entry of await reader.getEntries()) {
        if (entry.directory) continue
        const photo = want.get(entry.filename)
        if (!photo) continue
        try {
          const blob = await entry.getData(new BlobWriter(mimeFor(photo.path)))
          const fd = new FormData()
          fd.set('file', new File([blob], photo.path.split('/').pop() ?? 'photo.jpg', { type: mimeFor(photo.path) }))
          if (photo.takenAt) fd.set('taken_at', photo.takenAt)
          if (photo.caption) fd.set('caption', photo.caption)
          if (testMemberId) fd.set('member', testMemberId)
          const r = await uploadArchivalPhoto(fd)
          if (r.error) { failed++; why = why ?? r.error }
          else if (r.skipped) already++
          else added++
        } catch (err) { failed++; why = why ?? (err instanceof Error ? err.message : undefined) }
        done++
        setWork({ found: rest.photos.length, done, total: batch.length, added, already, failed, why })
      }
      await reader.close()
    }
    rest.from += batch.length
    setFinished(true)
    try { localStorage.removeItem(storeKey) } catch { /* private window */ }
    onImported()
  }

  const left = remaining.current ? Math.max(0, remaining.current.photos.length - remaining.current.from) : 0

  return (
    <div className="myra-guide rounded-[18px] bg-[rgba(255,255,255,0.7)] border border-[rgba(43,43,43,0.12)] px-6 md:px-9 py-8 space-y-7">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h4 className="text-[20px] xl:text-[23px] tracking-[0.16em] text-[#6E6B65]">IMPORT FROM INSTAGRAM · STEP {step} OF 3</h4>
        <button onClick={onClose} className={`${T_SMALL} underline underline-offset-4 text-[#6E6B65]`}>Close</button>
      </div>

      {/* Where she is */}
      <div className="flex gap-2" aria-hidden>
        {[1, 2, 3].map((n) => <span key={n} className={`h-1.5 flex-1 rounded-full ${n <= step ? 'bg-[#2B2B2B]' : 'bg-[rgba(43,43,43,0.15)]'}`} />)}
      </div>

      {step === 1 && (
        <div className="space-y-6">
          <h3 className="text-[30px] xl:text-[36px] text-[#2B2B2B] leading-tight">Ask Instagram for your photos</h3>
          <p className={`${T} text-[#4A4E57] max-w-4xl`}>
            Instagram will gather your photos into one file and email you when it&rsquo;s ready. Asking takes about two minutes.
            Press the button and Instagram opens in a new tab &mdash; then tap these, in order:
          </p>
          <ol className={`${T} text-[#2B2B2B] space-y-3 max-w-4xl list-decimal pl-8`}>
            <li>Tap <b>Create export</b>.</li>
            <li>Choose your <b>Instagram</b> account.</li>
            <li>Tap <b>Export to device</b>.</li>
            <li>Tap <b>Customise information</b>, untick everything, and tick only <b>Posts</b>. <span className="text-[#6E6B65]">(This keeps the file small. If you can&rsquo;t find it, skip this &mdash; it still works.)</span></li>
            <li>Set <b>Date range</b> to <b>All time</b>.</li>
            <li>Tap <b>Start export</b>. Instagram may ask for your password &mdash; that&rsquo;s Instagram checking it&rsquo;s you.</li>
          </ol>
          <p className={`${T_SMALL} text-[#6E6B65] max-w-4xl`}>Then come back to this tab. MYRA will be on the next step, waiting for you.</p>
          <div className="flex flex-wrap gap-4">
            <button onClick={openInstagram} className={BTN}>Open Instagram →</button>
            <button onClick={() => setStep(2)} className={BTN_QUIET}>I&rsquo;ve already asked</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-6">
          <h3 className="text-[30px] xl:text-[36px] text-[#2B2B2B] leading-tight">
            {mail?.ready ? 'Your photos are ready' : 'Now Instagram gets your photos ready'}
          </h3>
          {mail?.ready ? (
            <>
              <p className={`${T} text-[#4A4E57] max-w-4xl`}>
                Instagram&rsquo;s email has arrived. Press the button, then tap <b>Download</b> on Instagram&rsquo;s page. The file saves to your computer, usually in your <b>Downloads</b> folder. Then come back here.
              </p>
              <div className="flex flex-wrap gap-4">
                {mail.link && <a href={mail.link} target="_blank" rel="noopener noreferrer" onClick={() => { awaitingReturn.current = false }} className={BTN}>Open my download →</a>}
                <button onClick={() => setStep(3)} className={mail.link ? BTN_QUIET : BTN}>I have the file</button>
              </div>
            </>
          ) : (
            <>
              <p className={`${T} text-[#4A4E57] max-w-4xl`}>
                Instagram emails you when the file is ready &mdash; often within the hour, sometimes by tomorrow. You can close this and carry on; MYRA remembers where you got to.
              </p>
              <p className={`${T} text-[#2B2B2B] max-w-4xl`}>
                {mail === null || checking
                  ? 'Checking your email…'
                  : mail.inbox
                    ? 'MYRA is watching your inbox and will tell you here the moment it arrives.'
                    : 'When the email from Instagram arrives, open it and tap the download button. The file saves to your Downloads folder.'}
              </p>
              <div className="flex flex-wrap gap-4">
                <button onClick={() => setStep(3)} className={BTN}>I have the file</button>
                <button onClick={() => setStep(1)} className={BTN_QUIET}>Back</button>
              </div>
            </>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="space-y-6">
          <h3 className="text-[30px] xl:text-[36px] text-[#2B2B2B] leading-tight">Give the file to MYRA</h3>
          {!work && (
            <>
              <p className={`${T} text-[#4A4E57] max-w-4xl`}>
                It&rsquo;s in your <b>Downloads</b> folder, with a name like <b>instagram-yourname&hellip;.zip</b>. Press the button and choose it &mdash; you don&rsquo;t need to open it first.
              </p>
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => { e.preventDefault(); setDragging(false); void takeFiles(e.dataTransfer.files) }}
                className={`rounded-[18px] border-2 border-dashed px-6 py-12 text-center transition-colors ${dragging ? 'border-[#2B2B2B] bg-white' : 'border-[#8C8A85]'}`}
              >
                <button onClick={() => fileRef.current?.click()} className={BTN}>Choose the file</button>
                <p className={`${T_SMALL} text-[#6E6B65] mt-4`}>or drag it onto this box</p>
                <input ref={fileRef} type="file" accept=".zip,application/zip" multiple hidden onChange={(e) => takeFiles(e.target.files)} />
              </div>
              <p className={`${T_SMALL} text-[#6E6B65] max-w-4xl`}>
                The file is opened here on your computer. Only your post photos go to MYRA &mdash; your messages and everything else in it stay with you.
              </p>
              <button onClick={() => setStep(2)} className={`${T_SMALL} underline underline-offset-4 text-[#6E6B65]`}>Back</button>
            </>
          )}

          {work && (
            <div className="space-y-5">
              <p className={`${T} text-[#2B2B2B]`}>
                {!finished
                  ? `Found ${work.found} photo${work.found === 1 ? '' : 's'}. Bringing in photo ${Math.min(work.done + 1, work.total)} of ${work.total}…`
                  : work.added
                    ? `Done — ${work.added} photo${work.added === 1 ? '' : 's'} brought in${work.already ? `, ${work.already} were already here` : ''}${work.failed ? `, ${work.failed} could not be read` : ''}. MYRA is looking at them now.`
                    : work.already && !work.failed
                      ? 'Those photos were already here — nothing new to bring in.'
                      : `The photos could not be brought in${work.why ? ` — ${work.why}` : ''}. Nothing was lost; try again in a moment.`}
              </p>
              <div className="h-3 rounded-full bg-[rgba(43,43,43,0.12)] overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={work.total} aria-valuenow={work.done}>
                <div className="h-full bg-[#2B2B2B] transition-[width] duration-300" style={{ width: `${work.total ? (work.done / work.total) * 100 : 0}%` }} />
              </div>
              {finished && (
                <div className="flex flex-wrap gap-4">
                  {left > 0 && <button onClick={() => void bringIn()} className={BTN_QUIET}>Bring in {Math.min(BATCH, left)} more</button>}
                  <button onClick={onClose} className={BTN}>See my photos</button>
                </div>
              )}
              {!finished && <p className={`${T_SMALL} text-[#6E6B65]`}>Keep this tab open until it finishes.</p>}
            </div>
          )}
        </div>
      )}

      {error && <p className={`${T} text-[#B83A3A]`}>{error}</p>}
    </div>
  )
}
