import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import {
  findContextDirectives,
  findMentions,
  resolveFolderTree,
  resolveMentionContext
} from '../../electron/main/services/conversation/thread-context-resolver'
import {
  resolveGitChangesContext,
  resolveTerminalContext,
  resolveThreadReferenceContext
} from '../../electron/main/services/conversation/thread-context-sources'
import { ThreadManager } from '../../electron/main/services/conversation/thread-manager'
import type { ThreadSideTerminalHost } from '../../electron/main/services/conversation/side-chat-context'
import type { AgentConversationAdapter } from '../../shared/types/thread'
import { removeTempDir } from '../helpers/removeTempDir'

const roots: string[] = []
const databases: AppDatabase[] = []

afterEach(() => {
  for (const db of databases.splice(0)) db.close()
  for (const root of roots.splice(0)) removeTempDir(root)
})

function createTempRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'oxe-478-ctx-'))
  roots.push(root)
  mkdirSync(join(root, 'src', 'ui'), { recursive: true })
  mkdirSync(join(root, 'docs', 'my notes'), { recursive: true })
  mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true })
  writeFileSync(join(root, 'src', 'app.ts'), 'export const version = 1\n')
  writeFileSync(join(root, 'src', 'ui', 'Chip.tsx'), 'export const Chip = () => null\n')
  writeFileSync(join(root, 'docs', 'my notes', 'plan.md'), '# Plan\nDetails here\n')
  writeFileSync(join(root, 'Dockerfile'), 'FROM node:22\n')
  writeFileSync(join(root, 'node_modules', 'pkg', 'index.js'), 'module.exports = {}\n')
  return root
}

