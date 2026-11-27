// @vitest-environment node
import { mkdirSync, mkdtempSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db/index'
import { nativeSessionExists } from '../../electron/main/services/agent-state/native-session-files'
import { planPaneResume } from '../../electron/main/services/agent-state/pane-resume'
import { discoverPaneProviderSession, extractSessionFromCommandLine } from '../../electron/main/services/agent-state/pane-session-resolver'
import { PaneAgentSessions, resumeArgs, resumeCommand } from '../../electron/main/services/agent-state/pane-sessions'
import { TerminalManager } from '../../electron/main/services/terminal.service'
import { encodeClaudeProjectPath } from '../../electron/main/services/usage/claude-project-path'
import { WorkspaceService } from '../../electron/main/services/workspace.service'
import { removeTempDir } from '../helpers/removeTempDir'

const AGY_1 = '11111111-2222-4333-8444-555555555551'
const AGY_2 = '11111111-2222-4333-8444-555555555552'
const AGY_OLD = '11111111-2222-4333-8444-555555555559'
const CLAUDE_1 = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1'
const CODEX_1 = '019a5c1e-7b2d-7c3e-9f00-112233445566'
const CODEX_SQLITE = '019a5c1e-7b2d-7c3e-9f00-998877665544'

let dir: string
let repo: string
let otherRepo: string
let roots: { claudeProjects: string; codexSessions: string; antigravityHome: string }

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'oxe-467-'))
  repo = join(dir, 'repo')
  otherRepo = join(dir, 'other-repo')
  mkdirSync(repo, { recursive: true })
  mkdirSync(otherRepo, { recursive: true })
  roots = {
    claudeProjects: join(dir, 'claude', 'projects'),
    codexSessions: join(dir, 'codex', 'sessions'),
    antigravityHome: join(dir, 'antigravity')
  }
})

afterEach(() => {
  vi.restoreAllMocks()
  removeTempDir(dir)
})

function writeAntigravityBrain(id: string, workspacePath: string, timestampMs: number, options: { withSummaryDb?: boolean; withTranscriptOnly?: boolean } = {}): void {
  const brainDir = join(roots.antigravityHome, 'brain', id)
  const logsDir = join(brainDir, '.system_generated', 'logs')
  mkdirSync(logsDir, { recursive: true })
  const iso = new Date(timestampMs).toISOString()
  if (options.withTranscriptOnly) {
    const transcriptPath = join(logsDir, 'transcript.jsonl')
    writeFileSync(transcriptPath, `${JSON.stringify({ type: 'USER_INPUT', content: 'hello', created_at: iso, cwd: workspacePath })}\n`)
    const at = new Date(timestampMs)
    utimesSync(transcriptPath, at, at)
  } else {
    const metaPath = join(brainDir, 'metadata.json')
    writeFileSync(metaPath, JSON.stringify({ workspace: workspacePath, startedAt: iso, updatedAt: iso }))
    const at = new Date(timestampMs)
    utimesSync(metaPath, at, at)
  }
  const at = new Date(timestampMs)
  utimesSync(brainDir, at, at)

  if (options.withSummaryDb) {
    const dbPath = join(roots.antigravityHome, 'conversation_summaries.db')
    const db = new Database(dbPath)
    try {
      db.exec(`CREATE TABLE IF NOT EXISTS conversation_summaries (
        conversation_id TEXT PRIMARY KEY,
        title TEXT,
        preview TEXT,
        step_count INTEGER,
        last_modified_time TEXT,
        workspace_uris TEXT,
        parent_conversation_id TEXT,
        nesting_depth INTEGER
      )`)
      db.prepare(`INSERT OR REPLACE INTO conversation_summaries VALUES (?, ?, ?, ?, ?, ?, '', 0)`).run(
        id, 'Active chat', 'Working on task', 3, iso, JSON.stringify([workspacePath])
      )
    } finally {
      db.close()
    }
  }
}

function writeClaudeTranscript(id: string, cwd: string, timestampMs: number): void {
  const folder = join(roots.claudeProjects, encodeClaudeProjectPath(cwd))
  mkdirSync(folder, { recursive: true })
  const filePath = join(folder, `${id}.jsonl`)
  writeFileSync(filePath, `${JSON.stringify({ type: 'user', cwd, sessionId: id })}\n`)
  const at = new Date(timestampMs)
  utimesSync(filePath, at, at)
}

