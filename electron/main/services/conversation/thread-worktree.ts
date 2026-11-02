import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { canonicalPath } from '../git-common-dir'
import type { GitHubCreateWorktreeInput, GitHubMessageResult, GitHubRemoveWorktreeInput } from '../../../../shared/types/github'
import { checkoutDirectoryName, validateExplicitBranchName } from '../delegation/delegation-branch'
import type { ThreadWorktreeErrorCode } from '../../../../shared/threadWorktree'
import { readThreadTitle } from './thread-title'
import { runGit } from '../../utils/safe-git'

/** What creating a worktree needs from the Git service; the same operation the Worktrees panel uses. */
export interface ThreadWorktreeHost {
  createWorktree(input: GitHubCreateWorktreeInput): Promise<GitHubMessageResult>
  resolveBaseRef(rootPath: string): Promise<string>
  /** The guarded removal of the Worktrees panel, used to clean up when the conversation ends. */
  removeWorktree?(input: GitHubRemoveWorktreeInput): Promise<GitHubMessageResult>
}

export interface ThreadWorktreeRequest {
  /** Branch to create; generated when absent. */
  branch?: string
  /** Start point; the repository's default base when absent. */
  baseRef?: string
  /** Go on although the project has uncommitted changes that the new worktree will not contain. */
  allowDirtyBase?: boolean
}

/** Refusals the dialog can explain by cause, instead of a git error. */
export type { ThreadWorktreeErrorCode }

export class ThreadWorktreeError extends Error {
  constructor(readonly code: ThreadWorktreeErrorCode, message: string) { super(message) }
}

/** The folder next to the repository that holds every worktree the app creates for it (delegations included). */
export const worktreeFolderOf = (projectRoot: string): string => join(dirname(projectRoot), `${basename(projectRoot)}-worktrees`)

export const git = async (args: string[], cwd: string): Promise<{ ok: boolean; stdout: string; stderr: string }> => {
  const result = await runGit(cwd, args, { timeout: 30_000 })
  return { ok: result.ok, stdout: result.stdout, stderr: result.stderr }
}

/**
 * Creates a new branch in its own worktree for a conversation, next to the repository in `<repo>-worktrees/`
 * (the folder Delegation uses). Nothing is left behind when creation fails. The caller registers the
 * returned directory as a context of the same Thread project.
 */
