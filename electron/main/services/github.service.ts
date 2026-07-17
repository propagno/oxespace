import { spawn, type SpawnOptions } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { AppDatabase } from '../db/index'
import type {
  GitHubBranch,
  GitHubCheckpoint,
  GitHubCliStatus,
  GitHubCommit,
  GitHubCommitDetails,
  GitHubCommitInput,
  GitHubConnectRepositoryInput,
  GitHubConnectedRepository,
  GitHubCreateBranchInput,
  GitHubCreateCheckpointInput,
  GitHubCreatePullRequestInput,
  GitHubCreateReleaseInput,
  GitHubCreateWorktreeInput,
  GitHubRemoveWorktreeInput,
  GitHubWorktree,
  GitHubMessageResult,
  GitHubPullRequest,
  GitHubPullRequestListInput,
  GitHubRelease,
  GitHubRepositorySummary,
  GitHubRestoreCheckpointInput,
  GitHubWorkflow,
  GitHubWorkflowJob,
  GitHubWorkflowRun,
  GitHubWorkflowRunDetails,
  GitHubWorkflowRunInput,
  GitHubWorkspaceInput,
  GitHubWorkspaceStatus
} from '../../../shared/types/github'

export interface SpawnResult {
  stdout: string
  stderr: string
  status: number | null
  error?: Error
}

export type SpawnAsyncFn = (command: string, args: string[], options: SpawnAsyncOptions) => Promise<SpawnResult>

export interface SpawnAsyncOptions {
  cwd: string
  input?: string
  shell?: boolean
  timeout?: number
  windowsHide?: boolean
  env?: NodeJS.ProcessEnv
}

interface CheckpointRow {
  id: string
  workspace_id: string
  name: string
  description: string | null
  branch: string | null
  base_commit: string | null
  patch: string
  untracked_files: string
  created_at: number
}

interface ConnectedRepositoryRow {
  id: string
  workspace_id: string
  full_name: string
  url: string | null
  created_at: number
}

const DEFAULT_CLI_STATUS: GitHubCliStatus = {
  available: false,
  authenticated: false,
  user: null,
  host: null,
  message: 'GitHub CLI não encontrado. Instale em https://cli.github.com/ e execute gh auth login.',
  path: null
}

function defaultSpawnAsync(command: string, args: string[], options: SpawnAsyncOptions): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const spawnOpts: SpawnOptions = {
      cwd: options.cwd,
      shell: options.shell ?? false,
      windowsHide: options.windowsHide ?? true,
      env: options.env ? { ...process.env, ...options.env } : process.env
    }
    const child = spawn(command, args, spawnOpts)
    let stdout = ''
    let stderr = ''
    let settled = false
    let timer: NodeJS.Timeout | undefined

    const finish = (status: number | null, error?: Error): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve({ stdout, stderr, status, error })
    }

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => { stdout += chunk })
    child.stderr?.on('data', (chunk: string) => { stderr += chunk })
    child.on('error', (err) => finish(null, err))
    child.on('close', (code) => finish(code))

    if (options.timeout && options.timeout > 0) {
      timer = setTimeout(() => {
        try { child.kill() } catch { /* already exited */ }
        finish(null, new Error(`Comando excedeu ${options.timeout}ms.`))
      }, options.timeout)
    }

    if (options.input !== undefined && child.stdin) {
      child.stdin.end(options.input)
    } else {
      child.stdin?.end()
    }
  })
}

export class GitHubService {
  private readonly spawnCommand: SpawnAsyncFn
  private readonly now: () => number

  // detectCli runs gh --version + gh auth status + gh api user (3 spawns each time).
  // Cache it per-cwd with a 30s TTL so tab switches don't re-run these checks.
  private readonly cliCache = new Map<string, { status: GitHubCliStatus; expiresAt: number }>()

  // In-flight promise dedupe — if two callers ask for detectCli concurrently, share the same Promise
  // instead of spawning two parallel `gh` invocations.
  private readonly cliInFlight = new Map<string, Promise<GitHubCliStatus>>()

  // getRepositorySummary runs gh repo view (network call, 1-3s).
  // Cache with a 60s TTL — repo name/URL never changes mid-session.
  private readonly repoCache = new Map<string, { summary: GitHubRepositorySummary; expiresAt: number }>()
  private readonly repoInFlight = new Map<string, Promise<GitHubRepositorySummary>>()

  private static readonly CLI_TTL = 30_000
  private static readonly REPO_TTL = 60_000

  constructor(private readonly db: AppDatabase, options: { spawnCommand?: SpawnAsyncFn; now?: () => number } = {}) {
    this.spawnCommand = options.spawnCommand ?? defaultSpawnAsync
    this.now = options.now ?? Date.now
  }

  invalidateCaches(cwd: string): void {
    this.repoCache.delete(cwd)
  }

  async getCliStatus(input: GitHubWorkspaceInput): Promise<GitHubCliStatus> {
    return this.detectCli(input.rootPath)
  }

