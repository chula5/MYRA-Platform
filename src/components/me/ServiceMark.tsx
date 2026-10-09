// A service's own mark, so a button can say "Instagram" or "Gmail" with its
// logo rather than a sentence. One place for the logos the member area uses.
const LOGOS = {
  gmail: 'https://cdn.simpleicons.org/gmail/EA4335',
  instagram: 'https://cdn.simpleicons.org/instagram/E4405F',
  calendar: 'https://cdn.simpleicons.org/googlecalendar/4285F4',
  email: 'https://cdn.simpleicons.org/maildotru/6E6B65',
} as const

export type ServiceName = keyof typeof LOGOS

export default function ServiceMark({ service, size = 'md' }: { service: ServiceName; size?: 'sm' | 'md' }) {
  const box = size === 'sm' ? 'h-7 w-7 p-1.5 rounded-lg' : 'h-11 w-11 p-2 rounded-xl'
  return (
    <span className={`grid shrink-0 place-items-center bg-white shadow-[0_2px_8px_rgba(43,43,43,0.12)] ${box}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={LOGOS[service]} alt="" className="h-full w-full object-contain" />
    </span>
  )
}
