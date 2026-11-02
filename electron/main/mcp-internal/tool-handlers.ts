import type {
  CreateWorktreeArgs,
  GetJobOutputArgs,
  InternalMcpToolCallResult,
  ListBackgroundJobsArgs,
  OpenWebPreviewArgs,
  PaneListItem,
  RemoveWorktreeArgs,
  RunScriptArgs,
  ScriptListItem,
  StopBackgroundJobArgs,
  WorkspaceListItem
} from '../../../shared/types/mcp-internal'
import { classifyPreviewUrl, type PreviewUrl } from '../utils/preview-url'
import type { Approval } from './domain-tool'
import { discoverScripts } from '../services/scripts-discovery.service'
import type { ToolContext } from './tool-registry'
import { errorResult, textResult } from './tool-registry'
import { requirePreviewExecution } from './preview-scope'
import { savePreviewCapture } from '../services/documentation/preview-capture-store'
import { semanticProjects } from '../services/semantic-projects'
import { mainMessage } from '../../../shared/messages'

/**
 * One handler per tool. Each is a thin shape-translation layer over an
 * existing service — no business logic lives here. Validation is inline
 * to avoid pulling in a runtime schema lib (zod) for ten tools.
 */

function expectString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Argument "${field}" must be a non-empty string`)
  }
  return value.trim()
}

function expectBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`Argument "${field}" must be a boolean`)
  }
  return value
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {}
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Arguments must be an object')
  }
  return value as Record<string, unknown>
}

/**
 * Resolve the workspace for a tool call.
 *
 * Order:
 *  1. Explicit header id (`X-OXE-Workspace-Id` / bridge env) when it still exists.
 *  2. Active workspace in OXESpace (`is_active`) — recovers stale or missing
 *     bridge env without requiring the agent (or user) to know the fix.
 *  3. Actionable error listing available workspaces.
 *
 * Agents should never need product knowledge of OXESPACE_WORKSPACE_ID to recover.
 */
async function requireWorkspace(ctx: ToolContext): Promise<{ id: string; rootPath: string; name: string }> {
  let execution: ReturnType<NonNullable<typeof ctx.executions>['authenticate']> | undefined
  try { execution = ctx.executions?.authenticate(ctx.executionId, ctx.executionToken, ctx.workspaceId) } catch { /* Generic MCP callers may not have an execution. */ }
  if (execution?.owner.kind === 'thread' || ctx.workspaceId?.startsWith('thread:')) throw new Error('This tool requires a Code workspace. Open the project in Code explicitly before using workspace or terminal tools.')
  if (ctx.workspaceId) {
    const explicit = ctx.workspaceServ.get(ctx.workspaceId)
    if (explicit) {
      return { id: explicit.id, rootPath: explicit.rootPath, name: explicit.name }
    }
  }

  const all = ctx.workspaceServ.list()
  const active = all.find((ws) => ws.isActive === true)
  if (active) {
    return { id: active.id, rootPath: active.rootPath, name: active.name }
  }

  const available =
    all.length > 0
      ? all.map((ws) => `${ws.name} (${ws.id}${ws.isActive ? ', active' : ''})`).join('; ')
      : '(none — open a folder as a workspace in OXESpace)'

  if (ctx.workspaceId) {
    throw new Error(
      `Workspace ${ctx.workspaceId} not found (stale MCP bridge env) and no active workspace is set. ` +
        `Focus a workspace in OXESpace, or call oxespace_list_workspaces. Available: ${available}`
    )
  }

  throw new Error(
    `No workspace context (missing X-OXE-Workspace-Id) and no active workspace is set. ` +
      `Focus a workspace in OXESpace, or call oxespace_list_workspaces. Available: ${available}`
  )
}

/**
 * The project a read-only retrieval tool should look at.
 *
 * A Code workspace resolves as before. A Thread resolves to the checkout its
 * execution was started in, and borrows the Code workspace with the same root
 * (if the project is also open in Code) so both share one semantic index.
 * `workspaceId` is null when no such workspace exists.
 */
interface ProjectScope { kind: 'code' | 'thread'; rootPath: string; workspaceId: string | null }

const sameRoot = (a: string, b: string): boolean => {
  const norm = (value: string): string => {
    const unified = value.replace(/\\/g, '/').replace(/\/+$/, '')
    return process.platform === 'win32' ? unified.toLowerCase() : unified
  }
  return norm(a) === norm(b)
}

export async function requireProjectScope(ctx: ToolContext): Promise<ProjectScope> {
  let execution: ReturnType<NonNullable<typeof ctx.executions>['authenticate']> | undefined
  try { execution = ctx.executions?.authenticate(ctx.executionId, ctx.executionToken, ctx.workspaceId) } catch { /* Generic MCP callers may not have an execution. */ }
  if (execution?.owner.kind === 'thread') {
    const rootPath = execution.canonicalRoot || execution.cwd
    const match = ctx.workspaceServ.list().find(ws => sameRoot(ws.rootPath, rootPath))
    return { kind: 'thread', rootPath, workspaceId: match?.id ?? null }
  }
  if (ctx.workspaceId?.startsWith('thread:')) throw new Error('This Thread execution could not be verified. Start a new turn and try again.')
  const ws = await requireWorkspace(ctx)
  return { kind: 'code', rootPath: ws.rootPath, workspaceId: ws.id }
}

const NO_SEMANTIC_INDEX = 'Semantic search is off for this project. The person can turn it on in Thread (the project\'s menu › Project settings › Semantic search) or in Code. Structural search (oxespace_hybrid_explore) works without it.'

/** The semantic index to search: the Code workspace's when it has one on, otherwise the Thread project's when it was turned on. */
function semanticIndexFor(scope: ProjectScope, ctx: ToolContext): string | null {
  if (scope.workspaceId && ctx.semantic.isEnabled(scope.workspaceId)) return scope.workspaceId
  return scope.kind === 'thread' ? semanticProjects(ctx.semantic)?.ensure(scope.rootPath) ?? null : null
}

async function listWorkspaces(_args: unknown, ctx: ToolContext): Promise<InternalMcpToolCallResult> {
  const all = ctx.workspaceServ.list()
  const items: WorkspaceListItem[] = all.map((ws) => ({
    id: ws.id,
    name: ws.name,
    rootPath: ws.rootPath,
    isActive: ws.isActive === true
  }))
  return textResult(items)
}

async function listPanes(_args: unknown, ctx: ToolContext): Promise<InternalMcpToolCallResult> {
  const ws = await requireWorkspace(ctx)
  const full = ctx.workspaceServ.get(ws.id)
  if (!full) return errorResult(`Workspace ${ws.id} disappeared mid-call`)
  const items: PaneListItem[] = full.panes.map((p) => ({
    id: p.id,
    type: p.type,
    rowIndex: p.rowIndex,
    columnIndex: p.columnIndex,
    agentName: p.agentName ?? null,
    status: p.status,
    rootPath: p.rootPath ?? null,
    displayName: p.displayName ?? null
  }))
  return textResult(items)
}

async function listWorktrees(_args: unknown, ctx: ToolContext): Promise<InternalMcpToolCallResult> {
  const ws = await requireWorkspace(ctx)
  const trees = await ctx.github.listWorktrees({ workspaceId: ws.id, rootPath: ws.rootPath })
  return textResult(trees)
}

async function createWorktree(args: unknown, ctx: ToolContext): Promise<InternalMcpToolCallResult> {
  const ws = await requireWorkspace(ctx)
  const input = asRecord(args) as Partial<CreateWorktreeArgs>
  const path = expectString(input.path, 'path')
  const branch = expectString(input.branch, 'branch')
  const createBranch = input.createBranch === undefined ? false : expectBoolean(input.createBranch, 'createBranch')
  // Without an explicit base the new branch inherits the main worktree's HEAD,
  // which is whatever the user last checked out there. Agents get the same
  // default the panel does: the repository's own default branch on its remote.
  const baseRef = input.baseRef === undefined
    ? (createBranch ? (await ctx.github.resolveWorktreeBase({ workspaceId: ws.id, rootPath: ws.rootPath })).baseRef : undefined)
    : expectString(input.baseRef, 'baseRef')
  const fetchBase = input.fetchBase === undefined ? false : expectBoolean(input.fetchBase, 'fetchBase')
  const result = await ctx.github.createWorktree({ rootPath: ws.rootPath, path, branch, createBranch, baseRef, fetchBase })
  ctx.worktree.emitChanged({ workspaceId: ws.id, rootPath: ws.rootPath, action: 'created', requestedAt: Date.now() })
  return textResult(result)
}

async function removeWorktree(args: unknown, ctx: ToolContext): Promise<InternalMcpToolCallResult> {
  const ws = await requireWorkspace(ctx)
  const input = asRecord(args) as Partial<RemoveWorktreeArgs>
  const path = expectString(input.path, 'path')
  const force = input.force === undefined ? false : expectBoolean(input.force, 'force')
  const result = await ctx.github.removeWorktree({ rootPath: ws.rootPath, path, force })
  ctx.worktree.emitChanged({ workspaceId: ws.id, rootPath: ws.rootPath, action: 'removed', requestedAt: Date.now() })
  return textResult(result)
}

async function listScripts(_args: unknown, ctx: ToolContext): Promise<InternalMcpToolCallResult> {
  const ws = await requireWorkspace(ctx)
  const scripts = await discoverScripts(ctx.fileSystem, ws.id, ws.rootPath)
  const items: ScriptListItem[] = scripts.map((s) => ({
    id: s.id,
    name: s.name,
    relativePath: s.relativePath,
    extension: s.extension,
    command: s.command
  }))
  return textResult(items)
}

async function runScript(args: unknown, ctx: ToolContext): Promise<InternalMcpToolCallResult> {
  const ws = await requireWorkspace(ctx)
  const input = asRecord(args) as Partial<RunScriptArgs>
  const scriptId = expectString(input.scriptId, 'scriptId')
  const paneRootPath = input.paneRootPath ?? null

  const scripts = await discoverScripts(ctx.fileSystem, ws.id, ws.rootPath)
  const target = scripts.find((s) => s.id === scriptId)
  if (!target) {
    return errorResult(`Script "${scriptId}" not found. Call oxespace_list_scripts first.`)
  }

  const job = ctx.background.start({
    workspaceId: ws.id,
    workspaceRootPath: ws.rootPath,
    command: target.command,
    label: target.name,
    paneRootPath: typeof paneRootPath === 'string' ? paneRootPath : null,
    confirmed: true
  })
  return textResult({ jobId: job.id, status: job.status })
}

async function listBackgroundJobs(args: unknown, ctx: ToolContext): Promise<InternalMcpToolCallResult> {
  const ws = await requireWorkspace(ctx)
  const input = asRecord(args) as Partial<ListBackgroundJobsArgs>
  const allowedStatuses = new Set(['running', 'pending', 'exited', 'failed', 'killed'])
  if (input.status !== undefined && !allowedStatuses.has(String(input.status))) {
    return errorResult(`Invalid status "${input.status}". Allowed: ${[...allowedStatuses].join(', ')}.`)
  }
  const jobs = ctx.background.list(ws.id)
  const filtered = input.status ? jobs.filter((j) => j.status === input.status) : jobs
  return textResult(filtered)
}

async function stopBackgroundJob(args: unknown, ctx: ToolContext): Promise<InternalMcpToolCallResult> {
  const ws = await requireWorkspace(ctx)
  const input = asRecord(args) as Partial<StopBackgroundJobArgs>
  const jobId = expectString(input.jobId, 'jobId')
  // Verify the job belongs to this workspace before stopping — prevents
  // a malicious agent in workspace A from killing workspace B's job by id.
  const owned = ctx.background.list(ws.id).some((j) => j.id === jobId)
  if (!owned) {
    return errorResult(`Job ${jobId} not found in this workspace`)
  }
  ctx.background.stop(jobId)
  return textResult({ stopped: true, jobId })
}

async function getJobOutput(args: unknown, ctx: ToolContext): Promise<InternalMcpToolCallResult> {
  const ws = await requireWorkspace(ctx)
  const input = asRecord(args) as Partial<GetJobOutputArgs>
  const jobId = expectString(input.jobId, 'jobId')
  // Same workspace-ownership guard as stopBackgroundJob — an agent in
  // workspace A must not read workspace B's job output by id.
  const owned = ctx.background.list(ws.id).some((j) => j.id === jobId)
  if (!owned) {
    return errorResult(`Job ${jobId} not found in this workspace`)
  }
  const chunk = ctx.background.getOutput(jobId)
  return textResult(chunk)
}

/** What the person approves before an agent opens a page that is not on this computer's loopback (B15). */
export function previewApproval(target: Extract<PreviewUrl, { kind: 'external' }>): Approval {
  return {
    summary: `open ${target.href} in the Web Preview`,
    text: `Open in the Web Preview:\n${target.href}`,
    notes: [mainMessage('approvals.note.preview.notLocal', {})]
  }
}

/**
 * Local pages open as before (write: a live execution, recorded, rate limited). Any other http(s) page is confirm:
 * nothing is queued until a person approves that exact URL. Other schemes, file: included, are refused.
 */
async function openWebPreview(args: unknown, ctx: ToolContext): Promise<InternalMcpToolCallResult> {
  const execution = requirePreviewExecution(ctx)
  const input = asRecord(args) as Partial<OpenWebPreviewArgs>
  const url = expectString(input.url, 'url')
  const target = classifyPreviewUrl(url)
  if (target.kind === 'refused') {
    // Never echo a URL that carries credentials.
    if (target.reason === 'credentials') return errorResult('The preview does not open URLs with a user name or password in them.')
    return errorResult(`URL "${url}" is not safe to open (must be http or https).`)
  }
  const threadId = execution.owner.kind === 'thread' ? execution.owner.id : undefined
  const open = async (): Promise<InternalMcpToolCallResult> => {
    ctx.webPreview.emitPreview({ workspaceId: execution.workspaceId, threadId, url: target.href, requestedAt: Date.now() })
    return textResult({ queued: true, workspaceId: execution.workspaceId, threadId, url: target.href, next: 'The renderer must open the page. Use oxespace_preview_interact with action=status or inspect to confirm the active URL before interacting or capturing.' })
  }
  const { runGated } = await import('./app-settings-actions')
  return target.kind === 'local'
    ? runGated({ tool: 'oxespace_open_web_preview', level: 'write', handler: open }, args, ctx)
    : runGated({ tool: 'oxespace_open_web_preview', level: 'confirm', handler: open, confirm: async () => previewApproval(target) }, args, ctx)
}

async function semanticSearch(args: unknown, ctx: ToolContext): Promise<InternalMcpToolCallResult> {
  const scope = await requireProjectScope(ctx)
  const id = semanticIndexFor(scope, ctx)
  if (!id) return textResult(scope.kind === 'thread' ? NO_SEMANTIC_INDEX : 'Semantic search is disabled for this workspace.')
  const input = asRecord(args)
  const query = expectString(input.query, 'query')
  const limit = typeof input.limit === 'number' ? input.limit : undefined
  const mode = input.mode === 'explore' || input.mode === 'exhaustive' || input.mode === 'auto' ? input.mode : undefined
  const maxTokens = typeof input.maxTokens === 'number' ? input.maxTokens : undefined

  try {
    const report = await ctx.semantic.queryDetailed(id, query, { limit, mode, maxTokens, caller: 'oxespace_semantic_search' })
    if (report.results.length === 0) {
      return textResult('No semantic matches found.')
    }
    return textResult(formatSemanticReport(report))
  } catch (err) {
    return errorResult(`Semantic search failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function describeSources(sources: Awaited<ReturnType<ToolContext['semantic']['queryDetailed']>>['sources']): string {
  if (sources.length === 0) return 'none answered'
  return sources.map((source) => source === 'vector' ? 'vector index (meaning)' : 'FTS5 (exact repository terms)').join(' + ')
}