  async getWorkspaceStatus(input: GitHubWorkspaceInput): Promise<GitHubWorkspaceStatus> {
    const cli = await this.detectCli(input.rootPath)
    const isGitRepository = await this.isGitRepository(input.rootPath)

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
        hasUncommittedChanges: false
      }
    }

    // Parallelize 5 independent git calls + repo summary (network).
    // Without Promise.all these would serialize ~500ms; in parallel they hit ~100-150ms.
    const [repository, branchRaw, lastCommitRaw, lastPushRaw, statusRaw, revListRaw] = await Promise.all([
      this.getRepositorySummary(input.rootPath),
      this.tryGit(['branch', '--show-current'], input.rootPath),
      this.tryGit(['log', '-1', '--format=%h|%cr'], input.rootPath),
      this.tryGit(['log', '-1', '--format=%cr', '@{u}'], input.rootPath),
      this.tryGit(['status', '--porcelain=v1'], input.rootPath),
      this.tryGit(['rev-list', '--left-right', '--count', 'HEAD...@{u}'], input.rootPath)
    ])

    const branch = branchRaw.trim() || null
    const [lastCommit, lastCommitRelative] = splitPair(lastCommitRaw)
    const lastPushRelative = lastPushRaw.trim() || null
    const statusLines = statusRaw.split('\n').filter(Boolean)
    const counts = countStatusLines(statusLines)
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
      hasUncommittedChanges: statusLines.length > 0
    }
  }

  async fetch(input: GitHubWorkspaceInput): Promise<GitHubMessageResult> {
    await this.runGit(['fetch', '--all', '--prune'], input.rootPath)
    return ok('Fetch concluído.')
  }

  /**
   * Fast-forward only pull. Safe default for the Status "Update" action —
   * diverged branches fail with a clear error instead of creating a merge.
   */
  async pullFfOnly(input: GitHubWorkspaceInput): Promise<GitHubMessageResult> {
    if (await this.hasWorkingTreeChanges(input.rootPath)) {
      throw new Error('Working tree possui mudanças. Faça commit ou stash antes de atualizar a branch.')
    }
    await this.runGit(['pull', '--ff-only'], input.rootPath)
    return ok('Branch atualizada (fast-forward).')
  }

  async stageAll(input: GitHubWorkspaceInput): Promise<GitHubMessageResult> {
    await this.runGit(['add', '-A'], input.rootPath)
    return ok('Arquivos adicionados ao stage.')
  }

  async commit(input: GitHubCommitInput): Promise<GitHubMessageResult> {
    await this.runGit(['commit', '-m', input.message], input.rootPath)
    return ok('Commit criado.')
  }

  async generateCommitMessage(input: GitHubWorkspaceInput): Promise<GitHubMessageResult> {
    const [staged, unstaged, untracked] = await Promise.all([
      this.tryGit(['diff', '--cached', '--name-status'], input.rootPath).then((r) => r.trim()),
      this.tryGit(['diff', '--name-status'], input.rootPath).then((r) => r.trim()),
      this.tryGit(['ls-files', '--others', '--exclude-standard'], input.rootPath).then((r) => r.trim())
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
    await this.runGit(['push'], input.rootPath)
    return ok('Push concluído.')
  }

  async commitAndPush(input: GitHubCommitInput): Promise<GitHubMessageResult> {
    await this.commit(input)
    await this.push(input)
    return ok('Commit e push concluídos.')
  }

  async listBranches(input: GitHubWorkspaceInput): Promise<GitHubBranch[]> {
    const raw = await this.runGit(['branch', '--all', '--format=%(refname:short)|%(HEAD)'], input.rootPath)
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
      await this.runGit(['switch', '--track', input.name], input.rootPath)
      return ok(`Branch local criada rastreando ${input.name}.`)
    }
    await this.runGit(input.checkout ? ['switch', '-c', input.name] : ['branch', input.name], input.rootPath)
    return ok(input.checkout ? `Branch ${input.name} criada e selecionada.` : `Branch ${input.name} criada.`)
  }

  async checkoutBranch(input: { rootPath: string; name: string; force?: boolean }): Promise<GitHubMessageResult> {
    if (!input.force && await this.hasWorkingTreeChanges(input.rootPath)) {
      throw new Error('Working tree possui mudanças. Confirme checkout forçado ou faça commit/stash antes.')
    }

    if (input.name.startsWith('origin/')) {
      const localName = input.name.slice('origin/'.length)
      const localRef = await this.tryGit(['rev-parse', '--verify', `refs/heads/${localName}`], input.rootPath)
      if (localRef.trim()) {
        await this.runGit(['switch', localName], input.rootPath)
        return ok(`Branch ${localName} selecionada.`)
      }

      await this.runGit(['switch', '--track', '-c', localName, input.name], input.rootPath)
      return ok(`Branch ${localName} criada rastreando ${input.name}.`)
    }

    await this.runGit(['switch', input.name], input.rootPath)
    return ok(`Branch ${input.name} selecionada.`)
  }

  async listWorktrees(input: GitHubWorkspaceInput): Promise<GitHubWorktree[]> {
    const raw = await this.tryGit(['worktree', 'list', '--porcelain'], input.rootPath)
    if (!raw.trim()) return []
    return parseWorktreePorcelain(raw, input.rootPath)
  }

  async createWorktree(input: GitHubCreateWorktreeInput): Promise<GitHubMessageResult> {
    const absolutePath = isAbsolutePath(input.path) ? input.path : join(input.rootPath, '..', input.path)
    const args = ['worktree', 'add']
    if (input.createBranch) args.push('-b', input.branch, absolutePath)
    else args.push(absolutePath, input.branch)
    await this.runGit(args, input.rootPath)
    return ok(`Worktree criado em ${absolutePath} (branch ${input.branch}).`)
  }

  async removeWorktree(input: GitHubRemoveWorktreeInput): Promise<GitHubMessageResult> {
    const args = ['worktree', 'remove']
    if (input.force) args.push('--force')
    args.push(input.path)
    await this.runGit(args, input.rootPath)
    return ok(`Worktree em ${input.path} removido.`)
  }

  async listPullRequests(input: GitHubPullRequestListInput): Promise<GitHubPullRequest[]> {
    const raw = await this.runGh(['pr', 'list', '--state', input.state, '--limit', '50', '--json', 'number,title,state,author,url,headRefName,baseRefName,updatedAt'], input.rootPath)
    return parseJsonArray<Record<string, unknown>>(raw).map((item) => ({
      number: toNumber(item.number),
      title: toStringValue(item.title),
      state: toStringValue(item.state),
      author: readLogin(item.author),
      url: nullableString(item.url),
      headRefName: nullableString(item.headRefName),
      baseRefName: nullableString(item.baseRefName),
      updatedAt: nullableString(item.updatedAt)
    }))
  }

  async createPullRequest(input: GitHubCreatePullRequestInput): Promise<GitHubMessageResult> {
    const args = ['pr', 'create', '--title', input.title, '--body', input.body]
    if (input.base) args.push('--base', input.base)
    if (input.head) args.push('--head', input.head)
    if (input.draft) args.push('--draft')
    const url = (await this.runGh(args, input.rootPath)).trim()
    return ok(url || 'Pull request criada.')
  }

  async listCommits(input: GitHubWorkspaceInput): Promise<GitHubCommit[]> {
    const [raw, repo] = await Promise.all([
      this.runGit(['log', '-50', '--format=%H%x1f%h%x1f%s%x1f%an%x1f%cI'], input.rootPath),
      this.getRepositorySummary(input.rootPath)
    ])
    return raw.split('\n').filter(Boolean).map((line) => {
      const [oid, shortOid, message, author, committedDate] = line.split('\x1f')
      return {
        oid,
        shortOid,
        message,
        author: author || null,
        committedDate: committedDate || null,
        url: repo.url && oid ? `${repo.url}/commit/${oid}` : null
      }
    })
  }

  async getCommitDetails(input: { rootPath: string; oid: string }): Promise<GitHubCommitDetails> {
    const [repo, raw, filesRaw] = await Promise.all([
      this.getRepositorySummary(input.rootPath),
      this.runGit(['show', '-s', '--format=%H%x1f%h%x1f%s%x1f%B%x1f%an%x1f%cI', input.oid], input.rootPath),
      this.tryGit(['show', '--numstat', '--format=', input.oid], input.rootPath)
    ])
    const [oid, shortOid, subject, bodyRaw, author, committedDate] = raw.split('\x1f')
    const files = filesRaw.split('\n').filter(Boolean).map((line) => {
      const [additionsRaw, deletionsRaw, ...pathParts] = line.split('\t')
      const binary = additionsRaw === '-' || deletionsRaw === '-'
      return {
        path: pathParts.join('\t'),
        additions: binary ? 0 : Number.parseInt(additionsRaw ?? '0', 10) || 0,
        deletions: binary ? 0 : Number.parseInt(deletionsRaw ?? '0', 10) || 0,
        binary
      }
    })
    const additions = files.reduce((sum, file) => sum + file.additions, 0)
    const deletions = files.reduce((sum, file) => sum + file.deletions, 0)

    return {
      oid,
      shortOid,
      message: subject,
      body: normalizeCommitBody(bodyRaw, subject),
      author: author || null,
      committedDate: committedDate || null,
      url: repo.url && oid ? `${repo.url}/commit/${oid}` : null,
      files,
      additions,
      deletions
    }
  }

  async listReleases(input: GitHubWorkspaceInput): Promise<GitHubRelease[]> {
    const raw = await this.runGh(['release', 'list', '--limit', '50', '--json', 'tagName,name,isDraft,isPrerelease,publishedAt'], input.rootPath)
    return parseJsonArray<Record<string, unknown>>(raw).map((item) => ({
      tagName: toStringValue(item.tagName),
      name: nullableString(item.name),
      isDraft: item.isDraft === true,
      isPrerelease: item.isPrerelease === true,
      publishedAt: nullableString(item.publishedAt),
      url: null
    }))
  }

  async createRelease(input: GitHubCreateReleaseInput): Promise<GitHubMessageResult> {
    const args = ['release', 'create', input.tagName]
    if (input.title) args.push('--title', input.title)
    if (input.notes) args.push('--notes', input.notes)
    if (input.generateNotes !== false) args.push('--generate-notes')
    if (input.prerelease) args.push('--prerelease')
    if (input.draft) args.push('--draft')
    const output = (await this.runGh(args, input.rootPath)).trim()
    return ok(output || `Release ${input.tagName} criada.`)
  }

  async listWorkflows(input: GitHubWorkspaceInput): Promise<GitHubWorkflow[]> {
    const raw = await this.runGh(['workflow', 'list', '--json', 'id,name,path,state'], input.rootPath)
    return parseJsonArray<Record<string, unknown>>(raw).map((item) => ({
      id: toNumber(item.id),
      name: toStringValue(item.name),
      path: toStringValue(item.path),
      state: toStringValue(item.state)
    }))
  }

  async listWorkflowRuns(input: GitHubWorkspaceInput): Promise<GitHubWorkflowRun[]> {
    // `actor` was dropped from `gh run list --json` in recent gh releases (the
    // CLI returns the list of valid fields in its error). We keep the `actor`
    // shape on the response for backwards compatibility but always return null
    // — getRunDetails could fetch the actor via `gh api` if we ever need it.
    const raw = await this.runGh(['run', 'list', '--limit', '30', '--json', 'databaseId,name,displayTitle,status,conclusion,event,headBranch,url,createdAt'], input.rootPath)
    return parseJsonArray<Record<string, unknown>>(raw).map((item) => ({
      databaseId: toNumber(item.databaseId),
      name: nullableString(item.name),
      displayTitle: nullableString(item.displayTitle),
      status: toStringValue(item.status),
      conclusion: nullableString(item.conclusion),
      event: nullableString(item.event),
      branch: nullableString(item.headBranch),
      actor: null,
      url: nullableString(item.url),
      createdAt: nullableString(item.createdAt)
    }))
  }

  async getWorkflowRunDetails(input: { rootPath: string; runId: number }): Promise<GitHubWorkflowRunDetails> {
    const raw = await this.runGh([
      'run',
      'view',
      String(input.runId),
      '--json',
      'databaseId,name,displayTitle,status,conclusion,event,headBranch,url,createdAt,jobs'
    ], input.rootPath)
    const item = JSON.parse(raw) as Record<string, unknown>
    return {
      databaseId: toNumber(item.databaseId) || input.runId,
      name: nullableString(item.name),
      displayTitle: nullableString(item.displayTitle),
      status: toStringValue(item.status),
      conclusion: nullableString(item.conclusion),
      event: nullableString(item.event),
      branch: nullableString(item.headBranch),
      actor: null,
      url: nullableString(item.url),
      createdAt: nullableString(item.createdAt),
      jobs: parseWorkflowJobs(item.jobs)
    }
  }

  async runWorkflow(input: GitHubWorkflowRunInput): Promise<GitHubMessageResult> {
    const args = ['workflow', 'run', input.workflowId]
    if (input.ref) args.push('--ref', input.ref)
    for (const [key, value] of Object.entries(input.fields ?? {})) args.push('-f', `${key}=${value}`)
    await this.runGh(args, input.rootPath)
    return ok('Workflow disparado.')
  }

  /**
   * Re-runs a workflow run. `failedOnly` maps to `--failed` which re-runs only
   * the failed jobs (Wave 5: matches the VS Code GitHub Actions extension's
   * "Re-run failed jobs" affordance).
   */
  async rerunRun(input: { rootPath: string; runId: number; failedOnly: boolean }): Promise<GitHubMessageResult> {
    const args = ['run', 'rerun', String(input.runId)]
    if (input.failedOnly) args.push('--failed')
    await this.runGh(args, input.rootPath)
    return ok(input.failedOnly ? 'Failed jobs re-disparados.' : 'Run re-disparado.')
  }

  /**
   * Fetches the assembled logs of a workflow run via `gh run view --log` (or
   * `--log-failed`). The output is capped to keep the renderer responsive —
   * when the cap is hit we return the tail with a header. ANSI escapes are
   * stripped server-side; the frontend just renders monospace text.
   *
   * GitHub bundles run logs into a zip and `gh` downloads + assembles them;
   * for a CI run with several jobs and 4–5 minutes of output this commonly
   * takes 20–90s. The 60s default we use for other `gh` calls is too short
   * here, so this method bumps the timeout to 240s. `GH_PAGER=` disables any
   * pager that would otherwise hold stdout open waiting for a TTY.
   */
  async getRunLogs(input: { rootPath: string; runId: number; failedOnly: boolean }): Promise<{ logs: string; truncated: boolean; bytes: number }> {
    const status = await this.detectCli(input.rootPath)
    if (!status.available || !status.authenticated) throw new Error(status.message ?? 'GitHub CLI indisponível.')
    const args = ['run', 'view', String(input.runId), input.failedOnly ? '--log-failed' : '--log']
    const result = await this.spawn(
      status.path ?? 'gh',
      args,
      input.rootPath,
      undefined,
      240_000,
      { GH_PAGER: '', PAGER: '', NO_COLOR: '1' }
    )
    if (result.status !== 0 || result.error) {
      throw new Error(sanitizeError(result.stderr || result.stdout || result.error?.message || 'Falha ao buscar logs.'))
    }
    const stripped = stripAnsi(result.stdout ?? '')
    const bytes = Buffer.byteLength(stripped, 'utf8')
    const MAX_LOG_BYTES = 2 * 1024 * 1024 // 2 MB
    if (bytes > MAX_LOG_BYTES) {
      const tail = stripped.slice(-MAX_LOG_BYTES)
      return {
        logs: `… ${(bytes - MAX_LOG_BYTES).toLocaleString()} bytes truncated — showing last ${MAX_LOG_BYTES.toLocaleString()} bytes …\n\n${tail}`,
        truncated: true,
        bytes
      }
    }
    return { logs: stripped, truncated: false, bytes }
  }

  listCheckpoints(input: GitHubWorkspaceInput): GitHubCheckpoint[] {
    const rows = this.db.prepare('SELECT * FROM github_checkpoints WHERE workspace_id = ? ORDER BY created_at DESC').all(input.workspaceId) as CheckpointRow[]
    return rows.map(mapCheckpoint)
  }

  async createCheckpoint(input: GitHubCreateCheckpointInput): Promise<GitHubCheckpoint> {
    const [branchRaw, baseCommitRaw, patch, untrackedRaw] = await Promise.all([
      this.tryGit(['branch', '--show-current'], input.rootPath),
      this.tryGit(['rev-parse', 'HEAD'], input.rootPath),
      this.tryGit(['diff', 'HEAD', '--binary'], input.rootPath),
      this.tryGit(['ls-files', '--others', '--exclude-standard'], input.rootPath)
    ])
    const branch = branchRaw.trim() || null
    const baseCommit = baseCommitRaw.trim() || null
    const untrackedFiles = untrackedRaw.split('\n').filter(Boolean)
    const id = randomUUID()
    const createdAt = this.now()

    this.db.prepare(`
      INSERT INTO github_checkpoints (id, workspace_id, name, description, branch, base_commit, patch, untracked_files, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.workspaceId, input.name, input.description ?? null, branch, baseCommit, patch, JSON.stringify(untrackedFiles), createdAt)

    return {
      id,
      workspaceId: input.workspaceId,
      name: input.name,
      description: input.description ?? null,
      branch,
      baseCommit,
      patch,
      untrackedFiles,
      createdAt
    }
  }

  async restoreCheckpoint(input: GitHubRestoreCheckpointInput): Promise<GitHubMessageResult> {
    const row = this.db.prepare('SELECT * FROM github_checkpoints WHERE id = ? AND workspace_id = ?').get(input.checkpointId, input.workspaceId) as CheckpointRow | undefined
    if (!row) throw new Error('Checkpoint não encontrado.')
    if (await this.hasWorkingTreeChanges(input.rootPath)) {
      throw new Error('Restore bloqueado: working tree possui mudanças. Faça commit/stash ou limpe o workspace antes.')
    }
    if (row.patch.trim()) await this.runGit(['apply', '--whitespace=nowarn', '-'], input.rootPath, row.patch)
    return ok('Checkpoint restaurado para arquivos rastreados.')
  }

  deleteCheckpoint(input: { checkpointId: string }): GitHubMessageResult {
    this.db.prepare('DELETE FROM github_checkpoints WHERE id = ?').run(input.checkpointId)
    return ok('Checkpoint removido.')
  }

  listConnectedRepositories(input: GitHubWorkspaceInput): GitHubConnectedRepository[] {
    const rows = this.db.prepare('SELECT * FROM github_connected_repositories WHERE workspace_id = ? ORDER BY created_at DESC').all(input.workspaceId) as ConnectedRepositoryRow[]
    return rows.map(mapConnectedRepository)
  }

  connectRepository(input: GitHubConnectRepositoryInput): GitHubConnectedRepository {
    const id = randomUUID()
    const createdAt = this.now()
    this.db.prepare(`
      INSERT INTO github_connected_repositories (id, workspace_id, full_name, url, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id, full_name) DO UPDATE SET url = excluded.url
    `).run(id, input.workspaceId, input.fullName, input.url ?? null, createdAt)
    const row = this.db.prepare('SELECT * FROM github_connected_repositories WHERE workspace_id = ? AND full_name = ?').get(input.workspaceId, input.fullName) as ConnectedRepositoryRow
    return mapConnectedRepository(row)
  }

  private detectCli(cwd: string): Promise<GitHubCliStatus> {
    const ts = this.now()
    const cached = this.cliCache.get(cwd)
    if (cached && ts < cached.expiresAt) return Promise.resolve(cached.status)

    const inFlight = this.cliInFlight.get(cwd)
    if (inFlight) return inFlight

    const promise = this.detectCliUncached(cwd).then((status) => {
      this.cliCache.set(cwd, { status, expiresAt: this.now() + GitHubService.CLI_TTL })
      this.cliInFlight.delete(cwd)
      return status
    }, (err) => {
      this.cliInFlight.delete(cwd)
      throw err
    })
    this.cliInFlight.set(cwd, promise)
    return promise
  }

  private async detectCliUncached(cwd: string): Promise<GitHubCliStatus> {
    const gh = await this.resolveGhExecutable(cwd)
    if (!gh) return DEFAULT_CLI_STATUS

    // gh --version is implicit in resolveGhExecutable; check auth + user in parallel
    const [auth, user] = await Promise.all([
      this.spawn(gh, ['auth', 'status'], cwd, undefined, 30_000),
      this.spawn(gh, ['api', 'user', '--jq', '.login'], cwd, undefined, 30_000)
    ])
    if (auth.status !== 0) {
      return {
        available: true,
        authenticated: false,
        user: null,
        host: null,
        message: sanitizeError(auth.stderr || auth.stdout || 'Execute gh auth login para autenticar.'),
        path: gh
      }
    }

    return {
      available: true,
      authenticated: true,
      user: user.status === 0 ? user.stdout.trim() || null : null,
      host: 'github.com',
      message: null,
      path: gh
    }
  }

  private getRepositorySummary(cwd: string): Promise<GitHubRepositorySummary> {
    const ts = this.now()
    const cached = this.repoCache.get(cwd)
    if (cached && ts < cached.expiresAt) return Promise.resolve(cached.summary)

    const inFlight = this.repoInFlight.get(cwd)
    if (inFlight) return inFlight

    const promise = this.getRepositorySummaryUncached(cwd).then((summary) => {
      this.repoCache.set(cwd, { summary, expiresAt: this.now() + GitHubService.REPO_TTL })
      this.repoInFlight.delete(cwd)
      return summary
    }, (err) => {
      this.repoInFlight.delete(cwd)
      throw err
    })
    this.repoInFlight.set(cwd, promise)
    return promise
  }

  private async getRepositorySummaryUncached(cwd: string): Promise<GitHubRepositorySummary> {
    const remoteList = await this.tryGit(['remote'], cwd)
    const remoteName = remoteList.split('\n').find(Boolean) ?? null
    const remoteUrl = remoteName ? (await this.tryGit(['remote', 'get-url', remoteName], cwd)).trim() || null : null
    const parsed = remoteUrl ? parseGitHubRemote(remoteUrl) : null
    const fallback = {
      ...emptyRepositorySummary(),
      owner: parsed?.owner ?? null,
      name: parsed?.name ?? null,
      fullName: parsed ? `${parsed.owner}/${parsed.name}` : null,
      url: parsed ? `https://github.com/${parsed.owner}/${parsed.name}` : null,
      remoteName,
      remoteUrl,
      detected: parsed !== null
    }

    if (!parsed) return fallback

    try {
      const raw = await this.runGh(['repo', 'view', fallback.fullName!, '--json', 'name,owner,url,isPrivate,defaultBranchRef'], cwd)
      const repo = JSON.parse(raw) as Record<string, unknown>
      return {
        owner: readLogin(repo.owner) ?? parsed.owner,
        name: nullableString(repo.name) ?? parsed.name,
        fullName: `${readLogin(repo.owner) ?? parsed.owner}/${nullableString(repo.name) ?? parsed.name}`,
        url: nullableString(repo.url) ?? fallback.url,
        isPrivate: typeof repo.isPrivate === 'boolean' ? repo.isPrivate : null,
        defaultBranch: readName(repo.defaultBranchRef),
        remoteName,
        remoteUrl,
        detected: true
      }
    } catch {
      return fallback
    }
  }

  private async isGitRepository(cwd: string): Promise<boolean> {
    return (await this.tryGit(['rev-parse', '--is-inside-work-tree'], cwd)).trim() === 'true'
  }

  private async hasWorkingTreeChanges(cwd: string): Promise<boolean> {
    return (await this.tryGit(['status', '--porcelain=v1'], cwd)).trim().length > 0
  }

  private async tryGit(args: string[], cwd: string): Promise<string> {
    const result = await this.spawn('git', args, cwd, undefined, 12_000)
    return result.status === 0 ? result.stdout ?? '' : ''
  }

  private async runGit(args: string[], cwd: string, input?: string): Promise<string> {
    const result = await this.spawn('git', args, cwd, input, 30_000)
    if (result.status !== 0 || result.error) throw new Error(sanitizeError(result.stderr || result.stdout || result.error?.message || 'Falha ao executar git.'))
    return result.stdout ?? ''
  }

  private async runGh(args: string[], cwd: string): Promise<string> {
    const status = await this.detectCli(cwd)
    if (!status.available || !status.authenticated) throw new Error(status.message ?? 'GitHub CLI indisponível.')
    const result = await this.spawn(status.path ?? 'gh', args, cwd, undefined, 60_000)
    if (result.status !== 0 || result.error) throw new Error(sanitizeError(result.stderr || result.stdout || result.error?.message || 'Falha ao executar gh.'))
    return result.stdout ?? ''
  }

  private spawn(command: string, args: string[], cwd: string, input?: string, timeout = 15_000, env?: NodeJS.ProcessEnv): Promise<SpawnResult> {
    return this.spawnCommand(command, args, {
      cwd,
      input,
      shell: isCommandScript(command),
      timeout,
      windowsHide: true,
      env
    })
  }

  private async resolveGhExecutable(cwd: string): Promise<string | null> {
    const direct = await this.spawn('gh', ['--version'], cwd)
    if (!direct.error && direct.status === 0) return 'gh'

    const where = await this.spawn('where.exe', ['gh'], cwd)
    const wherePath = where.status === 0 ? where.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) : null
    if (wherePath && existsSync(wherePath)) return wherePath

    for (const candidate of getGhCandidates()) {
      if (candidate && existsSync(candidate)) return candidate
    }
    return null
  }
}

