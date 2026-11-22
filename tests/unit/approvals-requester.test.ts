import { afterEach, describe, expect, it, vi } from 'vitest'
import { noticeTitle } from '../../electron/main/services/approvals/drafts'
import { paneInfo, requesterFor, sanitizeProcessName, setRequesterLookup } from '../../electron/main/services/approvals/requester'
import { setMainLanguage, tMain } from '../../electron/main/i18n'
import { messageKey, messageValues } from '../../shared/messages'
import type { WorkspacePane } from '../../shared/types/workspace'

vi.mock('electron', () => ({
  app: { isReady: () => false, getLocale: () => 'en-US' }
}))

function makePane(overrides: Partial<WorkspacePane> = {}): WorkspacePane {
  return {
    id: 'p1',
    workspaceId: 'ws-1',
    type: 'terminal',
    rowIndex: 0,
    columnIndex: 0,
    shellProfileId: 'builtin-powershell',
    status: 'running',
    agentProfileId: null,
    agentName: null,
    displayName: 'Claude',
    createdAt: null,
    rootPath: null,
    ...overrides
  }
}

describe('OXE-293 · approvals requester process naming', () => {
  afterEach(() => {
    setRequesterLookup(undefined)
    setMainLanguage('en')
  })

  it('names a plain-script pane by its foreground process and pane number instead of Unknown agent in en and pt-BR', () => {
    const workspaces = [{ panes: [makePane({ id: 'p1', rowIndex: 0, columnIndex: 0 }), makePane({ id: 'p2', rowIndex: 0, columnIndex: 1 })] }]
    setRequesterLookup(owner =>
      paneInfo(owner.id, workspaces, () => undefined, paneId => (paneId === 'p1' ? 'C:\\Program Files\\nodejs\\node.exe agent.js' : '/usr/bin/python3 worker.py'))
    )

    const nodeReq = requesterFor({ kind: 'pane', id: 'p1' })
    const pyReq = requesterFor({ kind: 'pane', id: 'p2' })

    expect(nodeReq).toEqual({
      kind: 'agent',
      id: 'pane:p1',
      label: { code: 'approvals.requester.paneProcess', params: { process: 'node', pane: 1 } }
    })
    expect(pyReq).toEqual({
      kind: 'agent',
      id: 'pane:p2',
      label: { code: 'approvals.requester.paneProcess', params: { process: 'python3', pane: 2 } }
    })

    setMainLanguage('en')
    const enNode = tMain(messageKey(nodeReq.label.code) as never, messageValues(nodeReq.label, 'en'))
    const enPy = tMain(messageKey(pyReq.label.code) as never, messageValues(pyReq.label, 'en'))
    expect(enNode).toBe('node · pane 1')
    expect(enPy).toBe('python3 · pane 2')
    expect(enNode).not.toContain('Unknown agent')

    setMainLanguage('pt-BR')
    const ptNode = tMain(messageKey(nodeReq.label.code) as never, messageValues(nodeReq.label, 'pt-BR'))
    const ptPy = tMain(messageKey(pyReq.label.code) as never, messageValues(pyReq.label, 'pt-BR'))
    expect(ptNode).toBe('node · painel 1')
    expect(ptPy).toBe('python3 · painel 2')
    expect(ptNode).not.toContain('Agente desconhecido')

    // Notification title also formats paneProcess cleanly instead of falling back to pane 0 unknownPane.
    expect(noticeTitle(nodeReq, 'Needs review')).toEqual({
      code: 'notify.prefix.pane',
      params: { agent: 'node', pane: 1, title: 'Needs review' }
    })
  })

  it('keeps recognized agent labels unchanged and falls back to unknownPane only when no process is known', () => {
    const workspaces = [{
      panes: [
        makePane({ id: 'claude-pane', rowIndex: 0, columnIndex: 0, agentProfileId: 'prof-claude' }),
        makePane({ id: 'codex-pane', rowIndex: 0, columnIndex: 1, agentProfileId: 'prof-codex' }),
        makePane({ id: 'spoof-pane', rowIndex: 1, columnIndex: 0, agentProfileId: null }),
        makePane({ id: 'empty-pane', rowIndex: 1, columnIndex: 1, agentProfileId: null })
      ]
    }]
    const providers: Record<string, string> = { 'prof-claude': 'claude', 'prof-codex': 'codex' }
    const processes: Record<string, string | undefined> = {
      'claude-pane': 'node',
      'codex-pane': 'node',
      'spoof-pane': 'C:\\tmp\\claude.exe',
      'empty-pane': undefined
    }

    setRequesterLookup(owner => {
      if (owner.kind === 'thread') return { agent: 'Claude' }
      return paneInfo(owner.id, workspaces, id => providers[id], paneId => processes[paneId])
    })

    // Recognized agents stay on approvals.requester.pane / conversation.
    expect(requesterFor({ kind: 'pane', id: 'claude-pane' })).toEqual({
      kind: 'agent',
      id: 'pane:claude-pane',
      label: { code: 'approvals.requester.pane', params: { agent: 'Claude', pane: 1 } }
    })
    expect(requesterFor({ kind: 'pane', id: 'codex-pane' })).toEqual({
      kind: 'agent',
      id: 'pane:codex-pane',
      label: { code: 'approvals.requester.pane', params: { agent: 'Codex', pane: 2 } }
    })
    expect(requesterFor({ kind: 'thread', id: 'abcdef123456' })).toEqual({
      kind: 'agent',
      id: 'thread:abcdef123456',
      label: { code: 'approvals.requester.conversation', params: { agent: 'Claude', conversation: 'abcdef' } }
    })

    // Unbound executable masquerading as a reserved agent provider name is rejected -> unknownPane.
    expect(requesterFor({ kind: 'pane', id: 'spoof-pane' })).toEqual({
      kind: 'agent',
      id: 'pane:spoof-pane',
      label: { code: 'approvals.requester.unknownPane', params: { pane: 3 } }
    })

    // Unbound pane with no foreground process -> unknownPane.
    expect(requesterFor({ kind: 'pane', id: 'empty-pane' })).toEqual({
      kind: 'agent',
      id: 'pane:empty-pane',
      label: { code: 'approvals.requester.unknownPane', params: { pane: 4 } }
    })
  })

  it('sanitizes executable basenames strictly, caps length at 32 chars, and rejects reserved provider names', () => {
    expect(sanitizeProcessName('"C:\\Program Files\\nodejs\\node.exe" script.js')).toBe('node')
    expect(sanitizeProcessName('C:\\Program Files\\PowerShell\\7\\pwsh.exe')).toBe('pwsh')
    expect(sanitizeProcessName('& "/opt/bin/python3.12" -u run.py')).toBe('python3.12')
    expect(sanitizeProcessName('my-tool$bad;rm.cmd')).toBe('my-toolbadrm')
    expect(sanitizeProcessName('a'.repeat(50))).toHaveLength(32)
    expect(sanitizeProcessName('...')).toBeUndefined()
    expect(sanitizeProcessName('   ')).toBeUndefined()

    for (const reserved of ['claude', 'Claude.exe', 'C:\\tools\\codex.cmd', 'copilot', 'gh-copilot', 'cursor', 'grok', 'antigravity', 'agy.ps1']) {
      expect(sanitizeProcessName(reserved), reserved).toBeUndefined()
    }
  })
})
