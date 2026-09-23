'use client'

// Opens the application pop-out (ApplyModal listens for this event). Used
// wherever an APPLY NOW appears — the scatter hero, under the mirror, anywhere.
export function openApply() {
  window.dispatchEvent(new CustomEvent('myra:open-apply'))
}

// The big APPLY FOR ACCESS pill — shared by the hero and every repeat of it.
export const BIG_APPLY_CLASS =
  'pointer-events-auto inline-flex items-center justify-center gap-[0.6em] rounded-full bg-[#0A0A0A] text-white w-[clamp(280px,33vw,900px)] py-[clamp(18px,1.55vw,42px)] text-[clamp(16px,1.45vw,38px)] tracking-[0.18em] shadow-[0_18px_40px_-14px_rgba(0,0,0,0.45)] hover:scale-[1.02] transition-transform'

export default function ApplyButton({
  className,
  label = 'APPLY NOW',
}: {
  className?: string
  label?: string
}) {
  return (
    <button
      type="button"
      onClick={openApply}
      className={
        className ??
        'inline-flex items-center gap-3 rounded-full bg-[#0A0A0A] text-white px-11 py-5 text-[13px] tracking-[0.2em] hover:opacity-85 transition-opacity'
      }
    >
      {label} <span aria-hidden>→</span>
    </button>
  )
}