function countStatusLines(lines: string[]): { staged: number; modified: number; untracked: number } {
  let staged = 0
  let modified = 0
  let untracked = 0
  for (const line of lines) {
    if (line.startsWith('??')) {
      untracked++
      continue
    }
    if (line[0] && line[0] !== ' ') staged++
    if (line[1] && line[1] !== ' ') modified++
  }
  return { staged, modified, untracked }
}

function emptyRepositorySummary(): GitHubRepositorySummary {
  return {
    owner: null,
    name: null,
    fullName: null,
    url: null,
    isPrivate: null,
    defaultBranch: null,
    remoteName: null,
    remoteUrl: null,
    detected: false
  }
}

function parseGitHubRemote(remoteUrl: string): { owner: string; name: string } | null {
  const ssh = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/.exec(remoteUrl)
  if (ssh) return { owner: ssh[1], name: ssh[2].replace(/\.git$/, '') }
  const https = /^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/.exec(remoteUrl)
  if (https) return { owner: https[1], name: https[2].replace(/\.git$/, '') }
  return null
}

function splitPair(raw: string, separator: string | RegExp = '|'): [string | null, string | null] {
  const parts = raw.trim().split(separator).map((item) => item.trim()).filter(Boolean)
  return [parts[0] ?? null, parts[1] ?? null]
}

