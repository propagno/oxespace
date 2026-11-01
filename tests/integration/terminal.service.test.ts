import { randomUUID } from 'node:crypto'
import { ThreadProjectService } from '../../electron/main/services/conversation/thread-projects'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openInMemoryDatabase } from '../../electron/main/db/index'
import { WorkspaceService } from '../../electron/main/services/workspace.service'
import { RtkService } from '../../electron/main/services/rtk.service'
import { __resetExecutableCacheForTests, TerminalManager, resolveExecutable } from '../../electron/main/services/terminal.service'

// Starting a terminal waits a few seconds for RTK, which the real service downloads from GitHub. No test here may
// depend on the network or that wait: one that started two terminals hit its 5 s timeout on a slow Windows runner.
beforeEach(() => { vi.spyOn(RtkService.prototype, 'ensureRtk').mockResolvedValue('/test/rtk/bin') })
afterEach(() => { vi.restoreAllMocks() })

describe('TerminalManager', () => {
  test('runs an independent Thread shell without creating Code panes and rejects cross-owner launches', async () => {
    const root = mkdtempSync(join(tmpdir(), 'oxe-thread-shell-'))
    const db = openInMemoryDatabase(), projects = new ThreadProjectService(db)
    db.prepare("INSERT OR IGNORE INTO shell_profiles(id,name,executable,args_json,is_builtin) VALUES ('builtin-bash','Bash','/bin/bash','[]',1)").run()
    const pty = createFakePtyModule(), manager = new TerminalManager(db, { pty, platform: 'linux' })
    try {
      const project = await projects.add(root)
      const thread = { id: randomUUID(), workspaceId: `thread:${project.projectId}`, projectId: project.projectId, rootPath: projects.context(project.projectId).rootPath }
      db.prepare('INSERT INTO conversation_threads (id, workspace_id, thread_project_id, data_json) VALUES (?, ?, ?, ?)').run(thread.id, thread.workspaceId, thread.projectId, JSON.stringify(thread))
      const input = { workspaceId: thread.workspaceId, paneId: `thread-shell:${thread.id}:1`, disableRtk: true }
      await expect(manager.start({ ...input, workspaceId: 'other' })).rejects.toThrow('owner is unavailable')
      await expect(manager.start({ ...input, agentCommand: 'claude' })).rejects.toThrow('interactive shell')
      await manager.start(input)
      expect(pty.spawn).toHaveBeenCalledWith(expect.stringMatching(/bash$/), expect.any(Array), expect.objectContaining({ cwd: thread.rootPath }))
      expect(db.prepare('SELECT id FROM workspaces').all()).toEqual([])
      expect(db.prepare('SELECT id FROM panes').all()).toEqual([])
      manager.detach(input)
      expect(manager.attach(input).running).toBe(true)
      manager.stop(input)
      expect(manager.status(input.paneId).running).toBe(false)
    } finally { manager.stopAll(); db.close(); rmSync(root, { recursive: true, force: true }) }
  })

  test('starts a registered container shell with exactly the registered command and nothing else', async () => {
    const db = openInMemoryDatabase()
    const pty = createFakePtyModule()
    const registered = new Map([['oxequery-shell:11111111-1111-4111-8111-111111111111', { file: 'docker', args: ['exec', '-it', 'pg-dev', 'sh'] }]])
    const manager = new TerminalManager(db, { pty, platform: 'linux', oxeQueryShell: paneId => registered.get(paneId),
      executionEnvironment: () => { throw Error('container shells must not receive workspace execution credentials') },
      prepareLaunch: async () => { throw Error('container shells must not run launch integrations') } })
    const input = { workspaceId: 'oxequery', paneId: 'oxequery-shell:11111111-1111-4111-8111-111111111111', disableRtk: true }
    try {
      await expect(manager.start({ ...input, agentCommand: 'rm -rf /' })).rejects.toThrow('registered command only')
      await expect(manager.start({ ...input, launch: { executable: 'sh', args: ['-c', 'id'] } })).rejects.toThrow('registered command only')
      await manager.start(input)
      expect(pty.spawn).toHaveBeenCalledTimes(1)
      expect(pty.spawn).toHaveBeenCalledWith('docker', ['exec', '-it', 'pg-dev', 'sh'], expect.anything())
      // A pane id nobody registered is just a pane that does not exist.
      await expect(manager.start({ ...input, paneId: 'oxequery-shell:22222222-2222-4222-8222-222222222222' })).rejects.toThrow()
      expect(pty.spawn).toHaveBeenCalledTimes(1)
    } finally { manager.stopAll(); db.close() }
  })

  test('passes an exact native resume ID as separate agent arguments', async () => {
    const db = openInMemoryDatabase()
    const workspace = new WorkspaceService(db).create({ rootPath: 'C:/repo', layout: '1x1', autoStart: false })
    const pty = createFakePtyModule()
    const manager = new TerminalManager(db, { pty, platform: 'linux' })
    try {
      const id = '11111111-1111-4111-8111-111111111111'
      await manager.start({ workspaceId: workspace.id, paneId: workspace.panes[0].id, agentCommand: 'codex', agentArgs: ['resume', id, '--no-alt-screen'], disableRtk: true })
      expect(pty.spawn).toHaveBeenCalledWith('codex', ['resume', id, '--no-alt-screen'], expect.anything())
    } finally { manager.stopAll(); db.close() }
  })
  test('Windows terminals use the bundled ConPTY, whose kill never forks a helper (B13); others do not ask for it', async () => {
    for (const [platform, expected] of [['win32', true], ['linux', undefined]] as const) {
      const db = openInMemoryDatabase()
      const workspace = new WorkspaceService(db).create({ rootPath: 'C:/repo', layout: '1x1', autoStart: false })
      const pty = createFakePtyModule()
      const manager = new TerminalManager(db, { pty, platform })
      try {
        await manager.start({ workspaceId: workspace.id, paneId: workspace.panes[0].id, agentCommand: 'codex', disableRtk: true })
        expect((pty.spawn.mock.calls[0][2] as { useConptyDll?: boolean }).useConptyDll).toBe(expected)
      } finally { manager.stopAll(); db.close() }
    }
  })
  test('records an agent that cannot start as an incident, with only its name hashed (B8.3)', async () => {
    const { connectIncidentJournal, incidentSubject } = await import('../../electron/main/services/diagnostics/incident-sink')
    const recorded: Array<[string, string | undefined]> = []
    connectIncidentJournal(async () => ({ record: (code, subject) => { recorded.push([code, subject]) }, flush: () => undefined }))
    const db = openInMemoryDatabase()
    const workspace = new WorkspaceService(db).create({ rootPath: 'C:/repo', layout: '1x1', autoStart: false })
    const pty = createFakePtyModule()
    pty.spawn.mockImplementationOnce(() => { throw new Error('ENOENT /home/person/bin/claude') })
    const manager = new TerminalManager(db, { pty, platform: 'linux' })
    try {
      await expect(manager.start({ workspaceId: workspace.id, paneId: workspace.panes[0].id, agentCommand: 'claude --model x', disableRtk: true })).rejects.toThrow('Unable to start agent')
      await vi.waitFor(() => expect(recorded).toEqual([['incident.agent.startFailed', incidentSubject('claude')]]))
    } finally { manager.stopAll(); db.close(); connectIncidentJournal(null) }
  })
  test('reopens the recorded agent session on the first start after the app opens, only when asked and only once', async () => {
    const { PaneAgentSessions } = await import('../../electron/main/services/agent-state/pane-sessions')
    const db = openInMemoryDatabase()
    const workspace = new WorkspaceService(db).create({ rootPath: 'C:/repo', layout: '1x2', autoStart: false })
    const [agentPane, shellPane] = workspace.panes
    const sessions = new PaneAgentSessions(db)
    sessions.record(agentPane.id, 'claude', 'abc-123')
    sessions.record(shellPane.id, 'codex', 'def-456')
    sessions.record(agentPane.id, 'claude', 'bad id; rm -rf')
    const pty = createFakePtyModule()
    const manager = new TerminalManager(db, { pty, platform: 'linux', resumeSession: (paneId, wanted) => sessions.take(paneId, wanted) })
    try {
      await manager.start({ workspaceId: workspace.id, paneId: agentPane.id, agentCommand: 'claude', disableRtk: true, resumeAgent: true })
      expect(pty.spawn).toHaveBeenLastCalledWith('claude', ['--resume', 'abc-123'], expect.anything())
      manager.stop({ paneId: agentPane.id })
      // A later start in the same run is the person's choice: it starts fresh.
      await manager.start({ workspaceId: workspace.id, paneId: agentPane.id, agentCommand: 'claude', disableRtk: true, resumeAgent: true })
      expect(pty.spawn).toHaveBeenLastCalledWith('claude', [], expect.anything())
      // Not asked: the shell pane starts plain.
      await manager.start({ workspaceId: workspace.id, paneId: shellPane.id, disableRtk: true })
      expect(pty.instances.at(-1)!.write).not.toHaveBeenCalled()
    } finally { manager.stopAll(); db.close() }
  })
  test('types the resume command into a shell pane where the agent was started by hand', async () => {
    vi.useFakeTimers()
    const { PaneAgentSessions } = await import('../../electron/main/services/agent-state/pane-sessions')
    const db = openInMemoryDatabase()
    const workspace = new WorkspaceService(db).create({ rootPath: 'C:/repo', layout: '1x1', autoStart: false })
    const sessions = new PaneAgentSessions(db)
    sessions.record(workspace.panes[0].id, 'codex', 'def-456')
    const pty = createFakePtyModule()
    const manager = new TerminalManager(db, { pty, platform: 'linux', resumeSession: (paneId, wanted) => sessions.take(paneId, wanted) })
    try {
      await manager.start({ workspaceId: workspace.id, paneId: workspace.panes[0].id, disableRtk: true, resumeAgent: true })
      const instance = pty.instances.at(-1)!
      instance.emitData('$ ')
      await vi.advanceTimersByTimeAsync(900)
      expect(instance.write).toHaveBeenCalledWith('codex resume def-456 --no-alt-screen\r')
    } finally { vi.useRealTimers(); manager.stopAll(); db.close() }
  })
  test('a stalled RTK download does not hold the first terminal back', async () => {
    const db = openInMemoryDatabase()
    const workspace = new WorkspaceService(db).create({ rootPath: 'C:/repo', layout: '1x1', autoStart: false })
    const pty = createFakePtyModule()
    const ensure = vi.spyOn(RtkService.prototype, 'ensureRtk').mockImplementation(() => new Promise<string>(() => undefined))
    const manager = new TerminalManager(db, { pty, platform: 'linux' })
    try {
      const started = Date.now()
      await manager.start({ workspaceId: workspace.id, paneId: workspace.panes[0].id, agentCommand: 'codex' })
      expect(Date.now() - started).toBeLessThan(8000)
      expect(pty.spawn).toHaveBeenCalledTimes(1)
      expect(ensure).toHaveBeenCalled()
    } finally { ensure.mockRestore(); manager.stopAll(); db.close() }
  }, 15_000)

  test('managed launches preserve structured arguments and refuse a missing worktree fallback', async () => {
    const root = mkdtempSync(join(tmpdir(), 'oxe-managed-launch-'))
    const db = openInMemoryDatabase()
    const workspaceService = new WorkspaceService(db)
    const ws = workspaceService.create({ rootPath: root, layout: '1x1', autoStart: false })
    const pty = createFakePtyModule()
    const manager = new TerminalManager(db, { pty, platform: 'linux', isManagedPane: () => true,
      executionEnvironment: () => ({ OXESPACE_EXECUTION_ID: 'independent-execution' }) })
    const input = { workspaceId: ws.id, paneId: ws.panes[0].id, disableRtk: true }
    try {
      await expect(manager.start(input)).rejects.toThrow('managed by its task')
      const args = ['--', 'A prompt with spaces, quotes " and $ characters']
      await manager.start({ ...input, requireCwd: root, launch: { executable: 'codex', args } })
      expect(pty.spawn).toHaveBeenCalledWith('codex', args, expect.objectContaining({ cwd: root,
        env: expect.objectContaining({ OXESPACE_EXECUTION_ID: 'independent-execution' }) }))
      manager.stop(input)
      const missing = join(root, 'missing-worktree')
      workspaceService.setPaneRootPath(input.paneId, missing)
      await expect(manager.start({ ...input, requireCwd: missing, launch: { executable: 'codex', args } })).rejects.toThrow('refusing workspace-root fallback')
      expect(pty.spawn).toHaveBeenCalledTimes(1)
    } finally { manager.stopAll(); db.close(); rmSync(root, { recursive: true, force: true }) }
  })
  test('a provider launch withholds unrelated secrets but keeps its own auth; a plain shell keeps everything', async () => {
    const db = openInMemoryDatabase()
    const workspace = new WorkspaceService(db).create({ rootPath: 'C:/repo', layout: '1x1', autoStart: false })
    const pty = createFakePtyModule()
    const env = { PATH: '/bin', ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'o', GITHUB_TOKEN: 'g', AWS_ACCESS_KEY_ID: 'k' }
    const manager = new TerminalManager(db, { pty, platform: 'linux', env })
    const input = { workspaceId: workspace.id, paneId: workspace.panes[0].id, disableRtk: true }
    try {
      await manager.start({ ...input, agentCommand: 'claude' })
      const claudeEnv = pty.spawn.mock.calls.at(-1)![2].env as Record<string, string>
      expect(claudeEnv).toMatchObject({ PATH: '/bin', ANTHROPIC_API_KEY: 'a' })
      for (const name of ['OPENAI_API_KEY', 'GITHUB_TOKEN']) expect(claudeEnv[name]).toBeUndefined()
      manager.stop(input)
      await manager.start(input)
      expect(pty.spawn.mock.calls.at(-1)![2].env).toMatchObject({ GITHUB_TOKEN: 'g', OPENAI_API_KEY: 'o' })
    } finally { manager.stopAll(); db.close() }
  })
  test('stopping an in-flight optional launch cannot spawn a late process', async () => {
    const db = openInMemoryDatabase()
    const workspace = new WorkspaceService(db).create({ rootPath: 'C:/repo', layout: '1x1', autoStart: false })
    const pty = createFakePtyModule()
    const manager = new TerminalManager(db, { pty, platform: 'linux', prepareLaunch: () => new Promise(() => {}),
      onLaunchExit: () => { throw new Error('Optional cleanup unavailable') } })
    try {
      const input = { workspaceId: workspace.id, paneId: workspace.panes[0].id, disableRtk: true }
      const starting = manager.start(input)
      manager.stop(input)
      await starting
      expect(pty.spawn).not.toHaveBeenCalled()
    } finally { manager.stopAll(); db.close() }
  })
  test('memory integration failure cannot prevent terminal startup or restart', async () => {
    const db = openInMemoryDatabase()
    const workspace = new WorkspaceService(db).create({ rootPath: 'C:/repo', layout: '1x1', autoStart: false })
    const pty = createFakePtyModule()
    const manager = new TerminalManager(db, { pty, platform: 'linux', prepareLaunch: async () => { throw new Error('AI Memory unavailable') } })
    try {
      const input = { workspaceId: workspace.id, paneId: workspace.panes[0].id, disableRtk: true }
      await manager.start(input)
      expect(manager.hasSession(input.paneId)).toBe(true)
      await manager.restart(input)
      expect(pty.spawn).toHaveBeenCalledTimes(2)
      expect(manager.hasSession(input.paneId)).toBe(true)
    } finally { manager.stopAll(); db.close() }
  })
  test('spawns isolated ptys with workspace cwd and shell profile', async () => {
    const db = openInMemoryDatabase()
    const workspaceService = new WorkspaceService(db)
    const workspace = workspaceService.create({ rootPath: 'C:/repo', layout: '1x2', autoStart: false })
    const pty = createFakePtyModule()
    const emitData = vi.fn()
    const manager = new TerminalManager(db, { pty, emitData, platform: 'linux' })

    await manager.start({ workspaceId: workspace.id, paneId: workspace.panes[0].id })
    await manager.start({ workspaceId: workspace.id, paneId: workspace.panes[1].id })

    expect(pty.spawn).toHaveBeenCalledTimes(2)
    expect(pty.spawn).toHaveBeenNthCalledWith(
      1,
      'claude',
      [],
      expect.objectContaining({ cwd: 'C:/repo', cols: 80, rows: 24 })
    )

    pty.instances[0].emitData('A')
    pty.instances[1].emitData('B')

    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(emitData).toHaveBeenCalledWith({ paneId: workspace.panes[0].id, data: 'A' })
    expect(emitData).toHaveBeenCalledWith({ paneId: workspace.panes[1].id, data: 'B' })

    manager.write({ paneId: workspace.panes[0].id, data: 'echo A\r' })
    manager.resize({ paneId: workspace.panes[0].id, cols: 120, rows: 32 })
    manager.stop({ paneId: workspace.panes[0].id })

    expect(pty.instances[0].write).toHaveBeenCalledWith('echo A\r')
    expect(pty.instances[0].resize).toHaveBeenCalledWith(120, 32)
    expect(pty.instances[0].kill).toHaveBeenCalled()
    expect(manager.hasSession(workspace.panes[0].id)).toBe(false)

    db.close()
  })

  test('a policy that blocks an agent stops its pane from starting, and leaves a plain shell alone', async () => {
    const { setPolicyStore } = await import('../../electron/main/services/policy')
    const { PolicyStore } = await import('../../electron/main/services/policy/policy-store')
    const userData = mkdtempSync(join(tmpdir(), 'oxe-terminal-policy-'))
    writeFileSync(join(userData, 'policy.json'), JSON.stringify({ rules: [{ effect: 'deny', action: 'provider.use', resource: 'codex' }] }))
    setPolicyStore(new PolicyStore({ userData, managed: join(userData, 'none.json') }))
    const db = openInMemoryDatabase()
    const workspace = new WorkspaceService(db).create({ rootPath: 'C:/repo', layout: '1x2', autoStart: false })
    const pty = createFakePtyModule()
    const manager = new TerminalManager(db, { pty, platform: 'linux' })
    try {
      await expect(manager.start({ workspaceId: workspace.id, paneId: workspace.panes[0].id, agentCommand: 'codex --full-auto' })).rejects.toThrow('Codex is blocked by your policy.')
      expect(pty.spawn).not.toHaveBeenCalled()
      await manager.start({ workspaceId: workspace.id, paneId: workspace.panes[1].id })
      expect(pty.spawn).toHaveBeenCalledTimes(1)
    } finally { setPolicyStore(null); manager.stopAll(); db.close(); rmSync(userData, { recursive: true, force: true }) }
  })

  test('resolves Windows command shims through PATHEXT', () => {
    __resetExecutableCacheForTests()
    const binDir = mkdtempSync(join(tmpdir(), 'oxespace-path-'))
    const shim = join(binDir, 'copilot.cmd')
    writeFileSync(shim, '@echo off')

    try {
      expect(resolveExecutable('copilot', { PATH: binDir, PATHEXT: '.EXE;.CMD' }, 'win32')).toBe(shim)
    } finally {
      rmSync(binDir, { recursive: true, force: true })
    }
  })

  test('reports shell profile failures without creating a session', async () => {
    const db = openInMemoryDatabase()
    const workspaceService = new WorkspaceService(db)
    const workspace = workspaceService.create({
      rootPath: 'C:/repo',
      layout: '1x1',
      defaultShellProfileId: 'builtin-copilot',
      autoStart: false
    })
    const pty = {
      spawn: vi.fn(() => {
        throw new Error('ENOENT')
      })
    }
    const manager = new TerminalManager(db, { pty, platform: 'linux' })

    // builtin-copilot wraps the platform shell (powershell.exe / /bin/bash), and
    // the error quotes whichever executable the profile actually holds.
    const wrappedShell = process.platform === 'win32' ? 'powershell\\.exe' : '/bin/bash'
    await expect(manager.start({ workspaceId: workspace.id, paneId: workspace.panes[0].id })).rejects.toThrow(
      new RegExp(`Check Settings > Shell profiles executable "${wrappedShell}"`)
    )
    expect(manager.hasSession(workspace.panes[0].id)).toBe(false)

    db.close()
  })
})

