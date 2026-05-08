import { EventEmitter } from 'node:events'
import { describe, expect, test, vi } from 'vitest'
import { openInMemoryDatabase } from '../../electron/main/db/index'
import { buildPromptPayload, parseVerifyCommand, TaskService } from '../../electron/main/services/task.service'

describe('TaskService', () => {
  test('creates, lists, updates, reorders and deletes tasks', () => {
    const db = openInMemoryDatabase()
    seedWorkspace(db)
    const service = new TaskService(db)

    const first = service.create({ workspaceId: 'workspace-1', title: 'First' })
    const second = service.create({ workspaceId: 'workspace-1', title: 'Second', column: 'ready' })

    expect(service.list('workspace-1')).toHaveLength(2)
    expect(service.update(first.id, { column: 'ready', runStatus: 'running' }).column).toBe('ready')
    expect(service.reorder({ workspaceId: 'workspace-1', column: 'ready', orderedIds: [second.id, first.id] }).filter((task) => task.column === 'ready').map((task) => task.position)).toEqual([0, 1])

    service.delete(first.id)
    expect(service.list('workspace-1').map((task) => task.id)).toEqual([second.id])
    db.close()
  })

  test('runs a task by writing the agent prompt to the first active terminal', async () => {
    const db = openInMemoryDatabase()
    seedWorkspace(db)
    seedAgent(db)
    const terminalWrite = vi.fn()
    const service = new TaskService(db, {
      isTerminalRunning: (paneId) => paneId === 'pane-1',
      terminalWrite
    })
    const task = service.create({
      workspaceId: 'workspace-1',
      title: 'Fix login',
      description: 'Button disabled',
      context: 'Use auth store',
      allowedFiles: ['src/auth.ts']
    })

    const updated = await service.run({ taskId: task.id })

    expect(updated.column).toBe('running')
    expect(updated.runStatus).toBe('running')
    expect(terminalWrite).toHaveBeenCalledWith({
      paneId: 'pane-1',
      data: expect.stringContaining('# Task: Fix login')
    })
    expect(service.executions(task.id)[0]?.type).toBe('run')
    db.close()
  })

  test('parses verify commands without enabling shell operators', () => {
    expect(parseVerifyCommand('echo pwned && rm -rf /')).toEqual({
      file: 'echo',
      args: ['pwned', '&&', 'rm', '-rf', '/']
    })
  })

  test('marks verification failed when the verify process cannot spawn', async () => {
    const db = openInMemoryDatabase()
    seedWorkspace(db)
    const service = new TaskService(db, {
      spawnProcess: (() => {
        const child = new EventEmitter() as EventEmitter & {
          stdout: EventEmitter
          stderr: EventEmitter
        }
        child.stdout = new EventEmitter()
        child.stderr = new EventEmitter()
        setTimeout(() => child.emit('error', new Error('spawn ENOENT')), 0)
        return child as never
      }) as never
    })
    const task = service.create({
      workspaceId: 'workspace-1',
      title: 'Verify missing command',
      verifyCommand: 'missing-command --version'
    })

    const updated = await service.verify({ taskId: task.id })
    const execution = service.executions(task.id)[0]

    expect(updated.runStatus).toBe('failed')
    expect(updated.column).toBe('review')
    expect(execution?.exitCode).toBe(1)
    expect(execution?.completedAt).toEqual(expect.any(Number))
    expect(execution?.output).toContain('spawn ENOENT')
    db.close()
  })

  test('builds the KanbanRunner prompt payload', () => {
    expect(buildPromptPayload({
      id: 'task-1',
      workspaceId: 'workspace-1',
      title: 'Fix login',
      description: 'Button disabled',
      context: 'Use auth store',
      verifyCommand: '',
      allowedFiles: ['src/auth.ts', 'src/Login.tsx'],
      column: 'ready',
      runStatus: 'idle',
      position: 0,
      createdAt: 1,
      updatedAt: 1
    })).toContain('## Allowed Files\nsrc/auth.ts\nsrc/Login.tsx')
  })
})

function seedWorkspace(db: ReturnType<typeof openInMemoryDatabase>): void {
  db.prepare(`
    INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id, auto_start, is_active)
    VALUES ('workspace-1', 'Workspace', ?, '1x1', 'builtin-claude', 0, 1)
  `).run(process.cwd())
  db.prepare(`
    INSERT INTO panes (id, workspace_id, type, row_index, column_index, shell_profile_id, status)
    VALUES ('pane-1', 'workspace-1', 'terminal', 0, 0, 'builtin-claude', 'running')
  `).run()
}

function seedAgent(db: ReturnType<typeof openInMemoryDatabase>): void {
  db.prepare(`
    INSERT INTO agent_profiles
      (agent_profile_id, name, provider, command, command_template, model, role, is_builtin, created_at)
    VALUES
      ('agent-1', 'Claude', 'claude', 'claude', 'claude --message "{{task}}"', NULL, NULL, 1, 1)
  `).run()
}
