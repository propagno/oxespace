// OXE-327 ([OXE-132 · CA-4]) · Workspace access ceiling: min(workspaceCeiling, sessionAccess)
// enforced across ApprovalCenter, domain-tool, WorkspaceService persistence, and WorkspaceSettingsModal.
import { describe, expect, test, vi } from 'vitest'
import {
  WORKSPACE_ACCESS_LEVELS,
  accessRank,
  accessSatisfies,
  actionRequiredAccess,
  approvalRequiredAccess,
  effectiveAccess,
  isWorkspaceAccessLevel,
  type WorkspaceAccessLevel
} from '../../../shared/access-ceiling'
import { mainMessage } from '../../../shared/messages'
import { ApprovalCenter, type ApprovalDraft } from '../../../electron/main/services/approvals/approval-center'
import { ALLOW_ONCE, ALLOW_SESSION_READS, DENY } from '../../../electron/main/services/approvals/drafts'
import { domainTool, resolveScope } from '../../../electron/main/mcp-internal/domain-tool'
import { AgentActions } from '../../../electron/main/services/agent-actions/agent-actions'
import { ApprovalBroker } from '../../../electron/main/services/agent-actions/approval-broker'
import { centerApprovalPrompter } from '../../../electron/main/services/agent-actions/approval-prompter'
import { ExecutionRegistry } from '../../../electron/main/services/execution-registry'
import { parseUpdateWorkspaceSettingsInput } from '../../../electron/main/ipc/validation'
import type { ToolContext } from '../../../electron/main/mcp-internal/tool-registry'
import type { Workspace } from '../../../shared/types/workspace'
import type { WorkspaceService } from '../../../electron/main/services/workspace.service'

const AGENT_REQUESTER = {
  kind: 'agent' as const,
  id: 'pane:p1',
  label: mainMessage('approvals.requester.pane', { agent: 'Claude', pane: 1 })
}

function makeDraft(overrides: Partial<ApprovalDraft> = {}): ApprovalDraft {
  return {
    kind: 'mcp-confirm',
    requester: AGENT_REQUESTER,
    risk: 'medium',
    title: mainMessage('approvals.title.agent', {}),
    summary: mainMessage('approvals.summary.mcpConfirm', { tool: 'oxespace_demo', action: 'edit', target: '/repo' }),
    appNotes: [],
    text: 'edit /repo/file.ts',
    options: [DENY, ALLOW_ONCE],
    defaultOptionId: DENY.id,
    ...overrides
  }
}

function makeCenter(workspaceCeilingLookup?: (workspaceId: string) => WorkspaceAccessLevel | undefined) {
  const sent: Array<{ channel: string; payload: unknown }> = []
  const center = new ApprovalCenter({
    send: (channel, payload) => { sent.push({ channel, payload }) },
    hasWindow: () => true,
    native: vi.fn(async () => DENY.id),
    workspaceCeiling: workspaceCeilingLookup
  })
  return { center, sent }
}

function makeContext(options: {
  workspaceCeiling?: WorkspaceAccessLevel
  sessionAccess?: WorkspaceAccessLevel
  executionAccess?: WorkspaceAccessLevel
  agentActions?: AgentActions
} = {}): ToolContext {
  const executions = new ExecutionRegistry()
  const env = executions.register({
    paneId: 'pane-1',
    workspaceId: 'ws-1',
    cwd: '/repo',
    ...(options.executionAccess ? { access: options.executionAccess } : {})
  })
  const workspace: Workspace = {
    id: 'ws-1',
    name: 'Repo',
    rootPath: '/repo',
    layout: '2x2',
    layoutPreset: 4,
    themeId: 'midnight',
    uiDensity: 'default',
    defaultShellProfileId: 'builtin-pwsh',
    autoStart: false,
    isActive: true,
    color: null,
    accessCeiling: options.workspaceCeiling,
    panes: []
  }
  const workspaceServ = {
    get: (id: string) => (id === 'ws-1' ? workspace : null),
    list: () => [workspace]
  } as unknown as WorkspaceService
  return {
    workspaceId: 'ws-1',
    workspaceServ,
    executions,
    executionId: env.OXESPACE_EXECUTION_ID,
    executionToken: env.OXESPACE_EXECUTION_TOKEN,
    sessionAccess: options.sessionAccess,
    agentActions: options.agentActions,
    github: {} as ToolContext['github'],
    background: {} as ToolContext['background'],
    fileSystem: {} as ToolContext['fileSystem'],
    webPreview: {} as ToolContext['webPreview'],
    worktree: {} as ToolContext['worktree']
  }
}

