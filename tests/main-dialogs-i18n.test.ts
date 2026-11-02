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
const { nativeApproval, NATIVE_TEXT_MAX } = await import('../electron/main/services/approvals/native-approval')
const { boundAgentText } = await import('../shared/approval-rules')
const { mainMessage } = await import('../shared/messages')
const { actionQuestion, previewRequester } = await import('../electron/main/services/documentation/preview-automation')
type Request = import('../shared/types/approvals').ApprovalRequest

/** The system dialog is the approval center's fallback only (B10); it speaks the same C3 codes. */
const request = (patch: Partial<Request> = {}): Request => ({
  schemaVersion: 1, id: 'r1', generation: 1, kind: 'oxequery', risk: 'low', ackRequired: false, allowDelayMs: 0, enterDisabled: false,
  requester: { kind: 'agent', id: 'thread:t1', label: mainMessage('approvals.requester.conversation', { agent: 'Claude', conversation: 't1' }) },
  title: mainMessage('approvals.title.oxequery', {}), summary: mainMessage('approvals.summary.oxequery.read', {}), target: 'db · postgres · dev',
  appNotes: [mainMessage('approvals.note.production', {})], agentText: boundAgentText('SELECT 1'),
  options: [
    { id: 'deny', label: mainMessage('approvals.option.deny', {}), intent: 'deny' },
    { id: 'allow-once', label: mainMessage('approvals.option.allowOnce', {}), intent: 'allow' },
    { id: 'allow-session', label: mainMessage('approvals.option.allowSessionReads', {}), intent: 'allow-session' }
  ],
  defaultOptionId: 'deny', createdAt: 0, expiresAt: 1, ...patch
})

async function ask(patch: Partial<Request> = {}, reason: 'no-window' | 'unavailable' | 'no-ack' = 'no-window'): Promise<MessageBoxOptions> {
  showMessageBox.mockClear()
  await nativeApproval(request(patch), reason, new AbortController().signal)
  return showMessageBox.mock.calls[0]![0] as MessageBoxOptions
}

describe('native dialogs in the interface language', () => {
  beforeEach(() => { setMainLanguage('en') })

  it('words the fallback dialog from C3 codes in the interface language, and keeps the requester text as written', async () => {
    const english = await ask()
    expect(english.buttons).toEqual(['Deny', 'Allow once', 'Allow reads on this connection for this run'])
    expect(english.defaultId).toBe(0)
    expect(english.cancelId).toBe(0)
    expect(english.title).toBe('OxeQuery · request from an agent')
    setMainLanguage('pt-BR')
    const portuguese = await ask()
    expect(portuguese.buttons).toEqual(['Negar', 'Permitir uma vez', 'Permitir leituras nesta conexão nesta execução'])
    expect(portuguese.title).toBe('OxeQuery · pedido de um agente')
    expect(portuguese.message).toBe('Quer ler dados')
    expect(portuguese.detail).toContain('Claude · conversa t1')
    expect(portuguese.detail).toContain('Esta é uma conexão de produção.')
    expect(portuguese.detail).toContain('SELECT 1')
  })

  it('says why it is asking natively when the window could not show the modal', async () => {
    expect((await ask({}, 'unavailable')).detail).toContain('The approval could not be shown in the app')
  })

  it('never offers Allow for a text it may not show whole (Windows drops a long detail)', async () => {
    const long = await ask({ agentText: boundAgentText('x'.repeat(NATIVE_TEXT_MAX + 1)) })
    expect(long.buttons).toEqual(['Deny'])
    expect(long.detail).not.toContain('x'.repeat(100))
  })

  it('names a preview call with no owner as the app\'s preview automation, not an unknown pane', () => {
    expect(previewRequester(undefined, 'ws-1')).toEqual({ kind: 'agent', id: 'workspace:ws-1', label: { code: 'approvals.requester.preview', params: {} } })
    expect(previewRequester({ kind: 'pane', id: 'p1' }, 'ws-1').id).toBe('pane:p1')
  })

  it('makes a critical request deny-only in the system dialog, which cannot hold Allow back', async () => {
    const critical = await ask({ risk: 'critical', allowDelayMs: 2_000, enterDisabled: true })
    expect(critical.buttons).toEqual(['Deny'])
    expect(critical.detail).toContain('the system dialog cannot hold Allow back')
    // Even a dialog that somehow answers "Allow" counts as deny.
    showMessageBox.mockResolvedValueOnce({ response: 1, checkboxChecked: false })
    expect(await nativeApproval(request({ risk: 'critical', allowDelayMs: 2_000, enterDisabled: true }), 'no-window', new AbortController().signal)).toBe('deny')
  })

  it('maps each answer to its option id, Deny being the default', async () => {
    for (const [response, optionId] of [[0, 'deny'], [1, 'allow-once'], [2, 'allow-session'], [7, 'deny']] as const) {
      showMessageBox.mockResolvedValueOnce({ response, checkboxChecked: false })
      expect(await nativeApproval(request(), 'no-window', new AbortController().signal)).toBe(optionId)
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
