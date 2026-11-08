// Time each block the /admin dashboard awaits, alone and together.
//   node_modules/.bin/jiti scripts/bench-admin-dashboard.ts
import fs from 'node:fs'
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
async function main() {
  const { getAdminStats } = await import('../src/lib/admin-queries')
  const { getDashboardMetrics } = await import('../src/lib/dashboard-metrics')
  const { getNetworkStatuses } = await import('../src/lib/networks/sync')
  const { createAdminClient } = await import('../src/lib/supabase-server')
  const admin = createAdminClient()
  const t = async (label: string, fn: () => PromiseLike<any>) => { const s = Date.now(); try { await fn() } catch (e) { console.log(label, 'ERR', (e as any)?.message) } console.log(label.padEnd(28), ((Date.now() - s) / 1000).toFixed(2) + 's') }
  await t('warm (1 row)', () => admin.from('brand').select('brand_id').limit(1).then())
  await t('getAdminStats', getAdminStats)
  await t('getDashboardMetrics', getDashboardMetrics)
  await t('getNetworkStatuses', getNetworkStatuses)
  await t('count item exact', () => admin.from('item').select('*', { count: 'exact', head: true }).then())
  await t('count item status=live', () => admin.from('item').select('*', { count: 'exact', head: true }).eq('status', 'live').then())
  await t('listUsers p1', () => admin.auth.admin.listUsers({ page: 1, perPage: 200 }).then())
  await t('ALL together', () => Promise.all([getAdminStats(), getDashboardMetrics(), getNetworkStatuses()]))
}
main()
