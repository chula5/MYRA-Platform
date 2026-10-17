'use server'

// A browser error in a member room, written to the server log so it can be
// read later. Public like every server action (lib/server-action-gating):
// it writes nothing but a log line, and each field is cut short first.

export async function reportClientError(e: {
  message: string; stack?: string; digest?: string | null; path?: string; agent?: string
}): Promise<void> {
  const cut = (v: unknown, n: number) => String(v ?? '').slice(0, n)
  console.error('[client-error]', JSON.stringify({
    message: cut(e?.message, 500), digest: cut(e?.digest, 80) || null, path: cut(e?.path, 300),
    agent: cut(e?.agent, 200), stack: cut(e?.stack, 2000), at: new Date().toISOString(),
  }))
}
