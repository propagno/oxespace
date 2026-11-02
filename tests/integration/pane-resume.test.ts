// B17 · Why the agent panes did not go back to their sessions after the crash of 31/10, one test per root cause, and
// what each pane tells the window. No provider ever runs: the PTY is a fake and the transcripts are fake files.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db/index'
import { WorkspaceService } from '../../electron/main/services/workspace.service'
import { RtkService } from '../../electron/main/services/rtk.service'
import { TerminalManager } from '../../electron/main/services/terminal.service'
import { PaneAgentSessions } from '../../electron/main/services/agent-state/pane-sessions'
import { encodeClaudeProjectPath } from '../../electron/main/services/usage/claude-project-path'
import { RESUME_LOAD_MS } from '../../electron/main/services/agent-state/pane-resume'

const A = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
const B = '019a5c1e-7b2d-7c3e-9f00-112233445566'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

let dir: string
let root: string
let roots: { claudeProjects: string; codexSessions: string }

beforeEach(() => {
  vi.spyOn(RtkService.prototype, 'ensureRtk').mockResolvedValue('/test/rtk/bin')
  dir = mkdtempSync(join(tmpdir(), 'oxe-b17-'))
  root = join(dir, 'repo')
  mkdirSync(root)
  roots = { claudeProjects: join(dir, 'claude', 'projects'), codexSessions: join(dir, 'codex', 'sessions') }
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); rmSync(dir, { recursive: true, force: true }) })

function claudeTranscript(id: string, cwd = root): void {
  const folder = join(roots.claudeProjects, encodeClaudeProjectPath(cwd))
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, `${id}.jsonl`), '{}\n')
}

function codexRollout(id: string): void {
  const folder = join(roots.codexSessions, '2026', '10', '31')
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, `rollout-2026-10-31T09-00-00-${id}.jsonl`), '{}\n')
}

/** One app run: its own session map and terminal manager over the same database, as after a restart. */
function run(db: AppDatabase) {
  const sessions = new PaneAgentSessions(db)
  const pty = createFakePtyModule()
  const terminals = new TerminalManager(db, {
    pty, platform: 'linux', nativeSessionRoots: roots,
    resumeSession: (paneId, wanted, again) => sessions.take(paneId, wanted, again),
    assignSession: (paneId, agent, sessionId) => sessions.record(paneId, agent, sessionId, 'launch'),
    clearSession: paneId => sessions.clear(paneId),
    currentSession: paneId => sessions.current(paneId)
  })
  return { sessions, pty, terminals }
}

function workspace(db: AppDatabase, layout: '1x1' | '1x2' = '1x1', rootPath = root) {
  return new WorkspaceService(db).create({ rootPath, layout, autoStart: false })
}

