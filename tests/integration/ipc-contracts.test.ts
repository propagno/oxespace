import { describe, expect, test } from 'vitest'
import { IPC_CHANNELS } from '../../shared/types/ipc'
import {
  parseTerminalResizeInput,
  parseTerminalWriteInput,
  parseWorkspaceCreateInput
} from '../../electron/main/ipc/validation'

describe('ipc contracts', () => {
  test('uses stable workspace and terminal channel names', () => {
    expect(IPC_CHANNELS.workspace.create).toBe('workspace:create')
    expect(IPC_CHANNELS.workspace.shellProfiles).toBe('workspace:shell-profiles')
    expect(IPC_CHANNELS.workspace.closePane).toBe('workspace:close-pane')
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

  test('validates workspace create payloads', () => {
    expect(parseWorkspaceCreateInput({ rootPath: 'C:/repo', layout: '2x2', autoStart: true })).toEqual({
      rootPath: 'C:/repo',
      layout: '2x2',
      defaultShellProfileId: undefined,
      name: undefined,
      autoStart: true
    })

    expect(() => parseWorkspaceCreateInput({ rootPath: 'C:/repo', layout: '8x8' })).toThrow('layout')
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
})
