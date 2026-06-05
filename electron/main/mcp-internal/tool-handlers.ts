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
import { isSafeExternalUrl } from '../utils/external-url'
import { discoverScripts } from '../services/scripts-discovery.service'
import type { ToolContext } from './tool-registry'
import { errorResult, textResult } from './tool-registry'

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

async function requireWorkspace(ctx: ToolContext): Promise<{ id: string; rootPath: string; name: string }> {
  if (!ctx.workspaceId) {
    throw new Error('No workspace context — set X-OXE-Workspace-Id on the RPC call')
  }
  const ws = ctx.workspaceServ.get(ctx.workspaceId)
  if (!ws) {
    throw new Error(`Workspace ${ctx.workspaceId} not found`)
  }
  return { id: ws.id, rootPath: ws.rootPath, name: ws.name }
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
  const result = await ctx.github.createWorktree({ rootPath: ws.rootPath, path, branch, createBranch })
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

async function openWebPreview(args: unknown, ctx: ToolContext): Promise<InternalMcpToolCallResult> {
  const ws = await requireWorkspace(ctx)
  const input = asRecord(args) as Partial<OpenWebPreviewArgs>
  const url = expectString(input.url, 'url')
  if (!isSafeExternalUrl(url)) {
    return errorResult(`URL "${url}" is not safe to open (must be http/https).`)
  }
  ctx.webPreview.emitPreview({ workspaceId: ws.id, url, requestedAt: Date.now() })
  return textResult({ opened: true, workspaceId: ws.id, url })
}

async function semanticSearch(args: unknown, ctx: ToolContext): Promise<InternalMcpToolCallResult> {
  const { id } = await requireWorkspace(ctx)
  if (!ctx.semantic.isEnabled(id)) {
    return textResult('Semantic search is disabled for this workspace.')
  }
  const input = asRecord(args)
  const query = expectString(input.query, 'query')
  const limit = typeof input.limit === 'number' ? input.limit : 5

  try {
    const results = await ctx.semantic.query(id, query, limit)
    if (results.length === 0) {
      return textResult('No semantic matches found.')
    }
    const formatted = results.map((r, i) => `${i + 1}. ${r.filePath} (score: ${r.score.toFixed(3)})`).join('\n')
    return textResult(`Top semantic matches for "${query}":\n\n${formatted}`)
  } catch (err) {
    return errorResult(`Semantic search failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function captureWebPreview(_args: unknown, ctx: ToolContext): Promise<InternalMcpToolCallResult> {
  const ws = await requireWorkspace(ctx)
  
  // Find the primary app window (OXESpace uses one BrowserWindow)
  const { BrowserWindow } = require('electron')
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) return errorResult('No application window found')

  // Execute JS in the renderer to find the Web Preview iframe rect
  const rectJson = await win.webContents.executeJavaScript(`
    (() => {
      const iframe = document.querySelector('iframe[title="Workspace web preview"]')
      if (!iframe) return null
      const rect = iframe.getBoundingClientRect()
      return JSON.stringify({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
    })()
  `).catch(() => null)

  if (!rectJson) {
    return errorResult('Web Preview is not active or could not be found.')
  }

  const rect = JSON.parse(rectJson)
  if (rect.width === 0 || rect.height === 0) {
    return errorResult('Web Preview is not visible.')
  }

  // Capture the region matching the iframe
  const nativeImage = await win.webContents.capturePage({
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  })

  const base64Data = nativeImage.toPNG().toString('base64')
  return {
    content: [{
      type: 'image',
      data: base64Data,
      mimeType: 'image/png'
    }],
    isError: false
  }
}

import { basename } from 'node:path'

async function hybridExplore(args: unknown, ctx: ToolContext): Promise<InternalMcpToolCallResult> {
  const ws = await requireWorkspace(ctx)
  const input = asRecord(args) as any
  const query = expectString(input.query, 'query')
  const maxFiles = typeof input.maxFiles === 'number' ? input.maxFiles : 12

  let text = ''

  // 1. Semantic Search (Hybrid Hinting)
  let fileHints = ''
  try {
    const semanticResults = await ctx.semantic.query(ws.id, query, 3)
    if (semanticResults.length > 0) {
      fileHints = semanticResults.map(r => basename(r.filePath)).join(' ')
      text += `[Hybrid RAG: Semantic Hints]\nTop conceptually related files:\n${semanticResults.map(r => `- ${r.filePath} (score: ${r.score.toFixed(3)})`).join('\n')}\n\n`
    }
  } catch (err) {
    console.warn('[Hybrid RAG] Semantic search failed:', err)
  }

  // 2. CodeGraph Explore
  try {
    const cg = await ctx.codegraph.ensureInstance(ws.rootPath)
    const { ToolHandler } = await import('../vendor/codegraph/mcp/tools')
    const handler = new ToolHandler(cg as any)

    const augmentedQuery = fileHints ? `${query} ${fileHints}` : query
    const cgResult = await handler.execute('codegraph_explore', {
      query: augmentedQuery,
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
  hybridExplore
}