export async function createThreadWorktree(host: ThreadWorktreeHost, projectRoot: string, request: ThreadWorktreeRequest, now = new Date()): Promise<{ rootPath: string; branch: string; baseSha: string; message: string }> {
  if (!(await git(['rev-parse', '--is-inside-work-tree'], projectRoot)).ok) {
    throw new ThreadWorktreeError('NOT_A_REPO', `${projectRoot} is not a Git repository, so it cannot have a worktree.`)
  }
  let branch: string
  try {
    branch = request.branch?.trim() ? validateExplicitBranchName(request.branch.trim()) : generatedBranch(now)
  } catch {
    throw new ThreadWorktreeError('INVALID_BRANCH', `“${request.branch}” is not a valid branch name.`)
  }
  if ((await git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], projectRoot)).ok) {
    throw new ThreadWorktreeError('BRANCH_EXISTS', `A branch named “${branch}” already exists. Choose another name.`)
  }
  const baseRef = request.baseRef?.trim() || await host.resolveBaseRef(projectRoot)
  // Passed to git as an argument: a leading dash would be read as an option.
  if (!/^[A-Za-z0-9_./@~^{}-]+$/.test(baseRef) || baseRef.startsWith('-') || baseRef.includes('..')) {
    throw new ThreadWorktreeError('INVALID_BASE', `“${baseRef}” is not a valid base.`)
  }
  if (!(await git(['rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`], projectRoot)).ok) {
    throw new ThreadWorktreeError('INVALID_BASE', `The base “${baseRef}” does not exist in this repository.`)
  }
  // Edits in the project stay where they are: the new branch starts from the base, not from the working tree.
  if (!request.allowDirtyBase) {
    const dirty = await git(['status', '--porcelain', '--untracked-files=no'], projectRoot)
    if (dirty.ok && dirty.stdout.trim()) throw new ThreadWorktreeError('DIRTY_BASE', `The project has uncommitted changes; a new worktree starts from ${baseRef} without them.`)
  }
  const baseSha = (await git(['rev-parse', '--verify', `${baseRef}^{commit}`], projectRoot)).stdout.trim()
  const path = join(worktreeFolderOf(projectRoot), checkoutDirectoryName(branch, randomUUID()))
  if (existsSync(path)) throw new ThreadWorktreeError('PATH_EXISTS', `${path} already exists.`)

  let result: GitHubMessageResult
  try {
    result = await host.createWorktree({ rootPath: projectRoot, branch, path, createBranch: true, baseRef, fetchBase: false })
  } catch (error) {
    await discardThreadWorktree(projectRoot, path, branch)
    throw new ThreadWorktreeError('CREATE_FAILED', error instanceof Error ? error.message : 'The worktree could not be created.')
  }
  if (!result.ok || !existsSync(path)) {
    await discardThreadWorktree(projectRoot, path, branch)
    throw new ThreadWorktreeError('CREATE_FAILED', result.message || 'The worktree could not be created.')
  }
  return { rootPath: await realpath(path), branch, baseSha, message: result.message }
}

/** Removes a worktree this module created and its branch, when what follows the creation fails. */
export async function discardThreadWorktree(projectRoot: string, path: string, branch: string): Promise<void> {
  if (existsSync(path)) await git(['worktree', 'remove', '--force', path], projectRoot)
  await git(['worktree', 'prune'], projectRoot)
  await git(['branch', '-D', branch], projectRoot)
}

/** `thread/20261017-1530-a1b2`: sortable, readable, and unique enough within a minute. */
export function generatedBranch(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
  return `thread/${stamp}-${randomUUID().slice(0, 4)}`
}

/**
 * Conversations that are not archived and work in `worktreePath` (their own root, or the worktree they
 * moved into). Removing that worktree would leave them without a directory, so removal is refused first.
 */
export function threadsInWorktree(db: { prepare(sql: string): { all(): unknown[] } }, worktreePath: string): { id: string; title: string }[] {
  // Canonical spelling: a conversation saved under a Windows short name still matches the long one.
  const key = canonicalPath
  const target = key(worktreePath)
  const inside = (path: unknown): boolean => typeof path === 'string' && (key(path) === target || key(path).startsWith(`${target}/`))
  const rows = db.prepare(`SELECT id, json_extract(data_json, '$.title') AS title, json_extract(data_json, '$.rootPath') AS root,
    json_extract(data_json, '$.observedLocation.checkoutRoot') AS observed, json_extract(data_json, '$.archived') AS archived FROM conversation_threads`).all() as { id: string; title: string | null; root: unknown; observed: unknown; archived: unknown }[]
  return rows.filter(row => !row.archived && (inside(row.root) || inside(row.observed))).map(row => ({ id: row.id, title: row.title === null ? 'Conversation' : readThreadTitle(row.title) }))
}

/** The provider could not start because the conversation's folder is gone (a removed worktree). */
export class ThreadFolderMissingError extends Error {
  constructor(rootPath: string) {
    super(`This conversation's folder no longer exists: ${rootPath}. If it was a worktree that was removed, restore it or start a new conversation.`)
    this.name = 'ThreadFolderMissingError'
  }
}

/**
 * Turns a start failure into ThreadFolderMissingError when it is the "not found" a spawn reports for a
 * missing working directory and that directory is indeed gone; any other failure is returned unchanged.
 */
export function explainMissingFolder(error: unknown, rootPath: string): unknown {
  const notFound = (error as { code?: unknown } | null)?.code === 'ENOENT' || (error instanceof Error && /\bENOENT\b|no such file or directory/i.test(error.message))
  return notFound && !existsSync(rootPath) ? new ThreadFolderMissingError(rootPath) : error
}
