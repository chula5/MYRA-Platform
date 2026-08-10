'use client'

// ARCHIVE CARD — the search area as an archivist's index card: a ruled form
// with a hairline border, a punch hole at the head, and a labelled cell for
// each thing you can narrow by. Choosing a filter writes its value into the
// cell beside the label, so the card fills itself in as you go and the whole
// query is readable at a glance.

export function ArchiveCard({
  children,
  heading,
  className = '',
}: {
  children: React.ReactNode
  // Sits inside the card, under the archive's own header rule.
  heading?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={`relative bg-[#FCFCFA] border border-[#2B2B2B] shadow-[0_10px_34px_rgba(0,0,0,0.13)] ${className}`}
    >
      {/* Head: the archive's own label either side of the punch hole. */}
      <div className="flex items-center justify-between px-5 md:px-8 pt-5 md:pt-7 pb-4">
        <p className="text-[20px] md:text-[30px] tracking-[0.02em] text-[#4A4E57]">
          <span className="align-super text-[11px] md:text-[15px] tracking-[0.14em] mr-1">THE</span>
          <span className="font-bold">archive</span>
        </p>
        <span className="w-[18px] h-[18px] md:w-[24px] md:h-[24px] rounded-full border border-[#2B2B2B]" aria-hidden />
        <p className="myra-field">INVENTORY N°</p>
      </div>

      <div className="px-5 md:px-10 pb-6 md:pb-10">
        {heading && <div className="pb-6 md:pb-9">{heading}</div>}
        <div className="border border-[#2B2B2B]">{children}</div>
      </div>
    </div>
  )
}

/**
 * One ruled row of the card. `label` is the printed caption on the left;
 * everything else is the filled-in value.
 */
export function ArchiveRow({
  label,
  children,
  className = '',
  last = false,
}: {
  label: string
  children: React.ReactNode
  className?: string
  last?: boolean
}) {
  return (
    <div className={`flex items-stretch ${last ? '' : 'border-b border-[#2B2B2B]'} ${className}`}>
      <div className="shrink-0 w-[130px] md:w-[230px] border-r border-[#2B2B2B] flex items-end px-3 md:px-5 pb-3 pt-5">
        <span className="myra-field">{label}</span>
      </div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}

/**
 * A cell whose value is chosen from a panel. Shows the chosen value, or a
 * muted prompt when still blank — the equivalent of an unfilled line.
 */
export function ArchiveCell({
  value,
  onClick,
  open,
}: {
  value: string | null
  onClick: () => void
  open: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full h-full text-left px-4 md:px-7 py-5 md:py-7 flex items-center justify-between gap-3 hover:bg-[#F4F3F0] transition-colors"
    >
      <span
        className={`myra-field truncate ${value ? '' : 'opacity-45'}`}
      >
        {value ?? '—'}
      </span>
      <span className="myra-field shrink-0">{open ? '▲' : '▾'}</span>
    </button>
  )
}
