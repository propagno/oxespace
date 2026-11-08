/**
 * A60 (1.5.0, F4): the pull request of a branch, from GitHub (gh) or Azure DevOps cloud (az), in one shape.
 *
 * - The provider comes from the remote URL; the host must match exactly.
 * - `merged` asks the provider first, so a squash merge counts and its "not merged" stands; git is only the fallback,
 *   marked `by: 'git'`, when there is no CLI, it is signed out, or the remote is another host.
 * - SECURITY S3: every branch name is checked (utils/git-ref-name.ts) before any CLI runs; gh gets it after `--`,
 *   az only as the value of `--source-branch`. Never a shell.
 */
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import type {
  PrCheckState,
  PrCliState,
  PrProviderKind,
  PrState,
  PrVote,
  PullRequestCheck,
  PullRequestInfo,
  PullRequestMerged,
  PullRequestMergedInput,
  PullRequestReviewer,
  PullRequestState,
  PullRequestStateInput,
  PullRequestWorkItem
} from '../../../../shared/types/pull-request'
import { isSafeBranchName } from '../../utils/git-ref-name'
import { ghEnv, neutralizeRepositoryCommands, readCommandKeys } from '../../utils/safe-git'
import { PersonGitRefused, refusedKeys } from '../../utils/safe-git-person'
import { sanitizeError } from '../github/parsers'

export type PrCliRunner = (command: 'gh' | 'az', args: string[], cwd: string) => Promise<{ status: number | null; stdout: string; stderr: string; missing?: boolean }>

export interface PullRequestProviderOptions {
  run: PrCliRunner
  /** The repository's remote URL (origin first), or null. */
  remoteUrl: (rootPath: string) => Promise<string | null>
  /** git's own answer: the branch is an ancestor of the base. Blind to squash merges. */
  gitMerged: (input: PullRequestMergedInput) => Promise<boolean>
}

// ---- the remote ---------------------------------------------------------------------

interface RemoteParts { host: string; path: string }

const URL_SCHEMES = new Set(['https', 'http', 'ssh', 'git', 'git+ssh', 'ssh+git'])
const HOST = /^[a-z0-9.-]+$/
const AZURE_ORG_HOST = /^([a-z0-9][a-z0-9-]*)\.visualstudio\.com$/

function remoteParts(url: string): RemoteParts | null {
  const text = url.trim()
  if (!text || /\s/.test(text)) return null
  const scheme = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)/i.exec(text)
  if (scheme) {
    if (!URL_SCHEMES.has(scheme[1].toLowerCase())) return null
    const authority = scheme[2]
    const host = authority.slice(authority.lastIndexOf('@') + 1).replace(/:\d*$/, '').toLowerCase()
    return HOST.test(host) ? { host, path: scheme[3] } : null
  }
  // The scp form: [user@]host:path
  const scp = /^(?:[^@/\s]+@)?([^@/:\s]+):(?!\/\/)(.*)$/.exec(text)
  if (!scp) return null
  const host = scp[1].toLowerCase()
  return HOST.test(host) ? { host, path: scp[2] } : null
}

export function detectPrProvider(remoteUrl: string | null | undefined): 'github' | 'azure' | 'none' {
  if (typeof remoteUrl !== 'string') return 'none'
  const parts = remoteParts(remoteUrl)
  if (!parts) return 'none'
  const { host } = parts
  if (host === 'github.com') return 'github'
  if (host === 'dev.azure.com' || host === 'ssh.dev.azure.com' || host === 'vs-ssh.visualstudio.com' || AZURE_ORG_HOST.test(host)) return 'azure'
  return 'none'
}

interface AzureRepo { orgUrl: string; project: string; repository: string }

const safeValue = (value: string | undefined): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 256 && !value.startsWith('-') && ![...value].some(ch => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f)

