import type { Monaco } from '@monaco-editor/react'
import { currentMode, onModeChange, onSurfaceStyleChange } from '../design/mode'

/** The one Monaco theme OXESpace uses; it is redefined from the tokens whenever the mode changes. */
export const MONACO_THEME = 'oxe'

function token(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback
}

/** Defines the theme for the current mode and surface preset from the design tokens. */
export function defineMonacoTheme(monaco: Monaco): void {
  const dark = currentMode() === 'dark'
  const canvas = token('--surface-base', dark ? '#1f1f1f' : '#ffffff')
  monaco.editor.defineTheme(MONACO_THEME, {
    base: dark ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': canvas,
      'editorGutter.background': canvas,
      'editor.foreground': token('--tx-primary', dark ? '#e8e8e8' : '#1b1b1b'),
      'editor.lineHighlightBackground': '#00000000',
      'editor.lineHighlightBorder': token('--bd-subtle', dark ? '#2a2a2a' : '#ebebeb'),
      'editor.selectionBackground': `${token('--fill-selected-strong', dark ? '#383838' : '#e0e0e0')}`,
      'editorCursor.foreground': token('--accent', dark ? '#27bd85' : '#007044'),
      'editorLineNumber.foreground': token('--tx-muted', dark ? '#989898' : '#606060'),
      'editorLineNumber.activeForeground': token('--tx-primary', dark ? '#e8e8e8' : '#1b1b1b'),
      'editorWidget.background': token('--surface-overlay', dark ? '#2c2c2c' : '#ffffff'),
      'editorWidget.border': token('--bd-default', dark ? '#333333' : '#e0e0e0'),
      'focusBorder': token('--bd-focus', dark ? '#27bd85' : '#007044'),
      'diffEditor.insertedLineBackground': token('--diff-add-bg', dark ? '#12301c' : '#e1f5e6'),
      'diffEditor.removedLineBackground': token('--diff-del-bg', dark ? '#3a1714' : '#fde8e5'),
      'diffEditor.insertedTextBackground': token('--diff-add-strong', dark ? '#1d4a2b' : '#bfe8cb'),
      'diffEditor.removedTextBackground': token('--diff-del-strong', dark ? '#5a221d' : '#f8c9c2'),
      'diffEditorGutter.insertedLineBackground': token('--diff-add-strong', dark ? '#1d4a2b' : '#bfe8cb'),
      'diffEditorGutter.removedLineBackground': token('--diff-del-strong', dark ? '#5a221d' : '#f8c9c2'),
      'diffEditor.unchangedRegionBackground': token('--surface-chrome', dark ? '#191919' : '#f5f5f5'),
      'diffEditor.unchangedRegionForeground': token('--tx-secondary', dark ? '#bababa' : '#484848'),
      'diffEditor.border': token('--bd-default', dark ? '#333333' : '#e0e0e0')
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
