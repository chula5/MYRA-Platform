// Her brands as she typed them on the landing page: one free-text field,
// comma / newline separated. Shared by the review page and ACCEPT.

import { resolveBrandNames, type BrandGraph } from '@/lib/brand-affinity'

export function splitBrandNames(raw: string | null | undefined): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of String(raw ?? '').split(/[,\n;]+/)) {
    const name = part.trim()
    const key = name.toLowerCase()
    if (!name || seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out
}

/**
 * Her list, in her order, each name either MYRA's own spelling of a brand it
 * knows (name or alias) or kept as her words. Nothing she wrote is dropped.
 */
export function sortBrandNames(graph: BrandGraph, names: string[]): { matched: string[]; unmatched: string[] } {
  const matched: string[] = []
  const unmatched: string[] = []
  for (const n of names) {
    const r = resolveBrandNames(graph, [n])
    const hit = r.matched[0]?.name
    if (hit) { if (!matched.includes(hit)) matched.push(hit) }
    else unmatched.push(n)
  }
  return { matched, unmatched }
}