describe('root causes', () => {
  test('without the agent hooks installed nothing was ever recorded: main now names the Claude session it starts', async () => {
    const db = openInMemoryDatabase()
    const ws = workspace(db)
    const pane = ws.panes[0]
    const first = run(db)
    try {
      await first.terminals.start({ workspaceId: ws.id, paneId: pane.id, agentCommand: 'claude', disableRtk: true, resumeAgent: true })
      const [, args] = first.pty.spawn.mock.calls.at(-1)!
      expect(args.slice(0, 1)).toEqual(['--session-id'])
      const assigned = args[1]
      expect(assigned).toMatch(UUID)
      // No hook ever reports; the person talks to Claude, which writes the transcript; the app crashes.
      claudeTranscript(assigned)
      first.terminals.stopAll()
      const second = run(db)
      await second.terminals.start({ workspaceId: ws.id, paneId: pane.id, agentCommand: 'claude', disableRtk: true, resumeAgent: true })
      expect(second.pty.spawn).toHaveBeenLastCalledWith('claude', ['--resume', assigned], expect.objectContaining({ cwd: root }))
      expect(second.terminals.status(pane.id).agentResume).toEqual({ outcome: 'resumed', agent: 'claude', sessionId: assigned })
      second.terminals.stopAll()
    } finally { db.close() }
  })

  test('a session the hooks reported but the provider never wrote is not resumed into a dead pane', async () => {
    const db = openInMemoryDatabase()
    const ws = workspace(db)
    const pane = ws.panes[0]
    // SessionStart reports the id at launch; the person never sent a prompt, so Claude wrote no transcript.
    new PaneAgentSessions(db).record(pane.id, 'claude', A)
    const { pty, terminals } = run(db)
    try {
      await terminals.start({ workspaceId: ws.id, paneId: pane.id, agentCommand: 'claude', disableRtk: true, resumeAgent: true })
      const [file, args] = pty.spawn.mock.calls.at(-1)!
      expect(file).toBe('claude')
      expect(args).not.toContain('--resume')
      expect(args[0]).toBe('--session-id')
      expect(terminals.status(pane.id).agentResume).toEqual({ outcome: 'notResumed', agent: 'claude', sessionId: A, message: { code: 'agents.resume.sessionMissing', params: {} } })
    } finally { terminals.stopAll(); db.close() }
  })

  test('a pane where the agent was typed into a shell starts the agent with an argument vector, never typed into the shell', async () => {
    vi.useFakeTimers()
    const db = openInMemoryDatabase()
    const ws = workspace(db)
    const pane = ws.panes[0]
    new PaneAgentSessions(db).record(pane.id, 'codex', B)
    codexRollout(B)
    const { pty, terminals } = run(db)
    try {
      await terminals.start({ workspaceId: ws.id, paneId: pane.id, disableRtk: true, resumeAgent: true })
      expect(pty.spawn).toHaveBeenLastCalledWith('codex', ['resume', B, '--no-alt-screen'], expect.anything())
      pty.instances.at(-1)!.emitData('$ ')
      await vi.advanceTimersByTimeAsync(1_000)
      expect(pty.instances.at(-1)!.write).not.toHaveBeenCalled()
      expect(terminals.status(pane.id).agentResume).toEqual({ outcome: 'resumed', agent: 'codex', sessionId: B })
    } finally { terminals.stopAll(); db.close() }
  })

  test('a session that does not fit the start is reported, not dropped silently', async () => {
    const db = openInMemoryDatabase()
    const ws = workspace(db, '1x2')
    const [other, custom] = ws.panes
    const recorder = new PaneAgentSessions(db)
    recorder.record(other.id, 'claude', A)
    recorder.record(custom.id, 'claude', A)
    claudeTranscript(A)
    const { pty, terminals } = run(db)
    try {
      await terminals.start({ workspaceId: ws.id, paneId: other.id, agentCommand: 'codex', disableRtk: true, resumeAgent: true })
      expect(pty.spawn).toHaveBeenLastCalledWith('codex', [], expect.anything())
      expect(terminals.status(other.id).agentResume).toMatchObject({ outcome: 'notResumed', message: { code: 'agents.resume.otherAgent' } })
      await terminals.start({ workspaceId: ws.id, paneId: custom.id, agentCommand: 'claude', agentArgs: ['--model', 'x'], disableRtk: true, resumeAgent: true })
      expect(terminals.status(custom.id).agentResume).toMatchObject({ outcome: 'notResumed', message: { code: 'agents.resume.launchOverride' } })
    } finally { terminals.stopAll(); db.close() }
  })

  test('HML FINDING M: a root stored through a link or a short name resumes the transcript Claude filed under the real path', async () => {
    const alias = join(dir, 'alias')
    symlinkSync(root, alias, process.platform === 'win32' ? 'junction' : 'dir')
    const db = openInMemoryDatabase()
    const ws = workspace(db, '1x1', alias)
    new PaneAgentSessions(db).record(ws.panes[0].id, 'claude', A)
    // Claude started in the pane sees the canonical path (8.3 names expanded, links resolved) as its cwd.
    claudeTranscript(A, realpathSync.native(root))
    const { pty, terminals } = run(db)
    try {
      await terminals.start({ workspaceId: ws.id, paneId: ws.panes[0].id, agentCommand: 'claude', disableRtk: true, resumeAgent: true })
      expect(pty.spawn).toHaveBeenLastCalledWith('claude', ['--resume', A], expect.objectContaining({ cwd: alias }))
      expect(terminals.status(ws.panes[0].id).agentResume).toEqual({ outcome: 'resumed', agent: 'claude', sessionId: A })
    } finally { terminals.stopAll(); db.close() }
  })

  test('only a UUID is ever resumed', async () => {
    const db = openInMemoryDatabase()
    const ws = workspace(db)
    new PaneAgentSessions(db).record(ws.panes[0].id, 'claude', 'abc-123')
    const { pty, terminals } = run(db)
    try {
      await terminals.start({ workspaceId: ws.id, paneId: ws.panes[0].id, agentCommand: 'claude', disableRtk: true, resumeAgent: true })
      expect(pty.spawn.mock.calls.at(-1)![1]).not.toContain('--resume')
      expect(terminals.status(ws.panes[0].id).agentResume).toEqual({ outcome: 'nothingRecorded' })
    } finally { terminals.stopAll(); db.close() }
  })
})

