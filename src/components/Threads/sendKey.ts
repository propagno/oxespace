import { IS_MAC } from '../../keyboard/chords'

/** Which key sends a message from the OxeChat composer and answers an agent question (OXE-131). */
export type SendKeyMode = 'enter' | 'ctrl-enter'

export const SEND_KEY_MODES: readonly SendKeyMode[] = ['enter', 'ctrl-enter']

export interface SendKeyEvent {
  key: string
  shiftKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  isComposing?: boolean
  keyCode?: number
}

/** The fields isSendKey reads, from a React keyboard event (isComposing lives on the native event). */
export function sendKeyEvent(event: { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean; keyCode: number; nativeEvent: { isComposing?: boolean } }): SendKeyEvent {
  return { key: event.key, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey, keyCode: event.keyCode, isComposing: event.nativeEvent.isComposing }
}

/**
 * "enter" (factory default): Enter sends, Shift+Enter breaks the line; Ctrl+Enter and Cmd+Enter still send.
 * "ctrl-enter": Enter and Shift+Enter break the line; Ctrl+Enter sends (Cmd+Enter on macOS).
 * An IME composition never sends.
 */
export function isSendKey(event: SendKeyEvent, mode: SendKeyMode, mac: boolean = IS_MAC): boolean {
  if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return false
  if (event.shiftKey) return false
  if (mode === 'enter') return true
  return mac ? Boolean(event.metaKey) : Boolean(event.ctrlKey)
}

/** The key as a hint names it: "Enter", "Ctrl+Enter", or "⌘+Enter" on macOS. */
export function sendKeyLabel(mode: SendKeyMode, mac: boolean = IS_MAC): string {
  if (mode === 'enter') return 'Enter'
  return mac ? '⌘+Enter' : 'Ctrl+Enter'
}

/** Alt+Enter (Option+Enter on macOS) runs the opposite active-turn action (Steer vs Queue, OXE-479). */
export function isAltSendKey(event: SendKeyEvent): boolean {
  if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return false
  if (event.shiftKey || event.ctrlKey || event.metaKey) return false
  return Boolean(event.altKey)
}

/** Shortcut label for the alternate active-turn send key: "Alt+Enter", or "⌥+Enter" on macOS. */
export function altSendKeyLabel(mac: boolean = IS_MAC): string {
  return mac ? '⌥+Enter' : 'Alt+Enter'
}

export function isSendKeyMode(value: unknown): value is SendKeyMode {
  return value === 'enter' || value === 'ctrl-enter'
}
