import type { Monaco } from '@monaco-editor/react'
import {
  currentColorScheme,
  currentMode,
  currentSurfaceStyle,
  onColorSchemeChange,
  onModeChange,
  onSurfaceStyleChange
} from '../design/mode'
import { schemeColorRoles } from '../design/tokens/schemes'

/** The one Monaco theme OXESpace uses; it is redefined from the tokens whenever mode, surface, or scheme changes. */
export const MONACO_THEME = 'oxe'

function token(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback
}

/** Defines the theme for the current mode, surface preset, and Minimal color scheme from the design tokens. */
export function defineMonacoTheme(monaco: Monaco): void {
  const mode = currentMode()
  const surface = currentSurfaceStyle()
  const scheme = currentColorScheme()
  const dark = mode === 'dark'
  const roles = schemeColorRoles(scheme, mode, surface)
  const canvas = token('--surface-base', roles['surface-base'])
  monaco.editor.defineTheme(MONACO_THEME, {
    base: dark ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': canvas,
      'editorGutter.background': canvas,
      'editor.foreground': token('--tx-primary', roles['text-primary']),
      'editor.lineHighlightBackground': '#00000000',
      'editor.lineHighlightBorder': token('--bd-subtle', roles['border-subtle']),
      'editor.selectionBackground': `${token('--fill-selected-strong', roles['fill-selected-strong'])}`,
      'editorCursor.foreground': token('--accent', roles.accent),
      'editorLineNumber.foreground': token('--tx-muted', roles['text-muted']),
      'editorLineNumber.activeForeground': token('--tx-primary', roles['text-primary']),
      'editorWidget.background': token('--surface-overlay', roles['surface-overlay']),
      'editorWidget.border': token('--bd-default', roles['border-default']),
      'focusBorder': token('--bd-focus', roles['border-focus']),
      'diffEditor.insertedLineBackground': token('--diff-add-bg', roles['diff-add-bg']),
      'diffEditor.removedLineBackground': token('--diff-del-bg', roles['diff-del-bg']),
      'diffEditor.insertedTextBackground': token('--diff-add-strong', roles['diff-add-strong']),
      'diffEditor.removedTextBackground': token('--diff-del-strong', roles['diff-del-strong']),
      'diffEditorGutter.insertedLineBackground': token('--diff-add-strong', roles['diff-add-strong']),
      'diffEditorGutter.removedLineBackground': token('--diff-del-strong', roles['diff-del-strong']),
      'diffEditor.unchangedRegionBackground': token('--surface-chrome', roles['surface-chrome']),
      'diffEditor.unchangedRegionForeground': token('--tx-secondary', roles['text-secondary']),
      'diffEditor.border': token('--bd-subtle', roles['border-subtle'])
    }
  })
}

/**
 * For `beforeMount` / `onMount` of a Monaco editor: defines the theme now and
 * follows later mode, surface preset, and color scheme switches. Returns the cleanup for unmount.
 */
export function followMonacoTheme(monaco: Monaco): () => void {
  const apply = (): void => { defineMonacoTheme(monaco); monaco.editor.setTheme(MONACO_THEME) }
  apply()
  const stopMode = onModeChange(apply)
  const stopSurface = onSurfaceStyleChange(apply)
  const stopScheme = onColorSchemeChange(apply)
  return () => { stopMode(); stopSurface(); stopScheme() }
}
