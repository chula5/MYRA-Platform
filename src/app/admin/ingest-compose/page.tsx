import IngestComposeClient from './IngestComposeClient'

export const dynamic = 'force-dynamic'

export default function IngestComposePage() {
  return (
    <div>
      <div className="mb-8">
        <p className="text-[10px] tracking-[0.113em] text-[#6B6B6B] mb-1">ADMIN</p>
        <h1 className="text-[22px] tracking-[0.045em] text-[#4A4E57]">ADD &amp; COMPOSE</h1>
        <p className="text-[11px] tracking-[0.059em] text-[#A8A8A4] mt-1 max-w-[660px] leading-relaxed">
          Paste product URLs. Each one is scraped, AI-scored, and saved to your library — then MYRA immediately
          composes brand-coherent outfit options anchored on the new piece (same engine as the Composer). Approve
          the looks you like straight into draft projects.
        </p>
      </div>
      <IngestComposeClient />
    </div>
  )
}