/**
 * Detaching a view must not kill the shell — that is what made returning to a
 * workspace cost a full respawn. These cover the handoff itself: no output may
 * be lost while detached, and none may be duplicated or skipped on re-attach.
 */
describe('TerminalManager attach/detach', () => {
  const setup = async () => {
    const db = openInMemoryDatabase()
    const workspaceService = new WorkspaceService(db)
    const workspace = workspaceService.create({ rootPath: 'C:/repo', layout: '1x1', autoStart: false })
    const pty = createFakePtyModule()
    const emitData = vi.fn()
    const emitActivity = vi.fn()
    const manager = new TerminalManager(db, { pty, emitData, emitActivity, platform: 'linux' })
    const paneId = workspace.panes[0].id
    await manager.start({ workspaceId: workspace.id, paneId })
    return { db, manager, pty, emitData, emitActivity, paneId }
  }

  /** The batcher coalesces for 16ms before emitting. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 25))

  test('keeps the process alive and buffers output while detached', async () => {
    const { db, manager, pty, emitData, emitActivity, paneId } = await setup()

    manager.detach({ paneId })
    pty.instances[0].emitData('while away')
    await settle()

    // The shell must survive a view unmounting.
    expect(pty.instances[0].kill).not.toHaveBeenCalled()
    expect(manager.hasSession(paneId)).toBe(true)
    // No payload crosses the IPC boundary for a pane nobody is rendering…
    expect(emitData).not.toHaveBeenCalled()
    // …but the UI still learns the agent is working.
    expect(emitActivity).toHaveBeenCalledWith(expect.objectContaining({ paneId, bytes: 10 }))
    expect(manager.status(paneId)).toMatchObject({ running: true })
    const info = manager.status(paneId)
    expect(info.sessionId).toMatch(/^[0-9a-f-]{36}$/)
    expect(info.launchDirectory).toBeTruthy()
    expect(info.executable).toBeTruthy()
    expect(info.startedAt).toBeGreaterThan(0)
    expect(manager.status(paneId).sessionId).toBe(info.sessionId)

    db.close()
  })

  test('replays what was missed without dropping or duplicating a byte', async () => {
    const { db, manager, pty, emitData, paneId } = await setup()

    pty.instances[0].emitData('A')
    await settle()
    expect(emitData).toHaveBeenCalledWith({ paneId, data: 'A' })
    emitData.mockClear()

    manager.detach({ paneId })
    pty.instances[0].emitData('B')
    await settle()

    const attached = manager.attach({ paneId })
    // Everything produced so far comes back at once…
    expect(attached.running).toBe(true)
    expect(attached.replay).toBe('AB')
    expect(attached.truncated).toBe(false)
    // …and nothing was streamed while detached.
    expect(emitData).not.toHaveBeenCalled()

    pty.instances[0].emitData('C')
    await settle()
    // Only the new byte streams — 'B' is not delivered a second time.
    expect(emitData).toHaveBeenCalledTimes(1)
    expect(emitData).toHaveBeenCalledWith({ paneId, data: 'C' })

    db.close()
  })

  test('a fresh view that attaches to a live session gets the whole buffer', async () => {
    const { db, manager, pty, paneId } = await setup()

    pty.instances[0].emitData('history')
    await settle()
    manager.detach({ paneId })

    // No cursor: this is a newly constructed xterm, so it needs everything.
    expect(manager.attach({ paneId }).replay).toBe('history')

    db.close()
  })

  test('redraws a full-screen TUI only after the attached renderer is ready', async () => {
    const { db, manager, pty, paneId } = await setup()

    manager.resize({ paneId, cols: 100, rows: 30 })
    pty.instances[0].emitData('\x1b[?1049hTUI FRAME')
    await settle()
    manager.detach({ paneId })
    pty.instances[0].resize.mockClear()

    const attached = manager.attach({ paneId })

    // Replaying alt-screen bytes would paint TUI content onto the normal
    // buffer; the app is asked to repaint instead.
    expect(attached.altScreen).toBe(true)
    expect(attached.replay).toBe('')
    expect(attached.prologue).toContain('\x1b[?1049h')
    expect(pty.instances[0].resize).not.toHaveBeenCalled()
    manager.resize({ paneId, cols: 100, rows: 30 })
    expect(pty.instances[0].resize).toHaveBeenCalledWith(100, 29)

    db.close()
  })

  test('surfaces a crash that happened while detached instead of respawning silently', async () => {
    const { db, manager, pty, paneId } = await setup()

    manager.detach({ paneId })
    pty.instances[0].emitData('stack trace')
    await settle()
    pty.instances[0].emitExit(1)

    const attached = manager.attach({ paneId })
    expect(attached.running).toBe(false)
    expect(attached.exit).toMatchObject({ exitCode: 1 })
    // The output that explains the death must still be readable.
    expect(attached.replay).toContain('stack trace')

    db.close()
  })

  test('an explicit stop leaves nothing to explain on the next attach', async () => {
    const { db, manager, pty, paneId } = await setup()

    pty.instances[0].emitData('output')
    await settle()
    manager.stop({ paneId })

    const attached = manager.attach({ paneId })
    expect(attached).toMatchObject({ running: false, replay: '' })
    expect(attached.exit).toBeUndefined()

    db.close()
  })

  test('flushes pending output before disposing so last words survive', async () => {
    const { db, manager, pty, emitData, paneId } = await setup()

    // Inside the batcher's 16ms window — previously discarded by dispose().
    pty.instances[0].emitData('fatal: boom')
    manager.stop({ paneId })

    expect(emitData).toHaveBeenCalledWith({ paneId, data: 'fatal: boom' })

    db.close()
  })

  test('counts detached sessions for the status bar', async () => {
    const { db, manager, paneId } = await setup()

    expect(manager.countDetached()).toBe(0)
    manager.detach({ paneId })
    expect(manager.countDetached()).toBe(1)
    manager.attach({ paneId })
    expect(manager.countDetached()).toBe(0)

    db.close()
  })

  test('spawns at the geometry the view reported', async () => {
    const db = openInMemoryDatabase()
    const workspaceService = new WorkspaceService(db)
    const workspace = workspaceService.create({ rootPath: 'C:/repo', layout: '1x1', autoStart: false })
    const pty = createFakePtyModule()
    const manager = new TerminalManager(db, { pty, platform: 'linux' })

    await manager.start({ workspaceId: workspace.id, paneId: workspace.panes[0].id, cols: 132, rows: 43 })

    // Starting at 80x24 and resizing afterwards makes the app reflow once,
    // which the user sees as a flash.
    expect(pty.spawn).toHaveBeenCalledWith('claude', [], expect.objectContaining({ cols: 132, rows: 43 }))

    db.close()
  })
})

function createFakePtyModule() {
  const instances: Array<ReturnType<typeof createFakePty>> = []
  return {
    instances,
    spawn: vi.fn((_file: string, _args: string[], _options: unknown) => {
      const instance = createFakePty()
      instances.push(instance)
      return instance
    })
  }
}

function createFakePty() {
  let dataHandler: ((data: string) => void) | null = null
  let exitHandler: ((event: { exitCode: number }) => void) | null = null

  return {
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn((handler: (data: string) => void) => {
      dataHandler = handler
      return { dispose: vi.fn() }
    }),
    onExit: vi.fn((handler: (event: { exitCode: number }) => void) => {
      exitHandler = handler
      return { dispose: vi.fn() }
    }),
    emitData: (data: string) => dataHandler?.(data),
    emitExit: (exitCode: number) => exitHandler?.({ exitCode })
  }
}
