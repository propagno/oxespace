/**
 * Working tree, history-free repository operations: status, staging,
 * committing, pushing, branches and worktrees. Everything here is git; only
 * getWorkspaceStatus reaches gh, and only for the repository summary.
 */
import { join } from 'node:path'
import type {
  GitHubBranch,
  GitHubCreateBranchInput,
  GitHubCreateWorktreeInput,
  GitHubFileChange,
  GitHubMessageResult,
  GitHubRemoveWorktreeInput,
  GitHubWorkspaceInput,
  GitHubWorkspaceStatus,
  GitHubWorktree,
  GitHubWorktreeBase,
  GitHubWorktreePathInput,
  GitHubWorktreeStatus,
  GitHubFileInput,
  GitHubCommitInput,
  GitHubCliStatus
} from '../../../../shared/types/github'
import { countStatusLines, emptyRepositorySummary, inferCommitArea, inferCommitType, isAbsolutePath, ok, parseStatusLine, parseWorktreePorcelain, parseWorktreeStatusPorcelainV2, splitPair, summarizeCommitFiles } from './parsers'
import type { PersonGit } from '../../utils/safe-git-person'
import { mainMessage, type MainMessage } from '../../../../shared/messages'

/** A person-started push, switch or worktree ran without the repository's hooks (utils/safe-git-person.ts). */
const HOOKS_SKIPPED: MainMessage = mainMessage('git.hooks.skipped', {})
const withNotices = (result: GitHubMessageResult, notices: MainMessage[]): GitHubMessageResult => notices.length ? { ...result, notices } : result
import type { GhExec } from './gh-exec'
import { loadRepoConfig } from '../repo-config/loader'
import { runHook } from '../repo-config/hook-runner'
import { createSharedLinks } from '../repo-config/shared-dirs'
import type { RepoHookTrust } from '../repo-config/trust'
import { removeWorktreeSafely } from './worktree-removal'

export interface WorktreeLifecycleDeps {
  trust: RepoHookTrust
  /** Stops terminals whose cwd is inside `dir`; returns the pane ids stopped. */
  stopTerminalsWithin?: (dir: string) => string[]
}

export class GitHubRepositoryService {
  private lifecycle: WorktreeLifecycleDeps | null = null

  constructor(private readonly gh: GhExec) {}

  /**
   * Wired after construction because the terminal manager is built first and
   * the collaborators here predate it. Without it, removal still gets the
   * structural/dirty checks, just not hooks or terminal teardown.
   */
  configureWorktreeLifecycle(deps: WorktreeLifecycleDeps): void {
    this.lifecycle = deps
  }

  async getCliStatus(input: GitHubWorkspaceInput): Promise<GitHubCliStatus> {
    return this.gh.detectCli(input.rootPath)
  }

  async getWorkspaceStatus(input: GitHubWorkspaceInput): Promise<GitHubWorkspaceStatus> {
    const cli = await this.gh.detectCli(input.rootPath)
    const isGitRepository = await this.gh.isGitRepository(input.rootPath)

    if (!isGitRepository) {
      return {
        cli,
        repository: emptyRepositorySummary(),
        isGitRepository: false,
        branch: null,
        lastCommit: null,
        lastCommitRelative: null,
        lastPushRelative: null,
        staged: 0,
        modified: 0,
        untracked: 0,
        ahead: 0,
        behind: 0,
        hasUncommittedChanges: false,
        changes: []
      }
    }

    // Parallelize 5 independent git calls + repo summary (network).
    // Without Promise.all these would serialize ~500ms; in parallel they hit ~100-150ms.
    const [repository, branchRaw, lastCommitRaw, lastPushRaw, statusRaw, revListRaw] = await Promise.all([
      this.gh.getRepositorySummary(input.rootPath),
      this.gh.tryGit(['branch', '--show-current'], input.rootPath),
      this.gh.tryGit(['log', '-1', '--format=%h|%cr'], input.rootPath),
      this.gh.tryGit(['log', '-1', '--format=%cr', '@{u}'], input.rootPath),
      this.gh.tryGit(['status', '--porcelain=v1', '--untracked-files=all'], input.rootPath),
      this.gh.tryGit(['rev-list', '--left-right', '--count', 'HEAD...@{u}'], input.rootPath)
    ])

    const branch = branchRaw.trim() || null
    const [lastCommit, lastCommitRelative] = splitPair(lastCommitRaw)
    const lastPushRelative = lastPushRaw.trim() || null
    const statusLines = statusRaw.split('\n').filter(Boolean)
    const counts = countStatusLines(statusLines)
    const changes = statusLines.map(parseStatusLine).filter((change): change is GitHubFileChange => change !== null)
    const [aheadRaw, behindRaw] = splitPair(revListRaw, /\s+/)

    return {
      cli,
      repository,
      isGitRepository: true,
      branch,
      lastCommit,
      lastCommitRelative,
      lastPushRelative,
      staged: counts.staged,
      modified: counts.modified,
      untracked: counts.untracked,
      ahead: Number.parseInt(aheadRaw ?? '0', 10) || 0,
      behind: Number.parseInt(behindRaw ?? '0', 10) || 0,
      hasUncommittedChanges: statusLines.length > 0,
      changes
    }
  }