/** The organization, project and repository an Azure DevOps remote names. */
function azureRepo(url: string): AzureRepo | null {
  const parts = remoteParts(url)
  if (!parts) return null
  const segments = parts.path.split('/').filter(Boolean).map(segment => {
    try { return decodeURIComponent(segment) } catch { return segment }
  })
  let org: string | undefined
  let project: string | undefined
  let repository: string | undefined
  if (parts.host === 'ssh.dev.azure.com' || parts.host === 'vs-ssh.visualstudio.com') {
    if (segments[0] !== 'v3' || segments.length < 4) return null
    ;[, org, project, repository] = segments
  } else {
    let rest: string[]
    if (parts.host === 'dev.azure.com') {
      org = segments[0]
      rest = segments.slice(1)
    } else {
      org = AZURE_ORG_HOST.exec(parts.host)?.[1]
      rest = segments[0]?.toLowerCase() === 'defaultcollection' ? segments.slice(1) : segments
    }
    const git = rest.indexOf('_git')
    if (git < 0) return null
    repository = rest[git + 1]
    project = git > 0 ? rest[git - 1] : repository
  }
  if (!safeValue(org) || !safeValue(project) || !safeValue(repository)) return null
  return { orgUrl: `https://dev.azure.com/${encodeURIComponent(org)}`, project, repository }
}

// ---- JSON helpers -------------------------------------------------------------------