describe('what the window reads per pane (terminal.status agentResume)', () => {
  test('resumed', async () => {
    const db = openInMemoryDatabase()
    const ws = workspace(db)
    new PaneAgentSessions(db).record(ws.panes[0].id, 'claude', A)
    claudeTranscript(A)
    const { pty, terminals } = run(db)
    try {
      await terminals.start({ workspaceId: ws.id, paneId: ws.panes[0].id, agentCommand: 'claude --model opus', disableRtk: true, resumeAgent: true })
      expect(pty.spawn).toHaveBeenLastCalledWith('claude', ['--model', 'opus', '--resume', A], expect.anything())
      expect(terminals.status(ws.panes[0].id).agentResume).toEqual({ outcome: 'resumed', agent: 'claude', sessionId: A })
      // A later start in the same run is the person's choice: fresh, and the status of the first start stays.
      terminals.stop({ paneId: ws.panes[0].id })
      await terminals.start({ workspaceId: ws.id, paneId: ws.panes[0].id, agentCommand: 'claude', disableRtk: true, resumeAgent: true })
      expect(pty.spawn.mock.calls.at(-1)![1]).not.toContain('--resume')
      expect(terminals.status(ws.panes[0].id).agentResume).toEqual({ outcome: 'resumed', agent: 'claude', sessionId: A })
    } finally { terminals.stopAll(); db.close() }
  })

  test('not resumed, with the reason as a C3 code (resume turned off)', async () => {
    const db = openInMemoryDatabase()
    const ws = workspace(db)
    new PaneAgentSessions(db).record(ws.panes[0].id, 'claude', A)
    claudeTranscript(A)
    const { terminals } = run(db)
    try {
      await terminals.start({ workspaceId: ws.id, paneId: ws.panes[0].id, agentCommand: 'claude', disableRtk: true })
      expect(terminals.status(ws.panes[0].id).agentResume).toEqual({ outcome: 'notResumed', agent: 'claude', sessionId: A, message: { code: 'agents.resume.disabled', params: {} } })
    } finally { terminals.stopAll(); db.close() }
  })

  test('nothing recorded, and nothing before the first start', async () => {
    const db = openInMemoryDatabase()
    const ws = workspace(db)
    const { terminals } = run(db)
    try {
      expect(terminals.status(ws.panes[0].id).agentResume).toBeUndefined()
      await terminals.start({ workspaceId: ws.id, paneId: ws.panes[0].id, disableRtk: true, resumeAgent: true })
      expect(terminals.status(ws.panes[0].id).agentResume).toEqual({ outcome: 'nothingRecorded' })
    } finally { terminals.stopAll(); db.close() }
  })
})

