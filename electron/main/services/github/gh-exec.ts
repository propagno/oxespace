/**
 * Everything the GitHub collaborators need to reach git and gh, plus the caches
 * that make that affordable.
 *
 * This is deliberately ONE instance shared by all four collaborators. detectCli
 * costs three gh spawns and getRepositorySummary is a network round trip; the
 * 30s/60s TTLs are what keep switching tabs in the GitHub panel from re-running
 * them. Giving each collaborator its own kernel would compile, pass every test,
 * and quietly multiply that cost by four.
 */
import { spawn, type SpawnOptions } from 'node:child_process'
import { existsSync } from 'node:fs'
import type {
  GitHubCliStatus,
  GitHubRepositorySummary
} from '../../../../shared/types/github'
import {
  emptyRepositorySummary,
  getGhCandidates,
  isCommandScript,
  nullableString,
  parseGitHubRemote,
  readLogin,
  readName,
  sanitizeError
} from './parsers'

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

export class GhExec {
  private readonly spawnCommand: SpawnAsyncFn
  readonly now: () => number

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

  constructor(options: { spawnCommand?: SpawnAsyncFn; now?: () => number } = {}) {
    this.spawnCommand = options.spawnCommand ?? defaultSpawnAsync
    this.now = options.now ?? Date.now
  }

  invalidateCaches(cwd: string): void {
    this.repoCache.delete(cwd)
  }

  detectCli(cwd: string): Promise<GitHubCliStatus> {
    const ts = this.now()
    const cached = this.cliCache.get(cwd)
    if (cached && ts < cached.expiresAt) return Promise.resolve(cached.status)

    const inFlight = this.cliInFlight.get(cwd)
    if (inFlight) return inFlight

    const promise = this.detectCliUncached(cwd).then((status) => {
      this.cliCache.set(cwd, { status, expiresAt: this.now() + GhExec.CLI_TTL })
      this.cliInFlight.delete(cwd)
      return status
    }, (err) => {
      this.cliInFlight.delete(cwd)
      throw err
    })
    this.cliInFlight.set(cwd, promise)
    return promise
  }

  async detectCliUncached(cwd: string): Promise<GitHubCliStatus> {
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

  getRepositorySummary(cwd: string): Promise<GitHubRepositorySummary> {
    const ts = this.now()
    const cached = this.repoCache.get(cwd)
    if (cached && ts < cached.expiresAt) return Promise.resolve(cached.summary)

    const inFlight = this.repoInFlight.get(cwd)
    if (inFlight) return inFlight

    const promise = this.getRepositorySummaryUncached(cwd).then((summary) => {
      this.repoCache.set(cwd, { summary, expiresAt: this.now() + GhExec.REPO_TTL })
      this.repoInFlight.delete(cwd)
      return summary
    }, (err) => {
      this.repoInFlight.delete(cwd)
      throw err
    })
    this.repoInFlight.set(cwd, promise)
    return promise
  }

  async getRepositorySummaryUncached(cwd: string): Promise<GitHubRepositorySummary> {
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

  async isGitRepository(cwd: string): Promise<boolean> {
    return (await this.tryGit(['rev-parse', '--is-inside-work-tree'], cwd)).trim() === 'true'
  }

  async hasWorkingTreeChanges(cwd: string): Promise<boolean> {
    return (await this.tryGit(['status', '--porcelain=v1'], cwd)).trim().length > 0
  }

  async tryGit(args: string[], cwd: string): Promise<string> {
    const result = await this.spawn('git', args, cwd, undefined, 12_000)
    return result.status === 0 ? result.stdout ?? '' : ''
  }

  async runGit(args: string[], cwd: string, input?: string): Promise<string> {
    const result = await this.spawn('git', args, cwd, input, 30_000)
    if (result.status !== 0 || result.error) throw new Error(sanitizeError(result.stderr || result.stdout || result.error?.message || 'Falha ao executar git.'))
    return result.stdout ?? ''
  }

  async runGh(args: string[], cwd: string): Promise<string> {
    const status = await this.detectCli(cwd)
    if (!status.available || !status.authenticated) throw new Error(status.message ?? 'GitHub CLI indisponível.')
    const result = await this.spawn(status.path ?? 'gh', args, cwd, undefined, 60_000)
    if (result.status !== 0 || result.error) throw new Error(sanitizeError(result.stderr || result.stdout || result.error?.message || 'Falha ao executar gh.'))
    return result.stdout ?? ''
  }

  spawn(command: string, args: string[], cwd: string, input?: string, timeout = 15_000, env?: NodeJS.ProcessEnv): Promise<SpawnResult> {
    return this.spawnCommand(command, args, {
      cwd,
      input,
      shell: isCommandScript(command),
      timeout,
      windowsHide: true,
      env
    })
  }

  async resolveGhExecutable(cwd: string): Promise<string | null> {
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