type Json = Record<string, unknown>
const obj = (value: unknown): Json | null => (value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Json : null)
const arr = (value: unknown): Json[] => (Array.isArray(value) ? value.map(obj).filter((item): item is Json => item !== null) : [])
const str = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null)
const upper = (value: unknown): string => (typeof value === 'string' ? value.toUpperCase() : '')
function parseJson(raw: string): unknown {
  try { return JSON.parse(raw) } catch { return null }
}
function positiveInt(value: unknown): number | null {
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  return typeof number === 'number' && Number.isInteger(number) && number > 0 ? number : null
}
function seconds(start: unknown, end: unknown): number | null {
  if (typeof start !== 'string' || typeof end !== 'string') return null
  const from = Date.parse(start)
  const to = Date.parse(end)
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null
  return Math.round((to - from) / 1000)
}
const stripHeads = (ref: unknown): string | null => {
  const value = str(ref)
  return value ? value.replace(/^refs\/heads\//, '') : null
}
function cliError(reply: { stdout: string; stderr: string }, fallback: string): Error {
  return new Error(sanitizeError(reply.stderr || reply.stdout || fallback))
}

// ---- GitHub ---------------------------------------------------------------------------

const GH_FIELDS = 'number,title,state,isDraft,url,headRefName,baseRefName,statusCheckRollup,latestReviews,reviewRequests'
const GH_VOTES: Record<string, PrVote> = { APPROVED: 'approved', CHANGES_REQUESTED: 'changes-requested', COMMENTED: 'commented' }

function githubCheck(item: Json): PullRequestCheck {
  const name = str(item.name) ?? str(item.context) ?? 'Check'
  let state: PrCheckState
  if (item.__typename === 'StatusContext' || (item.status === undefined && item.state !== undefined)) {
    const raw = upper(item.state)
    state = raw === 'SUCCESS' ? 'pass' : raw === 'FAILURE' || raw === 'ERROR' ? 'fail' : 'running'
  } else if (upper(item.status) !== 'COMPLETED') {
    state = 'running'
  } else {
    const conclusion = upper(item.conclusion)
    state = conclusion === 'SUCCESS' ? 'pass' : ['NEUTRAL', 'SKIPPED', 'STALE'].includes(conclusion) ? 'skipped' : 'fail'
  }
  return { name, state, duration: state === 'running' ? null : seconds(item.startedAt, item.completedAt) }
}

function parseGithubPr(raw: string, branch: string): PullRequestInfo | null {
  const data = obj(parseJson(raw))
  const number = data ? positiveInt(data.number) : null
  if (!data || !number) return null
  const state = upper(data.state)
  const reviewers: PullRequestReviewer[] = []
  const seen = new Set<string>()
  for (const review of arr(data.latestReviews)) {
    const name = str(obj(review.author)?.login)
    const vote = GH_VOTES[upper(review.state)]
    if (!name || !vote || seen.has(name)) continue
    seen.add(name)
    reviewers.push({ name, vote })
  }
  for (const request of arr(data.reviewRequests)) {
    const name = str(request.login) ?? str(request.name) ?? str(request.slug)
    if (!name || seen.has(name)) continue
    seen.add(name)
    reviewers.push({ name, vote: 'review-requested' })
  }
  return {
    number,
    title: str(data.title) ?? `#${number}`,
    state: state === 'MERGED' ? 'merged' : state === 'CLOSED' ? 'closed' : 'open',
    draft: data.isDraft === true,
    head: str(data.headRefName) ?? branch,
    base: str(data.baseRefName) ?? '',
    url: str(data.url) ?? '',
    workItems: [],
    checks: arr(data.statusCheckRollup).map(githubCheck),
    reviewers
  }
}

// ---- Azure DevOps ---------------------------------------------------------------------

const AZ_VOTES: Record<number, PrVote> = { 10: 'approved', 5: 'approved-with-suggestions', 0: 'no-vote', [-5]: 'waiting-for-author', [-10]: 'rejected' }

function azureState(status: unknown): PrState {
  const value = typeof status === 'string' ? status.toLowerCase() : ''
  return value === 'completed' ? 'merged' : value === 'abandoned' ? 'closed' : 'open'
}

function azureCheck(policy: Json): PullRequestCheck {
  const configuration = obj(policy.configuration)
  const name = str(obj(configuration?.settings)?.displayName) ?? str(obj(configuration?.type)?.displayName) ?? 'Policy'
  const status = typeof policy.status === 'string' ? policy.status.toLowerCase() : ''
  const state: PrCheckState = status === 'approved' ? 'pass'
    : status === 'rejected' || status === 'broken' ? 'fail'
      : status === 'notapplicable' ? 'skipped'
        : 'running'
  return { name, state, duration: state === 'running' ? null : seconds(policy.startedDate, policy.completedDate) }
}

/** The branch's pull request among az's list: an active one first, then the newest. */
function pickAzure(prs: Json[], branch: string): Json | null {
  const ref = `refs/heads/${branch}`
  const mine = prs.filter(pr => positiveInt(pr.pullRequestId) && (pr.sourceRefName === undefined || pr.sourceRefName === ref))
  mine.sort((a, b) => {
    const active = Number(azureState(b.status) === 'open') - Number(azureState(a.status) === 'open')
    return active || (positiveInt(b.pullRequestId) ?? 0) - (positiveInt(a.pullRequestId) ?? 0)
  })
  return mine[0] ?? null
}

// ---- the provider -----------------------------------------------------------------------

function assertBranch(name: string, label = 'branch'): void {
  if (!isSafeBranchName(name)) throw new Error(`Refused an unsafe ${label} name.`)
}

export class PullRequestProvider {
  constructor(private readonly options: PullRequestProviderOptions) {}

  async state(input: PullRequestStateInput): Promise<PullRequestState> {
    assertBranch(input.branch)
    const remote = await this.options.remoteUrl(input.rootPath)
    const provider: PrProviderKind = detectPrProvider(remote)
    if (provider === 'none' || !remote) return { provider: 'none', cli: 'ok' }
    const cli = await this.cliState(provider, input.rootPath)
    if (cli !== 'ok') return { provider, cli }
    const pr = provider === 'github' ? await this.githubPr(input) : await this.azurePr(remote, input)
    return { provider, cli, pr }
  }

  async merged(input: PullRequestMergedInput): Promise<PullRequestMerged> {
    assertBranch(input.branch)
    assertBranch(input.base, 'base branch')
    const byGit = async (): Promise<PullRequestMerged> => ({ by: 'git', value: await this.options.gitMerged(input) })
    const remote = await this.options.remoteUrl(input.rootPath)
    const provider = detectPrProvider(remote)
    if (provider === 'none' || !remote) return byGit()
    if (await this.cliState(provider, input.rootPath) !== 'ok') return byGit()
    try {
      const number = provider === 'github' ? await this.githubMerged(input) : await this.azureMerged(remote, input)
      if (number === undefined) return byGit()
      return number === null ? { by: 'provider', value: false } : { by: 'provider', value: true, prNumber: number }
    } catch {
      return byGit()
    }
  }

  private async cliState(provider: 'github' | 'azure', cwd: string): Promise<PrCliState> {
    const reply = provider === 'github'
      ? await this.options.run('gh', ['auth', 'status'], cwd)
      : await this.options.run('az', ['account', 'show', '--output', 'json'], cwd)
    if (reply.missing) return 'missing'
    return reply.status === 0 ? 'ok' : 'signed-out'
  }

  private async githubPr(input: PullRequestStateInput): Promise<PullRequestInfo | null> {
    const reply = await this.options.run('gh', ['pr', 'view', '--json', GH_FIELDS, '--', input.branch], input.rootPath)
    if (reply.status !== 0) {
      if (/no (open )?pull requests? found/i.test(reply.stderr)) return null
      throw cliError(reply, 'Could not read the pull request.')
    }
    return parseGithubPr(reply.stdout, input.branch)
  }

  /** The merged PR's number, null for none, undefined when gh could not answer. */
  private async githubMerged(input: PullRequestMergedInput): Promise<number | null | undefined> {
    const reply = await this.options.run('gh', ['pr', 'list', '--state', 'merged', '--json', 'number', '--limit', '1', '--head', input.branch], input.rootPath)
    if (reply.status !== 0) return undefined
    const list = parseJson(reply.stdout)
    if (!Array.isArray(list)) return undefined
    return arr(list).map(item => positiveInt(item.number)).find((number): number is number => number !== null) ?? null
  }

  private azureList(repo: AzureRepo, branch: string, status: 'all' | 'completed', cwd: string) {
    return this.options.run('az', ['repos', 'pr', 'list', '--org', repo.orgUrl, '--project', repo.project, '--repository', repo.repository,
      '--source-branch', `refs/heads/${branch}`, '--status', status, '--output', 'json'], cwd)
  }

  private async azurePr(remote: string, input: PullRequestStateInput): Promise<PullRequestInfo | null> {
    const repo = azureRepo(remote)
    if (!repo) return null
    const reply = await this.azureList(repo, input.branch, 'all', input.rootPath)
    if (reply.status !== 0) throw cliError(reply, 'Could not read the pull request.')
    const pr = pickAzure(arr(parseJson(reply.stdout)), input.branch)
    const number = pr ? positiveInt(pr.pullRequestId) : null
    if (!pr || !number) return null
    const byId = ['--id', String(number), '--org', repo.orgUrl, '--output', 'json']
    const [policies, items] = await Promise.all([
      this.options.run('az', ['repos', 'pr', 'policy', 'list', ...byId], input.rootPath),
      this.options.run('az', ['repos', 'pr', 'work-item', 'list', ...byId], input.rootPath)
    ])
    const workItems: PullRequestWorkItem[] = []
    for (const item of items.status === 0 ? arr(parseJson(items.stdout)) : []) {
      const id = positiveInt(item.id)
      if (id && !workItems.some(known => known.id === id)) workItems.push({ id, url: `${repo.orgUrl}/_workitems/edit/${id}` })
    }
    const reviewers: PullRequestReviewer[] = arr(pr.reviewers).flatMap(reviewer => {
      const name = str(reviewer.displayName) ?? str(reviewer.uniqueName)
      return name ? [{ name, vote: AZ_VOTES[Number(reviewer.vote)] ?? 'no-vote' }] : []
    })
    const webUrl = str(obj(pr.repository)?.webUrl)
    const base = webUrl ?? `${repo.orgUrl}/${encodeURIComponent(repo.project)}/_git/${encodeURIComponent(repo.repository)}`
    return {
      number,
      title: str(pr.title) ?? `!${number}`,
      state: azureState(pr.status),
      draft: pr.isDraft === true,
      head: stripHeads(pr.sourceRefName) ?? input.branch,
      base: stripHeads(pr.targetRefName) ?? '',
      url: `${base.replace(/\/+$/, '')}/pullrequest/${number}`,
      workItems,
      checks: (policies.status === 0 ? arr(parseJson(policies.stdout)) : []).map(azureCheck),
      reviewers
    }
  }

  private async azureMerged(remote: string, input: PullRequestMergedInput): Promise<number | null | undefined> {
    const repo = azureRepo(remote)
    if (!repo) return undefined
    const reply = await this.azureList(repo, input.branch, 'completed', input.rootPath)
    if (reply.status !== 0) return undefined
    const list = parseJson(reply.stdout)
    if (!Array.isArray(list)) return undefined
    const ref = `refs/heads/${input.branch}`
    const done = arr(list).find(pr => azureState(pr.status) === 'merged' && (pr.sourceRefName === undefined || pr.sourceRefName === ref))
    return done ? positiveInt(done.pullRequestId) : null
  }
}

// ---- the real runner ------------------------------------------------------------------

const CLI_TIMEOUT = 60_000
const OUTPUT_CAP = 8 * 1024 * 1024

function spawnCli(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): ReturnType<PrCliRunner> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (result: Awaited<ReturnType<PrCliRunner>>): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const child = spawn(command, args, { cwd, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const timer = setTimeout(() => {
      try { child.kill() } catch { /* already gone */ }
      finish({ status: null, stdout, stderr: stderr || `${command} timed out.` })
    }, CLI_TIMEOUT)
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => { if (stdout.length < OUTPUT_CAP) stdout += chunk })
    child.stderr?.on('data', (chunk: string) => { if (stderr.length < OUTPUT_CAP) stderr += chunk })
    child.on('error', (error: NodeJS.ErrnoException) => finish(error.code === 'ENOENT'
      ? { status: null, stdout: '', stderr: '', missing: true }
      : { status: null, stdout, stderr: error.message }))
    child.on('close', (code) => finish({ status: code, stdout, stderr }))
  })
}