describe('Terminal details: the agent session a pane is in (terminal.status agentSession, S2)', () => {
  test('a Claude Code main started shows its own id, source launch, and the command that reopens it', async () => {
    const db = openInMemoryDatabase()
    const pane = workspace(db).panes[0]
    const { terminals, pty } = run(db)
    try {
      await terminals.start({ workspaceId: pane.workspaceId, paneId: pane.id, agentCommand: 'claude', disableRtk: true, resumeAgent: true })
      const assigned = pty.spawn.mock.calls.at(-1)![1][1]
      expect(terminals.status(pane.id).agentSession).toEqual({ agent: 'claude', sessionId: assigned, source: 'launch', resumeCommand: `claude --resume ${assigned}` })
    } finally { terminals.stopAll() }
  })

  test('a session main resumed after a restart reads as launch; one only remembered from before reads as recorded', async () => {
    const db = openInMemoryDatabase()
    const [left, right] = workspace(db, '1x2').panes
    new PaneAgentSessions(db).record(left.id, 'claude', A)
    new PaneAgentSessions(db).record(right.id, 'codex', B)
    claudeTranscript(A)
    const { terminals } = run(db)
    try {
      await terminals.start({ workspaceId: left.workspaceId, paneId: left.id, agentCommand: 'claude', disableRtk: true, resumeAgent: true })
      expect(terminals.status(left.id).agentSession).toMatchObject({ sessionId: A, source: 'launch', resumeCommand: `claude --resume ${A}` })
      // Not started in this run: still the session recorded for the pane.
      expect(terminals.status(right.id).agentSession).toEqual({ agent: 'codex', sessionId: B, source: 'recorded', resumeCommand: `codex resume ${B} --no-alt-screen` })
    } finally { terminals.stopAll() }
  })

  test('a session reported by the agent\'s hook reads as hook', async () => {
    const db = openInMemoryDatabase()
    const pane = workspace(db).panes[0]
    const { terminals, sessions } = run(db)
    try {
      await terminals.start({ workspaceId: pane.workspaceId, paneId: pane.id, agentCommand: 'codex', disableRtk: true, resumeAgent: true })
      sessions.record(pane.id, 'codex', B)
      expect(terminals.status(pane.id).agentSession).toMatchObject({ agent: 'codex', sessionId: B, source: 'hook' })
    } finally { terminals.stopAll() }
  })

  test('an agent pane with nothing reported says so with a C3 reason; a plain shell says nothing', async () => {
    const db = openInMemoryDatabase()
    const [agent, shell] = workspace(db, '1x2').panes
    const { terminals } = run(db)
    try {
      await terminals.start({ workspaceId: agent.workspaceId, paneId: agent.id, agentCommand: 'codex', disableRtk: true, resumeAgent: true })
      expect(terminals.status(agent.id).agentSession).toEqual({ source: 'notFound', message: { code: 'agents.session.notFound', params: {} } })
      // A pane with no agent running and no session recorded: nothing to show.
      expect(terminals.status(shell.id).agentSession).toBeUndefined()
    } finally { terminals.stopAll() }
  })
})

describe('restart (terminal.restart)', () => {
  const recorded = (db: AppDatabase, paneId: string) => db.prepare('SELECT session_id FROM pane_agent_sessions WHERE pane_id = ?').get(paneId) as { session_id: string } | undefined

  test('resume: false starts fresh, forgets the old session and reports startedFresh; the next crash resumes the new one', async () => {
    const db = openInMemoryDatabase()
    const ws = workspace(db)
    const pane = ws.panes[0]
    new PaneAgentSessions(db).record(pane.id, 'claude', A)
    claudeTranscript(A)
    const first = run(db)
    try {
      await first.terminals.start({ workspaceId: ws.id, paneId: pane.id, agentCommand: 'claude', disableRtk: true, resumeAgent: true })
      expect(first.pty.spawn).toHaveBeenLastCalledWith('claude', ['--resume', A], expect.anything())
      await first.terminals.restart({ paneId: pane.id, resume: false })
      const [file, args] = first.pty.spawn.mock.calls.at(-1)!
      expect(file).toBe('claude')
      expect(args).not.toContain('--resume')
      expect(args[0]).toBe('--session-id')
      const fresh = args[1]
      expect(fresh).toMatch(UUID)
      expect(fresh).not.toBe(A)
      expect(recorded(db, pane.id)).toEqual({ session_id: fresh })
      expect(first.terminals.status(pane.id).agentResume).toEqual({ outcome: 'notResumed', agent: 'claude', sessionId: A, message: { code: 'agents.resume.startedFresh', params: {} } })
      claudeTranscript(fresh)
      first.terminals.stopAll()
      // The app crashes; the next run goes back to the fresh session, never to A.
      const second = run(db)
      await second.terminals.start({ workspaceId: ws.id, paneId: pane.id, agentCommand: 'claude', disableRtk: true, resumeAgent: true })
      expect(second.pty.spawn).toHaveBeenLastCalledWith('claude', ['--resume', fresh], expect.anything())
      second.terminals.stopAll()
    } finally { db.close() }
  })

  test('resume: false on a pane with nothing recorded reports nothingRecorded and clears nothing else', async () => {
    const db = openInMemoryDatabase()
    const ws = workspace(db, '1x2')
    const [pane, other] = ws.panes
    new PaneAgentSessions(db).record(other.id, 'codex', B)
    const { terminals } = run(db)
    try {
      // Codex gets no session id from main, so this pane has nothing recorded.
      await terminals.start({ workspaceId: ws.id, paneId: pane.id, agentCommand: 'codex', disableRtk: true, resumeAgent: true })
      await terminals.restart({ paneId: pane.id, resume: false })
      expect(terminals.status(pane.id).agentResume).toEqual({ outcome: 'nothingRecorded' })
      expect(recorded(db, other.id)).toEqual({ session_id: B })
    } finally { terminals.stopAll(); db.close() }
  })

  test('a plain restart still resumes the pane session', async () => {
    const db = openInMemoryDatabase()
    const ws = workspace(db)
    const pane = ws.panes[0]
    new PaneAgentSessions(db).record(pane.id, 'codex', B)
    codexRollout(B)
    const { pty, terminals } = run(db)
    try {
      await terminals.start({ workspaceId: ws.id, paneId: pane.id, agentCommand: 'codex', disableRtk: true, resumeAgent: true })
      await terminals.restart({ paneId: pane.id })
      expect(pty.spawn).toHaveBeenCalledTimes(2)
      expect(pty.spawn).toHaveBeenLastCalledWith('codex', ['resume', B, '--no-alt-screen'], expect.anything())
      expect(terminals.status(pane.id).agentResume).toEqual({ outcome: 'resumed', agent: 'codex', sessionId: B })
      expect(recorded(db, pane.id)).toEqual({ session_id: B })
    } finally { terminals.stopAll(); db.close() }
  })
})

