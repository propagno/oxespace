import { randomUUID } from 'node:crypto'
import { existsSync, lstatSync, realpathSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { AppDatabase } from '../../db'
import { isSafeBranchName } from '../../utils/git-ref-name'
import { runGit } from '../../utils/safe-git'
import { nativeSessionExists } from '../agent-state/native-session-files'
import { canonicalPath } from '../git-common-dir'
import { forkClaudeToWorktree, removeClaudeSessionCopy } from './claude-transcript-fork'
import type { ThreadCheckpointService } from './thread-checkpoints'
import type { ThreadHistoryWriteOptions } from './thread-history'
import { mainMessage } from '../../../../shared/messages'
import type { ConversationThread, ThreadBranchResult, ThreadSnapshot } from '../../../../shared/types/thread'

export interface ThreadBranchForkInput {
  provider: ConversationThread['provider']
  sessionId: string
  rootPath: string
  worktreePath: string
  checkpoint: number
  localPrompts: string[]
  targetIndex: number
}

export type ThreadBranchForkResult =
  | { ok: true; sessionId: string | null }
  | { ok: false; code: 'thread.branch.unsupported' | 'thread.branch.sessionGone' }

export interface ThreadBranching {
  fork(input: ThreadBranchForkInput): Promise<ThreadBranchForkResult>
  sessionAvailable(provider: ConversationThread['provider'], sessionId: string, rootPath: string): Promise<boolean>
}

export interface BranchHost {
  readonly db: AppDatabase
  readonly checkpoints: ThreadCheckpointService
  readonly branching?: ThreadBranching
  settleFinalization(): Promise<void>
  read(id: string): ThreadSnapshot
  save(snapshot: ThreadSnapshot, options?: ThreadHistoryWriteOptions): void
  create(context: Pick<ConversationThread, 'workspaceId' | 'projectId' | 'rootPath' | 'provider' | 'agentProfileId' | 'ownedWorktree'>): ThreadSnapshot
  deleteThread(id: string): Promise<void>
  assertNativeSessionAvailable(id: string, provider: ConversationThread['provider'], nativeSessionId: string | null): void
}

interface BranchCheckpointRow {
  id: string
  turn_id: string | null
  root_path: string
  base_commit: string | null
  state: string
  created_at: number
}

function pathOccupied(path: string): boolean {
  if (existsSync(path)) return true
  try { lstatSync(path); return true } catch { return false }
}

function defaultBranching(host: BranchHost, sourceThreadId: string): ThreadBranching {
  return {
    async sessionAvailable(provider, sessionId, rootPath) {
      if (provider !== 'claude') return false
      try {
        host.assertNativeSessionAvailable(sourceThreadId, provider, sessionId)
        return await nativeSessionExists(provider, sessionId, rootPath)
      } catch {
        return false
      }
    },
    async fork(input) {
      if (input.provider !== 'claude') return { ok: false, code: 'thread.branch.unsupported' }
      const out = await forkClaudeToWorktree({
        rootPath: input.rootPath,
        worktreePath: input.worktreePath,
        sessionId: input.sessionId,
        localPrompts: input.localPrompts,
        targetIndex: input.targetIndex
      })
      return { ok: true, sessionId: out.sessionId }
    }
  }
}

export async function branchFromCheckpoint(
  host: BranchHost,
  id: string,
  checkpointId: string,
  input: { branch: string }
): Promise<ThreadBranchResult> {
  await host.settleFinalization()
  const snapshot = host.read(id)
  const { thread } = snapshot

  if (thread.provider !== 'claude') {
    return { ok: false, refusal: mainMessage('thread.branch.unsupported', {}) }
  }
  const branch = typeof input?.branch === 'string' ? input.branch : ''
  if (!branch || branch.length > 200 || !isSafeBranchName(branch)) {
    return { ok: false, refusal: mainMessage('thread.invalidInput', {}) }
  }

  const rows = host.db.prepare(
    "SELECT id, turn_id, root_path, base_commit, state, created_at FROM conversation_checkpoints WHERE thread_id = ? AND COALESCE(turn_id, '') NOT LIKE 'redo:%' ORDER BY created_at ASC, rowid ASC"
  ).all(id) as BranchCheckpointRow[]
  const cpIdx = rows.findIndex(row => row.id === checkpointId)
  if (cpIdx < 0) return { ok: false, refusal: mainMessage('thread.branch.checkpointGone', {}) }
  const checkpoint = rows[cpIdx]
  if (checkpoint.state === 'failed' || checkpoint.state === 'open') {
    return { ok: false, refusal: mainMessage('thread.branch.checkpointFailed', {}) }
  }

  let root: string
  try {
    root = realpathSync.native(checkpoint.root_path)
  } catch {
    return { ok: false, refusal: mainMessage('thread.branch.notGit', {}) }
  }
  const topLevel = await runGit(root, ['rev-parse', '--show-toplevel'])
  let topCanonical = ''
  if (topLevel.ok && topLevel.stdout.trim()) {
    try { topCanonical = canonicalPath(realpathSync.native(topLevel.stdout.trim())) } catch { topCanonical = '' }
  }
  if (!topCanonical || topCanonical !== canonicalPath(root)) {
    return { ok: false, refusal: mainMessage('thread.branch.notGit', {}) }
  }

  const targetDir = join(dirname(root), `${basename(root)}-${branch.replace(/\//g, '-')}`)
  if (pathOccupied(targetDir)) {
    return { ok: false, refusal: mainMessage('thread.branch.pathExists', { path: targetDir }) }
  }

  const refs = await runGit(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/'])
  if (!refs.ok) return { ok: false, refusal: mainMessage('thread.branch.notGit', {}) }
  const wantedLower = branch.toLowerCase()
  if (refs.stdout.split(/\r?\n/).some(line => line.trim() !== '' && line.trim().toLowerCase() === wantedLower)) {
    return { ok: false, refusal: mainMessage('thread.branch.exists', {}) }
  }

  if (!checkpoint.base_commit) return { ok: false, refusal: mainMessage('thread.branch.baseGone', {}) }
  const cat = await runGit(root, ['cat-file', '-e', `${checkpoint.base_commit}^{commit}`])
  if (!cat.ok) return { ok: false, refusal: mainMessage('thread.branch.baseGone', {}) }

  const branching = host.branching ?? defaultBranching(host, id)
  if (!thread.nativeSessionId) return { ok: false, refusal: mainMessage('thread.branch.sessionGone', {}) }
  const available = await branching.sessionAvailable(thread.provider, thread.nativeSessionId, root).catch(() => false)
  if (!available) return { ok: false, refusal: mainMessage('thread.branch.sessionGone', {}) }

  let worktreeCreated = false
  let worktreePath = targetDir
  let workspaceId: string | undefined
  let forkedSessionId: string | null | undefined
  let createdThreadId: string | undefined

  const rollback = async (): Promise<void> => {
    if (createdThreadId) {
      try { await host.deleteThread(createdThreadId) } catch { /* rollback best effort */ }
      createdThreadId = undefined
    }
    if (forkedSessionId) {
      await removeClaudeSessionCopy({ rootPath: worktreePath, forkId: forkedSessionId, keep: [thread.nativeSessionId] }).catch(() => {})
      forkedSessionId = undefined
    }
    if (workspaceId) {
      try {
        host.db.prepare('DELETE FROM workspaces WHERE id = ?').run(workspaceId)
        host.db.prepare('DELETE FROM thread_project_contexts WHERE project_id = ? AND root_path = ?').run(thread.projectId, worktreePath)
      } catch { /* rollback best effort */ }
      workspaceId = undefined
    }
    if (worktreeCreated || pathOccupied(targetDir)) {
      await runGit(root, ['worktree', 'remove', '--force', worktreePath], { timeout: 30_000 }).catch(() => {})
      if (pathOccupied(worktreePath)) await rm(worktreePath, { recursive: true, force: true }).catch(() => {})
      if (worktreePath !== targetDir && pathOccupied(targetDir)) await rm(targetDir, { recursive: true, force: true }).catch(() => {})
      await runGit(root, ['worktree', 'prune'], { timeout: 30_000 }).catch(() => {})
      await runGit(root, ['branch', '-D', branch], { timeout: 30_000 }).catch(() => {})
      worktreeCreated = false
    }
  }

  const add = await runGit(root, ['worktree', 'add', '-b', branch, targetDir, checkpoint.base_commit], { timeout: 30_000 })
  worktreeCreated = true
  if (!add.ok || !existsSync(targetDir)) {
    await rollback()
    return { ok: false, refusal: mainMessage('thread.branch.failed', { step: 'restore' }) }
  }
  try {
    worktreePath = realpathSync.native(targetDir)
  } catch {
    await rollback()
    return { ok: false, refusal: mainMessage('thread.branch.failed', { step: 'restore' }) }
  }

  try {
    await host.checkpoints.applyPreImagesToWorktree(checkpoint.id, worktreePath)
  } catch {
    await rollback()
    return { ok: false, refusal: mainMessage('thread.branch.failed', { step: 'restore' }) }
  }

  try {
    const wsId = randomUUID()
    const sourceWs = host.db.prepare('SELECT name, default_shell_profile_id FROM workspaces WHERE id = ?').get(thread.workspaceId) as { name: string; default_shell_profile_id: string } | undefined
    const fallbackShell = (host.db.prepare("SELECT id FROM shell_profiles WHERE id IN ('builtin-claude', 'builtin-powershell', 'builtin-bash') LIMIT 1").get() as { id: string } | undefined)?.id ?? 'builtin-claude'
    const shellProfileId = sourceWs?.default_shell_profile_id ?? fallbackShell
    const wsName = `${sourceWs?.name || basename(root)} · ${branch}`
    host.db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES (?, ?, ?, '1x1', ?)")
      .run(wsId, wsName, worktreePath, shellProfileId)
    workspaceId = wsId
  } catch {
    await rollback()
    return { ok: false, refusal: mainMessage('thread.branch.failed', { step: 'register' }) }
  }

  const turns = snapshot.turns ?? []
  const turnIdx = checkpoint.turn_id ? turns.findIndex(turn => turn.id === checkpoint.turn_id) : -1
  const targetIndex = turnIdx >= 0 ? turnIdx : cpIdx
  const localPrompts = turns.map(turn => {
    const event = snapshot.events.find(item => item.type === 'message' && item.role === 'user' && item.id === turn.id)
    return event && event.type === 'message' ? event.text : ''
  })

  try {
    const forkOut = await branching.fork({
      provider: thread.provider,
      sessionId: thread.nativeSessionId,
      rootPath: root,
      worktreePath,
      checkpoint: cpIdx + 1,
      localPrompts,
      targetIndex
    })
    if (!forkOut.ok) {
      await rollback()
      return { ok: false, refusal: mainMessage(forkOut.code, {}) }
    }
    forkedSessionId = forkOut.sessionId
  } catch {
    await rollback()
    return { ok: false, refusal: mainMessage('thread.branch.failed', { step: 'fork' }) }
  }

  try {
    const now = Date.now()
    const created = host.create({
      workspaceId: workspaceId!,
      projectId: thread.projectId,
      rootPath: worktreePath,
      provider: thread.provider,
      ...(thread.agentProfileId ? { agentProfileId: thread.agentProfileId } : {}),
      ownedWorktree: {
        path: worktreePath,
        branch,
        projectRoot: root,
        baseSha: checkpoint.base_commit,
        createdAt: now
      }
    })
    createdThreadId = created.thread.id
    created.thread.nativeSessionId = forkedSessionId ?? null
    created.thread.title = thread.title
    if (thread.model) created.thread.model = thread.model
    if (thread.reasoningEffort) created.thread.reasoningEffort = thread.reasoningEffort
    if (turnIdx > 0) {
      const cutEvent = checkpoint.turn_id ? snapshot.events.findIndex(event => event.type === 'message' && event.role === 'user' && event.id === checkpoint.turn_id) : -1
      created.turns = turns.slice(0, turnIdx).map(turn => ({ ...turn, operationId: undefined }))
      if (cutEvent > 0) created.events = snapshot.events.slice(0, cutEvent).map(event => ({ ...event }))
      created.thread.lastTurnStatus = created.turns.at(-1)?.status
    }
    host.save(created)
    host.db.prepare(
      "INSERT INTO person_action_audit (ts, actor, action, thread_id, place_id, target, outcome, code) VALUES (?, 'person', 'thread-branch', ?, NULL, ?, 'ok', NULL)"
    ).run(now, id, created.thread.id)
  } catch {
    await rollback()
    return { ok: false, refusal: mainMessage('thread.branch.failed', { step: 'conversation' }) }
  }

  return { ok: true, threadId: createdThreadId!, workspaceId: workspaceId!, worktreePath }
}
