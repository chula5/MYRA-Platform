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
  // Sits under the mirror mark at the head of the card.
  heading?: React.ReactNode
  className?: string
}) {
  return (
    // Borderless and transparent — the page's grey photoshoot texture shows
    // straight through, so the search area reads as part of the set wall.
    <div className={`relative ${className}`}>
      <div className="px-3 md:px-10 pb-4 md:pb-10">
        {/* The mirror mark, centred at the head. */}
        <div className="pt-8 md:pt-12">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/myra-mirror-transparent.png" alt="" className="h-32 md:h-56 w-auto mx-auto" />
        </div>
        {heading && <div className="pt-5 md:pt-8 pb-6 md:pb-9">{heading}</div>}
        {children}
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
      {/* Narrow on mobile: at the compact size the caption needs far less room,
          and every pixel saved here goes to the query itself — which is the
          part that has to stay readable while you type. */}
      <div className="shrink-0 w-[124px] md:w-[230px] border-r border-[#2B2B2B] flex items-center md:items-end px-3 md:px-5 py-3 md:pb-3 md:pt-5">
        <span className="myra-field leading-tight whitespace-nowrap md:whitespace-normal">{label}</span>
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