function formatSemanticReport(report: Awaited<ReturnType<ToolContext['semantic']['queryDetailed']>>): string {
  const header = [
    `[OXESpace Retrieval] mode=${report.resolvedMode}${report.expanded ? ' (auto-expanded after low confidence)' : ''} · confidence=${report.confidence} · context≈${report.estimatedTokens} tokens · saved≈${report.estimatedSavingsPercent}% vs full matched files · ${report.durationMs}ms`,
    `Sources: ${describeSources(report.sources)}`,
    `Coverage: ${report.coverage.indexedFiles} indexed files · ${report.coverage.semanticCandidates} vector candidates · ${report.coverage.lexicalCandidates} lexical candidates${report.coverage.truncated ? ' · OUTPUT CAPPED' : ''}`,
    report.warning ? `CAUTION: ${report.warning}` : ''
  ].filter(Boolean).join('\n')
  const matches = report.results.map((result, index) => {
    const location = result.lineStart > 0 ? `:${result.lineStart}-${result.lineEnd}` : ''
    const scores = [
      result.semanticScore !== null ? `semantic=${result.semanticScore.toFixed(3)}` : '',
      result.lexicalScore !== null ? `lexical=${result.lexicalScore.toFixed(3)}` : ''
    ].filter(Boolean).join(', ')
    return [
      `${index + 1}. ${result.filePath}${location} [${result.sources.join('+')}${scores ? `; ${scores}` : ''}]`,
      `   Why: ${result.reasons.join('; ')}`,
      result.snippet ? `\n${result.snippet}` : ''
    ].filter(Boolean).join('\n')
  }).join('\n\n---\n\n')
  return `${header}\n\n${matches}`
}

