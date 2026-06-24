import { listEarlyAccessUsers } from './actions'
import EarlyAccessManager from './EarlyAccessManager'
import { EARLY_ACCESS_INVITE_CODE } from '@/app/earlyaccess/invite'

export const dynamic = 'force-dynamic'

export default async function EarlyAccessAdminPage() {
  const { users, error } = await listEarlyAccessUsers()

  return (
    <div>
      <div className="mb-8">
        <p className="text-[11px] tracking-[0.25em] text-[#6B6B6B] mb-2">MYRA ADMIN STUDIO</p>
        <h1 className="text-[28px] tracking-[0.10em] text-[#4A4E57]">EARLY ACCESS</h1>
        <p className="mt-3 max-w-[640px] text-[11px] tracking-[0.12em] text-[#6B6B6B] leading-relaxed">
          Share the sign-up link below so people can create their own login, or create one manually. Either way
          they can only search occasions and browse The Edit — they cannot reach the admin studio. Below you can
          see how many times each person has signed in and visited.
        </p>
      </div>

      {error && (
        <p className="mb-6 text-[10px] tracking-[0.15em] text-[#B83A3A]">{error.toUpperCase()}</p>
      )}

      <EarlyAccessManager initialUsers={users} inviteCode={EARLY_ACCESS_INVITE_CODE} />
    </div>
  )
}
