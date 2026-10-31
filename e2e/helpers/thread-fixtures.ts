import type { ElectronApplication, Page } from '@playwright/test'

/**
 * Named Thread states for visual tests. The events mirror the shapes already used by
 * e2e/thread-view.spec.ts so the renderer exercises its real code paths; only the main
 * process IPC is replaced. Timestamps are fixed so screenshots do not drift.
 */
export type ThreadStateName =
  | 'empty'
  | 'conversation'
  | 'approval'
  | 'question'
  | 'usage-failure'
  | 'auth-failure'
  | 'running'
  | 'workbench'
  | 'long-command'

interface ThreadStateDefinition {
  status: string
  title: string
  provider?: 'claude' | 'codex'
  extra?: Record<string, unknown>
  events: (ctx: { root: string }) => unknown[]
}

const NOW = Date.UTC(2026, 9, 14, 12, 0, 0)
const done = { type: 'completed', status: 'completed' }
const user = (id: string, text: string) => ({ type: 'message', id, role: 'user', text })
const answer = (id: string, text: string) => ({ type: 'message', id, role: 'assistant', text })

export const THREAD_STATES: Record<ThreadStateName, ThreadStateDefinition> = {
  empty: { status: 'idle', title: 'New thread', events: () => [] },
  conversation: {
    status: 'idle',
    title: 'Authentication flow',
    events: () => [
      user('u1', 'How should sessions be stored?'),
      { type: 'tool', id: 't1', name: 'Read', state: 'completed', detail: 'README.md' },
      answer('a1', '**Use an HttpOnly cookie.**\n\nThe session stays outside client scripts.\n\n- Verify the callback before creating the session.\n- Rotate the identifier on sign-in.\n\n```ts\nres.cookie("sid", id, { httpOnly: true, sameSite: "lax" })\n```'),
      done
    ]
  },
  approval: {
    status: 'approval',
    title: 'Update the Thread guide',
    // A fixed cwd: the real temp root is random and would change every run.
    events: () => [
      user('u1', 'Update the Thread guide'),
      { type: 'request', id: 'approval-1', request: {
        id: 'approval-1', nativeId: '1', nativeMethod: 'item/commandExecution/requestApproval', kind: 'approval',
        title: 'Approve command', detail: 'npm run typecheck', command: 'npm run typecheck', cwd: 'C:\\work\\repo',
        reason: 'Verify the change compiles', generation: 1, createdAt: NOW, state: 'pending'
      } }
    ]
  },
  question: {
    status: 'approval',
    title: 'Rollout plan',
    events: () => [
      user('u1', 'Plan the rollout'),
      { type: 'request', id: 'native-choice', request: {
        id: 'native-choice', nativeId: 'native-choice', nativeMethod: 'can_use_tool:AskUserQuestion', kind: 'question',
        title: 'Claude needs your input', generation: 1, createdAt: NOW, state: 'pending',
        questions: [
          { id: 'rollout', question: 'Which rollout?', options: [{ label: 'Staged' }, { label: 'Immediate' }] },
          { id: 'validation', question: 'Which validation?', options: [{ label: 'Pilot' }, { label: 'Full rollout' }] }
        ]
      } }
    ]
  },
  'usage-failure': {
    status: 'failed',
    title: 'Usage limit reached',
    provider: 'codex',
    extra: { lastTurnStatus: 'failed' },
    events: () => [
      user('u1', 'Keep going'),
      { type: 'completed', status: 'failed', errorCode: 'usage', failure: {
        id: 'quota-failure', occurredAt: NOW, code: 'usage',
        message: 'The provider reported an exhausted usage allowance.', providerCode: 'usageLimitExceeded',
        detail: 'You have hit the session usage limit. Retry when your allowance resets.',
        usage: { checkedAt: NOW, windows: [
          { label: 'Codex · Session · 5 hours', usedPercent: 100, resetsAt: NOW + 3_600_000 },
          { label: 'Codex · Weekly', usedPercent: 60, resetsAt: NOW + 86_400_000 }
        ] }
      } }
    ]
  },
  'auth-failure': {
    status: 'failed',
    title: 'Sign-in required',
    extra: { lastTurnStatus: 'failed' },
    events: () => [user('u1', 'Hello'), { type: 'completed', status: 'failed', errorCode: 'authentication' }]
  },
  running: {
    status: 'running',
    title: 'Checking project files',
    extra: { connection: { state: 'connected', attempt: 0, changedAt: NOW, lastNativeSignalAt: NOW } },
    events: () => [
      user('u1', 'Audit the project'),
      { type: 'activity', id: 'reasoning', phase: 'reasoning', at: NOW, summary: 'Checking project files.' },
      answer('a1', 'Reading the configuration and the entry points first.')
    ]
  },
  workbench: {
    status: 'idle',
    title: 'Improve the Thread workbench',
    provider: 'codex',
    events: () => [
      user('u1', 'Show the files updated in this conversation.'),
      { type: 'tool', id: 'cmd', name: 'commandExecution', state: 'completed', detail: 'npm run typecheck', output: 'TypeScript checks passed', exitCode: 0 },
      { type: 'plan', id: 'plan', steps: [
        { label: 'Preserve file changes', status: 'completed' },
        { label: 'Integrate review alongside the conversation', status: 'completed' }
      ] },
      ...['src/App.tsx', 'src/components/Threads/ThreadWorkbench.tsx'].map((path, index) => ({
        type: 'tool', id: `file-${index}`, name: 'fileChange', state: 'completed', detail: path,
        files: [{ path, kind: index ? 'add' : 'update', state: 'completed', source: 'native-patch', artifactId: `artifact-${index}`, additions: 3, deletions: 1 }]
      })),
      answer('a1', 'File changes stay visible next to your messages.\n\n- Review each file without leaving the conversation.\n- Compare session changes with the project.'),
      done
    ]
  },
  'long-command': {
    status: 'idle',
    title: 'Inspect project history',
    events: () => [
      user('u1', 'Long command fixture'),
      { type: 'tool', id: 'long', name: 'Bash', state: 'unknown',
        detail: JSON.stringify({ command: `git log ${'very-long-path/'.repeat(95)}`, description: 'Inspect project history' }, null, 2) },
      done
    ]
  }
}