/**
 * On Windows az is az.cmd, which only a shell runs. Its MSI install runs `<CLI2>\python.exe -IBm azure.cli`, so that is
 * what runs here, without a shell; any other install reads as missing.
 */
async function azureOnWindows(cwd: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  const where = await spawnCli('where.exe', ['az'], cwd, env)
  if (where.status !== 0) return null
  const script = where.stdout.split(/\r?\n/).map(line => line.trim()).find(line => /[\\/]wbin[\\/]az\.cmd$/i.test(line))
  return script ? join(dirname(dirname(script)), 'python.exe') : null
}

/** gh with GhExec's rules (the repository's config read first, its commands neutralized for gh's git); az likewise. */
export function createPrCliRunner(): PrCliRunner {
  return async (command, args, cwd) => {
    if (command === 'gh') {
      const base = ghEnv()
      const entries = await readCommandKeys(cwd, base, 'git')
      const refused = refusedKeys(entries)
      if (refused.length) throw new PersonGitRefused(refused, 'github-panel:gh')
      return spawnCli('gh', args, cwd, ghEnv(process.env, neutralizeRepositoryCommands(entries, cwd)))
    }
    const env = ghEnv()
    if (process.platform !== 'win32') return spawnCli('az', args, cwd, env)
    const python = await azureOnWindows(cwd, env)
    if (!python) return { status: null, stdout: '', stderr: '', missing: true }
    return spawnCli(python, ['-IBm', 'azure.cli', ...args], cwd, { ...env, AZ_INSTALLER: 'MSI' })
  }
}
