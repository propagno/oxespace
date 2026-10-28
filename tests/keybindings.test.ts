import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { chordsCollide, formatChord, matchesChord, matchesHotkey, parseChord } from '../src/keyboard/chords'
import {
  KEYBINDINGS, bindingsCollide, dispatchKeybinding, isTerminalReservedChord, setKeybindingOverrides, setKeyboardView, shortcutLabel, useKeybindings,
  type Keybinding
} from '../src/keyboard/keybindings'

const key = (init: KeyboardEventInit & { key: string }): KeyboardEvent => new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })

describe('chords', () => {
  it('parse modifiers and keys, including the plus key', () => {
    expect(parseChord('Mod+Shift+D')).toMatchObject({ mod: true, shift: true, key: 'd' })
    expect(parseChord('Ctrl++')).toMatchObject({ ctrl: true, key: '+' })
    expect(parseChord('Ctrl+Shift+Space')).toMatchObject({ ctrl: true, shift: true, key: 'space' })
  })

  it('match Mod as Ctrl or Cmd, with exact Shift and Alt', () => {
    expect(matchesChord(key({ key: 'k', ctrlKey: true }), 'Mod+K')).toBe(true)
    expect(matchesChord(key({ key: 'k', metaKey: true }), 'Mod+K')).toBe(true)
    expect(matchesChord(key({ key: 'K', ctrlKey: true, shiftKey: true }), 'Mod+K')).toBe(false)
    expect(matchesChord(key({ key: 'k', ctrlKey: true, altKey: true }), 'Mod+K')).toBe(false)
    expect(matchesChord(key({ key: 'k' }), 'Mod+K')).toBe(false)
  })

  it('match symbols by the physical key when Shift changes the character', () => {
    expect(matchesChord(key({ key: '_', code: 'Minus', ctrlKey: true, shiftKey: true }), 'Mod+Shift+-')).toBe(true)
    expect(matchesChord(key({ key: '|', code: 'Backslash', ctrlKey: true, shiftKey: true }), 'Mod+Shift+\\')).toBe(true)
    expect(matchesChord(key({ key: '-', code: 'Minus', ctrlKey: true }), 'Mod+Shift+-')).toBe(false)
  })

  it('keep the exact hotkey semantics of push-to-talk', () => {
    expect(matchesHotkey(key({ key: ' ', ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+Space')).toBe(true)
    expect(matchesHotkey(key({ key: ' ', metaKey: true, shiftKey: true }), 'Ctrl+Shift+Space')).toBe(false)
  })

  it('format for display and detect collisions', () => {
    expect(formatChord('Mod+Shift+D', false)).toBe('Ctrl+Shift+D')
    expect(formatChord('Mod+Shift+D', true)).toBe('Cmd+Shift+D')
    expect(formatChord('Ctrl+Alt+PageDown', false)).toBe('Ctrl+Alt+PageDown')
    expect(chordsCollide('Mod+K', 'Ctrl+K')).toBe(true)
    expect(chordsCollide('Mod+K', 'Mod+Shift+K')).toBe(false)
  })
})

describe('keybinding registry', () => {
  afterEach(() => { setKeybindingOverrides({}); setKeyboardView('code') })

  it('has unique ids and no two bindings fire on the same key in the same view', () => {
    const bindings = KEYBINDINGS as readonly Keybinding[]
    expect(new Set(bindings.map(binding => binding.id)).size).toBe(bindings.length)
    const clashes = bindings.flatMap((a, index) => bindings.slice(index + 1)
      .filter(b => bindingsCollide(a, b, a.chords, b.chords)).map(b => `${a.id} × ${b.id}`))
    expect(clashes).toEqual([])
  })

  it('reserves only the palette, settings and sidebar chords in a focused terminal', () => {
    expect(isTerminalReservedChord(key({ key: 'k', ctrlKey: true }))).toBe(true)
    expect(isTerminalReservedChord(key({ key: 'P', ctrlKey: true, shiftKey: true }))).toBe(true)
    expect(isTerminalReservedChord(key({ key: ',', ctrlKey: true }))).toBe(true)
    expect(isTerminalReservedChord(key({ key: 'b', ctrlKey: true }))).toBe(true)
    for (const letter of ['r', 'j', 'c', 'd', 'e', 'l']) expect(isTerminalReservedChord(key({ key: letter, ctrlKey: true }))).toBe(false)
  })

  it('labels follow user overrides', () => {
    expect(shortcutLabel('code.changes')).toBe('Ctrl+Shift+D')
    setKeybindingOverrides({ 'code.changes': ['Mod+Alt+C'] })
    expect(shortcutLabel('code.changes')).toBe('Ctrl+Alt+C')
    setKeybindingOverrides({ 'code.changes': [] })
    expect(shortcutLabel('code.changes')).toBeUndefined()
  })

  it('dispatches only to the scope of the current view', () => {
    const code = vi.fn(), thread = vi.fn()
    const hook = renderHook(() => useKeybindings({ 'code.changes': code, 'thread.changes': thread }))
    setKeyboardView('code')
    dispatchKeybinding(key({ key: 'D', ctrlKey: true, shiftKey: true }))
    setKeyboardView('thread')
    const event = key({ key: 'D', ctrlKey: true, shiftKey: true })
    expect(dispatchKeybinding(event)).toBe(true)
    expect(event.defaultPrevented).toBe(true)
    expect([code.mock.calls.length, thread.mock.calls.length]).toEqual([1, 1])
    setKeyboardView('data')
    expect(dispatchKeybinding(key({ key: 'D', ctrlKey: true, shiftKey: true }))).toBe(false)
    hook.unmount()
  })

  it('lets a handler decline so the key goes on as usual', () => {
    const hook = renderHook(() => useKeybindings({ 'terminal.restart': () => false }))
    const event = key({ key: 'r', ctrlKey: true })
    expect(dispatchKeybinding(event)).toBe(false)
    expect(event.defaultPrevented).toBe(false)
    hook.unmount()
  })

  it('leaves no shortcut text in the catalogs: labels come from the registry', () => {
    for (const file of ['src/components/Workspace/toolCatalog.ts', 'src/components/Workbench/panelCatalog.ts', 'src/components/Navigation/appMenus.ts']) {
      const source = readFileSync(join(process.cwd(), file), 'utf8')
      // Native text-editing items (Undo, Copy…) are the only literal shortcuts left.
      const literal = [...source.matchAll(/'(?:Ctrl|Mod)\+[^']*'/g)].map(match => match[0])
        .filter(text => !/^'Ctrl\+(?:Z|Shift\+Z|X|C|V|A)'$/.test(text))
      expect(literal, file).toEqual([])
    }
  })
})
