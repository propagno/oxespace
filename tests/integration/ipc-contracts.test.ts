import { describe, expect, test } from 'vitest'
import { IPC_CHANNELS } from '../../shared/types/ipc'
import {
  parseTaskReorderInput,
  parseOxeWorkspaceInput,
  parsePrepareAgentWorkflowStepInput,
  parseTerminalResizeInput,
  parseTerminalWriteInput,
  parseUpdateWorkspaceAgentsStateInput,
  parseUpdateWorkspaceAgentRoleBindingsInput,
  parseUpdateWorkspaceEditorStateInput,
  parseUpdateWorkspaceOxeStateInput,
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
    expect(IPC_CHANNELS.workspace.updateOxeState).toBe('workspace:update-oxe-state')
    expect(IPC_CHANNELS.workspace.updateAgentsState).toBe('workspace:update-agents-state')
    expect(IPC_CHANNELS.workspace.updateReviewState).toBe('workspace:update-review-state')
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

  test('uses stable agent workflow channel names', () => {
    expect(IPC_CHANNELS.agentWorkflow.listRuns).toBe('agent-workflow:list-runs')
    expect(IPC_CHANNELS.agentWorkflow.createRun).toBe('agent-workflow:create-run')
    expect(IPC_CHANNELS.agentWorkflow.getRun).toBe('agent-workflow:get-run')
    expect(IPC_CHANNELS.agentWorkflow.updateRoleBindings).toBe('agent-workflow:update-role-bindings')
    expect(IPC_CHANNELS.agentWorkflow.getRoleBindings).toBe('agent-workflow:get-role-bindings')
    expect(IPC_CHANNELS.agentWorkflow.prepareStep).toBe('agent-workflow:prepare-step')
    expect(IPC_CHANNELS.agentWorkflow.runStep).toBe('agent-workflow:run-step')
    expect(IPC_CHANNELS.agentWorkflow.completeManualStep).toBe('agent-workflow:complete-manual-step')
    expect(IPC_CHANNELS.agentWorkflow.appendArtifact).toBe('agent-workflow:append-artifact')
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

  test('uses stable OXE channel names', () => {
    expect(IPC_CHANNELS.oxe.getStatus).toBe('oxe:get-status')
    expect(IPC_CHANNELS.oxe.getStatusJson).toBe('oxe:get-status-json')
    expect(IPC_CHANNELS.oxe.listArtifacts).toBe('oxe:list-artifacts')
    expect(IPC_CHANNELS.oxe.listArtifactsRich).toBe('oxe:list-artifacts-rich')
    expect(IPC_CHANNELS.oxe.getFreshness).toBe('oxe:get-freshness')
    expect(IPC_CHANNELS.oxe.onWorkspaceDrift).toBe('oxe:workspace-drift')
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

  test('validates workspace OXE state payloads', () => {
    expect(parseUpdateWorkspaceOxeStateInput({ workspaceId: 'workspace-1', oxePanelVisible: true, oxePanelWidthPercent: 40 })).toEqual({
      workspaceId: 'workspace-1',
      oxePanelVisible: true,
      oxePanelExpanded: undefined,
      oxePanelWidthPercent: 40
    })
    expect(() => parseUpdateWorkspaceOxeStateInput({ workspaceId: 'workspace-1', oxePanelWidthPercent: 90 })).toThrow('editorWidthPercent')
  })

  test('validates workspace Agents state payloads', () => {
    expect(parseUpdateWorkspaceAgentsStateInput({ workspaceId: 'workspace-1', agentsPanelVisible: true, agentsPanelWidthPercent: 40 })).toEqual({
      workspaceId: 'workspace-1',
      agentsPanelVisible: true,
      agentsPanelExpanded: undefined,
      agentsPanelWidthPercent: 40
    })
    expect(() => parseUpdateWorkspaceAgentsStateInput({ workspaceId: 'workspace-1', agentsPanelWidthPercent: 90 })).toThrow('editorWidthPercent')
  })

  test('validates agent workflow payloads', () => {
    expect(parsePrepareAgentWorkflowStepInput({ runId: 'run-1', role: 'rubber_duck' })).toEqual({
      runId: 'run-1',
      role: 'rubber_duck'
    })
    expect(parseUpdateWorkspaceAgentRoleBindingsInput({ workspaceId: 'workspace-1', bindings: [{ role: 'planner', enabled: true }] })).toEqual({
      workspaceId: 'workspace-1',
      bindings: [{ role: 'planner', agentProfileId: null, shellProfileId: null, model: null, enabled: true }]
    })
    expect(() => parsePrepareAgentWorkflowStepInput({ runId: 'run-1', role: 'bad' })).toThrow('role')
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

  test('validates OXE workspace payloads', () => {
    expect(parseOxeWorkspaceInput({ workspaceId: 'workspace-1', rootPath: 'C:/repo' })).toEqual({
      workspaceId: 'workspace-1',
      rootPath: 'C:/repo'
    })
    expect(() => parseOxeWorkspaceInput({ workspaceId: '', rootPath: 'C:/repo' })).toThrow('workspaceId')
  })
})