function parseJsonArray<T>(raw: string): T[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed as T[] : []
  } catch {
    return []
  }
}

function mapCheckpoint(row: CheckpointRow): GitHubCheckpoint {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    description: row.description,
    branch: row.branch,
    baseCommit: row.base_commit,
    patch: row.patch,
    untrackedFiles: parseJsonArray<string>(row.untracked_files),
    createdAt: row.created_at
  }
}

function mapConnectedRepository(row: ConnectedRepositoryRow): GitHubConnectedRepository {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    fullName: row.full_name,
    url: row.url,
    createdAt: row.created_at
  }
}

function ok(message: string): GitHubMessageResult {
  return { ok: true, message }
}

function inferCommitType(files: string[], status: string): string {
  if (files.some((file) => /(^|\/)(readme|docs?|\.md$)/i.test(file))) return 'docs'
  if (files.some((file) => /(\.test\.|\.spec\.|__tests__|tests?\/)/i.test(file))) return 'test'
  if (files.some((file) => /(package-lock|pnpm-lock|yarn\.lock|tsconfig|vite\.config|electron-builder|\.github\/)/i.test(file))) return 'chore'
  if (/^D\s/m.test(status) && !/^A\s/m.test(status)) return 'fix'
  return 'feat'
}

function inferCommitArea(files: string[]): string {
  const first = files[0] ?? ''
  if (first.startsWith('src/components/')) return 'ui'
  if (first.startsWith('electron/')) return 'electron'
  if (first.startsWith('shared/')) return 'types'
  if (first.startsWith('src/store/')) return 'store'
  if (first.startsWith('src/styles/')) return 'styles'
  const top = first.split(/[\\/]/)[0]
  return top && top.includes('.') === false ? top.replace(/[^a-z0-9-]/gi, '-').toLowerCase() : ''
}

