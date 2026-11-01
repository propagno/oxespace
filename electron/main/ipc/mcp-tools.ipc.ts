import { ipcMain } from 'electron'
import type { AppDatabase } from '../db'
import type { FileSystemService } from '../services/file-system.service'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { CONFIGURABLE_MCP_TOOL_GROUPS, MCP_TOOL_GROUP_MODES } from '../../../shared/types/mcp-tools'
import { parseOneOf, requireAppFrame } from './ipc-guards'

function rootPathOf(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096 || value.includes('\0')) throw new Error('Invalid project folder')
  return value
}

function fieldsOf(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid tool groups input')
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Unknown tool groups field')
  return value as Record<string, unknown>
}

/** Settings › Tools (F10): read the groups of a project, and set one group's mode. The service loads on first use. */
export function registerMcpToolsIpc(db: AppDatabase, files: FileSystemService): void {
  const service = () => import('../services/mcp-tool-groups')
  ipcMain.handle(IPC_CHANNELS.mcpInternal.toolGroups, async (event, value: unknown) => {
    requireAppFrame(event, 'Tool groups')
    const input = value === undefined || value === null ? {} : fieldsOf(value, ['rootPath'])
    const groups = await service()
    if (input.rootPath === undefined) return groups.toolGroupsReport(null)
    // Only a project OXESpace knows: the window never makes main read oxe.yaml from an arbitrary folder.
    const rootPath = rootPathOf(input.rootPath)
    groups.requireRegisteredProject(db, rootPath)
    return groups.toolGroupsReport(rootPath)
  })
  ipcMain.handle(IPC_CHANNELS.mcpInternal.setToolGroupMode, async (event, value: unknown) => {
    requireAppFrame(event, 'Tool groups')
    const input = fieldsOf(value, ['rootPath', 'group', 'mode'])
    return (await service()).setToolGroupMode(db, files, {
      rootPath: rootPathOf(input.rootPath),
      group: parseOneOf(input.group, CONFIGURABLE_MCP_TOOL_GROUPS, 'group'),
      mode: parseOneOf(input.mode, MCP_TOOL_GROUP_MODES, 'mode')
    })
  })
}
