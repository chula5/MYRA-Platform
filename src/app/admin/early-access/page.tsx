import { listEarlyAccessUsers } from './actions'
import EarlyAccessManager from './EarlyAccessManager'

export const dynamic = 'force-dynamic'

export default async function EarlyAccessAdminPage() {
  const { users, error } = await listEarlyAccessUsers()

  return (
    <div>
      <div className="mb-8">
        <p className="text-[11px] tracking-[0.25em] text-[#6B6B6B] mb-2">MYRA ADMIN STUDIO</p>
        <h1 className="text-[28px] tracking-[0.10em] text-[#0A0A0A]">EARLY ACCESS</h1>
        <p className="mt-3 max-w-[640px] text-[11px] tracking-[0.12em] text-[#6B6B6B] leading-relaxed">
          Create logins for people to preview The Edit at{' '}
          <span className="text-[#0A0A0A]">myraassistant.co.uk/earlyaccess</span>. They can search occasions and
          browse outfits only — they cannot reach the admin studio. Share the email + password with each person
          (the password is shown once on creation).
        </p>
      </div>

      {error && (
        <p className="mb-6 text-[10px] tracking-[0.15em] text-[#B83A3A]">{error.toUpperCase()}</p>
      )}

      <EarlyAccessManager initialUsers={users} />
    </div>
  )
}