async function qualityCheck(args: unknown, ctx: ToolContext): Promise<InternalMcpToolCallResult> {
  const scope = await requireProjectScope(ctx)
  // File reads go through the workspace-scoped file system, which needs a Code workspace for this root.
  if (!scope.workspaceId) return errorResult('[OXESpace Quality Controller] outcome=infrastructure · retryable=false\nThe quality check reads files through a Code workspace. Open this project in Code once, then retry.')
  const ws = { id: scope.workspaceId, rootPath: scope.rootPath }
  const input = asRecord(args)
  const baseRef = typeof input.baseRef === 'string' && input.baseRef.trim() ? input.baseRef.trim() : undefined
  const acceptanceCriteria = Array.isArray(input.acceptanceCriteria)
    ? input.acceptanceCriteria.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map((item) => item.trim())
    : undefined
  const maxFindings = typeof input.maxFindings === 'number' ? input.maxFindings : undefined
  const files = Array.isArray(input.files)
    ? input.files.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map(item => item.trim())
    : undefined
  try {
    // Quality analysis is an infrequent, user-triggered workflow. Keep its
    // parser and heuristics out of the Electron main-process startup chunk.
    const { QualityControllerService } = await import('../services/quality-controller.service')
    const qualityController = new QualityControllerService()
    const report = await qualityController.check(ws.id, ws.rootPath, ctx.fileSystem, { baseRef, files, acceptanceCriteria, maxFindings })
    const findings = report.findings.length > 0
      ? report.findings.map((finding, index) => [
          `${index + 1}. [${finding.severity.toUpperCase()}] ${finding.code}: ${finding.message}`,
          finding.files.length > 0 ? `   Files: ${finding.files.join(', ')}` : '',
          `   Action: ${finding.recommendation}`
        ].filter(Boolean).join('\n')).join('\n')
      : 'No heuristic gaps detected.'
    return textResult([
      `[OXESpace Quality Controller] outcome=validation · verdict=${report.verdict.toUpperCase()} · ${report.summary} · ${report.durationMs}ms`,
      files ? `Scope: ${files.length} explicitly selected path(s).` : 'Scope: complete Git worktree diff.',
      findings,
      `\nAcceptance evidence: ${report.evidence.acceptanceCriteria.filter((item) => item.status === 'evidenced').length}/${report.evidence.acceptanceCriteria.length}`,
      `Limitations: ${report.limitations.join(' ')}`
    ].join('\n'))
  } catch (err) {
    return errorResult(`[OXESpace Quality Controller] outcome=infrastructure · retryable=false\nQuality check could not run: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function captureWebPreview(args: unknown, ctx: ToolContext): Promise<InternalMcpToolCallResult> {
  const execution = requirePreviewExecution(ctx)
  const fileName = asRecord(args).fileName
  if (fileName !== undefined && (typeof fileName !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}\.png$/.test(fileName))) throw new Error('fileName must be a short PNG basename, for example aba-1.png')
  if (!ctx.documentation) return errorResult('Browser preview service unavailable')
  const verify = (): void => { ctx.executions!.authenticate(ctx.executionId, ctx.executionToken, ctx.workspaceId) }
  const service = await ctx.documentation()
  const shot = await service.preview.capture(execution.workspaceId, { mode: 'viewport' }, verify, execution.owner)
  verify()
  const content: InternalMcpToolCallResult['content'] = []
  if (typeof fileName === 'string') {
    if (!ctx.captureRoot) throw new Error('Preview capture directory is unavailable')
    const { directory, path } = await savePreviewCapture(ctx.captureRoot, execution.owner.kind === 'thread' ? execution.owner.id : execution.workspaceId, fileName, shot.png)
    content.push({ type: 'text', text: JSON.stringify({ directory, path, bytes: shot.png.length, pageUrl: shot.pageUrl }) })
  }
  content.push({ type: 'image', data: shot.png.toString('base64'), mimeType: 'image/png' })
  return { content, isError: false }
}

async function hybridExplore(args: unknown, ctx: ToolContext): Promise<InternalMcpToolCallResult> {
  const scope = await requireProjectScope(ctx)
  const ws = { id: scope.workspaceId, rootPath: scope.rootPath }
  const input = asRecord(args) as any
  const query = expectString(input.query, 'query')
  const maxFiles = typeof input.maxFiles === 'number' ? input.maxFiles : 12
  const mode = input.mode === 'explore' || input.mode === 'exhaustive' || input.mode === 'auto' ? input.mode : undefined
  const maxTokens = typeof input.maxTokens === 'number' ? input.maxTokens : 4_000

  let text = ''

  // 1. Semantic Search — listed as a complementary set (UNION with the
  //    structural results below). We deliberately DON'T fold these filename
  //    hints into the CodeGraph query: benchmarking showed query augmentation
  //    dilutes the structural search and drops recall (50% vs 70% on its own).
  //    Keeping the two retrievals independent and unioning them is what raises
  //    recall while staying token-cheap.
  try {
    // Structural search below needs only the checkout; the semantic half needs an index.
    const index = semanticIndexFor(scope, ctx)
    if (!index) throw new Error('no semantic index for this project')
    const semanticReport = await ctx.semantic.queryDetailed(index, query, { limit: Math.min(maxFiles, 20), mode, maxTokens, caller: 'oxespace_hybrid_explore' })
    if (semanticReport.results.length > 0) {
      text += `${formatSemanticReport(semanticReport)}\n\n`
    }
  } catch (err) {
    console.warn('[Hybrid RAG] Semantic search failed:', err)
  }

  // 2. CodeGraph Explore — on the PLAIN query (not augmented).
  try {
    const cg = await ctx.codegraph.ensureInstance(ws.rootPath)
    const { ToolHandler } = await import('../vendor/codegraph/mcp/tools')
    const handler = new ToolHandler(cg as any)

    const cgResult = await handler.execute('codegraph_explore', {
      query,
      maxFiles
    })

    if (cgResult.content && cgResult.content[0] && cgResult.content[0].type === 'text') {
      text += `[Hybrid RAG: Structural AST (CodeGraph)]\n${cgResult.content[0].text}`
    } else {
      text += `[Hybrid RAG: Structural AST (CodeGraph)]\nNo structural results found.`
    }
  } catch (err) {
    console.warn('[Hybrid RAG] CodeGraph explore failed:', err)
    text += `[Hybrid RAG: Structural AST (CodeGraph)]\nError: ${err instanceof Error ? err.message : String(err)}`
  }

  return textResult(text)
}

export const handlers = {
  listWorkspaces,
  listPanes,
  listWorktrees,
  createWorktree,
  removeWorktree,
  listScripts,
  runScript,
  listBackgroundJobs,
  stopBackgroundJob,
  getJobOutput,
  openWebPreview,
  captureWebPreview,
  semanticSearch,
  qualityCheck,
  hybridExplore
}
