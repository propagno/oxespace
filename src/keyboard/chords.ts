/**
 * Chords are written like "Mod+Shift+D": modifiers then one key, joined by "+".
 * "Mod" is Ctrl on Windows/Linux and either Ctrl or Cmd on macOS, the way the
 * app's shortcuts always behaved. "Ctrl", "Meta"/"Cmd", "Shift" and "Alt" are exact.
 */
export interface ParsedChord {
  mod: boolean
  ctrl: boolean
  meta: boolean
  shift: boolean
  alt: boolean
  key: string
}

const MODIFIERS = new Set(['mod', 'ctrl', 'control', 'shift', 'alt', 'option', 'meta', 'cmd'])

/** Physical key → the character it types on a US layout, so Ctrl+Shift+- still matches when the browser reports "_". */
const CODE_KEYS: Record<string, string> = {
  Minus: '-', Equal: '=', Backslash: '\\', Slash: '/', Comma: ',', Period: '.', Backquote: '`',
  Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Space: 'space'
}

export const IS_MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)

function normalizeKey(key: string): string {
  const lower = key.toLowerCase()
  if (lower === ' ' || lower === 'spacebar') return 'space'
  if (lower === 'esc') return 'escape'
  if (lower === 'plus') return '+'
  return lower
}

export function parseChord(chord: string): ParsedChord {
  // "Ctrl++" names the plus key: the trailing empty part is the "+".
  const raw = chord.split('+').map(part => part.trim())
  const parts = raw.slice(0, -1).filter(Boolean).map(part => part.toLowerCase())
  const last = raw[raw.length - 1] === '' && raw.length > 1 ? '+' : raw[raw.length - 1] ?? ''
  const all = [...parts, last.toLowerCase()]
  const key = normalizeKey(all.find(part => !MODIFIERS.has(part)) ?? '')
  return {
    mod: all.includes('mod'),
    ctrl: all.includes('ctrl') || all.includes('control'),
    meta: all.includes('meta') || all.includes('cmd'),
    shift: all.includes('shift'),
    alt: all.includes('alt') || all.includes('option'),
    key
  }
}

/** The keys an event may stand for: what it typed and, for symbols, the physical key. */
function eventKeys(event: Pick<KeyboardEvent, 'key' | 'code'>): string[] {
  const keys = [normalizeKey(event.key)]
  const code = event.code ?? ''
  if (CODE_KEYS[code]) keys.push(CODE_KEYS[code])
  else if (/^Key[A-Z]$/.test(code)) keys.push(code.slice(3).toLowerCase())
  else if (/^Digit\d$/.test(code)) keys.push(code.slice(5))
  return keys
}

type ChordEvent = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>

export function matchesChord(event: ChordEvent, chord: string | ParsedChord): boolean {
  const parsed = typeof chord === 'string' ? parseChord(chord) : chord
  if (!parsed.key) return false
  if (parsed.mod) {
    if (!(event.ctrlKey || event.metaKey)) return false
    if (!parsed.ctrl && !parsed.meta && event.ctrlKey && event.metaKey) return false
  } else if (event.ctrlKey !== parsed.ctrl || event.metaKey !== parsed.meta) return false
  if (event.shiftKey !== parsed.shift || event.altKey !== parsed.alt) return false
  return eventKeys(event).includes(parsed.key)
}

/** Match a KeyboardEvent against a hotkey string like "Ctrl+Shift+Space" (exact modifiers). */
export function matchesHotkey(event: ChordEvent, hotkey: string): boolean {
  return matchesChord(event, hotkey)
}

const KEY_LABELS: Record<string, string> = {
  space: 'Space', enter: 'Enter', escape: 'Esc', pagedown: 'PageDown', pageup: 'PageUp', arrowup: 'Up', arrowdown: 'Down',
  arrowleft: 'Left', arrowright: 'Right', backspace: 'Backspace', delete: 'Delete', tab: 'Tab', home: 'Home', end: 'End'
}

/** The parts a chord shows as, one per key cap: ["Ctrl", "Shift", "D"]. */
export function chordParts(chord: string, mac = IS_MAC): string[] {
  const parsed = parseChord(chord)
  const parts: string[] = []
  if (parsed.mod) parts.push(mac ? 'Cmd' : 'Ctrl')
  if (parsed.ctrl) parts.push('Ctrl')
  if (parsed.meta) parts.push(mac ? 'Cmd' : 'Meta')
  if (parsed.alt) parts.push(mac ? 'Option' : 'Alt')
  if (parsed.shift) parts.push('Shift')
  const key = KEY_LABELS[parsed.key] ?? (/^f\d{1,2}$/.test(parsed.key) ? parsed.key.toUpperCase() : parsed.key.length === 1 ? parsed.key.toUpperCase() : parsed.key)
  parts.push(key)
  return parts
}

/** "Mod+Shift+D" → "Ctrl+Shift+D" (or "Cmd+Shift+D" on macOS). */
export function formatChord(chord: string, mac = IS_MAC): string {
  return chordParts(chord, mac).join('+')
}

/** Two chords that a single key press would satisfy both of. "Mod+K" collides with "Ctrl+K". */
export function chordsCollide(a: string, b: string): boolean {
  const x = parseChord(a), y = parseChord(b)
  if (x.key !== y.key || x.shift !== y.shift || x.alt !== y.alt) return false
  // The Ctrl/Meta combinations that satisfy a chord, as "ctrl,meta" strings.
  const pressable = (c: ParsedChord): string[] => c.mod && !c.ctrl && !c.meta ? ['1,0', '0,1'] : [`${Number(c.ctrl || c.mod)},${Number(c.meta)}`]
  const other = pressable(y)
  return pressable(x).some(combo => other.includes(combo))
}
