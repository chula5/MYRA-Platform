// VAL-RENDER-008 (UI) — the composition-only Quality Lab exposes no render,
// reconcile, fidelity, Accepted Images, regeneration, or generated-image
// promotion controls, while composition review and canonical promotion remain
// present. Source-assertion style, mirroring a11y-surfaces.test.ts, because the
// Vitest environment is node-only (no DOM renderer).

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')
const TAB = 'src/app/admin/private-stylist/quality/OutfitQualityTab.tsx'
const WORKBENCH = 'src/app/admin/private-stylist/quality/ReviewWorkbench.tsx'

describe('Quality Lab tab exposes no rendering surface (VAL-RENDER-008)', () => {
  const tab = read(TAB)

  it('does not mount or import the Accepted Images gallery', () => {
    expect(tab).not.toContain('AcceptedImages')
    expect(tab).not.toContain("'accepted'")
    expect(tab.toUpperCase()).not.toContain('ACCEPTED IMAGES')
  })

  it('the Accepted Images component is removed from the tree', () => {
    expect(existsSync(resolve(process.cwd(), 'src/app/admin/private-stylist/quality/AcceptedImages.tsx'))).toBe(false)
  })

  it('keeps the composition-only views: review, batches, coverage', () => {
    expect(tab).toContain('ReviewWorkbench')
    expect(tab).toContain('BatchesView')
    expect(tab).toContain('CoverageView')
    expect(tab).toContain('REVIEW QUEUE')
    expect(tab).toContain('BATCHES')
    expect(tab).toContain('COVERAGE')
  })
})

describe('review workbench shows composition review but no render affordance (VAL-RENDER-008)', () => {
  const wb = read(WORKBENCH)

  it('does not announce or display any render state', () => {
    expect(wb).not.toContain('RENDER CYCLE QUEUED')
    expect(wb).not.toContain('render_status')
    expect(wb).not.toMatch(/RENDER:\s*\$\{/i)
  })

  it('keeps exact-version composition review (Yes/No, hold, undo, withdrawal)', () => {
    expect(wb).toContain('decideCandidateAction')
    expect(wb).toContain('holdCandidateAction')
    expect(wb).toContain('undoCandidateDecisionAction')
    expect(wb).toContain('withdrawCandidateApprovalAction')
  })

  it('does not reach for the gallery/render gated actions', () => {
    expect(wb).not.toContain('gallery-actions.gated')
    expect(wb).not.toContain('drainQualityRendersAction')
    expect(wb).not.toContain('regenerateRenderCycleAction')
  })
})
