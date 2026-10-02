// Regression guard for the milestone-2 axe serious findings.
//
// axe-core reported two serious issues on the Private Stylist surfaces:
//   1. color-contrast — unselected tab labels in the Private Stylist tab bar
//      and the Outfit Quality views tablist used #A8A8A4 on white (~2.2:1),
//      below WCAG AA's 4.5:1 for 20px non-bold text. The app's secondary-text
//      token #6B6B6B measures ~5.3:1 and passes AA.
//   2. aria-prohibited-attr — the keyboard-hint <p> in the review workbench
//      carried an aria-label, which is prohibited on a paragraph with no role.
//      Its visible text is already self-descriptive, so the attribute goes.
//
// These tests pin the fixed markup so the findings cannot silently return
// (mirrors the source-assertion pattern in security-gating.test.ts).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')

/** WCAG contrast ratio between two #RRGGBB colors. */
function contrastRatio(fg: string, bg: string): number {
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    const lin = c.map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)))
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
  }
  const [l1, l2] = [lum(fg), lum(bg)].sort((a, b) => b - a)
  return (l1 + 0.05) / (l2 + 0.05)
}

describe('tab-bar color contrast (axe color-contrast)', () => {
  it('the unselected-tab token meets WCAG AA (4.5:1) on white', () => {
    expect(contrastRatio('#6B6B6B', '#FFFFFF')).toBeGreaterThanOrEqual(4.5)
    // The old token is the documented failure mode this guard exists against.
    expect(contrastRatio('#A8A8A4', '#FFFFFF')).toBeLessThan(4.5)
  })

  it('the Private Stylist tab bar uses the AA-passing token for unselected tabs', () => {
    const src = read('src/app/admin/private-stylist/PrivateStylistClient.tsx')
    const tabBar = src.slice(src.indexOf('{TABS.map((t) => ('), src.indexOf('{TABS.map((t) => (') + 600)
    expect(tabBar).toContain('text-[#6B6B6B]')
    expect(tabBar).not.toContain('text-[#A8A8A4]')
  })

  it('the Outfit Quality views tablist uses the AA-passing token for unselected tabs', () => {
    const src = read('src/app/admin/private-stylist/quality/OutfitQualityTab.tsx')
    const tablist = src.slice(src.indexOf('role="tablist"'), src.indexOf('role="tablist"') + 900)
    expect(tablist).toContain('text-[#6B6B6B]')
    expect(tablist).not.toContain('text-[#A8A8A4]')
  })
})

describe('keyboard-hint paragraph (axe aria-prohibited-attr)', () => {
  it('the hint paragraph carries no aria-label — its visible text is the label', () => {
    const src = read('src/app/admin/private-stylist/quality/ReviewWorkbench.tsx')
    const hint = src.slice(src.indexOf('KEYS:'), src.indexOf('KEYS:') + 400)
    const pOpen = src.slice(src.lastIndexOf('<p', src.indexOf('KEYS:')), src.indexOf('KEYS:'))
    expect(pOpen).not.toContain('aria-label')
    expect(hint).toContain('REVIEW_SHORTCUTS')
  })

  it('the case-history panel pairs its aria-label with a landmark role', () => {
    const src = read('src/app/admin/private-stylist/quality/ReviewWorkbench.tsx')
    const idx = src.indexOf('Case lineage and event history')
    const divOpen = src.slice(src.lastIndexOf('<div', idx), idx)
    expect(divOpen).toContain('role="region"')
  })
})
