// @vitest-environment jsdom
// Acceptance test for 1.5.2/1.5.3 PE-09·F (Jira OXE-283): OxeQuery says each thing once (Activity heading + concise ConnectionDialog labels).
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { ActivityPanel } from '../../../src/components/OxeQuery/ActivityPanel'
import { ConnectionDialog } from '../../../src/components/OxeQuery/ConnectionDialog'
import { OxeQueryView } from '../../../src/components/OxeQuery/OxeQueryView'
import { loadOxeQueryCatalog } from '../../../src/components/OxeQuery/catalog'
import { useOxeQueryStore } from '../../../src/components/OxeQuery/oxequery.store'
import { changeLanguage } from '../../../src/i18n'
import { installFakeOxeQuery, type FakeOxeQuery } from '../../helpers/oxequery-api'

let api: FakeOxeQuery

beforeEach(async () => {
  await loadOxeQueryCatalog()
  await changeLanguage('en')
  api = installFakeOxeQuery()
  api.on('connections.list', [])
  api.on('audit.list', { entries: [], hasMore: false, cursor: null })
  useOxeQueryStore.setState({
    connections: [],
    tabs: [],
    activeTab: '',
    dialog: { open: false, editing: null },
    newDatabaseOpen: false
  })
})

afterEach(async () => {
  cleanup()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-density')
  act(() => {
    useOxeQueryStore.setState({
      tabs: [],
      activeTab: '',
      dialog: { open: false, editing: null },
      newDatabaseOpen: false
    })
  })
  await changeLanguage('en')
})

describe('OXE-283 · PE-09·F OxeQuery says each thing once', () => {
  test('renders Activity view with a single visible heading and preserves section aria-label across themes and densities', async () => {
    const locales: Array<{ lang: 'pt-BR' | 'en'; tabLabel: string; sectionLabel: string }> = [
      { lang: 'pt-BR', tabLabel: 'Atividade', sectionLabel: 'Atividade dos agentes' },
      { lang: 'en', tabLabel: 'Activity', sectionLabel: 'Agent activity' }
    ]

    for (const { lang, tabLabel, sectionLabel } of locales) {
      await changeLanguage(lang)
      for (const theme of ['light', 'dark'] as const) {
        for (const density of ['compact', 'comfortable'] as const) {
          document.documentElement.setAttribute('data-theme', theme)
          document.documentElement.setAttribute('data-density', density)

          useOxeQueryStore.setState({
            tabs: [{ id: 'activity', kind: 'activity' }],
            activeTab: 'activity'
          })

          const { unmount } = render(<OxeQueryView active />)
          const region = await screen.findByRole('region', { name: sectionLabel })
          expect(region).toHaveAttribute('aria-label', sectionLabel)

          // The Activity tab itself is the single visible title for the surface.
          expect(screen.getByRole('tab', { name: tabLabel })).toBeInTheDocument()
          const header = region.querySelector<HTMLElement>('.oq-activity-head')!
          expect(header, `${lang}/${theme}/${density}: activity header`).not.toBeNull()
          expect(header.querySelectorAll('strong'), `${lang}/${theme}/${density}: no duplicate heading inside tab`).toHaveLength(0)
          expect(header.textContent ?? '').not.toContain(sectionLabel)

          unmount()
        }
      }

      // Standalone ActivityPanel (e.g., OxePod scope="containers" without tab bar) keeps its visible heading.
      const { unmount } = render(<ActivityPanel active scope="containers" />)
      const standalone = await screen.findByRole('region', { name: sectionLabel })
      expect(within(standalone.querySelector<HTMLElement>('.oq-activity-head')!).getByText(sectionLabel)).toBeInTheDocument()
      unmount()
    }
  })

  test('uses concise Mode label and footer button labels in ConnectionDialog in pt-BR and en', async () => {
    const locales: Array<{
      lang: 'pt-BR' | 'en'
      dialogTitle: string
      modeLabel: string
      modeAria: string
      footerTexts: string[]
      testAria: string
      connectOnceAria: string
    }> = [
      {
        lang: 'pt-BR',
        dialogTitle: 'Nova conexão',
        modeLabel: 'Modo',
        modeAria: 'Conectar por',
        footerTexts: ['Testar', 'Abrir sem salvar', 'Cancelar', 'Salvar e abrir'],
        testAria: 'Testar conexão',
        connectOnceAria: 'Abrir sem salvar esta conexão'
      },
      {
        lang: 'en',
        dialogTitle: 'New connection',
        modeLabel: 'Mode',
        modeAria: 'Connect by',
        footerTexts: ['Test', 'Open without saving', 'Cancel', 'Save and open'],
        testAria: 'Test connection',
        connectOnceAria: 'Open without saving this connection'
      }
    ]

    for (const cfg of locales) {
      await changeLanguage(cfg.lang)
      const { unmount } = render(<ConnectionDialog />)
      act(() => useOxeQueryStore.getState().openDialog(null))

      const dialog = await screen.findByRole('dialog', { name: cfg.dialogTitle })

      // Mode label is concise ("Modo" / "Mode") while SegmentedControl keeps full aria-label ("Conectar por" / "Connect by").
      const modeRow = dialog.querySelector<HTMLElement>('.oq-connect-by')!
      expect(modeRow.querySelector('span')?.textContent?.trim()).toBe(cfg.modeLabel)
      expect(within(modeRow).getByRole('radiogroup', { name: cfg.modeAria })).toBeInTheDocument()

      // Footer buttons display exact concise labels in U1 order and preserve full aria-labels where shortened.
      const footer = dialog.querySelector<HTMLElement>('[data-dialog-footer]')!
      const buttons = [...footer.querySelectorAll<HTMLButtonElement>('button')]
      expect(buttons.map(btn => btn.textContent?.trim())).toEqual(cfg.footerTexts)

      const testBtn = within(footer).getByRole('button', { name: cfg.testAria })
      expect(testBtn.textContent?.trim()).toBe(cfg.footerTexts[0])
      expect(testBtn).toHaveAttribute('aria-label', cfg.testAria)

      const onceBtn = within(footer).getByRole('button', { name: cfg.connectOnceAria })
      expect(onceBtn.textContent?.trim()).toBe(cfg.footerTexts[1])
      expect(onceBtn).toHaveAttribute('aria-label', cfg.connectOnceAria)

      await waitFor(() => expect(within(footer).getByRole('button', { name: cfg.footerTexts[3] })).toBeInTheDocument())
      unmount()
    }
  })
})
