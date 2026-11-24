import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Workspace } from '../../../shared/types/workspace'
import { SettingsCenter } from '../../../src/components/Settings/SettingsCenter'
import { changeLanguage } from '../../../src/i18n'

// OXE-312: Settings' close ✕ was a raw <button> styled by its own rules, and NavigationChrome.css still named
// .settings-scope-note, which no element has had since OXE-281.

const workspace = { id: 'ws', name: 'demo', rootPath: '/repo', themeId: 'midnight', uiDensity: 'compact', layoutPreset: 4, defaultShellProfileId: 'sh', panes: [] } as unknown as Workspace
function renderCenter(onClose = vi.fn()) {
  render(<SettingsCenter initialPage="general" workspaces={[workspace]} shellProfiles={[]} onSave={vi.fn(async () => undefined)} onClose={onClose}
    agentProfiles={[]} agentReadiness={[]} isDiscoveringAgents={false} onDiscoverAgents={vi.fn()} onConfigureAgent={vi.fn()} onNewCustomAgent={vi.fn()} />)
  return onClose
}

describe('OXE-312 · Settings close is a src/ui IconButton; no orphan settings-scope-note rule', () => {
  afterEach(async () => {
    cleanup()
    delete document.documentElement.dataset.theme
    delete document.documentElement.dataset.density
    await changeLanguage('en')
  })

  test('SettingsCenter renders src/ui IconButton for close action and NavigationChrome has no orphan settings-scope-note rule', async () => {
    for (const [locale, label] of [['en', 'Close settings'], ['pt-BR', 'Fechar configurações']] as const) {
      await changeLanguage(locale)
      for (const theme of ['light', 'dark'] as const) for (const density of ['compact', 'comfortable'] as const) {
        document.documentElement.dataset.theme = theme
        document.documentElement.dataset.density = density
        const onClose = renderCenter()
        const close = screen.getByRole('button', { name: label })
        expect(close).toHaveAttribute('data-ui', 'icon-button')
        expect(close.closest('.settings-center-toolbar')).not.toBeNull()
        fireEvent.click(close)
        expect(onClose).toHaveBeenCalled()
        cleanup()
      }
    }
    const tsx = readFileSync(join(process.cwd(), 'src/components/Settings/SettingsCenter.tsx'), 'utf8')
    expect(tsx).not.toMatch(/<button type="button" aria-label=\{t\('center\.close'\)\}/)
    const chrome = readFileSync(join(process.cwd(), 'src/components/Navigation/NavigationChrome.css'), 'utf8')
    expect(chrome).not.toContain('.settings-scope-note')
  })
})