function summarizeCommitFiles(files: string[], status: string): string {
  const unique = Array.from(new Set(files))
  const changed = unique.length
  const added = (status.match(/^A\s/gm) ?? []).length
  const deleted = (status.match(/^D\s/gm) ?? []).length
  if (changed === 1) return `update ${unique[0]}`
  if (added > 0 && deleted === 0) return `add ${changed} files`
  if (deleted > 0 && added === 0) return `remove ${changed} files`
  return `update ${changed} files`
}

function normalizeCommitBody(body: string | undefined, subject: string | undefined): string | null {
  const normalized = (body ?? '').trim()
  const cleanSubject = (subject ?? '').trim()
  if (!normalized || normalized === cleanSubject) return null
  return normalized.startsWith(cleanSubject) ? normalized.slice(cleanSubject.length).trim() || null : normalized
}

function getGhCandidates(): string[] {
  const candidates = [
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Programs', 'GitHub CLI', 'gh.exe') : '',
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'GitHub CLI', 'gh.exe') : '',
    process.env.ProgramFiles ? join(process.env.ProgramFiles, 'GitHub CLI', 'gh.exe') : '',
    process.env['ProgramFiles(x86)'] ? join(process.env['ProgramFiles(x86)']!, 'GitHub CLI', 'gh.exe') : '',
    process.env.USERPROFILE ? join(process.env.USERPROFILE, 'AppData', 'Local', 'GitHub CLI', 'gh.exe') : '',
    process.env.APPDATA ? join(process.env.APPDATA, 'npm', 'gh.cmd') : ''
  ]
  return candidates.filter(Boolean)
}

