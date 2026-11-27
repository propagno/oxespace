import type { Monaco } from '@monaco-editor/react'
import { currentMode, currentSurfaceStyle, onModeChange, onSurfaceStyleChange } from '../design/mode'

/** The one Monaco theme OXESpace uses; it is redefined from the tokens whenever the mode changes. */
export const MONACO_THEME = 'oxe'

function token(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback
}

/** Defines the theme for the current mode and surface preset from the design tokens. */
export function defineMonacoTheme(monaco: Monaco): void {
  const dark = currentMode() === 'dark'
  const pure = currentSurfaceStyle() === 'pure'
  const canvas = token('--surface-base', dark ? (pure ? '#000000' : '#1f1f1f') : '#ffffff')
  monaco.editor.defineTheme(MONACO_THEME, {
    base: dark ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': canvas,
      'editorGutter.background': canvas,
      'editor.foreground': token('--tx-primary', dark ? (pure ? '#d8d8d8' : '#e8e8e8') : '#1b1b1b'),
      'editor.lineHighlightBackground': '#00000000',
      'editor.lineHighlightBorder': token('--bd-subtle', dark ? (pure ? '#222222' : '#2a2a2a') : (pure ? '#e8e8e8' : '#ebebeb')),
      'editor.selectionBackground': `${token('--fill-selected-strong', dark ? (pure ? '#2a2a2a' : '#383838') : (pure ? '#e3e3e3' : '#e0e0e0'))}`,
      'editorCursor.foreground': token('--accent', dark ? '#44b77e' : '#007044'),
      'editorLineNumber.foreground': token('--tx-muted', dark ? (pure ? '#949494' : '#a4a4a4') : '#606060'),
      'editorLineNumber.activeForeground': token('--tx-primary', dark ? (pure ? '#d8d8d8' : '#e8e8e8') : '#1b1b1b'),
      'editorWidget.background': token('--surface-overlay', dark ? (pure ? '#181818' : '#2c2c2c') : '#ffffff'),
      'editorWidget.border': token('--bd-default', dark ? (pure ? '#2e2e2e' : '#333333') : (pure ? '#dcdcdc' : '#e0e0e0')),
      'focusBorder': token('--bd-focus', dark ? '#44b77e' : '#007044'),
      'diffEditor.insertedLineBackground': token('--diff-add-bg', dark ? '#0f2413' : '#e4f6e6'),
      'diffEditor.removedLineBackground': token('--diff-del-bg', dark ? '#351210' : '#ffebe9'),
      'diffEditor.insertedTextBackground': token('--diff-add-strong', dark ? '#13361a' : '#c8ebcb'),
      'diffEditor.removedTextBackground': token('--diff-del-strong', dark ? '#511615' : '#ffd4cf'),
      'diffEditorGutter.insertedLineBackground': token('--diff-add-strong', dark ? '#13361a' : '#c8ebcb'),
      'diffEditorGutter.removedLineBackground': token('--diff-del-strong', dark ? '#511615' : '#ffd4cf'),
      'diffEditor.unchangedRegionBackground': token('--surface-chrome', dark ? (pure ? '#000000' : '#191919') : (pure ? '#ffffff' : '#f5f5f5')),
      'diffEditor.unchangedRegionForeground': token('--tx-secondary', dark ? (pure ? '#adadad' : '#c4c4c4') : '#484848'),
      'diffEditor.border': token('--bd-subtle', dark ? (pure ? '#222222' : '#2a2a2a') : (pure ? '#e8e8e8' : '#ebebeb'))
    }
  })
}

/**
 * For `beforeMount` / `onMount` of a Monaco editor: defines the theme now and
 * follows later mode and surface preset switches. Returns the cleanup for unmount.
 */
export function followMonacoTheme(monaco: Monaco): () => void {
  const apply = (): void => { defineMonacoTheme(monaco); monaco.editor.setTheme(MONACO_THEME) }
  apply()
  const stopMode = onModeChange(apply)
  const stopSurface = onSurfaceStyleChange(apply)
  return () => { stopMode(); stopSurface() }
}
