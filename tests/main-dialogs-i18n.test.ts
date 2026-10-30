// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MessageBoxOptions } from 'electron'

const showMessageBox = vi.fn(async (..._args: unknown[]) => ({ response: 0, checkboxChecked: false }))
vi.mock('electron', () => ({
  app: { isReady: () => true, getLocale: () => 'en' },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  dialog: { showMessageBox: (...args: unknown[]) => showMessageBox(...args) }
}))
// The preview service drives real web contents; the dialog wording does not need it.
vi.mock('../electron/main/services/browser-preview.service', () => ({ browserPreviewService: {} }))

process.env.OXESPACE_LOCALE = 'en'
const { setMainLanguage } = await import('../electron/main/i18n')
const { nativeApprovalPrompter } = await import('../electron/main/services/agent-actions/approval-prompter')
const { actionQuestion } = await import('../electron/main/services/documentation/preview-automation')

const request = (patch: Record<string, unknown> = {}) => ({
  id: 'r1', actor: 'thread:t1', tool: 'oxequery.read', title: 'OxeQuery — request from an agent', summary: 'thread:t1 wants to read',
  target: 'db · postgres · dev', risk: 'read' as const, text: 'SELECT 1', hash: 'h', reasons: ['Agent-specific warning'], expiresAt: 0, ...patch
})

async function ask(patch: Record<string, unknown> = {}): Promise<MessageBoxOptions> {
  showMessageBox.mockClear()
  await nativeApprovalPrompter.ask(request(patch), new AbortController().signal)
  return showMessageBox.mock.calls[0]![0] as MessageBoxOptions
}

describe('native dialogs in the interface language', () => {
  beforeEach(() => { setMainLanguage('en') })

  it('words the approval buttons and leaves the request text as the requester wrote it', async () => {
    const english = await ask()
    expect(english.buttons).toEqual(['Deny', 'Allow once', 'Allow reads like this for this run'])
    expect(english.defaultId).toBe(0)
    expect(english.cancelId).toBe(0)
    setMainLanguage('pt-BR')
    const portuguese = await ask()
    expect(portuguese.buttons).toEqual(['Negar', 'Permitir uma vez', 'Permitir leituras como esta nesta execução'])
    expect(portuguese.title).toBe('OxeQuery — request from an agent')
    expect(portuguese.message).toBe('thread:t1 wants to read')
    expect(portuguese.detail).toContain('Agent-specific warning')
    expect(portuguese.detail).toContain('SELECT 1')
  })

  it('offers no session answer for a write, and keeps a session label the requester gave', async () => {
    setMainLanguage('pt-BR')
    expect((await ask({ risk: 'write' })).buttons).toEqual(['Negar', 'Permitir uma vez'])
    expect((await ask({ sessionLabel: 'Allow reads on this connection for this run' })).buttons?.[2]).toBe('Allow reads on this connection for this run')
  })

  it('maps each answer of the approval dialog, Deny being the default', async () => {
    for (const [response, decision] of [[0, 'deny'], [1, 'allow-once'], [2, 'allow-session'], [7, 'deny']] as const) {
      showMessageBox.mockResolvedValueOnce({ response, checkboxChecked: false })
      expect(await nativeApprovalPrompter.ask(request(), new AbortController().signal)).toBe(decision)
    }
  })

  it('asks a question per Web Preview action, and names an unexpected one rather than inventing words', () => {
    expect(actionQuestion('click')).toBe('Allow the agent to click in the Browser?')
    expect(actionQuestion('navigate')).toBe('Allow the agent to open another page in the Browser?')
    setMainLanguage('pt-BR')
    expect(actionQuestion('fill')).toBe('Permitir que o agente digite em um campo do Navegador?')
    expect(actionQuestion('scroll')).toBe('Permitir que o agente role a página no Navegador?')
    expect(actionQuestion('wait')).toBe('Permitir que o agente execute "wait" no Navegador?')
  })
})