function isCommandScript(command: string): boolean {
  return /\.(cmd|bat)$/i.test(command)
}

function sanitizeError(message: string): string {
  return message.replace(/\s+/g, ' ').trim() || 'Falha ao executar comando.'
}

function readLogin(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null
  const login = (value as Record<string, unknown>).login
  return typeof login === 'string' ? login : null
}

function readName(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null
  const name = (value as Record<string, unknown>).name
  return typeof name === 'string' ? name : null
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function toStringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function toNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number.parseInt(String(value), 10) || 0
}

function toNullableNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = Number.parseInt(String(value), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function parseWorkflowJobs(value: unknown): GitHubWorkflowJob[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    const row = typeof item === 'object' && item !== null ? item as Record<string, unknown> : {}
    return {
      databaseId: toNullableNumber(row.databaseId),
      name: toStringValue(row.name),
      status: toStringValue(row.status),
      conclusion: nullableString(row.conclusion),
      startedAt: nullableString(row.startedAt),
      completedAt: nullableString(row.completedAt),
      steps: parseWorkflowSteps(row.steps)
    }
  })
}

function parseWorkflowSteps(value: unknown): GitHubWorkflowJob['steps'] {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    const row = typeof item === 'object' && item !== null ? item as Record<string, unknown> : {}
    return {
      number: toNullableNumber(row.number),
      name: toStringValue(row.name),
      status: toStringValue(row.status),
      conclusion: nullableString(row.conclusion),
      startedAt: nullableString(row.startedAt),
      completedAt: nullableString(row.completedAt)
    }
  })
}

