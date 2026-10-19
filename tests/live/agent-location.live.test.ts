/**
 * Live check, against the installed and signed-in agent CLIs, that OXESpace learns where a session works.
 * Opt-in: OXE_LIVE_AGENTS=1 npx vitest run tests/live/agent-location.live.test.ts
 * It spends a little of the person's subscription and needs network, so it never runs in CI.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { openInMemoryDatabase } from '../../electron/main/db'
import { ThreadManager } from '../../electron/main/services/conversation/thread-manager'
import { ClaudeConversationAdapter } from '../../electron/main/services/conversation/claude-conversation'
import { CodexConversationAdapter } from '../../electron/main/services/conversation/codex-conversation'
import { AgentProcessTransport } from '../../electron/main/services/conversation/process-transport'
import { resolveSessionLocation } from '../../electron/main/services/git-common-dir'
import { createThreadWorktree } from '../../electron/main/services/conversation/thread-worktree'
import type { ThreadEvent } from '../../shared/types/thread'

const live = process.env.OXE_LIVE_AGENTS === '1'
const roots: string[] = []
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }) })

function repository(): string {
  const root = mkdtempSync(join(tmpdir(), 'oxe-live-'))
  roots.push(root)
  const repo = join(root, 'repo')
  mkdirSync(repo)
  const git = (...args: string[]): void => { execFileSync('git', args, { cwd: repo }) }
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 'e@x'); git('config', 'user.name', 'E')
  writeFileSync(join(repo, 'README.md'), '# live\n'); git('add', '.'); git('commit', '-qm', 'init')
  return repo
}

async function untilCompleted(events: ThreadEvent[], ms: number): Promise<void> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (events.some(event => event.type === 'completed')) return
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error('The turn did not complete in time')
}

describe.skipIf(!live)('live agents report where they work', () => {
  it('Codex: each command reports its directory, and a worktree it moves into resolves to that checkout', async () => {
    const repo = repository()
    const tree = join(repo, '..', 'repo-codex')
    // The person's configured default model may not be offered to their account; ask the provider's own
    // catalog, as the model picker does, and use the first model it lists.
    const catalogEvents: ThreadEvent[] = []
    const catalog = new CodexConversationAdapter(new AgentProcessTransport('codex', ['app-server', '--listen', 'stdio://'], repo))
    let model: string | undefined
    try {
      await catalog.start({ rootPath: repo, nativeSessionId: null, access: 'read-only' }, event => catalogEvents.push(event))
      await catalog.send('/model')
      await untilCompleted(catalogEvents, 60_000)
      const picker = catalogEvents.find(event => event.type === 'model-picker')
      model = picker?.type === 'model-picker' ? picker.models[0]?.id : undefined
    } finally { await catalog.dispose() }
    console.log('Codex model:', model)
    const events: ThreadEvent[] = []
    const adapter = new CodexConversationAdapter(new AgentProcessTransport('codex', ['app-server', '--listen', 'stdio://'], repo))
    try {
      await adapter.start({ rootPath: repo, nativeSessionId: null, access: 'full-access', approvalPolicy: 'never', ...(model ? { model } : {}) }, event => events.push(event))
      await adapter.send(`Run exactly these two shell commands, one at a time, then stop: first \`git worktree add ../repo-codex -b codex-branch\`, then \`git branch --show-current\` with its working directory set to ../repo-codex.`)
      await untilCompleted(events, 240_000)
    } finally { await adapter.dispose() }
    const reported = events.flatMap(event => event.type === 'location' ? [event.cwd] : [])
    console.log('Codex reported directories:', reported)
    const outcome = events.find(event => event.type === 'completed')
    if (outcome?.type === 'completed' && outcome.status !== 'completed') console.log('Codex turn failed:', outcome.failure?.detail ?? outcome.error)
    expect(reported.length).toBeGreaterThan(0)
    const locations = reported.map(cwd => resolveSessionLocation(cwd, repo))
    expect(locations.some(location => location?.sameRepository && location.checkoutRoot !== null)).toBe(true)
    // When Codex ran the second command in the new worktree, that checkout is what OXESpace would show.
    const moved = locations.find(location => location?.checkoutRoot && location.checkoutRoot.toLowerCase().endsWith('repo-codex'))
    console.log('Moved into the worktree:', moved ?? 'not reported')
    if (moved) expect(moved.sameRepository).toBe(true)
    void tree
  }, 300_000)

  it('a conversation started in its own worktree runs the agent on that new branch', async () => {
    const repo = repository()
    const host = {
      createWorktree: async (input: { rootPath: string; branch: string; path: string; baseRef?: string }) => {
        execFileSync('git', ['worktree', 'add', '-b', input.branch, input.path, input.baseRef ?? 'HEAD'], { cwd: input.rootPath, stdio: 'ignore' })
        return { ok: true, message: `Worktree created at ${input.path}` }
      },
      resolveBaseRef: async () => 'main'
    }
    const created = await createThreadWorktree(host, repo, { branch: 'thread/live-check' })
    roots.push(join(created.rootPath, '..'))
    const events: ThreadEvent[] = []
    const adapter = new ClaudeConversationAdapter((args, cwd) => new AgentProcessTransport('claude', args, cwd))
    try {
      await adapter.start({ rootPath: created.rootPath, nativeSessionId: null, access: 'full-access' }, event => events.push(event))
      await adapter.send('Run the Bash command git branch --show-current and reply with its output only.')
      await untilCompleted(events, 240_000)
    } finally { await adapter.dispose() }
    const answer = events.filter(event => event.type === 'message' && event.role === 'assistant').map(event => event.type === 'message' ? event.text : '').join('\n')
    console.log('Branch seen by the agent:', answer.trim())
    expect(answer).toContain('thread/live-check')
    expect(events.find(event => event.type === 'location')).toMatchObject({ cwd: created.rootPath })
  }, 300_000)

  it('a Thread turn spent in a worktree Claude entered can be reviewed and undone there', async () => {
    const repo = repository()
    const db = openInMemoryDatabase()
    db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES ('A', 'A', ?, '1x1', 'builtin-claude')").run(repo)
    const models = { list: async () => ({ defaultModel: 'm', models: [] }), stop: async () => {} }
    const seen: string[] = []
    const manager = new ThreadManager(db, async () => {
      const adapter = new ClaudeConversationAdapter((args, cwd) => new AgentProcessTransport('claude', args, cwd))
      const start = adapter.start.bind(adapter)
      adapter.start = (context, emit) => start(context, event => { if (event.type === 'location' || event.type === 'session') seen.push(`${event.type} ${event.type === 'location' ? event.cwd : ''}`); emit(event) })
      return adapter
    }, () => {}, undefined, undefined, undefined, models as never)
    try {
      const id = manager.create({ workspaceId: 'A', projectId: 'p', rootPath: repo, provider: 'claude' }).thread.id
      await manager.configure(id, { access: 'full-access' }, manager.read(id).thread.revision ?? 0).catch(() => undefined)
      await manager.send(id, 'Use the EnterWorktree tool to create and enter a worktree named undo. Then use the Write tool to create hello.txt in the current directory containing exactly: hi. Reply done.')
      const end = Date.now() + 240_000
      const turnDone = (): boolean => manager.read(id).turns?.at(-1)?.status !== 'running' && manager.read(id).thread.status !== 'running'
      while (Date.now() < end && !turnDone()) await new Promise(resolve => setTimeout(resolve, 1000))
      await new Promise(resolve => setTimeout(resolve, 3000))
      const snapshot = manager.read(id)
      const tree = join(repo, '.claude', 'worktrees', 'undo')
      console.log('Observed:', snapshot.thread.observedLocation?.checkoutRoot, '| turn:', snapshot.turns?.at(-1)?.status, '| access:', snapshot.thread.access)
      console.log('Seen:', JSON.stringify(seen))
      expect(existsSync(join(tree, 'hello.txt'))).toBe(true)
      const turnId = snapshot.turns!.at(-1)!.id
      const files = await manager.turnFiles(id, turnId)
      console.log('Turn files:', files.map(file => file.path))
      expect(files.map(file => file.path)).toContain('hello.txt')
      await manager.undoTurnFile(id, turnId, 'hello.txt')
      expect(existsSync(join(tree, 'hello.txt'))).toBe(false)
    } finally { await manager.stop(); db.close() }
  }, 300_000)

  it('Claude: a message steered into a running turn is answered in that same turn', async () => {
    const repo = repository()
    const events: ThreadEvent[] = []
    const adapter = new ClaudeConversationAdapter((args, cwd) => new AgentProcessTransport('claude', args, cwd))
    try {
      await adapter.start({ rootPath: repo, nativeSessionId: null, access: 'full-access' }, event => events.push(event))
      await adapter.send('Run this Bash command exactly: for i in 1 2 3 4 5; do echo tick $i; sleep 2; done. Then reply with the word FIRST.')
      const until = Date.now() + 60_000
      while (Date.now() < until && !events.some(event => event.type === 'session')) await new Promise(resolve => setTimeout(resolve, 200))
      await new Promise(resolve => setTimeout(resolve, 2000))
      await adapter.steer('Also, end your reply with the word SECOND.')
      await untilCompleted(events, 240_000)
    } finally { await adapter.dispose() }
    const answer = events.filter(event => event.type === 'message' && event.role === 'assistant').map(event => event.type === 'message' ? event.text : '').join('\n')
    console.log('Steered answer:', answer.trim().slice(0, 200))
    expect(answer).toContain('FIRST')
    expect(answer).toContain('SECOND')
    expect(events.filter(event => event.type === 'completed')).toHaveLength(1)
  }, 300_000)

  it('Claude: the init directory and an EnterWorktree move are reported and resolve to the worktree', async () => {
    const repo = repository()
    const events: ThreadEvent[] = []
    const adapter = new ClaudeConversationAdapter((args, cwd) => new AgentProcessTransport('claude', args, cwd))
    try {
      await adapter.start({ rootPath: repo, nativeSessionId: null, access: 'full-access' }, event => events.push(event))
      await adapter.send('Use the EnterWorktree tool to create and enter a worktree named live. Then run the Bash command git branch --show-current and reply with its output only.')
      await untilCompleted(events, 240_000)
    } finally { await adapter.dispose() }
    const reported = events.flatMap(event => event.type === 'location' ? [event.cwd] : [])
    console.log('Claude reported directories:', reported)
    expect(reported[0]?.toLowerCase()).toBe(repo.toLowerCase())
    const moved = reported.map(cwd => resolveSessionLocation(cwd, repo)).find(location => location?.checkoutRoot?.toLowerCase().endsWith(join('.claude', 'worktrees', 'live').toLowerCase()))
    expect(moved).toMatchObject({ sameRepository: true })
  }, 300_000)
})
