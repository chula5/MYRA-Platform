import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerClient, createAdminClient } from '@/lib/supabase-server'
import { getClientStyleProfile } from '@/lib/taste-profile'
import { OCCASION_OPTIONS, PRICE_BANDS, HEEL_OPTIONS, LENGTH_NO_GO_OPTIONS } from '@/lib/style-profile'
import { resolveClientMember } from '@/lib/client-member'
import YouSettings from '../YouSettings'
import { buildYouSettings } from '@/lib/you-settings'
import InspirationBoard from '../inspiration/InspirationBoard'
import { loadMyInspiration } from '../inspiration/board-actions'
import ThreadsClient from '../threads/ThreadsClient'

export const dynamic = 'force-dynamic'

// Her profile — moved from /me when /me became FOR YOU, her newest looks.

const OCCASION_LABEL = new Map(OCCASION_OPTIONS.map((o) => [o.value, o.label]))
const HEEL_LABEL = new Map(HEEL_OPTIONS.map((o) => [o.value, o.label]))
const NO_GO_LABEL = new Map(LENGTH_NO_GO_OPTIONS.map((o) => [o.value, o.label]))

export default async function ProfilePage({ searchParams }: { searchParams?: { tab?: string } }) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/signin')

  // A private-stylist client gets her settings room; everyone else the profile below.
  const me = await resolveClientMember()
  if (me) {
    const tab = searchParams?.tab === 'inspiration' || searchParams?.tab === 'threads' ? searchParams.tab : 'settings'
    return (
      <div className="-mx-6 sm:-mx-10 -my-10">
        <nav aria-label="You sections" className="sticky top-0 z-20 myra-pearl border-b border-[rgba(43,43,43,0.14)] px-6 sm:px-10 pt-4">
          <div className="flex gap-6 sm:gap-10 overflow-x-auto">
            {[
              ['settings', 'Settings'],
              ['inspiration', 'Inspiration'],
              ['threads', 'Threads'],
            ].map(([id, label]) => (
              <Link
                key={id}
                href={id === 'settings' ? '/me/profile' : `/me/profile?tab=${id}`}
                aria-current={tab === id ? 'page' : undefined}
                className={`shrink-0 border-b-2 px-1 pb-3 text-[15px] sm:text-[18px] tracking-[0.1em] transition-colors ${tab === id ? 'border-[#2B2B2B] text-[#2B2B2B]' : 'border-transparent text-[#8C8A85] hover:text-[#2B2B2B]'}`}
              >
                {label}
              </Link>
            ))}
          </div>
        </nav>
        {tab === 'settings' && <YouSettings initial={await buildYouSettings(me.memberId, false, me.name)} />}
        {tab === 'inspiration' && <InspirationBoard view={await loadMyInspiration()} />}
        {tab === 'threads' && <ThreadsClient />}
      </div>
    )
  }

  const admin = createAdminClient() as any
  const [{ data: clientRow }, { data: assignment }, profile] = await Promise.all([
    admin.from('client_profile').select('name, persona_id').eq('user_id', user.id).maybeSingle(),
    admin.from('user_persona').select('persona_id, weight').eq('user_id', user.id).maybeSingle(),
    getClientStyleProfile(user.id),
  ])

  const personaId = assignment?.persona_id ?? clientRow?.persona_id ?? null
  const { data: persona } = personaId
    ? await admin.from('stylist').select('name, voice_notes').eq('stylist_id', personaId).maybeSingle()
    : { data: null }

  const { data: images } = await admin
    .from('inspiration_image')
    .select('image_id, image_url, scores')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(12)

  const name = clientRow?.name ?? (user.user_metadata as any)?.name ?? ''
  const mix = profile?.occasion_mix ?? null
  const spend = profile?.price_comfort?.length === 2
    ? [PRICE_BANDS.find((b) => b.tier === profile.price_comfort![0])?.label,
       PRICE_BANDS.find((b) => b.tier === profile.price_comfort![1])?.label].filter(Boolean).join(' → ')
    : null

  return (
    <div className="space-y-10">
      <div>
        <p className="text-[10px] tracking-[0.16em] text-[#A8A8A4] mb-2">YOUR PROFILE</p>
        <h1 className="text-[clamp(24px,5vw,34px)] tracking-[0.04em] text-[#4A4E57] leading-tight">
          {name ? name.toUpperCase() : 'WELCOME'}
        </h1>
      </div>

      {/* Assigned stylist */}
      <section>
        <p className="text-[10px] tracking-[0.16em] text-[#A8A8A4] mb-2">YOUR STYLIST</p>
        {persona ? (
          <div className="border border-[#E2E0DB] rounded-[12px] px-5 py-4">
            <p className="text-[16px] tracking-[0.06em] text-[#0A0A0A]">{String(persona.name).toUpperCase()}</p>
            {persona.voice_notes && (
              <p className="text-[12px] tracking-[0.03em] text-[#6B6B6B] leading-relaxed mt-2">{persona.voice_notes}</p>
            )}
            <p className="text-[10px] tracking-[0.08em] text-[#A8A8A4] mt-3 leading-relaxed">
              A starting point, not a box. The more you use MYRA, the more this becomes yours.
            </p>
          </div>
        ) : (
          <p className="text-[12px] tracking-[0.03em] text-[#6B6B6B]">No stylist assigned yet.</p>
        )}
      </section>

      {/* Occasion mix */}
      <section>
        <p className="text-[10px] tracking-[0.16em] text-[#A8A8A4] mb-2">WHERE YOUR CLOTHES GO</p>
        {mix && Object.keys(mix).length ? (
          <div className="space-y-2">
            {Object.entries(mix).map(([k, f]) => (
              <div key={k} className="flex items-center justify-between border border-[#E2E0DB] rounded-[12px] px-4 py-3">
                <span className="text-[13px] tracking-[0.04em] text-[#4A4E57]">{OCCASION_LABEL.get(k as any) ?? k}</span>
                <span className="text-[10px] tracking-[0.12em] text-[#A8A8A4]">{String(f).toUpperCase()}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[12px] tracking-[0.03em] text-[#6B6B6B]">Not set yet.</p>
        )}
        {(profile?.colour_never?.length || profile?.length_no_go?.length || profile?.heel_preference || spend) && (
          <div className="mt-3 border-l-2 border-[#E2E0DB] pl-3 space-y-1">
            <p className="text-[9px] tracking-[0.14em] text-[#A8A8A4]">WHAT WE KEEP OUT</p>
            {profile?.colour_never?.length ? (
              <p className="text-[11px] tracking-[0.03em] text-[#6B6B6B]">Never: {profile.colour_never.join(', ')}</p>
            ) : null}
            {profile?.length_no_go?.length ? (
              <p className="text-[11px] tracking-[0.03em] text-[#6B6B6B]">
                {profile.length_no_go.map((v) => (NO_GO_LABEL.get(v) ?? v).toLowerCase()).join(', ')}
              </p>
            ) : null}
            {profile?.heel_preference && profile.heel_preference !== 'any' ? (
              <p className="text-[11px] tracking-[0.03em] text-[#6B6B6B]">
                Heels: {(HEEL_LABEL.get(profile.heel_preference) ?? '').toLowerCase()}
              </p>
            ) : null}
            {spend && <p className="text-[11px] tracking-[0.03em] text-[#6B6B6B]">Spend: {spend}</p>}
          </div>
        )}
      </section>

      {/* Inspiration collection */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] tracking-[0.16em] text-[#A8A8A4]">YOUR INSPIRATION</p>
          <Link href="/me/inspiration" className="text-[10px] tracking-[0.12em] text-[#0A0A0A] underline">
            ADD MORE →
          </Link>
        </div>
        {images?.length ? (
          <div className="grid grid-cols-3 gap-2">
            {images.map((i: any) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i.image_id} src={i.image_url} alt="" className="w-full aspect-[3/4] object-cover bg-[#F8F8F6] rounded-[8px]" />
            ))}
          </div>
        ) : (
          <Link
            href="/me/inspiration"
            className="block border border-dashed border-[#D8D5CE] rounded-[12px] px-5 py-8 text-center"
          >
            <p className="text-[13px] tracking-[0.04em] text-[#4A4E57]">Add the first outfit you love</p>
            <p className="text-[11px] tracking-[0.03em] text-[#A8A8A4] mt-1">
              A screenshot, a photo, anything you&rsquo;d wear
            </p>
          </Link>
        )}
      </section>
    </div>
  )
}
