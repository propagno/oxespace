import { describe, expect, test } from 'vitest'
import { IPC_CHANNELS } from '../../shared/types/ipc'
import {
  parseTaskReorderInput,
  parseTerminalResizeInput,
  parseTerminalWriteInput,
  parseUpdateWorkspaceEditorStateInput,
  parseUpdateWorkspaceSettingsInput,
  parseWorkspaceCreateInput
} from '../../electron/main/ipc/validation'

describe('ipc contracts', () => {
  test('uses stable workspace and terminal channel names', () => {
    expect(IPC_CHANNELS.workspace.create).toBe('workspace:create')
    expect(IPC_CHANNELS.workspace.shellProfiles).toBe('workspace:shell-profiles')
    expect(IPC_CHANNELS.workspace.closePane).toBe('workspace:close-pane')
    expect(IPC_CHANNELS.workspace.updatePaneType).toBe('workspace:update-pane-type')
    expect(IPC_CHANNELS.workspace.updateEditorState).toBe('workspace:update-editor-state')
    expect(IPC_CHANNELS.workspace.updateSettings).toBe('workspace:update-settings')
    expect(IPC_CHANNELS.workspace.pickFolder).toBe('workspace:pick-folder')
    expect(IPC_CHANNELS.terminal.write).toBe('terminal:write')
    expect(IPC_CHANNELS.terminal.resize).toBe('terminal:resize')
  })

  test('uses stable agent channel names', () => {
    expect(IPC_CHANNELS.agent.list).toBe('agent:list')
    expect(IPC_CHANNELS.agent.create).toBe('agent:create')
    expect(IPC_CHANNELS.agent.update).toBe('agent:update')
    expect(IPC_CHANNELS.agent.delete).toBe('agent:delete')
    expect(IPC_CHANNELS.agent.discover).toBe('agent:discover')
    expect(IPC_CHANNELS.agent.getReadiness).toBe('agent:get-readiness')
  })

  test('uses stable tasks channel names', () => {
    expect(IPC_CHANNELS.tasks.list).toBe('tasks:list')
    expect(IPC_CHANNELS.tasks.create).toBe('tasks:create')
    expect(IPC_CHANNELS.tasks.update).toBe('tasks:update')
    expect(IPC_CHANNELS.tasks.delete).toBe('tasks:delete')
    expect(IPC_CHANNELS.tasks.reorder).toBe('tasks:reorder')
    expect(IPC_CHANNELS.tasks.run).toBe('tasks:run')
    expect(IPC_CHANNELS.tasks.verify).toBe('tasks:verify')
    expect(IPC_CHANNELS.tasks.executions).toBe('tasks:executions')
    expect(IPC_CHANNELS.tasks.onVerifyOutput).toBe('tasks:verify-output')
  })

  test('uses stable filesystem channel names', () => {
    expect(IPC_CHANNELS.fs.listTree).toBe('fs:list-tree')
    expect(IPC_CHANNELS.fs.readFile).toBe('fs:read-file')
    expect(IPC_CHANNELS.fs.writeFile).toBe('fs:write-file')
    expect(IPC_CHANNELS.fs.watchFile).toBe('fs:watch-file')
    expect(IPC_CHANNELS.fs.unwatchFile).toBe('fs:unwatch-file')
    expect(IPC_CHANNELS.fs.onFileChanged).toBe('fs:file-changed')
  })

  test('validates workspace create payloads', () => {
    expect(parseWorkspaceCreateInput({ rootPath: 'C:/repo', layout: '2x2', autoStart: true })).toEqual({
      rootPath: 'C:/repo',
      layout: '2x2',
      layoutPreset: undefined,
      defaultShellProfileId: undefined,
      name: undefined,
      themeId: undefined,
      uiDensity: undefined,
      autoStart: true
    })

    expect(() => parseWorkspaceCreateInput({ rootPath: 'C:/repo', layout: '8x8' })).toThrow('layout')
    expect(parseWorkspaceCreateInput({ rootPath: 'C:/repo', layoutPreset: 6, themeId: 'nord', uiDensity: 'comfortable' })).toMatchObject({
      rootPath: 'C:/repo',
      layoutPreset: 6,
      themeId: 'nord',
      uiDensity: 'comfortable'
    })
  })

  test('validates terminal payloads', () => {
    expect(parseTerminalWriteInput({ paneId: 'pane-1', data: 'echo ok\r' })).toEqual({
      paneId: 'pane-1',
      data: 'echo ok\r'
    })
    expect(parseTerminalResizeInput({ paneId: 'pane-1', cols: 120, rows: 32 })).toEqual({
      paneId: 'pane-1',
      cols: 120,
      rows: 32
    })
    expect(() => parseTerminalResizeInput({ paneId: 'pane-1', cols: 0, rows: 32 })).toThrow('cols')
  })

  test('validates workspace editor state payloads', () => {
    expect(parseUpdateWorkspaceEditorStateInput({ workspaceId: 'workspace-1', editorVisible: true, editorWidthPercent: 40 })).toEqual({
      workspaceId: 'workspace-1',
      editorVisible: true,
      editorExpanded: undefined,
      editorWidthPercent: 40
    })
    expect(() => parseUpdateWorkspaceEditorStateInput({ workspaceId: 'workspace-1', editorWidthPercent: 90 })).toThrow('editorWidthPercent')
  })

  test('validates workspace settings payloads', () => {
    expect(parseUpdateWorkspaceSettingsInput({ workspaceId: 'workspace-1', themeId: 'amber', uiDensity: 'comfortable', layoutPreset: 10 })).toEqual({
      workspaceId: 'workspace-1',
      themeId: 'amber',
      uiDensity: 'comfortable',
      defaultShellProfileId: undefined,
      layoutPreset: 10,
      applyShellToIdlePanes: undefined
    })
    expect(() => parseUpdateWorkspaceSettingsInput({ workspaceId: 'workspace-1', themeId: 'wrong' })).toThrow('themeId')
    expect(() => parseUpdateWorkspaceSettingsInput({ workspaceId: 'workspace-1', layoutPreset: 3 })).toThrow('layoutPreset')
  })

  test('validates task reorder payloads', () => {
    expect(parseTaskReorderInput({ workspaceId: 'workspace-1', column: 'done', orderedIds: ['a', 'b'] })).toEqual({
      workspaceId: 'workspace-1',
      column: 'done',
      orderedIds: ['a', 'b']
    })
    expect(() => parseTaskReorderInput({ workspaceId: 'workspace-1', column: 'later', orderedIds: [] })).toThrow('column')
  })
})
