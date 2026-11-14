// Frozen acceptance test for 1.5.2 OxeChat F2 (OXE program oxespace-152-chat, phase F2, Jira OXE-131, RT-1).
// Written by the planner; the executor must not edit it.
// Contract: src/components/Threads/sendKey.ts (new) exports
//   type SendKeyMode = 'enter' | 'ctrl-enter'
//   isSendKey(event: { key: string; shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean;
//                      isComposing?: boolean; keyCode?: number }, mode: SendKeyMode, mac?: boolean): boolean
// the one rule for "does this key send the message", used by the OxeChat composer and the agent question answer box
// (tests/oxe152/ux/oxe-131-send-key.test.tsx checks that wiring). `mac` defaults to the platform (IS_MAC,
// src/keyboard/chords.ts); this test passes it.
// - "enter" (the factory default, as today): Enter sends, Shift+Enter does not (the textarea breaks the line);
//   Ctrl+Enter and Cmd+Enter still send, as they do today.
// - "ctrl-enter": Enter and Shift+Enter do not send (the line breaks); Ctrl+Enter sends, Cmd+Enter on macOS.
// - An IME composition (`isComposing`, or the legacy keyCode 229) never sends, in either mode.
import { describe, expect, it } from 'vitest'
import { isSendKey } from '../../../src/components/Threads/sendKey'

const enter = { key: 'Enter' }
const shiftEnter = { key: 'Enter', shiftKey: true }
const ctrlEnter = { key: 'Enter', ctrlKey: true }
const cmdEnter = { key: 'Enter', metaKey: true }

describe('OXE-131 · which key sends the message', () => {
  it('CA-2 · modo Enter', () => {
    for (const mac of [false, true]) {
      expect(isSendKey(enter, 'enter', mac), `Enter sends (mac ${mac})`).toBe(true)
      expect(isSendKey(shiftEnter, 'enter', mac), `Shift+Enter breaks the line (mac ${mac})`).toBe(false)
      expect(isSendKey({ key: 'a' }, 'enter', mac)).toBe(false)
      expect(isSendKey({ key: 'a', ctrlKey: true }, 'enter', mac)).toBe(false)
    }
    expect(isSendKey(ctrlEnter, 'enter', false), 'Ctrl+Enter still sends').toBe(true)
    expect(isSendKey(cmdEnter, 'enter', true), 'Cmd+Enter still sends on macOS').toBe(true)
  })

  it('CA-3 · modo Ctrl+Enter', () => {
    for (const mac of [false, true]) {
      expect(isSendKey(enter, 'ctrl-enter', mac), `Enter breaks the line (mac ${mac})`).toBe(false)
      expect(isSendKey(shiftEnter, 'ctrl-enter', mac), `Shift+Enter breaks the line (mac ${mac})`).toBe(false)
      expect(isSendKey({ key: 'a', ctrlKey: true }, 'ctrl-enter', mac)).toBe(false)
    }
    expect(isSendKey(ctrlEnter, 'ctrl-enter', false), 'Ctrl+Enter sends on Windows and Linux').toBe(true)
    expect(isSendKey(cmdEnter, 'ctrl-enter', true), 'Cmd+Enter sends on macOS').toBe(true)
  })

  it('CA-4 · IME nunca envia', () => {
    for (const mode of ['enter', 'ctrl-enter'] as const) {
      for (const mac of [false, true]) {
        for (const event of [enter, shiftEnter, ctrlEnter, cmdEnter]) {
          expect(isSendKey({ ...event, isComposing: true }, mode, mac), `${mode} ${JSON.stringify(event)} composing (mac ${mac})`).toBe(false)
          expect(isSendKey({ ...event, keyCode: 229 }, mode, mac), `${mode} ${JSON.stringify(event)} keyCode 229 (mac ${mac})`).toBe(false)
        }
      }
    }
  })
})
