import { ipcMain } from 'electron'
import type { AppDatabase } from '../db'
import type { FileSystemService } from '../services/file-system.service'
import type { ToolRulesDeps } from '../services/mcp-tool-rules'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { MCP_TOOL_DECISIONS } from '../../../shared/types/mcp-tools'
import { parseOneOf } from './ipc-guards'

function fieldsOf(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid tool rules input')
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Unknown tool rules field')
  return value as Record<string, unknown>
}

function textOf(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) throw new Error(`Invalid ${label}`)
  return value
}

/** Settings › Tools, per tool (B7.3): read a project's rules, and set one. The window only (B12's global sender guard); the service loads on first use. */
export function registerMcpToolRulesIpc(db: AppDatabase, files: FileSystemService, servers?: ToolRulesDeps['servers']): void {
  const service = () => import('../services/mcp-tool-rules')
  ipcMain.handle(IPC_CHANNELS.mcpInternal.toolRules, async (_event, value: unknown) => {
    const input = fieldsOf(value, ['rootPath'])
    return (await service()).toolRules({ db, files, servers }, textOf(input.rootPath, 'project folder', 4096))
  })
  ipcMain.handle(IPC_CHANNELS.mcpInternal.setToolRule, async (_event, value: unknown) => {
    const input = fieldsOf(value, ['rootPath', 'server', 'tool', 'decision'])
    return (await service()).setToolRule({ db, files, servers }, {
      rootPath: textOf(input.rootPath, 'project folder', 4096),
      server: textOf(input.server, 'MCP server', 100),
      tool: textOf(input.tool, 'MCP tool', 200),
      decision: parseOneOf(input.decision, MCP_TOOL_DECISIONS, 'decision')
    })
  })
}
