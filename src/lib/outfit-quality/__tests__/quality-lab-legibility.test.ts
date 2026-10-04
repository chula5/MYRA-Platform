// VAL-REVIEW-007 — presentation regression guards for the Quality Lab.
//
// These source-level checks match the existing a11y/render-boundary tests.
// The Vitest environment is node-only, so rendered dimensions are verified
// separately in the authenticated browser.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

const PAGE = 'src/app/admin/private-stylist/page.tsx'
const WORKBENCH = 'src/app/admin/private-stylist/quality/ReviewWorkbench.tsx'
const BATCHES = 'src/app/admin/private-stylist/quality/OutfitQualityTab.tsx'
const COVERAGE = 'src/app/admin/private-stylist/quality/CoverageView.tsx'

describe('Quality Lab legibility and density (VAL-REVIEW-007)', () => {
  it('breaks out of the centred admin column with only a small viewport gutter', () => {
    const page = read(PAGE)

    expect(page).toContain('mx-[calc(50%-50vw)] w-screen px-4 sm:px-6')
  })

  it('adds review columns across the full responsive desktop grid', () => {
    const workbench = read(WORKBENCH)

    expect(workbench).toContain('data-quality-review-grid')
    expect(workbench).toContain('grid grid-cols-1 gap-6 lg:grid-cols-2 2xl:grid-cols-3')
  })

  it('gives source evidence an 11rem legibility floor without cropping', () => {
    const workbench = read(WORKBENCH)

    expect(workbench).toContain('data-quality-source-grid')
    expect(workbench).toContain("gridTemplateColumns: 'repeat(auto-fit, minmax(min(11rem, 100%), 1fr))'")
    expect(workbench).toContain('data-quality-source-image')
    expect(workbench).toContain('aspect-[4/5]')
    expect(workbench).toContain('object-contain')
  })

  it('keeps all Quality Lab text at 16px or larger', () => {
    for (const path of [WORKBENCH, BATCHES, COVERAGE]) {
      const source = read(path)
      const sizes = [...source.matchAll(/text-\[(\d+)px\]/g)].map((match) => Number(match[1]))

      expect(sizes.length, `${path} should declare readable text sizes`).toBeGreaterThan(0)
      expect(Math.min(...sizes), `${path} contains text below the 16px floor`).toBeGreaterThanOrEqual(16)
      expect(source, `${path} should not use low-contrast secondary text`).not.toContain('text-[#A8A8A4]')
      expect(source, `${path} should not use the old low-contrast gold text`).not.toContain('text-[#9A7B45]')
    }
  })
})
