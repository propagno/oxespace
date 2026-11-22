import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Workspace } from '../../../shared/types/workspace'
import { SEEN_HOSTS_KEY, seenHosts } from '../../../src/lib/externalLinks'
import { SeenSitesSetting } from '../../../src/components/Settings/SeenSitesSetting'
import { SettingsCenter } from '../../../src/components/Settings/SettingsCenter'
import { changeLanguage, i18n } from '../../../src/i18n'

const workspace = {
  id: 'ws',
  name: 'demo',
  rootPath: '/repo',
  themeId: 'midnight',
  uiDensity: 'compact',
  layoutPreset: 4,
  defaultShellProfileId: 'sh',
  panes: []
} as unknown as Workspace

function renderCenter(onClose = vi.fn()): void {
  render(
    <SettingsCenter
      initialPage="general"
      workspaces={[workspace]}
      shellProfiles={[]}
      onSave={vi.fn(async () => undefined)}
      onClose={onClose}
      agentProfiles={[]}
      agentReadiness={[]}
      isDiscoveringAgents={false}
      onDiscoverAgents={vi.fn()}
      onConfigureAgent={vi.fn()}
      onNewCustomAgent={vi.fn()}
    />
  )
}

describe('OXE-281 PE-09·D Settings once & Clear list', () => {
  afterEach(async () => {
    cleanup()
    localStorage.clear()
    delete document.documentElement.dataset.theme
    delete document.documentElement.dataset.density
    vi.restoreAllMocks()
    await changeLanguage('en')
  })

  test('omits redundant Settings > Application breadcrumb while keeping page title, active nav row and close button', async () => {
    for (const [locale, expectedTitle, closeLabel] of [
      ['pt-BR', 'Geral', 'Fechar configurações'],
      ['en', 'General', 'Close settings']
    ] as const) {
      await changeLanguage(locale)
      for (const theme of ['light', 'dark'] as const) {
        for (const density of ['compact', 'comfortable'] as const) {
          document.documentElement.dataset.theme = theme
          document.documentElement.dataset.density = density

          const onClose = vi.fn()
          renderCenter(onClose)

          const dialog = screen.getByRole('dialog')
          const toolbar = dialog.querySelector<HTMLElement>('.settings-center-toolbar')!
          expect(toolbar).not.toBeNull()
          // Zero redundant "Settings › Application" / "Configurações › Aplicativo" breadcrumb.
          expect(toolbar.querySelectorAll('div, span')).toHaveLength(0)
          expect(toolbar.textContent?.trim()).toBe('')

          const closeBtn = within(toolbar).getByRole('button', { name: closeLabel })
          expect(closeBtn).toBeVisible()

          // Page title and active nav row communicate location.
          const pageTitle = dialog.querySelector<HTMLElement>('[data-ui="settings-page-title"]')!
          expect(pageTitle.textContent?.trim()).toBe(expectedTitle)

          const nav = within(dialog).getByRole('navigation')
          const activeNav = nav.querySelector<HTMLElement>('button[aria-current="page"]')!
          expect(activeNav).not.toBeNull()
          expect(activeNav.textContent?.trim()).toBe(expectedTitle)

          // Ctrl+F still focuses the search box (RT-2).
          const search = within(dialog).getByRole('searchbox')
          fireEvent.keyDown(window, { key: 'f', ctrlKey: true })
          expect(document.activeElement).toBe(search)

          fireEvent.click(closeBtn)
          expect(onClose).toHaveBeenCalledTimes(1)

          cleanup()
        }
      }
    }
  })

  test('shows auto-save note once in page footer and removes scope/auto-save repetition in pt-BR and en', async () => {
    for (const [locale, forbiddenScope, forbiddenAutoSave] of [
      ['pt-BR', /vale (em|para) todos os workspaces/i, /(alterações são aplicadas automaticamente|mudanças valem na hora)/i],
      ['en', /applies across( all)? workspaces/i, /changes (are applied|apply) automatically/i]
    ] as const) {
      await changeLanguage(locale)
      renderCenter()

      const dialog = screen.getByRole('dialog')
      const navFooter = dialog.querySelector<HTMLElement>('.settings-nav-footer')!
      expect(navFooter).not.toBeNull()
      expect(navFooter.querySelectorAll('.settings-scope-note')).toHaveLength(0)
      expect(navFooter.textContent ?? '').not.toMatch(forbiddenScope)

      // Individual row descriptions in General do not repeat auto-save.
      const rows = [...dialog.querySelectorAll<HTMLElement>('[data-ui="setting-row"]')]
      expect(rows.length).toBeGreaterThan(0)
      for (const row of rows) {
        expect(row.textContent ?? '').not.toMatch(forbiddenAutoSave)
      }

      // Single auto-save note in the page footer.
      const notes = dialog.querySelectorAll<HTMLElement>('footer.settings-auto-apply-note')
      expect(notes).toHaveLength(1)
      expect(notes[0].textContent?.trim()).toBe(i18n.t('center.autoApplyNote', { ns: 'settings' }))

      cleanup()
    }

    const css = readFileSync(join(process.cwd(), 'src/components/Settings/SettingsCenter.css'), 'utf8')
    expect(css).toMatch(/\.settings-auto-apply-note\s*\{[^}]*font-size:\s*var\(--fs-xs\)/)
  })

  test('renders Clear list button label with full accessible aria-label in SeenSitesSetting', async () => {
    for (const [locale, visibleLabel, accessibleLabel] of [
      ['pt-BR', 'Limpar lista', 'Limpar lista de sites que você abriu'],
      ['en', 'Clear list', "Clear list of sites you've opened"]
    ] as const) {
      await changeLanguage(locale)
      localStorage.setItem(SEEN_HOSTS_KEY, JSON.stringify(['example.com']))

      render(<SeenSitesSetting />)

      const button = screen.getByRole('button', { name: accessibleLabel })
      expect(button).toHaveTextContent(visibleLabel)
      expect(button).toHaveAttribute('aria-label', accessibleLabel)
      expect(button).toBeEnabled()

      fireEvent.click(button)
      expect(seenHosts()).toEqual([])
      expect(button).toBeDisabled()

      cleanup()
    }
  })
})
