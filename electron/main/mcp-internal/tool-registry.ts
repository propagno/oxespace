import type { BackgroundManager } from '../services/background.service'
import type { FileSystemService } from '../services/file-system.service'
import type { GitHubService } from '../services/github.service'
import type { WorkspaceService } from '../services/workspace.service'
import type {
  InternalMcpContentBlock,
  InternalMcpToolCallResult,
  InternalMcpToolDescriptor
} from '../../../shared/types/mcp-internal'
import { INTERNAL_MCP_ERROR_CODES } from '../../../shared/types/mcp-internal'
import { handlers } from './tool-handlers'
import type { WebPreviewBus } from './web-preview-bus'
import type { WorktreeEventBus } from './worktree-event-bus'

/**
 * Static catalogue of tools the internal MCP server exposes. Each entry pairs
 * the public JSON-Schema (sent verbatim on `tools/list`) with a server-side
 * handler that translates `arguments` into a call against existing services
 * and returns an MCP `content[]` payload.
 *
 * Why hand-written JSON Schemas instead of zod/io-ts? The McpManager (lines
 * 310-358 of mcp.service.ts) and the bridge use plain JSON — adding a runtime
 * validator here would force a new dep without observable benefit. Validation
 * happens inline in each handler.
 */
import type { SemanticService } from '../services/semantic.service'

export interface ToolContext {
  workspaceId: string | null
  workspaceServ: WorkspaceService
  github: GitHubService
  background: BackgroundManager
  fileSystem: FileSystemService
  semantic: SemanticService
  webPreview: WebPreviewBus
  worktree: WorktreeEventBus
}

export interface ToolEntry {
  descriptor: InternalMcpToolDescriptor
  requiresWorkspace: boolean
  handler: (args: unknown, ctx: ToolContext) => Promise<InternalMcpToolCallResult>
}

export const TOOL_REGISTRY: ToolEntry[] = [
  {
    descriptor: {
      name: 'oxespace_list_workspaces',
      description: 'List all OXESpace workspaces with their id, name, root path and active flag.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }
    },
    requiresWorkspace: false,
    handler: handlers.listWorkspaces
  },
  {
    descriptor: {
      name: 'oxespace_list_panes',
      description: 'List the panes (terminals) of the current workspace with status, agent and root path.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }
    },
    requiresWorkspace: true,
    handler: handlers.listPanes
  },
  {
    descriptor: {
      name: 'oxespace_list_worktrees',
      description: 'List the git worktrees for the current workspace (path, branch, isMain, locked, prunable).',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }
    },
    requiresWorkspace: true,
    handler: handlers.listWorktrees
  },
  {
    descriptor: {
      name: 'oxespace_create_worktree',
      description: 'Create a new git worktree at the given path on the given branch.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Target folder for the worktree. Must not already exist.' },
          branch: { type: 'string', description: 'Branch name to check out (existing or new).' },
          createBranch: { type: 'boolean', description: 'If true, create the branch (-b). Default false.' }
        },
        required: ['path', 'branch'],
        additionalProperties: false
      }
    },
    requiresWorkspace: true,
    handler: handlers.createWorktree
  },
  {
    descriptor: {
      name: 'oxespace_remove_worktree',
      description: 'Remove the git worktree at the given path. Use `force` to override uncommitted changes.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path of the worktree to remove.' },
          force: { type: 'boolean', description: 'Pass --force to git worktree remove.' }
        },
        required: ['path'],
        additionalProperties: false
      }
    },
    requiresWorkspace: true,
    handler: handlers.removeWorktree
  },
  {
    descriptor: {
      name: 'oxespace_list_scripts',
      description: 'List `.ps1` and `.sh` scripts discovered in the current workspace tree.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }
    },
    requiresWorkspace: true,
    handler: handlers.listScripts
  },
  {
    descriptor: {
      name: 'oxespace_run_script',
      description: 'Run a script (returned by oxespace_list_scripts) as a background job. Returns the job id.',
      inputSchema: {
        type: 'object',
        properties: {
          scriptId: { type: 'string', description: 'Script id from oxespace_list_scripts (its relative path).' },
          paneRootPath: { type: 'string', description: 'Optional cwd inside the workspace.' }
        },
        required: ['scriptId'],
        additionalProperties: false
      }
    },
    requiresWorkspace: true,
    handler: handlers.runScript
  },
  {
    descriptor: {
      name: 'oxespace_list_background_jobs',
      description: 'List background jobs for the current workspace, optionally filtered by status.',
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['running', 'pending', 'exited', 'failed', 'killed'] }
        },
        additionalProperties: false
      }
    },
    requiresWorkspace: true,
    handler: handlers.listBackgroundJobs
  },
  {
    descriptor: {
      name: 'oxespace_stop_background_job',
      description: 'Stop a running background job by id. Returns { stopped: true } on success.',
      inputSchema: {
        type: 'object',
        properties: { jobId: { type: 'string' } },
        required: ['jobId'],
        additionalProperties: false
      }
    },
    requiresWorkspace: true,
    handler: handlers.stopBackgroundJob
  },
  {
    descriptor: {
      name: 'oxespace_get_job_output',
      description: 'Read the buffered stdout/stderr (last ~1000 lines) of a background job by id. Use after oxespace_run_script to check if a build/test passed.',
      inputSchema: {
        type: 'object',
        properties: { jobId: { type: 'string', description: 'Job id returned by oxespace_run_script.' } },
        required: ['jobId'],
        additionalProperties: false
      }
    },
    requiresWorkspace: true,
    handler: handlers.getJobOutput
  },
  {
    descriptor: {
      name: 'oxespace_open_web_preview',
      description: 'Open the Web Preview panel in OXESpace pointing to the given URL.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The HTTP/HTTPS URL to preview (e.g., http://localhost:5173).' }
        },
        required: ['url'],
        additionalProperties: false
      }
    },
    requiresWorkspace: true,
    handler: handlers.openWebPreview
  },
  {
    descriptor: {
      name: 'oxespace_capture_web_preview',
      description: 'Capture a screenshot of the active Web Preview panel in the current workspace. Returns a base64 PNG image block.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }
    },
    requiresWorkspace: true,
    handler: handlers.captureWebPreview
  },
  {
    descriptor: {
      name: 'oxespace_semantic_search',
      description: 'Search the entire workspace codebase using local vector embeddings (Semantic Search). Finds contextually related code even if exact keywords don\'t match.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The natural language query to search for.' },
          limit: { type: 'number', description: 'Maximum number of files to return (default 5).' }
        },
        required: ['query'],
        additionalProperties: false
      }
    },
    requiresWorkspace: true,
    handler: handlers.semanticSearch
  }
]

export function findTool(name: string): ToolEntry | null {
  return TOOL_REGISTRY.find((entry) => entry.descriptor.name === name) ?? null
}

/** Helper used by handlers to build a single text content block. */
export function textResult(value: unknown): InternalMcpToolCallResult {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  const block: InternalMcpContentBlock = { type: 'text', text }
  return { content: [block] }
}

export function errorResult(message: string): InternalMcpToolCallResult {
  const block: InternalMcpContentBlock = { type: 'text', text: message }
  return { content: [block], isError: true }
}

export { INTERNAL_MCP_ERROR_CODES }
