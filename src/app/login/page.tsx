import { signIn } from './actions'

export default function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string }
}) {
  const error = searchParams.error

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-6">
      <div className="w-full max-w-[360px]">

        {/* Wordmark */}
        <div className="text-center mb-14">
          <p className="text-[22px] tracking-[0.135em] text-[#4A4E57]">MYRA</p>
          <p className="text-[10px] tracking-[0.113em] text-[#A8A8A4] mt-2">ADMIN STUDIO</p>
        </div>

        {/* Form */}
        <form action={signIn} className="space-y-5">
          <div>
            <label className="block text-[10px] tracking-[0.09em] text-[#6B6B6B] mb-2">
              EMAIL
            </label>
            <input
              type="email"
              name="email"
              required
              autoComplete="email"
              className="
                w-full border border-[#0A0A0A] bg-white
                px-4 py-3 text-[12px] tracking-[0.045em] text-[#4A4E57]
                focus:outline-none
              "
            />
          </div>

          <div>
            <label className="block text-[10px] tracking-[0.09em] text-[#6B6B6B] mb-2">
              PASSWORD
            </label>
            <input
              type="password"
              name="password"
              required
              autoComplete="current-password"
              className="
                w-full border border-[#0A0A0A] bg-white
                px-4 py-3 text-[12px] tracking-[0.045em] text-[#4A4E57]
                focus:outline-none
              "
            />
          </div>

          {/* Error */}
          {error && (
            <p className="text-[10px] tracking-[0.068em] text-red-600">
              {decodeURIComponent(error).toUpperCase()}
            </p>
          )}

          {/* Submit */}
          <button
            type="submit"
            className="
              w-full bg-[#0A0A0A] text-white
              text-[11px] tracking-[0.099em]
              py-3.5 mt-2
              hover:opacity-80 transition-opacity duration-300
            "
          >
            SIGN IN
          </button>
        </form>

        {/* Back to site */}
        <div className="text-center mt-10">
          <a
            href="/"
            className="text-[10px] tracking-[0.09em] text-[#A8A8A4] hover:text-[#4A4E57] transition-colors duration-300"
          >
            ← BACK TO SITE
          </a>
        </div>

      </div>
    </div>
  )
}
