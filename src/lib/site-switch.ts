import 'server-only'

// SITE SWITCHES (migration 0127) — on/off settings Chloe flips from the admin.
// A missing table or row reads as OFF, so nothing turns on by accident.

export type SiteSwitchKey = 'auto_accept_applications'

export async function readSwitch(admin: any, key: SiteSwitchKey): Promise<boolean> {
  try {
    const { data, error } = await admin.from('site_switch').select('is_on').eq('key', key).maybeSingle()
    if (error) return false
    return !!data?.is_on
  } catch {
    return false
  }
}

export async function writeSwitch(admin: any, key: SiteSwitchKey, on: boolean, by?: string | null): Promise<{ error?: string }> {
  const { error } = await admin.from('site_switch')
    .upsert({ key, is_on: on, updated_at: new Date().toISOString(), updated_by: by ?? null }, { onConflict: 'key' })
  if (error && /does not exist|schema cache|not find/i.test(error.message)) return { error: 'RUN MIGRATION 0127_site_switch.sql FIRST (npm run migrate)' }
  return error ? { error: error.message } : {}
}
