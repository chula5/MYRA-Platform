// STAGE 3 — AUTONOMOUS COMPOSITION (Vercel cron, daily; see vercel.json).
// For each live stylist at Stage 3: identify catalogue gaps from the balance
// dashboard (occasions / colours / formality where supply is thin vs visitor
// demand), select hero items suited to those gaps, compose full styling sets
// and auto-publish them through the same render + fidelity pipeline. The
// fidelity check is never bypassed.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { listStylists, loadAutonomy } from '@/lib/stylist-store'
import { loadCatalogueBalance, loadSiteTasteProfile } from '@/lib/style-brain-store'
import { composeStylingSet } from '@/app/admin/pipeline/set-actions'
import { autoPublishStaged } from '@/app/admin/pipeline/actions'
import { loadPipelineQueue } from '@/lib/pipeline-store'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const SETS_PER_RUN = 2

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const admin = createAdminClient()
    const stylists = await listStylists('live')
    const results: Record<string, unknown>[] = []

    for (const s of stylists) {
      const autonomy = await loadAutonomy(s.stylist_id)
      if (autonomy.stage < 3) continue

      // ── Gap analysis: thin colours + formality bands, demand-led axes ──
      const [balance, taste] = await Promise.all([loadCatalogueBalance(), loadSiteTasteProfile()])
      const thinColours = new Set(
        (balance?.colours ?? []).filter(([, n]) => n <= 3).map(([c]) => c),
      )
      const formalityCounts = balance?.formality ?? []
      const thinFormality = formalityCounts
        .map((f, i) => ({ band: i + 1, count: f.count }))
        .filter((f) => f.count <= Math.max(2, (balance?.totalOutfits ?? 0) * 0.08))
        .map((f) => f.band)
      const demandAxes = (taste?.hasPeople ? taste.axes : [])
        .filter((a) => a.people - a.catalogue > 0.05)
        .map((a) => a.label)

      // ── Hero selection: ready/live garments matching a gap, not already in a set ──
      const { data: existingSets } = await admin
        .from('styling_set' as any)
        .select('hero_item_id')
        .eq('stylist_id', s.stylist_id)
      const usedHeroes = new Set(((existingSets ?? []) as any[]).map((r) => r.hero_item_id))
      const HERO_TYPES = ['mini_dress', 'midi_dress', 'maxi_dress', 'shirt_dress', 'slip_dress', 'shirt', 'blouse', 'knitwear', 'trousers', 'jeans', 'skirt']
      const { data: items } = await admin
        .from('item' as any)
        .select('item_id, item_type, colour_family, material_formality')
        .in('status', ['ready', 'live'])
        .in('item_type', HERO_TYPES)
        .limit(500)
      const heroes = ((items ?? []) as any[])
        .filter((it) => !usedHeroes.has(it.item_id))
        .map((it) => ({
          ...it,
          gapScore:
            (thinColours.has(it.colour_family) ? 2 : 0) +
            (thinFormality.includes(it.material_formality ?? 3) ? 1 : 0),
        }))
        .sort((a, b) => b.gapScore - a.gapScore)
        .slice(0, SETS_PER_RUN)

      let published = 0
      let staged = 0
      for (const hero of heroes) {
        const setRes = await composeStylingSet(hero.item_id, { stylistId: s.stylist_id })
        if (!setRes.staged) continue
        staged += setRes.staged
        const rows = (await loadPipelineQueue()).filter((p) => p.styling_set_id === setRes.stylingSetId)
        for (const row of rows) {
          // Stage 3 publishes every gate-passing variant; fidelity failures fall
          // back to the review queue automatically.
          const ok = await autoPublishStaged(row, 3)
          if (ok) published++
        }
      }
      results.push({ stylist: s.slug, staged, published, gaps: { thinColours: [...thinColours], thinFormality, demandAxes } })
    }
    return NextResponse.json({ ok: true, results })
  } catch (err) {
    console.error('[autonomous-compose]', err)
    return NextResponse.json({ error: 'Autonomous compose failed' }, { status: 500 })
  }
}