describe('OXE-327 · shared access ceiling pure rules', () => {
  test('effectiveAccess returns min(workspaceCeiling, sessionAccess) across all 9 combinations', () => {
    const expected: Record<WorkspaceAccessLevel, Record<WorkspaceAccessLevel, WorkspaceAccessLevel>> = {
      'read-only': {
        'read-only': 'read-only',
        'workspace-write': 'read-only',
        'full-access': 'read-only'
      },
      'workspace-write': {
        'read-only': 'read-only',
        'workspace-write': 'workspace-write',
        'full-access': 'workspace-write'
      },
      'full-access': {
        'read-only': 'read-only',
        'workspace-write': 'workspace-write',
        'full-access': 'full-access'
      }
    }

    for (const ceiling of WORKSPACE_ACCESS_LEVELS) {
      for (const session of WORKSPACE_ACCESS_LEVELS) {
        expect(effectiveAccess(ceiling, session)).toBe(expected[ceiling][session])
        expect(accessRank(effectiveAccess(ceiling, session))).toBe(Math.min(accessRank(ceiling), accessRank(session)))
      }
    }
    expect(effectiveAccess(undefined, undefined)).toBe('full-access')
    expect(effectiveAccess(null, 'workspace-write')).toBe('workspace-write')
    expect(effectiveAccess('read-only', undefined)).toBe('read-only')
  })

  test('accessSatisfies, actionRequiredAccess, approvalRequiredAccess, and validation guard', () => {
    expect(isWorkspaceAccessLevel('read-only')).toBe(true)
    expect(isWorkspaceAccessLevel('workspace-write')).toBe(true)
    expect(isWorkspaceAccessLevel('full-access')).toBe(true)
    expect(isWorkspaceAccessLevel('admin')).toBe(false)

    expect(accessSatisfies('read-only', 'read-only')).toBe(true)
    expect(accessSatisfies('read-only', 'workspace-write')).toBe(false)
    expect(accessSatisfies('workspace-write', 'workspace-write')).toBe(true)
    expect(accessSatisfies('workspace-write', 'full-access')).toBe(false)
    expect(accessSatisfies('full-access', 'full-access')).toBe(true)

    expect(actionRequiredAccess('read')).toBe('read-only')
    expect(actionRequiredAccess('confirm', { brokerRisk: 'read', risk: 'low' })).toBe('read-only')
    expect(actionRequiredAccess('write')).toBe('workspace-write')
    expect(actionRequiredAccess('confirm', { risk: 'medium' })).toBe('workspace-write')
    expect(actionRequiredAccess('confirm', { risk: 'critical' })).toBe('full-access')

    expect(approvalRequiredAccess({ requesterKind: 'app', risk: 'critical', hasSessionReadOption: false })).toBe('read-only')
    expect(approvalRequiredAccess({ requesterKind: 'agent', risk: 'low', hasSessionReadOption: true })).toBe('read-only')
    expect(approvalRequiredAccess({ requesterKind: 'agent', risk: 'medium', hasSessionReadOption: false })).toBe('workspace-write')
    expect(approvalRequiredAccess({ requesterKind: 'agent', risk: 'critical', hasSessionReadOption: false })).toBe('full-access')

    expect(parseUpdateWorkspaceSettingsInput({ workspaceId: 'ws-1', accessCeiling: 'read-only' }).accessCeiling).toBe('read-only')
    expect(() => parseUpdateWorkspaceSettingsInput({ workspaceId: 'ws-1', accessCeiling: 'root' })).toThrow(/accessCeiling/)
  })
})

