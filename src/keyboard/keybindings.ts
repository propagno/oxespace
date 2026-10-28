import { useEffect, useLayoutEffect, useRef } from 'react'
import { useUIStore } from '../store/ui.store'
import { chordsCollide, formatChord, matchesChord, parseChord, type ParsedChord } from './chords'

/**
 * Every app keyboard shortcut, in one place. Components bind handlers to these
 * ids with `useKeybindings`; menus, the palette and tooltips read the labels
 * from here, so a shortcut is defined once and shown the same everywhere.
 */
export type KeybindingScope = 'global' | 'code' | 'thread' | 'oxequery' | 'terminal'
export type AppView = 'code' | 'thread' | 'data'

export interface KeybindingContext {
  view: AppView
  target: Element | null
}

export interface Keybinding {
  id: string
  /** Default chords, first one is the one shown. */
  chords: string[]
  scope: KeybindingScope
  label: string
  /** Extra condition on top of the scope. */
  when?: (context: KeybindingContext) => boolean
  /** A focused terminal hands these chords to the app instead of the shell. */
  reservedInTerminal?: boolean
}

export const inXterm = (target: Element | null): boolean => Boolean(target?.closest('.xterm'))
/** Editors and terminals keep their own find. */
export const inEditor = (target: Element | null): boolean => Boolean(target?.closest('.xterm, .monaco-editor, .cm-editor'))

export const KEYBINDINGS = [
  // Global
  { id: 'palette.open', chords: ['Mod+K', 'Mod+Shift+P'], scope: 'global', label: 'Open command palette', reservedInTerminal: true },
  { id: 'palette.search', chords: ['Mod+J'], scope: 'global', label: 'Search files & commands' },
  { id: 'settings.open', chords: ['Mod+,'], scope: 'global', label: 'Open settings', reservedInTerminal: true },
  { id: 'sidebar.toggle', chords: ['Mod+B'], scope: 'global', label: 'Toggle sidebar', reservedInTerminal: true },
  { id: 'voice.toggle', chords: ['Mod+Shift+V'], scope: 'global', label: 'Toggle voice input', when: context => context.view !== 'data' },

  // Code
  { id: 'code.changes', chords: ['Mod+Shift+D'], scope: 'code', label: 'Changes' },
  { id: 'code.browser', chords: ['Mod+Shift+B'], scope: 'code', label: 'Browser' },
  { id: 'code.files', chords: ['Mod+E'], scope: 'code', label: 'Files' },
  { id: 'code.search', chords: ['Mod+Shift+F'], scope: 'code', label: 'Find in files' },
  { id: 'code.splitLayout', chords: ['F2'], scope: 'code', label: 'Toggle split layout' },
  { id: 'pane.splitRight', chords: ['Mod+Shift+\\'], scope: 'code', label: 'Split pane right' },
  { id: 'pane.splitDown', chords: ['Mod+Shift+-'], scope: 'code', label: 'Split pane down' },
  { id: 'pane.maximize', chords: ['Mod+Shift+Enter'], scope: 'code', label: 'Maximize / restore pane' },

  // Terminal (Code panes)
  { id: 'terminal.restart', chords: ['Mod+R'], scope: 'terminal', label: 'Restart terminal' },
  { id: 'terminal.slash', chords: ['Mod+/'], scope: 'terminal', label: 'Terminal commands' },
  { id: 'terminal.zoomIn', chords: ['Mod+=', 'Mod+Shift+='], scope: 'terminal', label: 'Terminal font bigger', when: context => inXterm(context.target) },
  { id: 'terminal.zoomOut', chords: ['Mod+-'], scope: 'terminal', label: 'Terminal font smaller', when: context => inXterm(context.target) },
  { id: 'terminal.zoomReset', chords: ['Mod+0'], scope: 'terminal', label: 'Terminal font reset', when: context => inXterm(context.target) },

  // Thread
  { id: 'thread.new', chords: ['Ctrl+Alt+N'], scope: 'thread', label: 'New conversation' },
  { id: 'thread.next', chords: ['Ctrl+Alt+PageDown'], scope: 'thread', label: 'Next conversation' },
  { id: 'thread.previous', chords: ['Ctrl+Alt+PageUp'], scope: 'thread', label: 'Previous conversation' },
  { id: 'thread.find', chords: ['Mod+F'], scope: 'thread', label: 'Find in conversation', when: context => !inEditor(context.target) },
  { id: 'thread.viewMode', chords: ['Mod+O'], scope: 'thread', label: 'Transcript view', when: context => !inXterm(context.target) },
  { id: 'thread.terminal', chords: ['Mod+`'], scope: 'thread', label: 'Terminal' },
  { id: 'thread.changes', chords: ['Mod+Shift+D'], scope: 'thread', label: 'Changes' },
  { id: 'thread.browser', chords: ['Mod+Shift+B'], scope: 'thread', label: 'Browser' },
  { id: 'thread.permissions', chords: ['Mod+Shift+M'], scope: 'thread', label: 'Permissions' },
  { id: 'thread.model', chords: ['Mod+Shift+I'], scope: 'thread', label: 'Model' },
  { id: 'thread.effort', chords: ['Mod+Shift+E'], scope: 'thread', label: 'Reasoning effort' }
] as const satisfies readonly Keybinding[]

