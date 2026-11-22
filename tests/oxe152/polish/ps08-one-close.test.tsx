// Acceptance test for 1.5.2 Polimento · Configurações (Jira OXE-232, PS-08·1, CA-1 & CA-2).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsCenter, type AppPage } from '../../../src/components/Settings/SettingsCenter'
import { changeLanguage } from '../../../src/i18n'

const PAGES_WITH_HEADER: readonly AppPage[] = [
  'appearance',
  'providers',
  'notifications',
  'terminal',
  'diagnostics',
  'about'
]

/** Each page's own title, which only its mounted content has; the Settings title sits outside the content region. */
const PAGE_TITLE_ID: Readonly<Record<string, string>> = {
  appearance: 'settings-appearance-title',
  providers: 'settings-providers-title',
  notifications: 'settings-notifications-title',
  terminal: 'settings-terminal-title',
  diagnostics: 'settings-diagnostics-title',
  about: 'settings-updates-title'
}

afterEach(async () => {
  cleanup()
  await changeLanguage('en')
})

describe('OXE-232 (PS-08·1): one close button on every Settings page', () => {
  it('every Settings page shows one close button, in en and pt-BR', async () => {
    for (const [locale, closePattern] of [['en', /close/i], ['pt-BR', /fechar/i]] as const) {
      await changeLanguage(locale)
      for (const page of PAGES_WITH_HEADER) {
        cleanup()
        render(
          <SettingsCenter
            workspaces={[]}
            initialPage={page}
            shellProfiles={[]}
            allowWorkspaceScope={false}
            agentProfiles={[]}
            agentReadiness={[]}
            isDiscoveringAgents={false}
            onClose={vi.fn()}
            onDiscoverAgents={vi.fn()}
            onConfigureAgent={vi.fn()}
            onNewCustomAgent={vi.fn()}
            onSave={vi.fn().mockResolvedValue(undefined)}
          />
        )
        const dialog = screen.getByRole('dialog')
        // Wait for the lazy SettingsContent page to mount inside the region.
        await waitFor(() => expect(
          dialog.querySelector(`.settings-center-content #${PAGE_TITLE_ID[page]}`),
          `${locale} › ${page} never mounted`
        ).not.toBeNull(), { timeout: 10_000 })
        const closeButtons = within(dialog).getAllByRole('button', { name: closePattern })
        expect(closeButtons, `${locale} › ${page} should have exactly one close button`).toHaveLength(1)
      }
    }
  }, 60_000)

  it('the redundant X leaves SettingsContentHeader and no CSS selector reads a translated aria-label', () => {
    const modalSource = readFileSync(join(process.cwd(), 'src/components/Settings/SettingsModal.tsx'), 'utf8')
    const headerMatch = modalSource.match(/function SettingsContentHeader\b[\s\S]*?^}/m)
    expect(headerMatch, 'SettingsContentHeader function exists').not.toBeNull()
    expect(headerMatch![0]).not.toContain("t('header.close')")
    expect(headerMatch![0]).not.toContain('<X ')

    const css = readFileSync(join(process.cwd(), 'src/components/Settings/SettingsCenter.css'), 'utf8')
    expect(css).not.toMatch(/\[aria-label\s*=/)
  })
})