describe('OXE-327 · ApprovalCenter enforces min(workspaceCeiling, sessionAccess)', () => {
  const cases: Array<{
    ceiling: WorkspaceAccessLevel
    session: WorkspaceAccessLevel
    required: WorkspaceAccessLevel
    shouldAllowToAsk: boolean
  }> = []

  for (const ceiling of WORKSPACE_ACCESS_LEVELS) {
    for (const session of WORKSPACE_ACCESS_LEVELS) {
      for (const required of WORKSPACE_ACCESS_LEVELS) {
        const eff = effectiveAccess(ceiling, session)
        cases.push({ ceiling, session, required, shouldAllowToAsk: accessSatisfies(eff, required) })
      }
    }
  }

  test.each(cases)(
    'ceiling=$ceiling, session=$session, required=$required -> allowToAsk=$shouldAllowToAsk',
    async ({ ceiling, session, required, shouldAllowToAsk }) => {
      const { center, sent } = makeCenter()
      const risk = required === 'full-access' ? 'critical' : required === 'read-only' ? 'low' : 'medium'
      const options = required === 'read-only' ? [DENY, ALLOW_ONCE, ALLOW_SESSION_READS] : [DENY, ALLOW_ONCE]
      const draft = makeDraft({
        risk,
        options,
        workspaceCeiling: ceiling,
        sessionAccess: session,
        requiredAccess: required
      })

      if (!shouldAllowToAsk) {
        const outcome = await center.ask(draft)
        expect(outcome.by).toBe('refused')
        expect(outcome.intent).toBe('deny')
        expect(outcome.refusal?.code).toBe('approvals.denied.accessCeiling')
        expect(sent).toHaveLength(0)
        expect(center.history()[0]?.reason?.code).toBe('approvals.denied.accessCeiling')
      } else {
        const controller = new AbortController()
        const pending = center.ask(draft, controller.signal)
        expect(sent).toHaveLength(1)
        expect(center.list()).toHaveLength(1)
        controller.abort()
        const outcome = await pending
        expect(outcome.by).toBe('cancelled')
      }
    }
  )

  test('resolves workspaceCeiling via workspaceId lookup when draft omits explicit workspaceCeiling', async () => {
    const { center, sent } = makeCenter((wsId) => (wsId === 'ws-locked' ? 'read-only' : 'full-access'))
    const outcome = await center.ask(makeDraft({ workspaceId: 'ws-locked', sessionAccess: 'full-access' }))
    expect(outcome.by).toBe('refused')
    expect(outcome.refusal?.code).toBe('approvals.denied.accessCeiling')
    expect(sent).toHaveLength(0)
  })
})

