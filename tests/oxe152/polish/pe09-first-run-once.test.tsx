import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { FirstRun, type FirstRunProps } from '../../../src/components/Onboarding/FirstRun'
import { NoWorkspaceStart } from '../../../src/components/Onboarding/NoWorkspaceStart'
import { changeLanguage, i18n } from '../../../src/i18n'

function makeFirstRunProps(overrides: Partial<FirstRunProps> = {}): FirstRunProps {
  return {
    folder: null,
    agents: [
      { provider: 'claude', status: 'signed-out' },
      { provider: 'codex', status: 'signed-out' }
    ],
    onOpenFolder: vi.fn(),
    onSignIn: vi.fn(),
    onCancelSignIn: vi.fn(),
    onNewConversation: vi.fn(),
    onOpenMode: vi.fn(),
    onNewWorkspace: vi.fn(),
    ...overrides
  }
}

const THEMES = ['light', 'dark'] as const
const DENSITIES = ['compact', 'comfortable'] as const

afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-density')
  await changeLanguage('en')
})

describe('OXE-282 · PE-09.E first-run hero and short Sign in label', () => {
  test('renders hero title without heroLead step narration in FirstRun and NoWorkspaceStart across themes and densities', async () => {
    const narrationSnippets = [
      'Escolha uma pasta de projeto, conecte o Claude Code ou o Codex',
      'Pick a project folder, connect Claude Code or Codex'
    ]

    for (const theme of THEMES) {
      for (const density of DENSITIES) {
        document.documentElement.setAttribute('data-theme', theme)
        document.documentElement.setAttribute('data-density', density)

        for (const lang of ['pt-BR', 'en'] as const) {
          await changeLanguage(lang)
          const firstRunView = render(<FirstRun {...makeFirstRunProps()} />)
          const root = screen.getByTestId('first-run')
          const header = root.querySelector('header')
          expect(header).not.toBeNull()
          const title = header!.querySelector('[data-ui="first-run-title"]')
          expect(title).not.toBeNull()
          expect(title!.tagName).toBe('H1')
          expect(title!.textContent?.trim()).toBe(i18n.t('firstRun.v2.heroTitle'))
          expect(header!.querySelectorAll('p'), `${theme}/${density}/${lang} should render 0 heroLead paragraphs`).toHaveLength(0)
          for (const snippet of narrationSnippets) {
            expect(root.textContent ?? '').not.toContain(snippet)
          }
          firstRunView.unmount()

          const emptyView = render(
            <NoWorkspaceStart onNewWorkspace={vi.fn()} onSelectMode={vi.fn()} onAddProject={vi.fn()} />
          )
          expect(screen.queryByTestId('first-run-checklist')).toBeNull()
          for (const snippet of narrationSnippets) {
            expect(document.body.textContent ?? '').not.toContain(snippet)
          }
          emptyView.unmount()
        }
      }
    }

    // BRD-12 enforced targets remain intact
    const brd12 = JSON.parse(readFileSync(resolve(process.cwd(), 'src/design/targets/brd-12.json'), 'utf8')) as {
      measures: Array<{ id: string; state: string }>
    }
    expect(brd12.measures.map(m => [m.id, m.state])).toEqual([
      ['BRD-12.title.font-size', 'enforced'],
      ['BRD-12.title.font-family', 'enforced'],
      ['BRD-12.title.font-weight', 'enforced']
    ])
  })

  test('renders short Sign in button label with provider-specific aria-label in pt-BR and en', async () => {
    const cases: Array<{
      lang: 'pt-BR' | 'en'
      visible: string
      claudeAria: string
      codexAria: string
    }> = [
      {
        lang: 'pt-BR',
        visible: 'Entrar',
        claudeAria: 'Entrar no Claude Code',
        codexAria: 'Entrar no Codex'
      },
      {
        lang: 'en',
        visible: 'Sign in',
        claudeAria: 'Sign in to Claude Code',
        codexAria: 'Sign in to Codex'
      }
    ]

    for (const item of cases) {
      await changeLanguage(item.lang)
      const onSignIn = vi.fn()
      const view = render(<FirstRun {...makeFirstRunProps({ onSignIn })} />)
      const steps = [...screen.getByTestId('first-run').querySelectorAll<HTMLElement>('[data-ui="first-run-step"]')]
      const agentStep = steps[1]

      const claudeButton = within(agentStep).getByRole('button', { name: item.claudeAria })
      const codexButton = within(agentStep).getByRole('button', { name: item.codexAria })

      expect(claudeButton.textContent?.trim()).toBe(item.visible)
      expect(claudeButton).toHaveAttribute('aria-label', item.claudeAria)
      expect(codexButton.textContent?.trim()).toBe(item.visible)
      expect(codexButton).toHaveAttribute('aria-label', item.codexAria)

      fireEvent.click(claudeButton)
      fireEvent.click(codexButton)
      expect(onSignIn.mock.calls).toEqual([['claude'], ['codex']])

      view.unmount()
    }
  })
})
