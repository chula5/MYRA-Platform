import Link from 'next/link'
import Navigation from '@/components/navigation/Navigation'
import WaitlistModal from '@/components/WaitlistModal'

export default function LaunchingSoon() {
  return (
    <>
      <Navigation />
      <main className="min-h-screen bg-white flex flex-col items-center justify-center px-10">
        <p className="text-[11px] tracking-[0.35em] text-[#A8A8A4] mb-6">MYRA.ASSISTANT</p>
        <h1 className="text-[clamp(28px,4vw,52px)] tracking-[0.12em] text-[#0A0A0A] mb-5 text-center">
          LAUNCHING SOON
        </h1>
        <p className="text-[12px] tracking-[0.15em] text-[#6B6B6B] mb-12 text-center max-w-[360px] leading-relaxed">
          We're putting the finishing touches on something worth waiting for.
        </p>
        <div className="flex flex-col items-center gap-4">
          <WaitlistModal triggerClassName="inline-flex items-center bg-[#0A0A0A] border border-[#0A0A0A] text-white text-[11px] tracking-[0.20em] px-10 py-3 hover:bg-[#333] transition-colors duration-300" />
          <Link
            href="/"
            className="text-[10px] tracking-[0.25em] text-[#6B6B6B] hover:text-[#0A0A0A] border border-[#E2E0DB] hover:border-[#0A0A0A] px-8 py-3 transition-colors duration-300"
          >
            ← BACK TO LOOKBOOK
          </Link>
        </div>
      </main>
    </>
  )
}
