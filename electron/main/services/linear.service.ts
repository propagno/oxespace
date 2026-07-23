import { safeStorage } from 'electron'
import type { AppDatabase } from '../db/index'
import type {
  LinearIssue,
  LinearListIssuesInput,
  LinearStatus,
  LinearTeam,
  LinearWorktreeFromIssueInput,
  LinearWorktreeFromIssueResult
} from '../../../shared/types/linear'
import type { GitHubService } from './github.service'

const LINEAR_API_URL = 'https://api.linear.app/graphql'
const PROVIDER = 'linear'
const REQUEST_TIMEOUT_MS = 15_000
const MAX_ISSUES = 100

const PRIORITY_LABELS = ['No priority', 'Urgent', 'High', 'Medium', 'Low']

interface CredentialRow {
  payload: Buffer
  encrypted: number
  label: string | null
}

interface GraphQlResponse<T> {
  data?: T
  errors?: { message: string }[]
}

/**
 * Linear integration (#4). Talks to the public GraphQL API with plain `fetch`
 * rather than `@linear/sdk` — the surface used here is four queries, and the SDK
 * would add a multi-megabyte GraphQL dependency to the shipped app.
 *
 * The API key is stored encrypted through Electron `safeStorage` and never
 * crosses the IPC boundary back to the renderer.
 */
export class LinearService {
  private cachedKey: string | null = null