describe('OXE-327 · domain-tool enforces min(workspaceCeiling, sessionAccess)', () => {
  const demoTool = domainTool('oxespace_demo', 'Demo tool for access ceiling checks.', {
    inspect: {
      level: 'read',
      description: 'Read state.',
      run: async () => ({ read: true })
    },
    mutate: {
      level: 'write',
      description: 'Write state.',
      run: async () => ({ written: true })
    },
    destroy: {
      level: 'confirm',
      description: 'Critical destructive action.',
      confirm: () => ({ summary: 'destroy', text: 'rm -rf /tmp/demo', risk: 'critical' }),
      run: async () => ({ destroyed: true })
    }
  })

  test('resolveScope computes effectiveAccess = min(workspaceCeiling, sessionAccess)', async () => {
    const ctx = makeContext({ workspaceCeiling: 'read-only', sessionAccess: 'full-access' })
    const scope = await resolveScope(ctx)
    expect(scope.workspaceCeiling).toBe('read-only')
    expect(scope.sessionAccess).toBe('full-access')
    expect(scope.effectiveAccess).toBe('read-only')

    const ctx2 = makeContext({ workspaceCeiling: 'full-access', executionAccess: 'workspace-write' })
    const scope2 = await resolveScope(ctx2)
    expect(scope2.effectiveAccess).toBe('workspace-write')
  })

  test('enforces all ceiling × session × action-level combinations without leaking through', async () => {
    for (const ceiling of WORKSPACE_ACCESS_LEVELS) {
      for (const session of WORKSPACE_ACCESS_LEVELS) {
        const eff = effectiveAccess(ceiling, session)
        const ctx = makeContext({ workspaceCeiling: ceiling, sessionAccess: session })

        // read action -> always allowed
        const readRes = await demoTool.handler({ action: 'inspect' }, ctx)
        expect(readRes.isError).toBeUndefined()
        expect(JSON.parse(readRes.content[0]!.text).ok).toBe(true)

        // write action -> allowed iff effectiveAccess >= workspace-write
        const writeRes = await demoTool.handler({ action: 'mutate' }, ctx)
        const writeBody = JSON.parse(writeRes.content[0]!.text)
        if (accessSatisfies(eff, 'workspace-write')) {
          expect(writeRes.isError).toBeUndefined()
          expect(writeBody.ok).toBe(true)
        } else {
          expect(writeRes.isError).toBe(true)
          expect(writeBody.code).toBe('access-ceiling')
        }

        // critical confirm action -> refused by domain-tool before broker when effectiveAccess < full-access
        const destroyRes = await demoTool.handler({ action: 'destroy' }, ctx)
        const destroyBody = JSON.parse(destroyRes.content[0]!.text)
        if (accessSatisfies(eff, 'full-access')) {
          // Reached AgentActions without a broker -> denied (not access-ceiling)
          expect(destroyRes.isError).toBe(true)
          expect(destroyBody.code).toBe('denied')
        } else {
          expect(destroyRes.isError).toBe(true)
          expect(destroyBody.code).toBe('access-ceiling')
        }
      }
    }
  })

  test('end-to-end: ApprovalCenter also refuses if a brokered confirm exceeds workspace ceiling', async () => {
    const { center, sent } = makeCenter(() => 'read-only')
    const broker = new ApprovalBroker(centerApprovalPrompter(center))
    const actions = new AgentActions({ broker })
    const ctx = makeContext({ workspaceCeiling: 'full-access', sessionAccess: 'full-access', agentActions: actions })

    // Simulate a confirm action whose ApprovalCenter lookup caps the workspace at read-only
    const confirmTool = domainTool('oxespace_confirm_demo', 'Confirm demo.', {
      push: {
        level: 'confirm',
        description: 'Push changes.',
        confirm: () => ({ summary: 'push', text: 'git push origin main', risk: 'medium' }),
        run: async () => ({ pushed: true })
      }
    })
    // Override workspaceCeiling on workspace to read-only via center lookup while domain-tool sees read-only too
    const lockedCtx = makeContext({ workspaceCeiling: 'read-only', sessionAccess: 'full-access', agentActions: actions })
    const res = await confirmTool.handler({ action: 'push' }, lockedCtx)
    const body = JSON.parse(res.content[0]!.text)
    expect(res.isError).toBe(true)
    expect(body.code).toBe('access-ceiling')
    expect(sent).toHaveLength(0)

    // Verify direct AgentActions -> ApprovalBroker -> ApprovalCenter path refuses with access-ceiling too
    await expect(
      actions.run(
        { key: 'exec-1', label: 'pane:p1', workspaceId: 'ws-1', authenticated: true, requester: AGENT_REQUESTER },
        { tool: 'oxespace_confirm_demo', action: 'push', level: 'confirm', text: 'git push', workspaceCeiling: 'read-only', sessionAccess: 'full-access' },
        async () => 'should-not-run'
      )
    ).rejects.toMatchObject({ code: 'access-ceiling' })
    expect(sent).toHaveLength(0)
    // Cleanup broker subscription
    broker.dispose()
    expect(ctx.workspaceId).toBe('ws-1')
  })
})
