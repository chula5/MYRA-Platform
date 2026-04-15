export default function StatusBadge({ status }: { status: string }) {
  const colours: Record<string, string> = {
    draft: 'bg-[#F2F2F0] text-[#6B6B6B]',
    ready: 'bg-[#E8F0E8] text-[#3A6B3A]',
    in_review: 'bg-[#FFF3E0] text-[#8B5E00]',
    live: 'bg-[#0A0A0A] text-white',
    archived: 'bg-[#E2E0DB] text-[#A8A8A4]',
  }
  return (
    <span
      className={`inline-block text-[9px] tracking-[0.20em] px-2.5 py-1 rounded-[2px] ${colours[status] ?? colours.draft}`}
    >
      {status.toUpperCase().replace('_', ' ')}
    </span>
  )
}
