import { describe, expect, test, vi } from 'vitest'
import { openInMemoryDatabase } from '../../electron/main/db/index'
import { AgentWorkflowService } from '../../electron/main/services/agent-workflow.service'
import { WorkspaceService } from '../../electron/main/services/workspace.service'

describe('AgentWorkflowService', () => {
  test('creates default role bindings and a run with gated steps', () => {
    const db = openInMemoryDatabase()
    const workspace = new WorkspaceService(db).create({ rootPath: 'C:/repo', layoutPreset: 4 })
    const service = new AgentWorkflowService(db)

    const bindings = service.getRoleBindings(workspace.id)
    const details = service.createRun({ workspaceId: workspace.id, title: 'Implement feature', initialPrompt: 'Need a safer workflow' })

    expect(bindings).toHaveLength(6)
    expect(bindings.find((binding) => binding.role === 'rubber_duck')?.agentProfileId).toBe('builtin-agent-claude')
    expect(bindings.find((binding) => binding.role === 'publisher')?.enabled).toBe(false)
    expect(details.run.status).toBe('draft')
    expect(details.steps.map((step) => step.role)).toEqual(['rubber_duck', 'planner', 'executor', 'reviewer', 'verifier', 'publisher'])
    expect(details.artifacts[0]).toMatchObject({ kind: 'clarification', title: 'Initial input' })

    db.close()
  })

  test('prepares a Rubber Duck prompt without executing and then sends it to a terminal', async () => {
    const db = openInMemoryDatabase()
    const workspace = new WorkspaceService(db).create({ rootPath: 'C:/repo', layoutPreset: 4 })
    const terminalWrite = vi.fn()
    const service = new AgentWorkflowService(db, { terminalWrite })
    const details = service.createRun({ workspaceId: workspace.id, title: 'Clarify bug', initialPrompt: 'It breaks after minimize' })

    const prepared = service.prepareStep({ runId: details.run.id, role: 'rubber_duck' })
    const duckStep = prepared.steps.find((step) => step.role === 'rubber_duck')

    expect(duckStep?.status).toBe('prepared')
    expect(duckStep?.prompt).toContain('You are the Rubber Duck')
    expect(terminalWrite).not.toHaveBeenCalled()

    await service.runStep({ stepId: duckStep!.id, paneId: workspace.panes[0].id })
    expect(terminalWrite).toHaveBeenCalledWith({ paneId: workspace.panes[0].id, data: expect.stringContaining('You are the Rubber Duck') })
    expect(service.getRun(details.run.id).steps.find((step) => step.id === duckStep!.id)?.status).toBe('sent_to_terminal')

    db.close()
  })

  test('requires an approved plan before sending executor prompt', async () => {
    const db = openInMemoryDatabase()
    const workspace = new WorkspaceService(db).create({ rootPath: 'C:/repo', layoutPreset: 4 })
    const terminalWrite = vi.fn()
    const service = new AgentWorkflowService(db, { terminalWrite })
    const details = service.createRun({ workspaceId: workspace.id, title: 'Gate execution', initialPrompt: 'Implement the feature' })
    const executor = details.steps.find((step) => step.role === 'executor')!

    await expect(service.sendApprovedExecution({ stepId: executor.id, paneId: workspace.panes[0].id })).rejects.toThrow('Approve a plan before execution')

    const approved = service.approvePlan({ runId: details.run.id, planContent: '1. Update the UI\n2. Run checks' })
    const approvedExecutor = approved.steps.find((step) => step.role === 'executor')!
    await service.sendApprovedExecution({ stepId: approvedExecutor.id, paneId: workspace.panes[0].id })

    expect(terminalWrite).toHaveBeenCalledWith({ paneId: workspace.panes[0].id, data: expect.stringContaining('Implement only the approved plan') })
    expect(service.getRun(details.run.id).artifacts.some((artifact) => artifact.kind === 'execution_prompt')).toBe(true)

    db.close()
  })

  test('completes manual output and isolates runs by workspace', () => {
    const db = openInMemoryDatabase()
    const workspaceService = new WorkspaceService(db)
    const first = workspaceService.create({ rootPath: 'C:/repo-a', layoutPreset: 4 })
    const second = workspaceService.create({ rootPath: 'C:/repo-b', layoutPreset: 4 })
    const service = new AgentWorkflowService(db)
    const firstRun = service.createRun({ workspaceId: first.id, title: 'First' })
    service.createRun({ workspaceId: second.id, title: 'Second' })
    const prepared = service.prepareStep({ runId: firstRun.run.id, role: 'planner' })
    const planner = prepared.steps.find((step) => step.role === 'planner')!

    const completed = service.completeManualStep({ stepId: planner.id, output: 'Plan is ready', status: 'passed' })

    expect(completed.steps.find((step) => step.id === planner.id)?.status).toBe('passed')
    expect(completed.artifacts.some((artifact) => artifact.title === 'Planner output')).toBe(true)
    expect(service.listRuns(first.id)).toHaveLength(1)
    expect(service.listRuns(second.id)).toHaveLength(1)

    db.close()
  })
})