function isAbsolutePath(p: string): boolean {
  // Windows: `C:\` or `\\server`; POSIX: `/something`
  return /^([A-Za-z]:[\\/]|\\\\|\/)/.test(p)
}

/**
 * Parses `git worktree list --porcelain` output into structured records.
 * The format is documented at https://git-scm.com/docs/git-worktree#_porcelain_format
 * — empty lines delimit records; the main worktree comes first.
 *
 * Example:
 *   worktree /Users/me/proj
 *   HEAD 1a2b3c4d
 *   branch refs/heads/main
 *
 *   worktree /Users/me/proj-feature
 *   HEAD 5e6f7a8b
 *   branch refs/heads/feature
 *   locked
 */
function parseWorktreePorcelain(raw: string, mainRootPath: string): GitHubWorktree[] {
  const records = raw.split(/\r?\n\r?\n/).map((block) => block.trim()).filter(Boolean)
  const worktrees: GitHubWorktree[] = []
  // Cross-platform path equality: collapse all separators to `/`, strip
  // trailing slash, lowercase. Without the backslash-to-slash step,
  // workspace.rootPath stored as `C:\Users\repo` would never match git's
  // porcelain output `C:/Users/repo`, leaving every worktree as isMain=false.
  // That bug surfaced as the trash icon appearing next to the main worktree
  // and the sidebar badge counting the main as a non-main worktree.
  const normalizePath = (p: string): string =>
    p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const normalizedMain = normalizePath(mainRootPath)

  for (const block of records) {
    let path = ''
    let head: string | null = null
    let branch: string | null = null
    let locked = false
    let prunable = false
    let detached = false

    for (const line of block.split(/\r?\n/)) {
      const [key, ...rest] = line.split(' ')
      const value = rest.join(' ')
      switch (key) {
        case 'worktree': path = value; break
        case 'HEAD': head = value; break
        case 'branch': branch = value.replace(/^refs\/heads\//, ''); break
        case 'locked': locked = true; break
        case 'prunable': prunable = true; break
        case 'detached': detached = true; break
      }
    }

    if (!path) continue
    const normalized = normalizePath(path)
    worktrees.push({
      path,
      branch: detached ? null : branch,
      head,
      isMain: normalized === normalizedMain,
      locked,
      prunable
    })
  }

  // Safety net: if the comparison above missed (workspace.rootPath may be a
  // subdirectory of a parent .git, or the user passed a normalized form
  // git can't echo back), fall back to porcelain's documented contract —
  // "the main worktree comes first" — so we never present a state where
  // every worktree is non-main and the user can accidentally try to remove
  // their primary checkout.
  if (worktrees.length > 0 && !worktrees.some((wt) => wt.isMain)) {
    worktrees[0].isMain = true
  }

  return worktrees
}

/**
 * Strips ANSI escape sequences from gh CLI output so the renderer can display
 * logs as plain text. Covers the most common SGR (color) + control sequences;
 * good enough for `gh run view --log`, which uses standard escapes.
 */
function stripAnsi(text: string): string {
  // CSI (Control Sequence Introducer) — `\x1b[ ... letter` (most colors/cursors)
  // OSC (Operating System Command) — `\x1b] ... BEL` or `\x1b] ... ST`
  // Other Fe escapes (single-byte after ESC)
  return text
    .replace(/\x1B\[[\x3C-\x3F]*[\d;]*[\x20-\x2F]*[\x40-\x7E]/g, '')
    .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, '')
    .replace(/\x1B[@-_]/g, '')
}