export type KeybindingId = typeof KEYBINDINGS[number]['id']

const BY_ID = new Map<string, Keybinding>(KEYBINDINGS.map(binding => [binding.id, binding]))

export function getKeybinding(id: KeybindingId): Keybinding {
  return BY_ID.get(id)!
}

// User overrides (Settings › Keyboard). An empty list disables the shortcut.
let overrides: Partial<Record<string, string[]>> = {}
const parsedCache = new Map<string, ParsedChord>()
const parsed = (chord: string): ParsedChord => {
  let value = parsedCache.get(chord)
  if (!value) { value = parseChord(chord); parsedCache.set(chord, value) }
  return value
}

export function setKeybindingOverrides(next: Partial<Record<string, string[]>>): void {
  overrides = next
}

export function chordsFor(id: KeybindingId): string[] {
  return overrides[id] ?? [...getKeybinding(id).chords]
}

/** The label a menu or tooltip shows, e.g. "Ctrl+Shift+D"; undefined when unbound. */
export function shortcutLabel(id: KeybindingId | undefined): string | undefined {
  if (!id) return undefined
  const [first] = chordsFor(id)
  return first ? formatChord(first) : undefined
}

/** "Changes · Ctrl+Shift+D" */
export function withShortcut(label: string, id: KeybindingId | undefined): string {
  const shortcut = shortcutLabel(id)
  return shortcut ? `${label} · ${shortcut}` : label
}

// The view the user is looking at decides which scopes listen.
let activeView: AppView = 'code'
export function setKeyboardView(view: AppView): void { activeView = view }
export function getKeyboardView(): AppView { return activeView }

export function scopeIsActive(scope: KeybindingScope, view: AppView): boolean {
  if (scope === 'global') return true
  if (scope === 'thread') return view === 'thread'
  if (scope === 'oxequery') return view === 'data'
  return view === 'code'
}

/** Bindings two of which the same key press in the same view would fire. */
export function bindingsCollide(a: Keybinding, b: Keybinding, chordsA: string[], chordsB: string[]): boolean {
  const views: AppView[] = ['code', 'thread', 'data']
  if (!views.some(view => scopeIsActive(a.scope, view) && scopeIsActive(b.scope, view))) return false
  return chordsA.some(x => chordsB.some(y => chordsCollide(x, y)))
}

/** True when a focused terminal should give this key to the app rather than the shell. */
export function isTerminalReservedChord(event: KeyboardEvent): boolean {
  return (KEYBINDINGS as readonly Keybinding[]).some(binding => binding.reservedInTerminal
    && chordsFor(binding.id as KeybindingId).some(chord => matchesChord(event, parsed(chord))))
}

/** Return false when the shortcut does not apply right now; the key then goes on as usual. */
export type KeybindingHandler = (event: KeyboardEvent) => boolean | void
type HandlerMap = Partial<Record<KeybindingId, KeybindingHandler>>

const layers: Array<{ current: HandlerMap }> = []

function blocked(target: Element | null): boolean {
  // The native CLI owns its keymap, including Ctrl+R, Ctrl+B and Ctrl+J.
  if (target?.closest('.thread-native-cli')) return true
  const ui = useUIStore.getState()
  return ui.isSettingsOpen || ui.isWorkspaceSettingsOpen
}

export function dispatchKeybinding(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.isComposing) return false
  const target = event.target instanceof Element ? event.target : null
  if (blocked(target)) return false
  const context: KeybindingContext = { view: activeView, target }
  for (const binding of KEYBINDINGS as readonly Keybinding[]) {
    if (!scopeIsActive(binding.scope, context.view)) continue
    if (!chordsFor(binding.id as KeybindingId).some(chord => matchesChord(event, parsed(chord)))) continue
    if (binding.when && !binding.when(context)) continue
    // The most recently mounted handler for an id wins.
    for (let index = layers.length - 1; index >= 0; index--) {
      const handler = layers[index].current[binding.id as KeybindingId]
      if (!handler) continue
      if (handler(event) === false) continue
      event.preventDefault()
      return true
    }
  }
  return false
}

let listening = false
function listen(): void {
  if (listening || typeof window === 'undefined') return
  listening = true
  window.addEventListener('keydown', dispatchKeybinding)
}

/** Binds handlers to registry ids while `enabled`. Handlers always see the latest render. */
export function useKeybindings(handlers: HandlerMap, enabled = true): void {
  const ref = useRef(handlers)
  useLayoutEffect(() => { ref.current = handlers })
  useEffect(() => {
    if (!enabled) return
    listen()
    const layer = { get current() { return ref.current } }
    layers.push(layer)
    return () => { const index = layers.indexOf(layer); if (index >= 0) layers.splice(index, 1) }
  }, [enabled])
}
