// Keyboard map for the review workbench. One documented key per action; the
// mapping is pure so the keyboard path and the pointer path run the identical
// validation and mutation code. Shortcuts never fire from editable controls —
// typing a note or picking a reason must not be able to submit a verdict.

export type ReviewShortcutAction = 'yes' | 'no' | 'hold' | 'history' | 'next' | 'prev'

export interface ReviewShortcut {
  key: string
  action: ReviewShortcutAction
  description: string
}

export const REVIEW_SHORTCUTS: readonly ReviewShortcut[] = [
  { key: 'Y', action: 'yes', description: 'Approve the exact shown version (Yes)' },
  { key: 'N', action: 'no', description: 'Begin a structured No — choose a reason' },
  { key: 'H', action: 'hold', description: 'Hold the candidate out of the active queue' },
  { key: 'V', action: 'history', description: 'Open the version and event history' },
  { key: 'J', action: 'next', description: 'Move to the next candidate in the queue' },
  { key: 'K', action: 'prev', description: 'Move to the previous candidate in the queue' },
] as const

const KEY_TO_ACTION = new Map(REVIEW_SHORTCUTS.map((s) => [s.key.toLowerCase(), s.action]))

/** True when a keydown target is a text-entry or choice control. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false
  const el = target as HTMLElement
  const tag = typeof el.tagName === 'string' ? el.tagName.toLowerCase() : ''
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  if (el.isContentEditable) return true
  if (typeof el.closest === 'function' && el.closest('[contenteditable="true"]')) return true
  return false
}

/**
 * Resolve a keydown to a review action, or null when the press must do
 * nothing: unmapped keys, modifier chords (so browser/OS shortcuts survive),
 * and anything originating in an editable control.
 */
export function reviewShortcutForKey(
  key: string,
  target: EventTarget | null,
  modifiers: { metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean } = {},
): ReviewShortcutAction | null {
  if (modifiers.metaKey || modifiers.ctrlKey || modifiers.altKey) return null
  if (isEditableTarget(target)) return null
  return KEY_TO_ACTION.get(key.toLowerCase()) ?? null
}
