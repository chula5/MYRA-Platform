import Link from 'next/link'
import { isConnected } from '@/lib/canva'

interface PageProps {
  searchParams: Promise<{ connected?: string; error?: string }>
}

export default async function CanvaConnectPage({ searchParams }: PageProps) {
  const { connected, error } = await searchParams
  const connectedNow = await isConnected()

  return (
    <div className="max-w-[720px] mx-auto px-10 py-16">
      <Link
        href="/admin"
        className="text-[10px] tracking-[0.20em] text-[#6B6B6B] hover:text-[#0A0A0A] mb-6 inline-block"
      >
        ← ADMIN
      </Link>

      <p className="text-[11px] tracking-[0.25em] text-[#6B6B6B] mb-2">INTEGRATION</p>
      <h1 className="text-[28px] tracking-[0.10em] text-[#0A0A0A] mb-8">CANVA</h1>

      {error && (
        <div className="mb-6 border border-red-300 bg-red-50 p-4">
          <p className="text-[10px] tracking-[0.15em] text-red-700">
            CONNECTION ERROR: {error}
          </p>
        </div>
      )}

      {connected === '1' && (
        <div className="mb-6 border border-green-300 bg-green-50 p-4">
          <p className="text-[10px] tracking-[0.15em] text-green-700">
            ✓ CONNECTED SUCCESSFULLY
          </p>
        </div>
      )}

      <div className="border border-[#E2E0DB] bg-white p-6">
        <div className="flex items-center justify-between mb-4">
          <p className="text-[12px] tracking-[0.15em] text-[#0A0A0A]">
            STATUS
          </p>
          <p
            className={`text-[10px] tracking-[0.20em] ${
              connectedNow ? 'text-green-700' : 'text-[#A8A8A4]'
            }`}
          >
            {connectedNow ? '● CONNECTED' : '○ NOT CONNECTED'}
          </p>
        </div>

        <p className="text-[11px] leading-relaxed text-[#6B6B6B] mb-6">
          Connects MYRA to your Canva account so the outfit builder can
          auto-generate decks from your Brand Template in one click.
        </p>

        <a
          href="/api/canva/connect"
          className="inline-block bg-[#0A0A0A] text-white px-6 py-3 text-[10px] tracking-[0.20em] hover:bg-[#333] transition-colors duration-300"
        >
          {connectedNow ? 'RECONNECT →' : 'CONNECT TO CANVA →'}
        </a>
      </div>
    </div>
  )
}
