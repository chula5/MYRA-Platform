'use client'

// Opens the application pop-out (ApplyModal listens for this event). Used
// wherever an APPLY NOW appears — the scatter hero, under the mirror, anywhere.
export function openApply() {
  window.dispatchEvent(new CustomEvent('myra:open-apply'))
}

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
