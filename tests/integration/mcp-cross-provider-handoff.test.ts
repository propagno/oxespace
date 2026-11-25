// OXE-298: advanced handoff between providers.
// - CA-4 (Part A): completed handoff leaves an append-only trail (author session, provider, model, UTC timestamp).
// - CA-2 (Part B): opening external agent from handoff pre-validates and uses chosen worktree or Git ref.
// - CA-3 (Part C): cross-session attachment transfer requires explicit ApprovalCenter approval and copies 0 files on denial.
// - CA-1 (Part D): watched handoff file change or peer reply emits a debounced/deduped inbound notice without stealing focus.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createElement, useState } from 'react'
import { act, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { openInMemoryDatabase } from '../../electron/main/db'
import { AGENT_CHANGE_TOOLS, _resetAgentOwnersForTests } from '../../electron/main/mcp-internal/agent-tools'
import { findTool, type ToolContext } from '../../electron/main/mcp-internal/tool-registry'
import { AgentActions } from '../../electron/main/services/agent-actions/agent-actions'
import { ApprovalBroker } from '../../electron/main/services/agent-actions/approval-broker'
import { centerApprovalPrompter } from '../../electron/main/services/agent-actions/approval-prompter'
import { ApprovalCenter } from '../../electron/main/services/approvals/approval-center'
import { requesterFor } from '../../electron/main/services/approvals/requester'
import { ExecutionRegistry } from '../../electron/main/services/execution-registry'
import { transferCrossSessionAttachments } from '../../electron/main/services/handoff/attachment-transfer'
import { HandoffNoticeWatcher } from '../../electron/main/services/handoff/handoff-watcher'
import type { AgentLifecycleState, PaneAgentState } from '../../shared/types/agent-state'
import type { ApprovalRequest as CenterApprovalRequest } from '../../shared/types/approvals'
import type { HandoffInboundNotice } from '../../shared/types/handoff-notice'
import { IPC_CHANNELS } from '../../shared/types/ipc'
import type { ConversationThread, ThreadSnapshot } from '../../shared/types/thread'
import { HandoffInboundNoticeBanner } from '../../src/components/Integration/HandoffInboundNoticeBanner'

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

function setup(rootPath = process.cwd()) {
  const db = openInMemoryDatabase()
  const root = rootPath, now = Date.now()
  const source: ConversationThread = { id: randomUUID(), workspaceId: 'thread:project', projectId: 'project', rootPath: root,
    provider: 'claude', nativeSessionId: 'native-claude-1', title: 'Source', pinned: false, status: 'running', createdAt: now, updatedAt: now, generation: 1 }
  db.prepare('INSERT INTO thread_projects (id, identity, root_path, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('project', root, root, 'Project', now, now)
  db.prepare('INSERT INTO thread_project_contexts (project_id, root_path) VALUES (?, ?)').run('project', root)
  db.prepare('INSERT INTO conversation_threads (id, workspace_id, thread_project_id, data_json, events_json) VALUES (?, ?, ?, ?, ?)')
    .run(source.id, source.workspaceId, source.projectId, JSON.stringify(source), '[]')
  const snapshots = new Map<string, ThreadSnapshot>([[source.id, {
    thread: source,
    events: [{ type: 'configuration', model: 'claude-sonnet-4-5' }]
  } as unknown as ThreadSnapshot]])
  const manager = {
    read: (id: string) => { const value = snapshots.get(id); if (!value) throw new Error('Thread not found'); return value },
    create: (context: Pick<ConversationThread, 'workspaceId' | 'projectId' | 'rootPath' | 'provider'>) => {
      const thread: ConversationThread = { ...context, id: randomUUID(), nativeSessionId: null, title: 'New thread', pinned: false, status: 'idle', createdAt: now, updatedAt: now, generation: 1 }
      db.prepare('INSERT INTO conversation_threads (id, workspace_id, thread_project_id, data_json, events_json) VALUES (?, ?, ?, ?, ?)')
        .run(thread.id, thread.workspaceId, thread.projectId, JSON.stringify(thread), '[]')
      const snapshot = { thread, events: [] }
      snapshots.set(thread.id, snapshot)
      return snapshot
    },
    send: vi.fn(async () => undefined)
  }
  const executions = new ExecutionRegistry()
  const env = executions.register({ owner: { kind: 'thread', id: source.id }, workspaceId: source.workspaceId, cwd: root })
  const ctx = { db, threads: Promise.resolve(manager), executions, workspaceId: source.workspaceId,
    executionId: env.OXESPACE_EXECUTION_ID, executionToken: env.OXESPACE_EXECUTION_TOKEN } as unknown as ToolContext
  const call = async (name: string, args: Record<string, unknown>) => JSON.parse((await findTool(name)!.handler(args, ctx)).content[0].text!)
  return { db, source, manager, call }
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

async function callAgentChange(args: Record<string, unknown>, ctx: ToolContext) {
  const tool = AGENT_CHANGE_TOOLS.find(entry => entry.descriptor.name === 'oxespace_agents_change')!
  const res = await tool.handler(args, ctx)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return JSON.parse(res.content[0].text) as { ok: boolean; code?: string; message?: string; result?: any }
}

describe('OXE-298 cross-provider handoff', () => {
  test('completed cross-provider handoff records author session, model and UTC timestamp trail', async () => {
    const { db, source, call } = setup()
    try {
      const before = Date.now()
      const created = await call('oxespace_thread_create', { key: 'create-trail-1' }) as { threadId: string }
      await call('oxespace_thread_send', { threadId: created.threadId, key: 'send-trail-1', text: 'Continue the review' })
      // A retried key repeats nothing, in the conversation or in the trail.
      await call('oxespace_thread_create', { key: 'create-trail-1' })
      await call('oxespace_thread_send', { threadId: created.threadId, key: 'send-trail-1', text: 'Continue the review' })
      const after = Date.now()

      const read = await call('oxespace_thread_read', { threadId: created.threadId }) as { trail: Array<Record<string, unknown>> }
      expect(read.trail.map(entry => entry.step)).toEqual(['create', 'send'])
      for (const entry of read.trail) {
        expect(entry).toMatchObject({
          authorSessionId: source.id,
          authorNativeSessionId: 'native-claude-1',
          provider: 'claude',
          model: 'claude-sonnet-4-5',
          destinationThreadId: created.threadId
        })
        expect(entry.timestampUtc).toMatch(ISO_UTC)
        const at = Date.parse(entry.timestampUtc as string)
        expect(at).toBeGreaterThanOrEqual(before - 1)
        expect(at).toBeLessThanOrEqual(after + 1)
      }
      expect(read.trail[1]).toMatchObject({ state: 'submitted' })

      // Append-only: a trail entry is never rewritten.
      expect(() => db.prepare("UPDATE mcp_thread_handoff_trail SET provider = 'codex'").run()).toThrow(/append-only/)
      expect(db.prepare('SELECT COUNT(*) AS n FROM mcp_thread_handoff_trail').get()).toEqual({ n: 2 })
    } finally { db.close() }
  })

  test('opening external agent from handoff validates and uses chosen worktree or git ref', async () => {
    const base = await mkdtemp(join(tmpdir(), 'oxe298-wt-'))
    const mainRepo = join(base, 'repo')
    const linkedWt = join(base, 'wt-feature')
    try {
      await mkdir(mainRepo, { recursive: true })
      git(mainRepo, ['init', '-b', 'main'])
      git(mainRepo, ['config', 'user.email', 'test@oxespace.local'])
      git(mainRepo, ['config', 'user.name', 'OXESpace Test'])
      await writeFile(join(mainRepo, 'README.md'), '# main\n', 'utf8')
      git(mainRepo, ['add', 'README.md'])
      git(mainRepo, ['commit', '-m', 'init'])
      git(mainRepo, ['worktree', 'add', '-b', 'feat/handoff-target', linkedWt])
      const canonicalMain = await realpath(mainRepo)
      const canonicalWt = await realpath(linkedWt)
      const featureCommit = git(linkedWt, ['rev-parse', 'HEAD'])

      let seq = 0
      const panes: Array<{ id: string; displayName: string | null; rootPath?: string | null }> = [{ id: 'caller-pane', displayName: 'Claude' }]
      const workspace = { id: 'ws-handoff', rootPath: canonicalMain, name: 'handoff-repo', isActive: true, panes }
      const states = new Map<string, AgentLifecycleState>()
      const stateOf = (paneId: string): PaneAgentState | null =>
        states.has(paneId)
          ? { paneId, workspaceId: workspace.id, agent: 'codex', state: states.get(paneId)!, source: 'screen', seen: true, since: 0, stateChangeSeq: 1, completionSeq: 0 }
          : null

      const createPane = vi.fn(() => {
        const paneId = `helper-${++seq}`
        panes.push({ id: paneId, displayName: null, rootPath: null })
        return { workspace, paneId }
      })
      const setPaneRootPath = vi.fn((paneId: string, rootPath: string | null) => {
        const found = panes.find(p => p.id === paneId)
        if (found) found.rootPath = rootPath
        return workspace
      })
      const terminalStart = vi.fn(async (input: { paneId: string }) => {
        states.set(input.paneId, 'idle')
      })

      const agents = {
        state: {
          list: () => [],
          get: stateOf,
          explain: () => ({ state: null }),
          waitFor: vi.fn(async (paneId: string) => ({ state: stateOf(paneId), timedOut: false }))
        },
        terminal: { peek: () => null, submit: vi.fn(), interrupt: vi.fn(), start: terminalStart, stop: vi.fn() },
        profiles: () => [{ agentProfileId: 'codex-1', provider: 'codex', name: 'Codex', command: 'codex', commandTemplate: '', isBuiltin: true }],
        resolve: () => ({ executable: 'codex', provider: 'codex' }),
        mcpArgs: () => [],
        createPane,
        setPaneAgent: () => workspace,
        setPaneRootPath,
        closePane: () => workspace,
        workspaceChanged: vi.fn()
      }

      const ctx = {
        workspaceId: workspace.id,
        executionId: 'exec-wt',
        executionToken: 'tok-wt',
        workspaceServ: { get: (id: string) => id === workspace.id ? workspace : null, list: () => [workspace] },
        executions: { authenticate: () => ({ id: 'exec-wt', owner: { kind: 'pane', id: 'caller-pane' }, workspaceId: workspace.id, canonicalRoot: canonicalMain, cwd: canonicalMain }) },
        agentActions: new AgentActions(),
        app: { agents }
      } as unknown as ToolContext

      // 1. Omitting worktree and gitRef preserves the default worktree.
      const defaultStart = await callAgentChange({ action: 'start', agent: 'codex' }, ctx)
      expect(defaultStart).toMatchObject({ ok: true, result: { paneId: 'helper-1', ready: true } })
      expect(setPaneRootPath).not.toHaveBeenCalled()
      expect(terminalStart).toHaveBeenLastCalledWith({
        paneId: 'helper-1',
        workspaceId: workspace.id,
        launch: { executable: 'codex', args: [] }
      })

      // 2. Explicit valid worktree path validates and points the external agent to that worktree.
      const byWorktree = await callAgentChange({ action: 'start', agent: 'codex', worktree: linkedWt }, ctx)
      expect(byWorktree).toMatchObject({
        ok: true,
        result: { paneId: 'helper-2', ready: true, worktree: canonicalWt, branch: 'feat/handoff-target' }
      })
      expect(setPaneRootPath).toHaveBeenLastCalledWith('helper-2', canonicalWt)
      expect(terminalStart).toHaveBeenLastCalledWith(expect.objectContaining({
        paneId: 'helper-2',
        workspaceId: workspace.id,
        requireCwd: canonicalWt
      }))

      // 3. Explicit valid gitRef validates and resolves to the registered worktree checked out on that ref.
      const byRef = await callAgentChange({ action: 'start', agent: 'codex', gitRef: 'feat/handoff-target' }, ctx)
      expect(byRef).toMatchObject({
        ok: true,
        result: { paneId: 'helper-3', ready: true, worktree: canonicalWt, gitRef: 'feat/handoff-target', commit: featureCommit }
      })
      expect(setPaneRootPath).toHaveBeenLastCalledWith('helper-3', canonicalWt)
      expect(terminalStart).toHaveBeenLastCalledWith(expect.objectContaining({
        paneId: 'helper-3',
        requireCwd: canonicalWt
      }))

      // 4. Nonexistent worktree and nonexistent gitRef are refused with clear errors before creating any pane.
      const paneCountBefore = createPane.mock.calls.length
      const startCountBefore = terminalStart.mock.calls.length

      const badWorktree = await callAgentChange({ action: 'start', agent: 'codex', worktree: join(base, 'does-not-exist') }, ctx)
      expect(badWorktree).toMatchObject({ ok: false, code: 'not-found' })
      expect(badWorktree.message).toMatch(/does not exist|not a registered/i)

      const badRef = await callAgentChange({ action: 'start', agent: 'codex', gitRef: 'refs/heads/no-such-branch' }, ctx)
      expect(badRef).toMatchObject({ ok: false, code: 'not-found' })
      expect(badRef.message).toMatch(/does not exist/i)

      expect(createPane).toHaveBeenCalledTimes(paneCountBefore)
      expect(terminalStart).toHaveBeenCalledTimes(startCountBefore)

      // 5. Thread handoff creation also validates and honors chosen worktree / refuses bad ref.
      const threadHarness = setup(canonicalMain)
      try {
        const createdWt = await threadHarness.call('oxespace_thread_create', { key: 'create-wt-01', worktree: linkedWt }) as { threadId: string; worktree: string }
        expect(createdWt.worktree).toBe(canonicalWt)
        expect(threadHarness.manager.read(createdWt.threadId).thread.rootPath).toBe(canonicalWt)
        await expect(threadHarness.call('oxespace_thread_create', { key: 'create-wt-bad', gitRef: 'nonexistent-ref-xyz' }))
          .rejects.toThrow(/does not exist/i)
      } finally {
        threadHarness.db.close()
      }
    } finally {
      _resetAgentOwnersForTests()
      await rm(base, { recursive: true, force: true })
    }
  })

  test('cross-session attachment handoff requires explicit user approval and transfers zero files on denial', async () => {
    const base = await mkdtemp(join(tmpdir(), 'oxe298-attach-'))
    const originRoot = join(base, 'origin-claude')
    const destRoot = join(base, 'dest-codex')
    const outsideSecret = join(base, 'outside-secret.txt')
    try {
      await mkdir(join(originRoot, 'artifacts'), { recursive: true })
      await mkdir(join(originRoot, '.git'), { recursive: true })
      await mkdir(destRoot, { recursive: true })
      await writeFile(join(originRoot, 'artifacts', 'spec.md'), '# Handoff spec\n', 'utf8')
      await writeFile(join(originRoot, 'artifacts', 'report.json'), '{"ok":true}\n', 'utf8')
      await writeFile(join(originRoot, '.env'), 'API_SECRET=super-secret\n', 'utf8')
      await writeFile(join(originRoot, '.git', 'config'), '[core]\n', 'utf8')
      await writeFile(join(originRoot, 'id_rsa'), 'PRIVATE KEY\n', 'utf8')
      await writeFile(outsideSecret, 'DO NOT LEAK\n', 'utf8')

      let symlinkCreated = false
      try {
        await symlink(outsideSecret, join(originRoot, 'artifacts', 'escape-link.txt'))
        symlinkCreated = true
      } catch {
        // Symlink creation may require elevated privileges on Windows without Developer Mode.
      }

      const wsOrigin = {
        id: 'ws-origin', rootPath: originRoot, name: 'Origin Workspace', isActive: true,
        panes: [{ id: 'pane-claude', displayName: 'Claude Origin', status: 'running', agentProfileId: 'prof-claude', rootPath: originRoot, rowIndex: 0, columnIndex: 0 }]
      }
      const wsDest = {
        id: 'ws-dest', rootPath: destRoot, name: 'Dest Workspace', isActive: false,
        panes: [{ id: 'pane-codex', displayName: 'Codex Target', status: 'running', agentProfileId: 'prof-codex', rootPath: destRoot, rowIndex: 0, columnIndex: 0 }]
      }

      const modalRequests: CenterApprovalRequest[] = []
      let decision: 'deny' | 'allow-once' = 'deny'
      const center = new ApprovalCenter({
        hasWindow: () => true,
        send: (channel, payload) => {
          if (channel !== IPC_CHANNELS.approvals.onRequested) return
          const req = payload as CenterApprovalRequest
          modalRequests.push(req)
          center.ack({ id: req.id, generation: req.generation, visible: true, focused: true })
          center.respond({ id: req.id, generation: req.generation, optionId: decision })
        },
        native: async () => 'deny'
      })
      const broker = new ApprovalBroker(centerApprovalPrompter(center), Date.now, 5_000)

      const agents = {
        state: { list: () => [], get: () => null, explain: () => ({ state: null }), waitFor: vi.fn() },
        terminal: { peek: () => null, submit: vi.fn(), interrupt: vi.fn(), start: vi.fn(), stop: vi.fn() },
        profiles: () => [
          { agentProfileId: 'prof-claude', provider: 'claude', name: 'Claude', command: 'claude', commandTemplate: '', isBuiltin: true },
          { agentProfileId: 'prof-codex', provider: 'codex', name: 'Codex', command: 'codex', commandTemplate: '', isBuiltin: true }
        ],
        resolve: () => ({ executable: 'codex', provider: 'codex' }),
        mcpArgs: () => [],
        createPane: () => ({ workspace: wsOrigin, paneId: 'x' }),
        setPaneAgent: () => wsOrigin,
        closePane: () => wsOrigin,
        workspaceChanged: vi.fn()
      }

      const ctx = {
        workspaceId: wsOrigin.id,
        executionId: 'exec-attach',
        executionToken: 'tok-attach',
        workspaceServ: { get: (id: string) => id === wsOrigin.id ? wsOrigin : id === wsDest.id ? wsDest : null, list: () => [wsOrigin, wsDest] },
        executions: { authenticate: () => ({ id: 'exec-attach', owner: { kind: 'pane', id: 'pane-claude' }, workspaceId: wsOrigin.id, canonicalRoot: originRoot, cwd: originRoot }) },
        agentActions: new AgentActions({ broker }),
        app: { agents }
      } as unknown as ToolContext

      try {
        // 1. Sensitive and out-of-scope paths are rejected BEFORE asking ApprovalCenter and copy 0 files.
        const blockedPaths = ['../outside-secret.txt', outsideSecret, '.env', '.git/config', 'id_rsa']
        if (symlinkCreated) blockedPaths.push('artifacts/escape-link.txt')
        for (const badPath of blockedPaths) {
          const refused = await callAgentChange({
            action: 'transfer_attachments',
            paneId: 'pane-codex',
            workspaceId: wsDest.id,
            files: [badPath]
          }, ctx)
          expect(refused, badPath).toMatchObject({ ok: false, code: 'forbidden-path' })
        }
        expect(modalRequests).toHaveLength(0)
        expect(existsSync(join(destRoot, '.oxespace'))).toBe(false)

        // 2. Denial via ApprovalCenter shows origin, destination, complete file list, and copies 0 files.
        decision = 'deny'
        const denied = await callAgentChange({
          action: 'transfer_attachments',
          paneId: 'pane-codex',
          workspaceId: wsDest.id,
          files: ['artifacts/spec.md', 'artifacts/report.json'],
          targetDir: 'inbox-denied'
        }, ctx)
        expect(denied).toMatchObject({ ok: false, code: 'denied' })
        expect(modalRequests).toHaveLength(1)
        const prompt = modalRequests[0]
        expect(prompt.target).toContain('claude')
        expect(prompt.target).toContain('codex')
        expect(prompt.agentText.text).toContain('Origin: claude (Claude Origin)')
        expect(prompt.agentText.text).toContain('Destination: codex (Codex Target)')
        expect(prompt.agentText.text).toContain('artifacts/spec.md')
        expect(prompt.agentText.text).toContain('artifacts/report.json')
        expect(prompt.options.map(o => o.intent)).toEqual(['deny', 'allow'])
        expect(existsSync(join(destRoot, 'inbox-denied'))).toBe(false)

        // 3. Direct ApprovalCenter API also reports 0 files copied on denial.
        const directDenied = await transferCrossSessionAttachments({
          origin: { sessionId: 'claude-s1', provider: 'claude', rootPath: originRoot, label: 'Claude Origin' },
          destination: { sessionId: 'codex-s2', provider: 'codex', rootPath: destRoot, label: 'Codex Target' },
          files: ['artifacts/spec.md'],
          targetDir: 'direct-denied'
        }, { approvalCenter: center, requester: requesterFor({ kind: 'pane', id: 'pane-claude' }) })
        expect(directDenied).toMatchObject({ approved: false, transferred: false, filesCopied: 0, files: [], reason: 'denied' })
        expect(existsSync(join(destRoot, 'direct-denied'))).toBe(false)

        // 4. Explicit approval transfers the exact validated file list into destination.
        decision = 'allow-once'
        const approved = await callAgentChange({
          action: 'transfer_attachments',
          paneId: 'pane-codex',
          workspaceId: wsDest.id,
          files: ['artifacts/spec.md', 'artifacts/report.json'],
          targetDir: 'inbox-approved'
        }, ctx)
        expect(approved).toMatchObject({
          ok: true,
          result: {
            approved: true,
            transferred: true,
            filesCopied: 2
          }
        })
        expect(await readFile(join(destRoot, 'inbox-approved', 'artifacts', 'spec.md'), 'utf8')).toBe('# Handoff spec\n')
        expect(await readFile(join(destRoot, 'inbox-approved', 'artifacts', 'report.json'), 'utf8')).toBe('{"ok":true}\n')
      } finally {
        broker.dispose()
      }
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })

  test('watched handoff file change or peer reply emits inbound notice without stealing focus', async () => {
    const base = await mkdtemp(join(tmpdir(), 'oxe298-watch-'))
    const handoffDir = join(base, 'handoffs')
    const handoffFile = join(handoffDir, 'review-notes.md')
    const watcher = new HandoffNoticeWatcher()

    try {
      await mkdir(handoffDir, { recursive: true })
      await writeFile(handoffFile, '# Initial handoff\n', 'utf8')

      let pushNoticeToUi: ((notice: HandoffInboundNotice) => void) | null = null
      function ConsumerPaneHarness() {
        const [notices, setNotices] = useState<HandoffInboundNotice[]>([])
        pushNoticeToUi = notice => setNotices(prev => [notice, ...prev])
        return createElement(
          'div',
          null,
          createElement(HandoffInboundNoticeBanner, { notices }),
          createElement('textarea', { 'aria-label': 'Consumer pane input', defaultValue: 'typing...' })
        )
      }

      render(createElement(ConsumerPaneHarness))
      const input = screen.getByLabelText('Consumer pane input') as HTMLTextAreaElement
      input.focus()
      expect(document.activeElement).toBe(input)

      const received: HandoffInboundNotice[] = []
      const stopSub = watcher.subscribe(notice => {
        received.push(notice)
        act(() => { pushNoticeToUi?.(notice) })
      })

      const handle = await watcher.watchFile({
        consumerPaneId: 'pane-consumer',
        rootPath: base,
        relativePath: 'handoffs/review-notes.md',
        origin: { paneId: 'pane-codex', provider: 'codex', label: 'Codex · pane 2' },
        debounceMs: 40
      })

      // Atomic save (write tmp + rename over watched file) emits exactly 1 debounced notice.
      const tmpSave = join(handoffDir, '.review-notes.md.tmp')
      await writeFile(tmpSave, '# Updated handoff v2\n', 'utf8')
      await rename(tmpSave, handoffFile)

      await vi.waitFor(() => {
        expect(received.filter(n => n.kind === 'file-changed')).toHaveLength(1)
      }, { timeout: 2500 })

      // Rewriting identical content via another atomic save is deduplicated (0 extra notices).
      await writeFile(tmpSave, '# Updated handoff v2\n', 'utf8')
      await rename(tmpSave, handoffFile)
      await new Promise(resolve => setTimeout(resolve, 140))
      expect(received.filter(n => n.kind === 'file-changed')).toHaveLength(1)

      const fileNotice = received[0]
      expect(fileNotice).toMatchObject({
        consumerPaneId: 'pane-consumer',
        kind: 'file-changed',
        origin: { paneId: 'pane-codex', provider: 'codex', label: 'Codex · pane 2' },
        relativePath: 'handoffs/review-notes.md',
        stealFocus: false
      })
      expect(fileNotice.timestampUtc).toMatch(ISO_UTC)
      expect(screen.getByText(/Handoff updated by Codex · pane 2/)).toBeInTheDocument()
      expect(screen.getByText('handoffs/review-notes.md')).toBeInTheDocument()
      // Typing focus stays on the consumer pane input.
      expect(document.activeElement).toBe(input)

      // Partner pane reply emits a deduplicated inbound notice citing origin & file without stealing focus.
      watcher.linkPartnerPane({
        consumerPaneId: 'pane-consumer',
        partnerPaneId: 'pane-codex',
        originLabel: 'Codex · pane 2',
        originProvider: 'codex',
        relativePath: 'handoffs/review-notes.md'
      })
      const firstReply = watcher.notifyPeerReply({
        fromPaneId: 'pane-codex',
        fromProvider: 'codex',
        summary: 'API contract verified'
      })
      const dupReply = watcher.notifyPeerReply({
        fromPaneId: 'pane-codex',
        fromProvider: 'codex',
        summary: 'API contract verified'
      })
      expect(firstReply).toHaveLength(1)
      expect(dupReply).toHaveLength(0)
      expect(firstReply[0]).toMatchObject({
        consumerPaneId: 'pane-consumer',
        kind: 'peer-reply',
        origin: { paneId: 'pane-codex', provider: 'codex', label: 'Codex · pane 2' },
        relativePath: 'handoffs/review-notes.md',
        summary: 'API contract verified',
        stealFocus: false
      })
      expect(screen.getByText(/Reply from Codex · pane 2/)).toBeInTheDocument()
      expect(screen.getByText(/API contract verified/)).toBeInTheDocument()
      expect(document.activeElement).toBe(input)

      handle.stop()
      stopSub()
    } finally {
      watcher.dispose()
      await rm(base, { recursive: true, force: true })
    }
  })
})