  /** Network calls need the person (utils/safe-git-person.ts); without one, git has no transport and fails. */
  async fetch(input: GitHubWorkspaceInput, person?: PersonGit): Promise<GitHubMessageResult> {
    await this.network(['fetch', '--all', '--prune'], input.rootPath, person)
    return ok('Fetch complete.')
  }

  /**
   * Fast-forward only pull. Safe default for the Status "Update" action —
   * diverged branches fail with a clear error instead of creating a merge.
   */
  async pullFfOnly(input: GitHubWorkspaceInput, person?: PersonGit): Promise<GitHubMessageResult> {
    if (await this.gh.hasWorkingTreeChanges(input.rootPath)) {
      throw new Error('The working tree has changes. Commit or stash them before updating the branch.')
    }
    await this.network(['pull', '--ff-only'], input.rootPath, person)
    return ok('Branch atualizada (fast-forward).')
  }

  async stageAll(input: GitHubWorkspaceInput): Promise<GitHubMessageResult> {
    await this.gh.runGit(['add', '-A'], input.rootPath)
    return ok('Arquivos adicionados ao stage.')
  }

  async stageFile(input: GitHubFileInput): Promise<GitHubMessageResult> {
    await this.gh.runGit(['add', '--', input.path], input.rootPath)
    return ok(`${input.path} adicionado ao stage.`)
  }

  async unstageFile(input: GitHubFileInput): Promise<GitHubMessageResult> {
    try {
      await this.gh.runGit(['restore', '--staged', '--', input.path], input.rootPath)
    } catch {
      // `restore --staged` needs HEAD. Repositories before their first commit
      // fall back to removing the path from the index while keeping the file.
      try {
        await this.gh.runGit(['reset', 'HEAD', '--', input.path], input.rootPath)
      } catch {
        await this.gh.runGit(['rm', '--cached', '--', input.path], input.rootPath)
      }
    }
    return ok(`${input.path} removido do stage.`)
  }

  async commit(input: GitHubCommitInput): Promise<GitHubMessageResult> {
    await this.gh.runGit(['commit', '-m', input.message], input.rootPath)
    return ok('Commit criado.')
  }

  async generateCommitMessage(input: GitHubWorkspaceInput): Promise<GitHubMessageResult> {
    const [staged, unstaged, untracked] = await Promise.all([
      this.gh.tryGit(['diff', '--cached', '--name-status'], input.rootPath).then((r) => r.trim()),
      this.gh.tryGit(['diff', '--name-status'], input.rootPath).then((r) => r.trim()),
      this.gh.tryGit(['ls-files', '--others', '--exclude-standard'], input.rootPath).then((r) => r.trim())
    ])
    const source = staged || unstaged || untracked
    if (!source) return ok('chore: update workspace')

    const files = source.split('\n').filter(Boolean).map((line) => line.split(/\s+/).at(-1) ?? '').filter(Boolean)
    const firstFile = files[0] ?? 'workspace'
    const area = inferCommitArea(files)
    const type = inferCommitType(files, source)
    const summary = summarizeCommitFiles(files, source)

    return ok(`${type}${area ? `(${area})` : ''}: ${summary || `update ${firstFile}`}`)
  }

  async push(input: GitHubWorkspaceInput, person?: PersonGit): Promise<GitHubMessageResult> {
    await this.network(['push'], input.rootPath, person)
    return withNotices(ok('Push complete.'), person ? [HOOKS_SKIPPED] : [])
  }

  async commitAndPush(input: GitHubCommitInput, person?: PersonGit): Promise<GitHubMessageResult> {
    await this.commit(input)
    await this.push(input, person)
    return withNotices(ok('Commit and push complete.'), person ? [HOOKS_SKIPPED] : [])
  }

