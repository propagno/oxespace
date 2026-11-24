import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { FirstRun, type FirstRunProps } from '../../../src/components/Onboarding/FirstRun'
import { changeLanguage } from '../../../src/i18n'

// OXE-313: for a signed-out agent the status signal read "Codex: Sign in to Codex" ("Codex: Entrar no Codex"), the
// provider twice and an action in a state. The signal names the state; the Sign in button keeps the action.

function props(): FirstRunProps {
  return {
    folder: null,
    agents: [{ provider: 'codex', status: 'signed-out' }],
    onOpenFolder: vi.fn(),
    onSignIn: vi.fn(),
    onCancelSignIn: vi.fn(),
    onNewConversation: vi.fn(),
    onOpenMode: vi.fn(),
    onNewWorkspace: vi.fn()
  }
}

afterEach(async () => {
  cleanup()
  await changeLanguage('en')
})

describe('OXE-313 · FirstRun signed-out status signal', () => {
  for (const [lang, state, action] of [['en', 'Codex: Signed out', 'Sign in to Codex'], ['pt-BR', 'Codex: Desconectado', 'Entrar no Codex']] as const) {
    test(`FirstRun StatusSignal uses neutral signed-out state label without echoing provider name (${lang})`, async () => {
      await changeLanguage(lang)
      render(<FirstRun {...props()} />)
      const signal = screen.getByRole('img', { name: state })
      expect(signal.getAttribute('aria-label')!.match(/Codex/g)).toHaveLength(1)
      // The action stays on the button, with its full name.
      expect(screen.getByRole('button', { name: action })).toBeInTheDocument()
      expect(screen.queryByRole('img', { name: `Codex: ${action}` })).toBeNull()
    })
  }
})
