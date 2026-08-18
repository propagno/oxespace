/**
 * GitHub Actions: workflows, runs and their logs. Log fetching is the one
 * call in this feature that routinely takes minutes, so it bypasses the shared
 * gh timeout and talks to the kernel spawn directly.
 */
import type {
  GitHubMessageResult,
  GitHubWorkflow,
  GitHubWorkflowRun,
  GitHubWorkflowRunDetails,
  GitHubWorkflowRunInput,
  GitHubWorkspaceInput
} from '../../../../shared/types/github'
import { nullableString, ok, parseJsonArray, parseWorkflowJobs, sanitizeError, stripAnsi, toNumber, toStringValue } from './parsers'
import type { GhExec } from './gh-exec'
export class GitHubActionsService {
  constructor(private readonly gh: GhExec) {}
  async listWorkflows(input: GitHubWorkspaceInput): Promise<GitHubWorkflow[]> {
    const raw = await this.gh.runGh(['workflow', 'list', '--json', 'id,name,path,state'], input.rootPath)
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
    const raw = await this.gh.runGh(['run', 'list', '--limit', '30', '--json', 'databaseId,name,displayTitle,status,conclusion,event,headBranch,url,createdAt'], input.rootPath)
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
    const raw = await this.gh.runGh([
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
    await this.gh.runGh(args, input.rootPath)
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
    await this.gh.runGh(args, input.rootPath)
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
    const status = await this.gh.detectCli(input.rootPath)
    if (!status.available || !status.authenticated) throw new Error(status.message ?? 'GitHub CLI indisponível.')
    const args = ['run', 'view', String(input.runId), input.failedOnly ? '--log-failed' : '--log']
    const result = await this.gh.spawn(
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
}