  constructor(
    private readonly db: AppDatabase,
    private readonly gitHubService: GitHubService,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async setApiKey(apiKey: string): Promise<LinearStatus> {
    const trimmed = apiKey.trim()
    if (!trimmed) throw new Error('API key is empty')

    // Validate before persisting so a typo never gets stored as "connected".
    const viewer = await this.query<{ viewer: { name: string; email: string; organization?: { name: string } } }>(
      'query { viewer { name email organization { name } } }',
      {},
      trimmed
    )

    const canEncrypt = safeStorage.isEncryptionAvailable()
    const payload = canEncrypt ? safeStorage.encryptString(trimmed) : Buffer.from(trimmed, 'utf8')
    const now = Date.now()
    this.db
      .prepare(
        `INSERT INTO secure_credentials (provider, payload, encrypted, label, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(provider) DO UPDATE SET payload = excluded.payload, encrypted = excluded.encrypted,
           label = excluded.label, updated_at = excluded.updated_at`
      )
      .run(PROVIDER, payload, canEncrypt ? 1 : 0, viewer.viewer.name, now, now)
    this.cachedKey = trimmed

    return {
      connected: true,
      encrypted: canEncrypt,
      viewerName: viewer.viewer.name,
      viewerEmail: viewer.viewer.email,
      organization: viewer.viewer.organization?.name ?? null,
      error: null
    }
  }

  clearApiKey(): void {
    this.db.prepare('DELETE FROM secure_credentials WHERE provider = ?').run(PROVIDER)
    this.cachedKey = null
  }

  async getStatus(): Promise<LinearStatus> {
    const row = this.readCredentialRow()
    if (!row) {
      return { connected: false, encrypted: false, viewerName: null, viewerEmail: null, organization: null, error: null }
    }

    try {
      const viewer = await this.query<{ viewer: { name: string; email: string; organization?: { name: string } } }>(
        'query { viewer { name email organization { name } } }'
      )
      return {
        connected: true,
        encrypted: row.encrypted === 1,
        viewerName: viewer.viewer.name,
        viewerEmail: viewer.viewer.email,
        organization: viewer.viewer.organization?.name ?? null,
        error: null
      }
    } catch (error) {
      // A stored-but-failing key is still "connected" — surface why instead of
      // silently pretending the integration was never set up.
      return {
        connected: true,
        encrypted: row.encrypted === 1,
        viewerName: row.label,
        viewerEmail: null,
        organization: null,
        error: toMessage(error)
      }
    }
  }

  async listTeams(): Promise<LinearTeam[]> {
    const result = await this.query<{ teams: { nodes: LinearTeam[] } }>(
      'query { teams(first: 50) { nodes { id key name } } }'
    )
    return result.teams.nodes
  }

  async listIssues(input: LinearListIssuesInput): Promise<LinearIssue[]> {
    const filter = this.buildFilter(input)
    const result = await this.query<{ issues: { nodes: RawIssue[] } }>(
      `query Issues($filter: IssueFilter, $first: Int!) {
         issues(filter: $filter, first: $first, orderBy: updatedAt) {
           nodes {
             id identifier title description url branchName priority updatedAt
             state { name type color }
             assignee { name }
             team { key }
           }
         }
       }`,
      { filter, first: MAX_ISSUES }
    )
    return result.issues.nodes.map(normalizeIssue)
  }

  async getIssue(issueId: string): Promise<LinearIssue> {
    const result = await this.query<{ issue: RawIssue | null }>(
      `query Issue($id: String!) {
         issue(id: $id) {
           id identifier title description url branchName priority updatedAt
           state { name type color }
           assignee { name }
           team { key }
         }
       }`,
      { id: issueId }
    )
    if (!result.issue) throw new Error(`Issue ${issueId} not found`)
    return normalizeIssue(result.issue)
  }

  /**
   * Creates a git worktree checked out on the branch Linear suggests for the
   * issue, so the agent working the ticket gets an isolated tree.
   */
  async createWorktreeFromIssue(input: LinearWorktreeFromIssueInput): Promise<LinearWorktreeFromIssueResult> {
    const issue = await this.getIssue(input.issueId)
    const branch = issue.branchName || `linear/${issue.identifier.toLowerCase()}`
    const directoryName = sanitizeDirectoryName(issue.identifier)

    const existing = await this.gitHubService.listWorktrees({ workspaceId: input.workspaceId, rootPath: input.rootPath })
    const alreadyThere = existing.find((worktree) => worktree.branch === branch)
    if (alreadyThere) {
      return {
        ok: true,
        message: `Worktree for ${issue.identifier} already exists at ${alreadyThere.path}.`,
        branch,
        worktreePath: alreadyThere.path
      }
    }

    const branches = await this.gitHubService.listBranches({ workspaceId: input.workspaceId, rootPath: input.rootPath })
    const branchExists = branches.some((candidate) => candidate.name === branch)

    const result = await this.gitHubService.createWorktree({
      rootPath: input.rootPath,
      branch,
      path: directoryName,
      createBranch: !branchExists
    })

    return { ok: result.ok, message: result.message, branch, worktreePath: directoryName }
  }

  private buildFilter(input: LinearListIssuesInput): Record<string, unknown> {
    const filter: Record<string, unknown> = {}
    if (input.scope === 'assigned') filter.assignee = { isMe: { eq: true } }
    if (input.scope === 'created') filter.creator = { isMe: { eq: true } }
    if (input.teamId) filter.team = { id: { eq: input.teamId } }
    if (!input.includeCompleted) filter.state = { type: { nin: ['completed', 'canceled'] } }
    if (input.query?.trim()) filter.searchableContent = { contains: input.query.trim() }
    return filter
  }

  private readCredentialRow(): CredentialRow | null {
    const row = this.db
      .prepare('SELECT payload, encrypted, label FROM secure_credentials WHERE provider = ?')
      .get(PROVIDER) as CredentialRow | undefined
    return row ?? null
  }

  private resolveApiKey(): string {
    if (this.cachedKey) return this.cachedKey
    const row = this.readCredentialRow()
    if (!row) throw new Error('Linear is not connected. Add a personal API key in the Linear panel.')
    const key = row.encrypted === 1 ? safeStorage.decryptString(Buffer.from(row.payload)) : Buffer.from(row.payload).toString('utf8')
    this.cachedKey = key
    return key
  }

  private async query<T>(query: string, variables: Record<string, unknown> = {}, overrideKey?: string): Promise<T> {
    const apiKey = overrideKey ?? this.resolveApiKey()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    try {
      const response = await this.fetchImpl(LINEAR_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: apiKey },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal
      })

      if (response.status === 401 || response.status === 403) {
        throw new Error('Linear rejected the API key (401/403). Generate a new personal API key.')
      }
      if (!response.ok) {
        throw new Error(`Linear API returned HTTP ${response.status}`)
      }

      const body = (await response.json()) as GraphQlResponse<T>
      if (body.errors?.length) throw new Error(body.errors.map((error) => error.message).join('; '))
      if (!body.data) throw new Error('Linear API returned an empty response')
      return body.data
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Linear API timed out after ${REQUEST_TIMEOUT_MS}ms`)
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }
}

interface RawIssue {
  id: string
  identifier: string
  title: string
  description: string | null
  url: string
  branchName: string
  priority: number
  updatedAt: string
  state: { name: string; type: string; color: string | null } | null
  assignee: { name: string } | null
  team: { key: string } | null
}

function normalizeIssue(raw: RawIssue): LinearIssue {
  return {
    id: raw.id,
    identifier: raw.identifier,
    title: raw.title,
    description: raw.description,
    url: raw.url,
    branchName: raw.branchName,
    priority: raw.priority,
    priorityLabel: PRIORITY_LABELS[raw.priority] ?? 'No priority',
    stateName: raw.state?.name ?? 'Unknown',
    stateType: raw.state?.type ?? 'unknown',
    stateColor: raw.state?.color ?? null,
    assigneeName: raw.assignee?.name ?? null,
    teamKey: raw.team?.key ?? null,
    updatedAt: raw.updatedAt
  }
}

/** Worktree directories are created next to the repo, so keep the name inert. */
export function sanitizeDirectoryName(identifier: string): string {
  const cleaned = identifier.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '')
  return cleaned ? `wt-${cleaned}` : 'wt-linear'
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected Linear error'
}
