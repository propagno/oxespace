import type { Monaco } from '@monaco-editor/react'
import { currentMode, onModeChange } from '../design/mode'

/** The one Monaco theme OXESpace uses; it is redefined from the tokens whenever the mode changes. */
export const MONACO_THEME = 'oxe'

function token(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback
}

/** Defines the theme for the current mode from the design tokens. */
export function defineMonacoTheme(monaco: Monaco): void {
  const dark = currentMode() === 'dark'
  const canvas = token('--surface-base', dark ? '#141615' : '#fcfdfc')
  monaco.editor.defineTheme(MONACO_THEME, {
    base: dark ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': canvas,
      'editorGutter.background': canvas,
      'editor.foreground': token('--text-primary', dark ? '#e8f1eb' : '#1b211d'),
      'editor.lineHighlightBackground': '#00000000',
      'editor.lineHighlightBorder': token('--border-subtle', dark ? '#2b302d' : '#dce1de'),
      'editor.selectionBackground': `${token('--fill-selected-strong', dark ? '#4a3a1c' : '#c8e9d5')}`,
      'editorCursor.foreground': token('--accent', dark ? '#f5a939' : '#006d42'),
      'editorLineNumber.foreground': token('--text-muted', dark ? '#9fa7a1' : '#5e6560'),
      'editorLineNumber.activeForeground': token('--text-primary', dark ? '#e8f1eb' : '#1b211d'),
      'editorWidget.background': token('--surface-overlay', dark ? '#232624' : '#ffffff'),
      'editorWidget.border': token('--border-default', dark ? '#373c38' : '#d1d6d2'),
      'focusBorder': token('--border-focus', dark ? '#f5a939' : '#006d42'),
      'diffEditor.insertedLineBackground': token('--diff-add-bg', dark ? '#12301c' : '#e1f5e6'),
      'diffEditor.removedLineBackground': token('--diff-del-bg', dark ? '#3a1714' : '#fde8e5'),
      'diffEditor.insertedTextBackground': token('--diff-add-strong', dark ? '#1d4a2b' : '#bfe8cb'),
      'diffEditor.removedTextBackground': token('--diff-del-strong', dark ? '#5a221d' : '#f8c9c2'),
      'diffEditorGutter.insertedLineBackground': token('--diff-add-strong', dark ? '#1d4a2b' : '#bfe8cb'),
      'diffEditorGutter.removedLineBackground': token('--diff-del-strong', dark ? '#5a221d' : '#f8c9c2'),
      'diffEditor.unchangedRegionBackground': token('--surface-chrome', dark ? '#141615' : '#eef1ef'),
      'diffEditor.unchangedRegionForeground': token('--text-secondary', dark ? '#c4cdc7' : '#404742'),
      'diffEditor.border': token('--border-default', dark ? '#373c38' : '#d1d6d2')
    }
  })
}

/**
 * For `beforeMount` / `onMount` of a Monaco editor: defines the theme now and
 * follows later mode switches. Returns the cleanup for unmount.
 */
export function followMonacoTheme(monaco: Monaco): () => void {
  defineMonacoTheme(monaco)
  monaco.editor.setTheme(MONACO_THEME)
  return onModeChange(() => { defineMonacoTheme(monaco); monaco.editor.setTheme(MONACO_THEME) })
}