describe('a resume that cannot load (exits within RESUME_LOAD_MS)', () => {
  const recorded = (db: AppDatabase, paneId: string) => db.prepare('SELECT session_id FROM pane_agent_sessions WHERE pane_id = ?').get(paneId) as { session_id: string } | undefined
  let clock = 1_000_000
  beforeEach(() => { clock = 1_000_000; vi.spyOn(Date, 'now').mockImplementation(() => clock) })

  test('exits at once → the next restart starts fresh with failedToLoad and the record is cleared; the fresh session resumes next time', async () => {
    const db = openInMemoryDatabase()
    const ws = workspace(db)
    const pane = ws.panes[0]
    new PaneAgentSessions(db).record(pane.id, 'claude', A)
    claudeTranscript(A)
    const first = run(db)
    try {
      await first.terminals.start({ workspaceId: ws.id, paneId: pane.id, agentCommand: 'claude', disableRtk: true, resumeAgent: true })
      expect(first.pty.spawn).toHaveBeenLastCalledWith('claude', ['--resume', A], expect.anything())
      clock += RESUME_LOAD_MS - 1
      first.pty.instances.at(-1)!.emitExit(1)
      expect(recorded(db, pane.id)).toBeUndefined()
      // The pane exited by itself; a restart brings it back, fresh.
      await first.terminals.restart({ paneId: pane.id })
      const [file, args] = first.pty.spawn.mock.calls.at(-1)!
      expect(file).toBe('claude')
      expect(args).not.toContain('--resume')
      expect(args[0]).toBe('--session-id')
      const fresh = args[1]
      expect(fresh).not.toBe(A)
      expect(first.terminals.status(pane.id).agentResume).toEqual({ outcome: 'notResumed', agent: 'claude', sessionId: A, message: { code: 'agents.resume.failedToLoad', params: {} } })
      expect(recorded(db, pane.id)).toEqual({ session_id: fresh })
      // Only one fresh start: a further restart in this run resumes the fresh session once it is on disk.
      claudeTranscript(fresh)
      clock += 60_000
      await first.terminals.restart({ paneId: pane.id })
      expect(first.pty.spawn).toHaveBeenLastCalledWith('claude', ['--resume', fresh], expect.anything())
      first.terminals.stopAll()
      // And after a crash, the next run goes back to it too.
      const second = run(db)
      await second.terminals.start({ workspaceId: ws.id, paneId: pane.id, agentCommand: 'claude', disableRtk: true, resumeAgent: true })
      expect(second.pty.spawn).toHaveBeenLastCalledWith('claude', ['--resume', fresh], expect.anything())
      second.terminals.stopAll()
    } finally { db.close() }
  })

  test('runs normally and exits later → the next restart still resumes (no false positive)', async () => {
    const db = openInMemoryDatabase()
    const ws = workspace(db)
    const pane = ws.panes[0]
    new PaneAgentSessions(db).record(pane.id, 'codex', B)
    codexRollout(B)
    const { pty, terminals } = run(db)
    try {
      await terminals.start({ workspaceId: ws.id, paneId: pane.id, agentCommand: 'codex', disableRtk: true, resumeAgent: true })
      clock += RESUME_LOAD_MS
      pty.instances.at(-1)!.emitExit(0)
      expect(recorded(db, pane.id)).toEqual({ session_id: B })
      await terminals.restart({ paneId: pane.id })
      expect(pty.spawn).toHaveBeenLastCalledWith('codex', ['resume', B, '--no-alt-screen'], expect.anything())
      expect(terminals.status(pane.id).agentResume).toEqual({ outcome: 'resumed', agent: 'codex', sessionId: B })
    } finally { terminals.stopAll(); db.close() }
  })

  test('a fresh start that exits at once is not a failed resume', async () => {
    const db = openInMemoryDatabase()
    const ws = workspace(db)
    const pane = ws.panes[0]
    const { pty, terminals } = run(db)
    try {
      await terminals.start({ workspaceId: ws.id, paneId: pane.id, agentCommand: 'claude', disableRtk: true, resumeAgent: true })
      const assigned = pty.spawn.mock.calls.at(-1)![1][1]
      pty.instances.at(-1)!.emitExit(1)
      expect(recorded(db, pane.id)).toEqual({ session_id: assigned })
      expect(terminals.status(pane.id).agentResume).toEqual({ outcome: 'nothingRecorded' })
    } finally { terminals.stopAll(); db.close() }
  })
})