/**
 * Replaces the Thread IPC in the main process with a snapshot-backed fake. Call before
 * the workspace is opened, then `openThreadWithState` once the workspace exists.
 */
export async function installThreadFixtures(app: ElectronApplication, root: string): Promise<void> {
  await app.evaluate(({ ipcMain, BrowserWindow }, { fixtureRoot, now }) => {
    const g = globalThis as Record<string, unknown>
    let snapshot: Record<string, unknown> | null = null
    const changed = () => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send('thread:changed', { threadId: 'e2e-thread' }) }
    g.applyThreadState = (state: { status: string; title: string; provider?: string; extra?: Record<string, unknown>; events: unknown[] }) => {
      const thread = snapshot!.thread as Record<string, unknown>
      Object.assign(thread, { status: state.status, title: state.title, ...(state.provider ? { provider: state.provider } : {}), ...(state.extra ?? {}) })
      snapshot!.events = state.events
      changed()
    }
    for (const channel of ['commands', 'list', 'read', 'create', 'send', 'pin', 'projects', 'models', 'configure', 'command', 'artifact', 'project-diff', 'observe', 'respond', 'turn-files']) ipcMain.removeHandler(`thread:${channel}`)
    // The real handler returns null for a thread that only exists in this fake.
    ipcMain.handle('thread:turn-files', () => [])
    ipcMain.handle('thread:create', (_event, input) => {
      snapshot = { thread: { id: 'e2e-thread', workspaceId: g.e2eWorkspaceId, projectId: 'e2e-project', rootPath: fixtureRoot, provider: input.provider, nativeSessionId: null, title: 'New thread', pinned: false, status: 'idle', createdAt: now, updatedAt: now }, events: [] }
      changed(); return snapshot
    })
    ipcMain.handle('thread:list', () => snapshot ? [snapshot.thread] : [])
    ipcMain.handle('thread:read', () => snapshot)
    ipcMain.handle('thread:send', () => {})
    ipcMain.handle('thread:pin', () => {})
    ipcMain.handle('thread:observe', () => {})
    ipcMain.handle('thread:respond', () => {})
    ipcMain.handle('thread:configure', (_event, _id, configuration, revision) => { Object.assign(snapshot!.thread as object, configuration, { configurationRevision: revision + 1 }); changed(); return snapshot })
    ipcMain.handle('thread:command', () => ({ kind: 'none' }))
    ipcMain.handle('thread:commands', () => ({ commands: [] }))
    ipcMain.handle('thread:artifact', () => null)
    ipcMain.handle('thread:project-diff', () => ({ files: [], base: 'HEAD', includeUncommitted: true, compiledAt: now }))
    ipcMain.handle('thread:models', () => ({ defaultModel: 'native-model', models: [{ id: 'native-model', label: 'Native model', description: 'Native catalog model', efforts: ['low', 'high'], defaultEffort: 'low' }] }))
    for (const name of ['github:get-pull-request-status', 'agent-credits:get', 'copilot:credits', 'git:get-status']) ipcMain.removeHandler(name)
    ipcMain.handle('github:get-pull-request-status', () => null)
    ipcMain.handle('copilot:credits', () => ({ installed: false, credits: null, plan: null, error: null }))
    ipcMain.handle('agent-credits:get', (_event, input: { provider: string }) => ({ provider: input.provider, available: true, installed: true, planLabel: 'Pro', source: 'oauth', observedAtMs: now, error: null, windows: [] }))
    ipcMain.handle('git:get-status', () => ({ branch: 'main', ahead: 0, behind: 0, checkedAt: now, files: [] }))
  }, { fixtureRoot: root, now: NOW - 5 * 60_000 })
}

