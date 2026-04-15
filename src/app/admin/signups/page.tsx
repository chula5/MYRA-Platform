import { createAdminClient } from '@/lib/supabase-server'

export default async function SignupsPage() {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('waitlist')
    .select('id, email, created_at')
    .order('created_at', { ascending: false })

  const signups = data ?? []

  return (
    <div>
      <div className="flex items-center justify-between mb-10">
        <div>
          <h1 className="text-[13px] tracking-[0.25em] text-[#0A0A0A] mb-1">EMAIL SIGN UPS</h1>
          <p className="text-[11px] tracking-[0.15em] text-[#6B6B6B]">{signups.length} {signups.length === 1 ? 'person' : 'people'} on the waitlist</p>
        </div>
      </div>

      {error && (
        <p className="text-[11px] tracking-[0.12em] text-red-500 mb-6">
          Error loading signups — make sure the waitlist table exists in Supabase.
        </p>
      )}

      {signups.length === 0 && !error ? (
        <p className="text-[11px] tracking-[0.15em] text-[#A8A8A4]">NO SIGN UPS YET.</p>
      ) : (
        <div className="border border-[#E2E0DB]">
          {/* Header */}
          <div className="grid grid-cols-[1fr_200px] gap-4 px-6 py-3 border-b border-[#E2E0DB] bg-[#F8F8F6]">
            <span className="text-[10px] tracking-[0.20em] text-[#6B6B6B]">EMAIL</span>
            <span className="text-[10px] tracking-[0.20em] text-[#6B6B6B]">SIGNED UP</span>
          </div>
          {signups.map((s, i) => (
            <div
              key={s.id}
              className={`grid grid-cols-[1fr_200px] gap-4 px-6 py-4 border-b border-[#E2E0DB] last:border-b-0 items-center ${i % 2 === 0 ? 'bg-white' : 'bg-[#FAFAF8]'}`}
            >
              <span className="text-[12px] tracking-[0.08em] text-[#0A0A0A]">{s.email}</span>
              <span className="text-[11px] tracking-[0.10em] text-[#6B6B6B]">
                {new Date(s.created_at).toLocaleDateString('en-GB', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
