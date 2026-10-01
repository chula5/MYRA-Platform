// Keyboard review controls: one documented key per action, suppressed from
// editable controls so typing a note can never fire a verdict. The mapping is
// pure so pointer and keyboard paths are provably identical.

import { describe, it, expect } from 'vitest'
import {
  REVIEW_SHORTCUTS,
  isEditableTarget,
  reviewShortcutForKey,
  type ReviewShortcutAction,
} from '@/lib/outfit-quality/review-keyboard'

describe('REVIEW_SHORTCUTS documentation', () => {
  it('documents yes, no, hold, history, and queue navigation', () => {
    const actions = REVIEW_SHORTCUTS.map((s) => s.action)
    for (const a of ['yes', 'no', 'hold', 'history', 'next', 'prev'] satisfies ReviewShortcutAction[]) {
      expect(actions).toContain(a)
    }
    for (const s of REVIEW_SHORTCUTS) {
      expect(s.key).toBeTruthy()
      expect(s.description.length).toBeGreaterThan(5)
    }
  })
})

describe('isEditableTarget', () => {
  const el = (tag: string, attrs: Record<string, string | boolean> = {}) =>
    ({ tagName: tag.toUpperCase(), isContentEditable: false, closest: () => null, getAttribute: (k: string) => (attrs[k] === undefined ? null : String(attrs[k])), ...attrs }) as unknown as HTMLElement

  it('treats inputs, textareas and selects as editable', () => {
    expect(isEditableTarget(el('input'))).toBe(true)
    expect(isEditableTarget(el('textarea'))).toBe(true)
    expect(isEditableTarget(el('select'))).toBe(true)
  })

  it('treats contenteditable as editable', () => {
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: true, closest: () => null } as unknown as HTMLElement)).toBe(true)
  })

  it('treats anything inside a contenteditable region as editable', () => {
    const span = { tagName: 'SPAN', isContentEditable: false, closest: (sel: string) => (sel === '[contenteditable="true"]' ? {} : null) } as unknown as HTMLElement
    expect(isEditableTarget(span)).toBe(true)
  })

  it('treats buttons and the page body as non-editable', () => {
    expect(isEditableTarget(el('button'))).toBe(false)
    expect(isEditableTarget(el('body'))).toBe(false)
  })

  it('treats a null target as non-editable', () => {
    expect(isEditableTarget(null)).toBe(false)
  })
})

describe('reviewShortcutForKey', () => {
  const body = { tagName: 'BODY', isContentEditable: false, closest: () => null } as unknown as HTMLElement
  const input = { tagName: 'INPUT', isContentEditable: false, closest: () => null } as unknown as HTMLElement

  it('maps the documented keys to actions', () => {
    expect(reviewShortcutForKey('y', body)).toBe('yes')
    expect(reviewShortcutForKey('n', body)).toBe('no')
    expect(reviewShortcutForKey('h', body)).toBe('hold')
    expect(reviewShortcutForKey('v', body)).toBe('history')
    expect(reviewShortcutForKey('j', body)).toBe('next')
    expect(reviewShortcutForKey('k', body)).toBe('prev')
  })

  it('is case-insensitive for letter keys', () => {
    expect(reviewShortcutForKey('Y', body)).toBe('yes')
    expect(reviewShortcutForKey('K', body)).toBe('prev')
  })

  it('does nothing from editable controls', () => {
    expect(reviewShortcutForKey('y', input)).toBeNull()
    expect(reviewShortcutForKey('n', input)).toBeNull()
  })

  it('ignores unmapped keys and modifier chords', () => {
    expect(reviewShortcutForKey('x', body)).toBeNull()
    expect(reviewShortcutForKey('y', body, { metaKey: true })).toBeNull()
    expect(reviewShortcutForKey('y', body, { ctrlKey: true })).toBeNull()
    expect(reviewShortcutForKey('y', body, { altKey: true })).toBeNull()
  })
})
