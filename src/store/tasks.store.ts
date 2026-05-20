import { create } from 'zustand'
import type {
  CreateTaskInput,
  ReorderTasksInput,
  RunTaskInput,
  Task,
  TaskExecution,
  TaskVerifyOutputEvent,
  UpdateTaskInput,
  VerifyTaskInput
} from '../../shared/types/task'

interface TasksState {
  tasksByWorkspace: Record<string, Task[]>
  executionsByTask: Record<string, TaskExecution[]>
  verifyOutputByTask: Record<string, string>
  loading: boolean
  error: string | null
  loadTasks: (workspaceId: string) => Promise<void>
  createTask: (input: CreateTaskInput) => Promise<Task>
  updateTask: (id: string, input: UpdateTaskInput) => Promise<Task>
  deleteTask: (workspaceId: string, id: string) => Promise<void>
  reorderTasks: (input: ReorderTasksInput) => Promise<void>
  runTask: (input: RunTaskInput) => Promise<Task>
  verifyTask: (input: VerifyTaskInput) => Promise<Task>
  loadExecutions: (taskId: string) => Promise<void>
  attachVerifyOutputListener: () => () => void
  addDependency: (taskId: string, dependsOnTaskId: string) => Promise<void>
  removeDependency: (taskId: string, dependsOnTaskId: string) => Promise<void>
  runPipeline: (workspaceId: string) => Promise<{ dispatched: string[]; pending: string[] }>
  clearError: () => void
}

export const useTasksStore = create<TasksState>((set, get) => ({
  tasksByWorkspace: {},
  executionsByTask: {},
  verifyOutputByTask: {},
  loading: false,
  error: null,

  loadTasks: async (workspaceId) => {
    set({ loading: true, error: null })
    try {
      const tasks = await window.oxe.tasks.list(workspaceId)
      set((state) => ({
        tasksByWorkspace: { ...state.tasksByWorkspace, [workspaceId]: tasks },
        loading: false
      }))
    } catch (error) {
      set({ error: toMessage(error), loading: false })
    }
  },

  createTask: async (input) => {
    const task = await window.oxe.tasks.create(input)
    set((state) => ({
      tasksByWorkspace: upsertTask(state.tasksByWorkspace, task)
    }))
    return task
  },

  updateTask: async (id, input) => {
    const task = await window.oxe.tasks.update(id, input)
    set((state) => ({
      tasksByWorkspace: upsertTask(state.tasksByWorkspace, task)
    }))
    return task
  },

  deleteTask: async (workspaceId, id) => {
    await window.oxe.tasks.delete(id)
    set((state) => ({
      tasksByWorkspace: {
        ...state.tasksByWorkspace,
        [workspaceId]: (state.tasksByWorkspace[workspaceId] ?? []).filter((task) => task.id !== id)
      }
    }))
  },

  reorderTasks: async (input) => {
    const tasks = await window.oxe.tasks.reorder(input)
    set((state) => ({
      tasksByWorkspace: { ...state.tasksByWorkspace, [input.workspaceId]: tasks }
    }))
  },

  runTask: async (input) => {
    try {
      const task = await window.oxe.tasks.run(input)
      set((state) => ({
        tasksByWorkspace: upsertTask(state.tasksByWorkspace, task),
        error: null
      }))
      return task
    } catch (error) {
      set({ error: toMessage(error) })
      throw error
    }
  },

  verifyTask: async (input) => {
    try {
      const task = await window.oxe.tasks.verify(input)
      set((state) => ({
        tasksByWorkspace: upsertTask(state.tasksByWorkspace, task),
        error: null
      }))
      return task
    } catch (error) {
      set({ error: toMessage(error) })
      throw error
    }
  },

  loadExecutions: async (taskId) => {
    const executions = await window.oxe.tasks.executions(taskId)
    set((state) => ({
      executionsByTask: { ...state.executionsByTask, [taskId]: executions }
    }))
  },

  attachVerifyOutputListener: () =>
    window.oxe.tasks.onVerifyOutput((event) => {
      set((state) => ({
        verifyOutputByTask: {
          ...state.verifyOutputByTask,
          [event.taskId]: event.done ? state.verifyOutputByTask[event.taskId] ?? '' : `${state.verifyOutputByTask[event.taskId] ?? ''}${event.chunk}`
        }
      }))
    }),

  addDependency: async (taskId, dependsOnTaskId) => {
    try {
      const task = await window.oxe.tasks.addDependency({ taskId, dependsOnTaskId })
      set((state) => ({ tasksByWorkspace: upsertTask(state.tasksByWorkspace, task), error: null }))
    } catch (err) {
      set({ error: toMessage(err) })
      throw err
    }
  },

  removeDependency: async (taskId, dependsOnTaskId) => {
    try {
      const task = await window.oxe.tasks.removeDependency({ taskId, dependsOnTaskId })
      set((state) => ({ tasksByWorkspace: upsertTask(state.tasksByWorkspace, task), error: null }))
    } catch (err) {
      set({ error: toMessage(err) })
      throw err
    }
  },

  runPipeline: async (workspaceId) => {
    try {
      const readyIds = await window.oxe.tasks.getReady(workspaceId)
      const dispatched: string[] = []
      const pending: string[] = []
      for (const taskId of readyIds) {
        try {
          await window.oxe.tasks.run({ taskId })
          dispatched.push(taskId)
        } catch (err) {
          // Most common case: no running pane available; record and continue
          if (err instanceof Error && /no running terminal/i.test(err.message)) {
            pending.push(taskId)
          } else {
            throw err
          }
        }
      }
      await get().loadTasks(workspaceId)
      return { dispatched, pending }
    } catch (err) {
      set({ error: toMessage(err) })
      throw err
    }
  },

  clearError: () => set({ error: null })
}))

function upsertTask(tasksByWorkspace: Record<string, Task[]>, task: Task): Record<string, Task[]> {
  const tasks = tasksByWorkspace[task.workspaceId] ?? []
  const exists = tasks.some((item) => item.id === task.id)
  const nextTasks = exists ? tasks.map((item) => (item.id === task.id ? task : item)) : [...tasks, task]
  return {
    ...tasksByWorkspace,
    [task.workspaceId]: nextTasks.sort((a, b) => a.position - b.position)
  }
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected tasks error'
}