describe('what survives the crash', () => {
  test('a session with no end recorded (the app died) is still there after the restart', async () => {
    const db = openInMemoryDatabase()
    const ws = workspace(db)
    const recorder = new PaneAgentSessions(db)
    recorder.record(ws.panes[0].id, 'claude', A)
    claudeTranscript(A)
    const { pty, terminals } = run(db)
    try {
      await terminals.start({ workspaceId: ws.id, paneId: ws.panes[0].id, agentCommand: 'claude', disableRtk: true, resumeAgent: true })
      expect(pty.spawn).toHaveBeenLastCalledWith('claude', ['--resume', A], expect.anything())
    } finally { terminals.stopAll(); db.close() }
  })

  test('main never names a session of its own when the command already picks one', async () => {
    const db = openInMemoryDatabase()
    const ws = workspace(db, '1x2')
    const { pty, terminals } = run(db)
    try {
      await terminals.start({ workspaceId: ws.id, paneId: ws.panes[0].id, agentCommand: 'claude --continue', disableRtk: true })
      expect(pty.spawn).toHaveBeenLastCalledWith('claude', ['--continue'], expect.anything())
      await terminals.start({ workspaceId: ws.id, paneId: ws.panes[1].id, agentCommand: 'claude -p hello', disableRtk: true })
      expect(pty.spawn).toHaveBeenLastCalledWith('claude', ['-p', 'hello'], expect.anything())
      expect(db.prepare('SELECT COUNT(*) AS n FROM pane_agent_sessions').get()).toEqual({ n: 0 })
    } finally { terminals.stopAll(); db.close() }
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
    // No pid: stopping a pane ends its real process tree (terminatePty), and on Linux pid 1 meant kill(-1, SIGTERM),
    // every process the user owns, which took the CI runner down. A fake PTY has no process to end.
    pid: 0,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn((handler: (data: string) => void) => { dataHandler = handler; return { dispose: vi.fn() } }),
    onExit: vi.fn((handler: (event: { exitCode: number }) => void) => { exitHandler = handler; return { dispose: vi.fn() } }),
    emitData: (data: string) => dataHandler?.(data),
    emitExit: (exitCode: number) => exitHandler?.({ exitCode })
  }
}