function initGitRepo(root: string): void {
  const git = (args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' })
  git(['init'])
  git(['config', 'user.email', 'test@oxespace.local'])
  git(['config', 'user.name', 'OXE Test'])
  git(['add', 'src/app.ts', 'Dockerfile'])
  git(['commit', '-m', 'initial'])
}

describe('OXE-478 · Composer Context Directives & Main-Process Resolver', () => {
  it('parses file mentions (including quoted paths with spaces) and @changes/@terminal/@folder/@thread directives', () => {
    const prompt = 'Check @src/app.ts @"docs/my notes/plan.md" @"Dockerfile" @changes @terminal @terminal:pane-2 @folder:src/ui @folder:"docs/my notes" @thread:t-abc'
    expect(findMentions(prompt)).toEqual(['src/app.ts', 'docs/my notes/plan.md', 'Dockerfile'])
    expect(findContextDirectives(prompt)).toEqual({
      files: ['src/app.ts', 'docs/my notes/plan.md', 'Dockerfile'],
      folders: ['src/ui', 'docs/my notes'],
      changes: true,
      terminals: [{}, { paneId: 'pane-2' }],
      threads: ['t-abc']
    })
  })

  it('resolves @folder bounded directory tree, skips node_modules/.git, and rejects outside traversal', async () => {
    const root = createTempRepo()
    const outside = mkdtempSync(join(tmpdir(), 'oxe-478-outside-'))
    roots.push(outside)
    writeFileSync(join(outside, 'secret.txt'), 'nope')

    const resolved = await resolveFolderTree(root, '.')
    expect(resolved).not.toBeNull()
    expect(resolved!.block).toContain('<attached_folder path=".">')
    expect(resolved!.block).toContain('src/')
    expect(resolved!.block).toContain('Chip.tsx')
    expect(resolved!.block).not.toContain('node_modules')

    // Reject path traversal outside workspace root.
    expect(await resolveFolderTree(root, `../${outside.split(/[\\/]/).pop()}`)).toBeNull()

    // Symlink pointing outside workspace must not be traversed (best-effort on OS allowing symlinks).
    try {
      symlinkSync(outside, join(root, 'escape-link'), 'junction')
      const linkTree = await resolveFolderTree(root, 'escape-link')
      expect(linkTree).toBeNull()
    } catch {
      /* Symlink creation may require elevated privilege on some Windows hosts. */
    }
  })

  it('resolves @changes for a Git repository with bounded diff and secret redaction', { timeout: 20_000 }, async () => {
    const root = createTempRepo()
    initGitRepo(root)

    // Clean tree reports cleanly.
    writeFileSync(join(root, '.gitignore'), 'node_modules/\ndocs/\nsrc/ui/\n')
    execFileSync('git', ['add', '.gitignore'], { cwd: root, stdio: 'pipe' })
    execFileSync('git', ['commit', '-m', 'ignore'], { cwd: root, stdio: 'pipe' })
    const clean = await resolveGitChangesContext(root)
    expect(clean?.block).toContain('working tree is clean')

    // Modify tracked file and add untracked file -> captured and bounded.
    writeFileSync(join(root, 'src', 'app.ts'), 'export const version = 2\nconst token = "ghp_1234567890abcdef1234567890abcdef1234"\n')
    writeFileSync(join(root, 'src', 'new-file.ts'), 'export const fresh = true\n')

    const dirty = await resolveGitChangesContext(root, 4096)
    expect(dirty).not.toBeNull()
    expect(dirty!.label).toBe('@changes')
    expect(dirty!.block).toContain('<attached_changes')
    expect(dirty!.block).toContain('src/app.ts')
    expect(dirty!.block).toContain('src/new-file.ts')
    expect(dirty!.block).toContain('export const version = 2')

    // Tight byte cap truncates cleanly.
    const tiny = await resolveGitChangesContext(root, 80)
    expect(tiny?.truncated).toBe(true)
    expect(tiny?.block).toContain('truncated="true"')
  })

  it('resolves @terminal from live ScreenMirror or peek buffer, strips ANSI, and enforces pane authorization', async () => {
    const terminalHost: ThreadSideTerminalHost = {
      peek: paneId =>
        paneId === 'thread-shell:t1:1'
          ? { running: true, data: '\x1b[32mPASS\x1b[0m tests/app.test.ts\n', altScreen: false }
          : null,
      readScreen: paneId =>
        paneId === 'pane-screen'
          ? { screen: 'ScreenMirror live output\nReady >', oscTitle: 'Shell', oscProgress: '' }
          : null,
      shellCwd: () => '/repo'
    }

    // Auto-selects the thread's integrated shell when no paneId is specified.
    const auto = await resolveTerminalContext({ threadId: 't1', terminal: terminalHost })
    expect(auto).not.toBeNull()
    expect(auto!.block).toContain('<attached_terminal')
    expect(auto!.block).toContain('PASS tests/app.test.ts')
    expect(auto!.block).not.toContain('\x1b[32m')

    // Explicit authorized pane uses live ScreenMirror when available.
    const screenMirror = await resolveTerminalContext({
      threadId: 't1',
      paneId: 'pane-screen',
      terminal: terminalHost,
      isAllowedPane: id => id === 'pane-screen'
    })
    expect(screenMirror).not.toBeNull()
    expect(screenMirror!.block).toContain('ScreenMirror live output')

    // Unauthorized paneId is rejected.
    const refused = await resolveTerminalContext({
      threadId: 't1',
      paneId: 'foreign-pane',
      terminal: terminalHost,
      isAllowedPane: () => false
    })
    expect(refused).toBeNull()
  })

  it('resolves @thread:<id> from SQLite and integrates all sources cleanly in ThreadManager.send()', { timeout: 30_000 }, async () => {
    const root = createTempRepo()
    initGitRepo(root)
    writeFileSync(join(root, 'src', 'app.ts'), 'export const version = 99\n')

    const db = openInMemoryDatabase()
    databases.push(db)
    db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES ('ws-1', 'Repo', ?, '1x1', 'builtin-claude')").run(root)

    const sendSpy = vi.fn(async () => undefined)
    const factory = vi.fn(async () => ({
      capabilities: { resume: true, approvals: true, attachments: false, modelSelection: false },
      start: vi.fn(async (_c, emit) => emit({ type: 'session', nativeSessionId: 'native-1' })),
      send: sendSpy,
      interrupt: vi.fn(async () => undefined),
      approve: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined)
    }) as AgentConversationAdapter)

    const manager = new ThreadManager(db, factory, vi.fn())
    vi.spyOn((manager as unknown as { turns: { workingState: () => Promise<undefined> } }).turns, 'workingState').mockResolvedValue(undefined)

    const other = manager.create({ workspaceId: 'ws-1', projectId: 'proj-1', rootPath: root, provider: 'codex' })
    const otherSnap = manager.read(other.thread.id)
    otherSnap.thread.title = 'Auth migration'
    otherSnap.events.push(
      { type: 'message', id: 'm1', role: 'user', text: 'Migrate session tokens to PKCE' },
      { type: 'message', id: 'm2', role: 'assistant', text: 'Updated OAuth PKCE handler in src/auth.ts' }
    )
    db.prepare('UPDATE conversation_threads SET data_json = ?, events_json = ? WHERE id = ?')
      .run(JSON.stringify(otherSnap.thread), JSON.stringify(otherSnap.events), other.thread.id)

    // Direct unit check on resolveThreadReferenceContext.
    const threadRef = resolveThreadReferenceContext({ db, targetThreadId: other.thread.id })
    expect(threadRef).not.toBeNull()
    expect(threadRef!.label).toBe('@thread:Auth migration')
    expect(threadRef!.block).toContain('Migrate session tokens to PKCE')
    expect(threadRef!.block).toContain('Updated OAuth PKCE handler')

    // Wire terminal host on ThreadManager and send a prompt referencing all context sources.
    const main = manager.create({ workspaceId: 'ws-1', projectId: 'proj-1', rootPath: root, provider: 'claude' })
    manager.configureTerminal({
      peek: paneId =>
        paneId === `thread-shell:${main.thread.id}:1`
          ? { running: true, data: 'vitest: 42 passed\n', altScreen: false }
          : null,
      readScreen: () => null
    })

    await manager.send(
      main.thread.id,
      `Audit everything\n\n@src/app.ts @"docs/my notes/plan.md" @folder:src/ui @changes @terminal @thread:${other.thread.id}`
    )

    const delivered = sendSpy.mock.calls[0][0] as unknown as string
    expect(delivered).toContain('<attached_file path="src/app.ts">')
    expect(delivered).toContain('<attached_file path="docs/my notes/plan.md">')
    expect(delivered).toContain('<attached_folder path="src/ui">')
    expect(delivered).toContain('Chip.tsx')
    expect(delivered).toContain('<attached_changes')
    expect(delivered).toContain('export const version = 99')
    expect(delivered).toContain('<attached_terminal')
    expect(delivered).toContain('vitest: 42 passed')
    expect(delivered).toContain('<attached_thread')
    expect(delivered).toContain('Auth migration')

    const userMessage = manager.read(main.thread.id).events.find(event => event.type === 'message' && event.role === 'user')
    expect(userMessage?.type === 'message' && userMessage.context?.map(entry => entry.path)).toEqual([
      'src/app.ts',
      'docs/my notes/plan.md',
      '@folder:src/ui',
      '@changes',
      '@terminal (Terminal 1)',
      '@thread:Auth migration'
    ])

    // Empty resolve still returns empty block.
    expect(await resolveMentionContext(root, 'Nothing mentioned here')).toEqual({ block: '', files: [] })
    await manager.stop()
  })
})
