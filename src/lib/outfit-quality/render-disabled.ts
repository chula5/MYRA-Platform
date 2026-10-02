// Composition-only release switch for the Outfit Quality Lab.
//
// The current release reviews outfit COMPOSITIONS only. All Quality-Lab-specific
// rendering (render, reconcile, fidelity, regeneration, Accepted Images, and
// generated-image promotion) is disabled. The render-family server actions
// import ONLY this module and return `qualityLabRenderingDisabled()` before any
// provider, storage, or database dependency is touched — so a direct call can
// never submit, poll, recover, or reconcile a provider job, nor write a row.
//
// This boundary is intentionally narrow: it governs the Quality Lab only. Shared
// Higgsfield infrastructure and every non-Quality-Lab admin render surface are
// untouched. The underlying Quality Lab render modules remain in the tree as
// superseded history; nothing browser-callable reaches them.

export const QUALITY_LAB_RENDERING_DISABLED_CODE = 'quality_lab_rendering_disabled'

export const QUALITY_LAB_RENDERING_DISABLED_MESSAGE =
  'Outfit Quality Lab rendering is disabled in this release. The Quality Lab reviews outfit compositions only; render, reconcile, fidelity, regeneration, Accepted Images, and generated-image promotion are unavailable.'

export interface RenderingDisabledResult {
  ok: false
  disabled: true
  code: typeof QUALITY_LAB_RENDERING_DISABLED_CODE
  message: string
}

/** The single fail-closed result every Quality Lab render-family action returns. */
export function qualityLabRenderingDisabled(): RenderingDisabledResult {
  return {
    ok: false,
    disabled: true,
    code: QUALITY_LAB_RENDERING_DISABLED_CODE,
    message: QUALITY_LAB_RENDERING_DISABLED_MESSAGE,
  }
}