/** Registers the project so Thread lists it, after the workspace has been created. */
export async function registerThreadProject(app: ElectronApplication, page: Page, root: string): Promise<void> {
  const workspace = await page.evaluate(async () => (await window.oxe.workspace.list())[0])
  await app.evaluate((_context, workspaceId) => { (globalThis as Record<string, unknown>).e2eWorkspaceId = workspaceId }, workspace.id)
  await app.evaluate(({ ipcMain }, { workspaceId, rootPath }) => {
    ipcMain.removeHandler('thread:projects')
    ipcMain.handle('thread:projects', () => ({ projects: [{ projectId: 'e2e-project', displayName: 'repo', identityLabel: rootPath, contexts: [{ workspaceId, rootPath, label: 'repo' }] }], unavailable: [] }))
  }, { workspaceId: workspace.id, rootPath: root })
}

/** Opens Thread mode, creates the fake thread through the real dialog and applies a named state. */
export async function openThreadWithState(app: ElectronApplication, page: Page, root: string, state: ThreadStateName): Promise<void> {
  await page.getByRole('navigation', { name: 'Application view' }).getByRole('button', { name: 'Thread', exact: true }).click()
  await page.getByRole('button', { name: 'New thread in repo' }).click()
  await page.getByRole('button', { name: 'Create thread', exact: true }).click()
  await page.locator('.thread-timeline').waitFor()
  await setThreadState(app, root, state)
}

export async function setThreadState(app: ElectronApplication, root: string, state: ThreadStateName): Promise<void> {
  const definition = THREAD_STATES[state]
  await app.evaluate((_context, payload) => {
    ;(globalThis as Record<string, (s: unknown) => void>).applyThreadState(payload)
  }, { status: definition.status, title: definition.title, provider: definition.provider, extra: definition.extra, events: definition.events({ root }) })
}
