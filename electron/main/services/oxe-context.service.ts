import type { AppDatabase } from '../db/index'
import type { BackgroundManager } from './background.service'
import type { FileSystemService } from './file-system.service'
import type { GitHubService } from './github.service'
import type { GitService } from './git.service'
import type { WorkspaceService } from './workspace.service'
import { TOOL_REGISTRY } from '../mcp-internal/tool-registry'
import { discoverScripts } from './scripts-discovery.service'

/**
 * Builds a compact OXESpace context manifest to prepend to a pane's initial
 * agent prompt. The agent CLI (Claude / Copilot / Codex) reads it on first
 * turn and gains awareness of:
 *
 *   - which workspace + branch + cwd it's in
 *   - which sibling panes exist (multi-agent vibe coding)
 *   - which git worktrees are available
 *   - which scripts the user has in the repo
 *   - which background jobs are running
 *   - which OXESpace MCP tools it can call to ACT on any of the above
 *
 * Static snapshot at pane spawn — for fresh state mid-conversation the agent
 * is supposed to fall back to the MCP server (oxespace_* tools). The manifest
 * is the read shortcut; MCP is the write/refresh path.
 *
 * Designed to stay under ~400 tokens. Each section omitted when empty.
 */

export interface OxeContextDeps {
  db: AppDatabase
  workspaceServ: WorkspaceService
  github: GitHubService
  git: GitService
  background: BackgroundManager
  fileSystem: FileSystemService
}

export interface BuildPaneManifestInput {
  workspaceId: string
  paneId: string
}

export async function buildPaneManifest(deps: OxeContextDeps, input: BuildPaneManifestInput): Promise<string> {
  const workspace = deps.workspaceServ.get(input.workspaceId)
  if (!workspace) return ''
  const pane = workspace.panes.find((p) => p.id === input.paneId) ?? null
  const paneCwd = pane?.rootPath ?? workspace.rootPath
  const paneLabel = pane ? formatPaneLabel(pane) : 'this pane'

  // Run cheap reads in parallel — each is independent.
  const [worktreesResult, branchResult, scriptsResult, bgJobsResult] = await Promise.allSettled([
    deps.github.listWorktrees({ workspaceId: workspace.id, rootPath: workspace.rootPath }),
    deps.git.getBranch(paneCwd),
    discoverScripts(deps.fileSystem, workspace.id, workspace.rootPath),
    Promise.resolve(deps.background.list(workspace.id))
  ])

  const worktrees = worktreesResult.status === 'fulfilled' ? worktreesResult.value : []
  const branch = branchResult.status === 'fulfilled' ? branchResult.value : null
  const scripts = scriptsResult.status === 'fulfilled' ? scriptsResult.value : []
  const bgJobs = bgJobsResult.status === 'fulfilled' ? bgJobsResult.value : []

  const sections: string[] = []

  // Header — single line, identifies the pane's "you are here".
  const branchLabel = branch?.branch ? branch.branch : branch?.shortSha ? `detached ${branch.shortSha}` : 'no git'
  sections.push(`# OXESpace context — workspace: ${workspace.name} · branch: ${branchLabel}`)

  // Pane identity + siblings.
  const siblings = workspace.panes.filter((p) => p.id !== input.paneId)
  const paneSection: string[] = ['## Pane', `- ${paneLabel} (this) · agent: ${pane?.agentName ?? 'shell'} · cwd: ${shortPath(paneCwd, workspace.rootPath)}`]
  if (siblings.length > 0) {
    paneSection.push('', '### Sibling panes in this workspace')
    for (const sib of siblings.slice(0, 6)) {
      const cwd = shortPath(sib.rootPath ?? workspace.rootPath, workspace.rootPath)
      paneSection.push(`- ${formatPaneLabel(sib)} · agent: ${sib.agentName ?? 'shell'} · cwd: ${cwd}`)
    }
    if (siblings.length > 6) paneSection.push(`- (+${siblings.length - 6} more)`)
  }
  sections.push(paneSection.join('\n'))

  // Worktrees — only surface when there's more than the main one (otherwise noise).
  const nonMainWorktrees = worktrees.filter((w) => !w.isMain)
  if (nonMainWorktrees.length > 0) {
    const lines = ['## Worktrees']
    for (const wt of worktrees) {
      const tag = wt.isMain ? ' (main)' : ''
      const here = wt.path === paneCwd ? ' ← current pane' : ''
      lines.push(`- ${wt.branch ?? '(detached)'} at ${shortPath(wt.path, workspace.rootPath)}${tag}${here}`)
    }
    sections.push(lines.join('\n'))
  }

  // Scripts — top 12 to stay under the token budget.
  if (scripts.length > 0) {
    const lines = ['## Scripts (.ps1/.sh discovered — run via oxespace_run_script)']
    for (const script of scripts.slice(0, 12)) {
      lines.push(`- ${script.name} (${script.relativePath})`)
    }
    if (scripts.length > 12) lines.push(`- (+${scripts.length - 12} more)`)
    sections.push(lines.join('\n'))
  }

  // Background jobs — only running/pending (finished ones are noise here).
  const activeJobs = bgJobs.filter((j) => j.status === 'running' || j.status === 'pending')
  if (activeJobs.length > 0) {
    const lines = ['## Background jobs (active)']
    for (const job of activeJobs.slice(0, 6)) {
      const ago = formatRelativeAge(job.startedAtMs)
      lines.push(`- ${job.label || job.command} · status: ${job.status} · started ${ago}`)
    }
    sections.push(lines.join('\n'))
  }

  // MCP tools — always include so the agent knows what it can call.
  const toolNames = TOOL_REGISTRY.map((t) => t.descriptor.name).join(', ')
  sections.push(
    [
      '## OXESpace MCP tools available',
      toolNames,
      'Call via MCP (e.g. `oxespace_list_worktrees`) to refresh this snapshot or act on the workspace.'
    ].join('\n')
  )

  return sections.join('\n\n')
}

function formatPaneLabel(pane: { displayName?: string | null; rowIndex: number; columnIndex: number }): string {
  return pane.displayName ?? `Pane ${pane.rowIndex + 1}.${pane.columnIndex + 1}`
}

function shortPath(path: string, workspaceRoot: string): string {
  if (path === workspaceRoot) return '.'
  // Display as relative if inside the workspace, otherwise the absolute path
  // (which is the case for worktrees living outside the main repo).
  const wsNormalized = workspaceRoot.replace(/[\\/]+$/, '')
  if (path.startsWith(wsNormalized + '/') || path.startsWith(wsNormalized + '\\')) {
    return path.slice(wsNormalized.length + 1)
  }
  return path
}

function formatRelativeAge(startedAtMs: number): string {
  const diff = Date.now() - startedAtMs
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}
