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
  GitHubFileInput,
  GitHubCommitInput,
  GitHubCliStatus
} from '../../../../shared/types/github'
import { countStatusLines, emptyRepositorySummary, inferCommitArea, inferCommitType, isAbsolutePath, ok, parseStatusLine, parseWorktreePorcelain, splitPair, summarizeCommitFiles } from './parsers'
import type { GhExec } from './gh-exec'
export class GitHubRepositoryService {
  constructor(private readonly gh: GhExec) {}

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

  async fetch(input: GitHubWorkspaceInput): Promise<GitHubMessageResult> {
    await this.gh.runGit(['fetch', '--all', '--prune'], input.rootPath)
    return ok('Fetch concluído.')
  }

  /**
   * Fast-forward only pull. Safe default for the Status "Update" action —
   * diverged branches fail with a clear error instead of creating a merge.
   */
  async pullFfOnly(input: GitHubWorkspaceInput): Promise<GitHubMessageResult> {
    if (await this.gh.hasWorkingTreeChanges(input.rootPath)) {
      throw new Error('Working tree possui mudanças. Faça commit ou stash antes de atualizar a branch.')
    }
    await this.gh.runGit(['pull', '--ff-only'], input.rootPath)
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

  async push(input: GitHubWorkspaceInput): Promise<GitHubMessageResult> {
    await this.gh.runGit(['push'], input.rootPath)
    return ok('Push concluído.')
  }

  async commitAndPush(input: GitHubCommitInput): Promise<GitHubMessageResult> {
    await this.commit(input)
    await this.push(input)
    return ok('Commit e push concluídos.')
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

  async createBranch(input: GitHubCreateBranchInput): Promise<GitHubMessageResult> {
    if (input.checkout && input.name.startsWith('origin/')) {
      await this.gh.runGit(['switch', '--track', input.name], input.rootPath)
      return ok(`Branch local criada rastreando ${input.name}.`)
    }
    await this.gh.runGit(input.checkout ? ['switch', '-c', input.name] : ['branch', input.name], input.rootPath)
    return ok(input.checkout ? `Branch ${input.name} criada e selecionada.` : `Branch ${input.name} criada.`)
  }

  async checkoutBranch(input: { rootPath: string; name: string; force?: boolean }): Promise<GitHubMessageResult> {
    if (!input.force && await this.gh.hasWorkingTreeChanges(input.rootPath)) {
      throw new Error('Working tree possui mudanças. Confirme checkout forçado ou faça commit/stash antes.')
    }

    if (input.name.startsWith('origin/')) {
      const localName = input.name.slice('origin/'.length)
      const localRef = await this.gh.tryGit(['rev-parse', '--verify', `refs/heads/${localName}`], input.rootPath)
      if (localRef.trim()) {
        await this.gh.runGit(['switch', localName], input.rootPath)
        return ok(`Branch ${localName} selecionada.`)
      }

      await this.gh.runGit(['switch', '--track', '-c', localName, input.name], input.rootPath)
      return ok(`Branch ${localName} criada rastreando ${input.name}.`)
    }

    await this.gh.runGit(['switch', input.name], input.rootPath)
    return ok(`Branch ${input.name} selecionada.`)
  }

  async listWorktrees(input: GitHubWorkspaceInput): Promise<GitHubWorktree[]> {
    const raw = await this.gh.tryGit(['worktree', 'list', '--porcelain'], input.rootPath)
    if (!raw.trim()) return []
    return parseWorktreePorcelain(raw, input.rootPath)
  }

  async createWorktree(input: GitHubCreateWorktreeInput): Promise<GitHubMessageResult> {
    const absolutePath = isAbsolutePath(input.path) ? input.path : join(input.rootPath, '..', input.path)
    const args = ['worktree', 'add']
    if (input.createBranch) args.push('-b', input.branch, absolutePath)
    else args.push(absolutePath, input.branch)
    await this.gh.runGit(args, input.rootPath)
    return ok(`Worktree criado em ${absolutePath} (branch ${input.branch}).`)
  }

  async removeWorktree(input: GitHubRemoveWorktreeInput): Promise<GitHubMessageResult> {
    const args = ['worktree', 'remove']
    if (input.force) args.push('--force')
    args.push(input.path)
    await this.gh.runGit(args, input.rootPath)
    return ok(`Worktree em ${input.path} removido.`)
  }
}