  async listBranches(input: GitHubWorkspaceInput): Promise<GitHubBranch[]> {
    const raw = await this.gh.runGit(['branch', '--all', '--format=%(refname:short)|%(HEAD)'], input.rootPath)
    return raw.split('\n').filter(Boolean).map((line) => {
      const [nameRaw, currentRaw] = line.split('|')
      const name = (nameRaw ?? '').replace(/^remotes\/origin\//, 'origin/').trim()
      return {
        name,
        current: currentRaw?.trim() === '*',
        remote: name.startsWith('origin/')
      }
    }).filter((branch) => branch.name !== 'origin' && !branch.name.endsWith('/HEAD'))
  }

  async createBranch(input: GitHubCreateBranchInput, person?: PersonGit): Promise<GitHubMessageResult> {
    if (input.checkout && input.name.startsWith('origin/')) {
      await this.network(['switch', '--track', input.name], input.rootPath, person)
      return withNotices(ok(`Branch local criada rastreando ${input.name}.`), person ? [HOOKS_SKIPPED] : [])
    }
    await this.network(input.checkout ? ['switch', '-c', input.name] : ['branch', input.name], input.rootPath, person)
    return withNotices(ok(input.checkout ? `Branch ${input.name} criada e selecionada.` : `Branch ${input.name} criada.`), person && input.checkout ? [HOOKS_SKIPPED] : [])
  }

  async checkoutBranch(input: { rootPath: string; name: string; force?: boolean }, person?: PersonGit): Promise<GitHubMessageResult> {
    if (!input.force && await this.gh.hasWorkingTreeChanges(input.rootPath)) {
      throw new Error('The working tree has changes. Confirm a forced checkout, or commit or stash them first.')
    }

    if (input.name.startsWith('origin/')) {
      const localName = input.name.slice('origin/'.length)
      const localRef = await this.gh.tryGit(['rev-parse', '--verify', `refs/heads/${localName}`], input.rootPath)
      if (localRef.trim()) {
        await this.network(['switch', localName], input.rootPath, person)
        return withNotices(ok(`Branch ${localName} selecionada.`), person ? [HOOKS_SKIPPED] : [])
      }

      await this.network(['switch', '--track', '-c', localName, input.name], input.rootPath, person)
      return withNotices(ok(`Branch ${localName} criada rastreando ${input.name}.`), person ? [HOOKS_SKIPPED] : [])
    }

    await this.network(['switch', input.name], input.rootPath, person)
    return withNotices(ok(`Branch ${input.name} selecionada.`), person ? [HOOKS_SKIPPED] : [])
  }

  async listWorktrees(input: GitHubWorkspaceInput): Promise<GitHubWorktree[]> {
    const raw = await this.gh.tryGit(['worktree', 'list', '--porcelain'], input.rootPath)
    if (!raw.trim()) return []
    return parseWorktreePorcelain(raw, input.rootPath)
  }

  /**
   * Resolves the ref a new worktree branch should start from.
   *
   * Order: the remote's own HEAD (`refs/remotes/origin/HEAD`, what `git clone`
   * records as the default branch) → a conventional remote branch → a
   * conventional local branch → `HEAD`. Pure git, no `gh`, so it stays fast
   * enough to run every time the create form opens.
   *
   * Falling all the way through to `HEAD` reproduces git's own default. That is
   * only correct for a repo with no remote and no main/master; everywhere else
   * one of the earlier steps wins, which is the whole point — a hotfix branch
   * must not silently inherit whatever the main worktree left checked out.
   */
  async resolveWorktreeBase(input: GitHubWorkspaceInput): Promise<GitHubWorktreeBase> {
    const remotes = (await this.gh.tryGit(['remote'], input.rootPath))
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    const remoteName = remotes.includes('origin') ? 'origin' : remotes[0] ?? null

    if (remoteName) {
      const head = (await this.gh.tryGit(['symbolic-ref', '--short', `refs/remotes/${remoteName}/HEAD`], input.rootPath)).trim()
      if (head) return { baseRef: head, remoteName, isRemote: true }

      for (const candidate of ['main', 'master', 'develop']) {
        const found = await this.refExists(input.rootPath, `refs/remotes/${remoteName}/${candidate}`)
        if (found) return { baseRef: `${remoteName}/${candidate}`, remoteName, isRemote: true }
      }
    }

    for (const candidate of ['main', 'master']) {
      const found = await this.refExists(input.rootPath, `refs/heads/${candidate}`)
      if (found) return { baseRef: candidate, remoteName, isRemote: false }
    }

    return { baseRef: 'HEAD', remoteName, isRemote: false }
  }

  /**
   * Cheap per-worktree state for the removal confirmation and the panel list.
   * Runs inside the worktree itself, so it reports that tree's index and not
   * the main one's.
   */
  async getWorktreeStatus(input: GitHubWorktreePathInput): Promise<GitHubWorktreeStatus> {
    const raw = await this.gh.tryGit(['status', '--porcelain=v2', '--branch'], input.path)
    return { path: input.path, ...parseWorktreeStatusPorcelainV2(raw) }
  }

  /** Without `person`, a fetchBase fetch has no transport and becomes the stale-base warning below. */
  async createWorktree(input: GitHubCreateWorktreeInput, person?: PersonGit): Promise<GitHubMessageResult> {
    const absolutePath = isAbsolutePath(input.path) ? input.path : join(input.rootPath, '..', input.path)
    // A base ref only means anything when git is creating the branch; checking
    // out an existing branch already has a start point of its own.
    const baseRef = input.createBranch ? input.baseRef?.trim() || null : null

    // A stale local copy of `origin/main` is indistinguishable from a fresh one
    // until you fetch, so a base the user believes is the remote tip may not be.
    // Fetch failures are reported, not thrown: being offline should degrade the
    // guarantee, not block the worktree.
    let warning = ''
    const notices: MainMessage[] = person ? [HOOKS_SKIPPED] : []
    if (baseRef && input.fetchBase) {
      const remoteName = baseRef.includes('/') ? baseRef.slice(0, baseRef.indexOf('/')) : null
      if (remoteName) {
        try {
          await this.network(['fetch', remoteName, '--prune'], input.rootPath, person)
        } catch {
          warning = ` Warning: fetching ${remoteName} failed — the base may be out of date.`
          notices.push(mainMessage('git.base.maybeStale', { branch: baseRef }))
        }
      }
    }

    const args = ['worktree', 'add']
    if (input.createBranch) {
      args.push('-b', input.branch, absolutePath)
      if (baseRef) args.push(baseRef)
    } else {
      args.push(absolutePath, input.branch)
    }
    await this.network(args, input.rootPath, person)

    warning += await this.prepareNewWorktree(input.rootPath, absolutePath)

    const from = baseRef ? ` a partir de ${baseRef}` : ''
    return withNotices(ok(`Worktree criado em ${absolutePath} (branch ${input.branch}${from}).${warning}`), notices)
  }

  /**
   * Applies the repo's oxe.yaml to a worktree that now exists: shared links
   * first (so setup sees them), then the setup hook. Nothing here may fail the
   * creation — the worktree is real by now — so problems become a warning.
   */
  private async prepareNewWorktree(rootPath: string, worktreePath: string): Promise<string> {
    const config = (await loadRepoConfig(worktreePath)) ?? (await loadRepoConfig(rootPath))
    if (!config) return ''
    let notes = ''
    if (config.worktree.sharedDirectories.length > 0) {
      await createSharedLinks(rootPath, worktreePath, config.worktree.sharedDirectories)
    }
    const setup = config.scripts.setup
    if (!setup) return notes
    if (!this.lifecycle?.trust.isTrusted(rootPath, 'setup', setup)) {
      return ' Warning: the oxe.yaml setup hook was not approved and did not run.'
    }
    const outcome = await runHook(setup, {
      cwd: worktreePath,
      env: {
        OXE_ROOT_PATH: rootPath,
        OXE_WORKTREE_PATH: worktreePath,
        OXE_WORKSPACE_NAME: worktreePath.replace(/\\/g, '/').split('/').pop() ?? ''
      }
    })
    if (outcome.status === 'passed') notes += ' Setup hook complete.'
    else if (outcome.status === 'failed') notes += ` Warning: the setup hook exited with code ${outcome.exitCode}.`
    else notes += ' Warning: the setup hook did not end in a verifiable way.'
    return notes
  }

  /**
   * The person path for what the person started: network calls, and the checkouts (switch, worktree add), which let
   * git-lfs download content. Without a person: local git, no transport, LFS files stay pointers.
   */
  private network(args: string[], rootPath: string, person: PersonGit | undefined): Promise<string> {
    return person ? this.gh.runPersonGit(args, rootPath, person) : this.gh.runGit(args, rootPath)
  }

  private async refExists(rootPath: string, ref: string): Promise<boolean> {
    const sha = await this.gh.tryGit(['rev-parse', '--verify', '--quiet', ref], rootPath)
    return sha.trim().length > 0
  }

  async removeWorktree(input: GitHubRemoveWorktreeInput): Promise<GitHubMessageResult> {
    if (!this.lifecycle) {
      // Not wired (tests, headless use): keep the original behaviour exactly.
      const args = ['worktree', 'remove']
      if (input.force) args.push('--force')
      args.push(input.path)
      await this.gh.runGit(args, input.rootPath)
      return ok(`Worktree em ${input.path} removido.`)
    }
    return removeWorktreeSafely({ gh: this.gh, ...this.lifecycle }, input)
  }
}