function writeCodexRollout(id: string, cwd: string, timestampMs: number): void {
  const date = new Date(timestampMs)
  const year = String(date.getUTCFullYear())
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  const folder = join(roots.codexSessions, year, month, day)
  mkdirSync(folder, { recursive: true })
  const filePath = join(folder, `rollout-2026-11-27T12-00-00-${id}.jsonl`)
  writeFileSync(filePath, `${JSON.stringify({ type: 'session_meta', timestamp: date.toISOString(), payload: { id, cwd, timestamp: date.toISOString() } })}\n`)
  utimesSync(filePath, date, date)
}

function writeCodexStateDb(id: string, cwd: string, timestampMs: number): void {
  const codexHome = join(dir, 'codex')
  mkdirSync(codexHome, { recursive: true })
  const db = new Database(join(codexHome, 'state_5.sqlite'))
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      cwd TEXT NOT NULL,
      title TEXT DEFAULT '',
      archived INTEGER DEFAULT 0,
      created_at_ms INTEGER,
      updated_at_ms INTEGER
    )`)
    db.prepare('INSERT OR REPLACE INTO threads (id, cwd, title, archived, created_at_ms, updated_at_ms) VALUES (?, ?, ?, 0, ?, ?)').run(
      id, cwd, '', timestampMs, timestampMs
    )
  } finally {
    db.close()
  }
}

function createFakePtyModule() {
  const instances: Array<{ pid: number; write: ReturnType<typeof vi.fn>; resize: ReturnType<typeof vi.fn>; kill: ReturnType<typeof vi.fn>; onData: ReturnType<typeof vi.fn>; onExit: ReturnType<typeof vi.fn>; process: string }> = []
  let pid = 4000
  const spawn = vi.fn((file: string) => {
    const pty = {
      pid: ++pid,
      process: file,
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: vi.fn(() => ({ dispose: () => undefined })),
      onExit: vi.fn(() => ({ dispose: () => undefined }))
    }
    instances.push(pty)
    return pty
  })
  return { spawn, instances }
}

function createHarness(db: AppDatabase) {
  const sessions = new PaneAgentSessions(db)
  const pty = createFakePtyModule()
  const terminals = new TerminalManager(db, {
    pty,
    platform: 'linux',
    nativeSessionRoots: roots,
    resumeSession: (paneId, wanted, again) => sessions.take(paneId, wanted, again),
    assignSession: (paneId, agent, sessionId) => sessions.record(paneId, agent, sessionId, 'launch'),
    recordSession: (paneId, agent, sessionId, source) => sessions.record(paneId, agent, sessionId, source),
    clearSession: paneId => sessions.clear(paneId),
    currentSession: paneId => sessions.current(paneId),
    claimedSessions: excludePaneId => sessions.claimedSessionIds(excludePaneId)
  })
  terminals.setAgentsFullAccess(false)
  return { sessions, pty, terminals }
}

describe('OXE-467 · PaneAgentSessions & pane-resume Antigravity support', () => {
  test('records, reads, and resumes Antigravity sessions alongside Claude and Codex', async () => {
    const db = openInMemoryDatabase()
    try {
      const ws = new WorkspaceService(db).create({ rootPath: repo, layout: '1x2', autoStart: false })
      const [paneA, paneB] = ws.panes
      const sessions = new PaneAgentSessions(db)

      sessions.record(paneA.id, 'antigravity', AGY_1, 'discovered')
      sessions.record(paneB.id, 'codex', CODEX_1, 'hook')

      expect(sessions.current(paneA.id)).toEqual({ agent: 'antigravity', sessionId: AGY_1, source: 'discovered' })
      expect(resumeArgs('antigravity', AGY_1)).toEqual(['--resume', AGY_1])
      expect(resumeCommand('antigravity', AGY_1)).toBe(`agy --resume ${AGY_1}`)
      expect(sessions.claimedSessionIds(paneB.id)).toEqual(new Set([AGY_1.toLowerCase()]))

      // New app run reads persisted Antigravity row as 'recorded' and takes it for resume.
      const nextRun = new PaneAgentSessions(db)
      expect(nextRun.current(paneA.id)).toEqual({ agent: 'antigravity', sessionId: AGY_1, source: 'recorded' })
      const record = nextRun.take(paneA.id, true)
      expect(record).toEqual({ agent: 'antigravity', sessionId: AGY_1, wanted: true })

      const plan = await planPaneResume(record, { agentCommand: 'agy' }, repo, {
        allowed: () => true,
        exists: async () => true
      })
      expect(plan).toEqual({
        agentCommand: 'agy',
        extraArgs: ['--resume', AGY_1],
        status: { outcome: 'resumed', agent: 'antigravity', sessionId: AGY_1 }
      })
    } finally {
      db.close()
    }
  })

  test('nativeSessionExists verifies Antigravity brain/<uuid> containment and workspace ownership', async () => {
    const now = Date.now()
    writeAntigravityBrain(AGY_1, repo, now, { withSummaryDb: true })
    writeAntigravityBrain(AGY_2, otherRepo, now, { withTranscriptOnly: true })

    expect(await nativeSessionExists('antigravity', AGY_1, repo, roots)).toBe(true)
    expect(await nativeSessionExists('antigravity', AGY_1, otherRepo, roots)).toBe(false)
    expect(await nativeSessionExists('antigravity', AGY_2, otherRepo, roots)).toBe(true)
    expect(await nativeSessionExists('antigravity', AGY_2, repo, roots)).toBe(false)

    // Symlink escaping brain/ is rejected.
    const outside = join(dir, 'outside-session')
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(outside, 'metadata.json'), JSON.stringify({ workspace: repo }))
    symlinkSync(outside, join(roots.antigravityHome, 'brain', AGY_OLD), process.platform === 'win32' ? 'junction' : 'dir')
    expect(await nativeSessionExists('antigravity', AGY_OLD, repo, roots)).toBe(false)
  })
})

describe('OXE-467 · extractSessionFromCommandLine', () => {
  test('extracts native UUIDs for Antigravity, Claude, and Codex launch forms', () => {
    expect(extractSessionFromCommandLine(`agy --resume ${AGY_1}`)).toEqual({ agent: 'antigravity', sessionId: AGY_1 })
    expect(extractSessionFromCommandLine(`agy --conversation=${AGY_1}`)).toEqual({ agent: 'antigravity', sessionId: AGY_1 })
    expect(extractSessionFromCommandLine(`"C:\\tools\\agy.exe" -r ${AGY_1}`)).toEqual({ agent: 'antigravity', sessionId: AGY_1 })
    expect(extractSessionFromCommandLine(`claude --resume ${CLAUDE_1}`)).toEqual({ agent: 'claude', sessionId: CLAUDE_1 })
    expect(extractSessionFromCommandLine(`claude --session-id=${CLAUDE_1}`)).toEqual({ agent: 'claude', sessionId: CLAUDE_1 })
    expect(extractSessionFromCommandLine(`codex -c model=o3 resume ${CODEX_1} --no-alt-screen`)).toEqual({ agent: 'codex', sessionId: CODEX_1 })
    expect(extractSessionFromCommandLine('codex resume --last')).toBeNull()
    expect(extractSessionFromCommandLine('agy --resume not-a-uuid')).toBeNull()
    expect(extractSessionFromCommandLine(`pwsh --resume ${CLAUDE_1}`)).toBeNull()
  })
})

describe('OXE-467 · Automatic provider session discovery & TerminalManager capture', () => {
  test('correlates Antigravity brain/<uuid> by workspace & recency while ignoring stale and other-workspace sessions', async () => {
    const db = openInMemoryDatabase()
    try {
      const ws = new WorkspaceService(db).create({ rootPath: repo, layout: '1x1', autoStart: false })
      const pane = ws.panes[0]
      const { terminals, sessions } = createHarness(db)

      const now = Date.now()
      writeAntigravityBrain(AGY_OLD, repo, now - 3_600_000, { withSummaryDb: true })
      writeAntigravityBrain(AGY_2, otherRepo, now + 500, { withSummaryDb: true })

      await terminals.start({ workspaceId: ws.id, paneId: pane.id, agentCommand: 'agy' })
      // Before Antigravity writes a session for this pane, stale & other-workspace sessions are NOT matched.
      expect(terminals.status(pane.id).agentSession).toEqual({
        source: 'notFound',
        message: { code: 'agents.session.notFound', params: {} }
      })

      // Once Antigravity creates its brain/<uuid> folder for this repo, status() captures it automatically.
      writeAntigravityBrain(AGY_1, repo, Date.now() + 100, { withTranscriptOnly: true })
      expect(terminals.status(pane.id).agentSession).toEqual({
        agent: 'antigravity',
        sessionId: AGY_1,
        source: 'discovered',
        resumeCommand: `agy --resume ${AGY_1}`
      })
      expect(sessions.current(pane.id)).toEqual({ agent: 'antigravity', sessionId: AGY_1, source: 'discovered' })
      terminals.stopAll()
    } finally {
      db.close()
    }
  })

  test('captures Codex sessions automatically from rollout JSONL and from state SQLite index without hooks', async () => {
    const db = openInMemoryDatabase()
    try {
      const ws = new WorkspaceService(db).create({ rootPath: repo, layout: '1x2', autoStart: false })
      const [paneRollout, paneSqlite] = ws.panes
      const { terminals } = createHarness(db)

      await terminals.start({ workspaceId: ws.id, paneId: paneRollout.id, agentCommand: 'codex' })
      writeCodexRollout(CODEX_1, repo, Date.now() + 50)
      expect(terminals.status(paneRollout.id).agentSession).toEqual({
        agent: 'codex',
        sessionId: CODEX_1,
        source: 'discovered',
        resumeCommand: `codex resume ${CODEX_1} --no-alt-screen`
      })

      await terminals.start({ workspaceId: ws.id, paneId: paneSqlite.id, agentCommand: 'codex' })
      writeCodexStateDb(CODEX_SQLITE, repo, Date.now() + 100)
      // Pane 1 already claimed CODEX_1, so Pane 2 cleanly resolves CODEX_SQLITE from SQLite index.
      expect(terminals.status(paneSqlite.id).agentSession).toEqual({
        agent: 'codex',
        sessionId: CODEX_SQLITE,
        source: 'discovered',
        resumeCommand: `codex resume ${CODEX_SQLITE} --no-alt-screen`
      })
      terminals.stopAll()
    } finally {
      db.close()
    }
  })

  test('captures Claude sessions started with --continue and explicit --resume args for all 3 providers', async () => {
    const db = openInMemoryDatabase()
    try {
      const ws = new WorkspaceService(db).create({ rootPath: repo, layout: '2x2', autoStart: false })
      const [claudeContinue, agyExplicit, codexExplicit, shellTyped] = ws.panes
      const { terminals } = createHarness(db)

      await terminals.start({ workspaceId: ws.id, paneId: claudeContinue.id, agentCommand: 'claude --continue' })
      writeClaudeTranscript(CLAUDE_1, repo, Date.now() + 50)
      expect(terminals.status(claudeContinue.id).agentSession).toEqual({
        agent: 'claude',
        sessionId: CLAUDE_1,
        source: 'discovered',
        resumeCommand: `claude --resume ${CLAUDE_1}`
      })

      await terminals.start({ workspaceId: ws.id, paneId: agyExplicit.id, agentCommand: `agy --resume ${AGY_1}` })
      expect(terminals.status(agyExplicit.id).agentSession).toEqual({
        agent: 'antigravity',
        sessionId: AGY_1,
        source: 'launch',
        resumeCommand: `agy --resume ${AGY_1}`
      })

      await terminals.start({ workspaceId: ws.id, paneId: codexExplicit.id, agentCommand: 'codex', agentArgs: ['resume', CODEX_1] })
      expect(terminals.status(codexExplicit.id).agentSession).toEqual({
        agent: 'codex',
        sessionId: CODEX_1,
        source: 'launch',
        resumeCommand: `codex resume ${CODEX_1} --no-alt-screen`
      })

      // Plain shell pane where the user types `agy --conversation <uuid>` interactively.
      await terminals.start({ workspaceId: ws.id, paneId: shellTyped.id, agentCommand: 'bash' })
      expect(terminals.status(shellTyped.id).agentSession).toBeUndefined()
      await terminals.write({ paneId: shellTyped.id, data: `agy --conversation ${AGY_2}\r` })
      expect(terminals.status(shellTyped.id).agentSession).toEqual({
        agent: 'antigravity',
        sessionId: AGY_2,
        source: 'launch',
        resumeCommand: `agy --resume ${AGY_2}`
      })

      terminals.stopAll()
    } finally {
      db.close()
    }
  })

  test('discoverPaneProviderSession skips sessions claimed by other panes in the same workspace', () => {
    const now = Date.now()
    writeAntigravityBrain(AGY_1, repo, now + 100, { withSummaryDb: true })
    writeAntigravityBrain(AGY_2, repo, now + 50, { withSummaryDb: true })

    const second = discoverPaneProviderSession({
      paneId: 'pane-2',
      agent: 'antigravity',
      cwd: repo,
      startedAt: now,
      claimedByOtherPanes: new Set([AGY_1]),
      roots
    })
    expect(second?.sessionId).toBe(AGY_2)
  })
})
