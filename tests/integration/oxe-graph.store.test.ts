import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { OxeExecutionGraph } from '../../shared/types/oxe-graph'
import { useOxeGraphStore, selectGraphState, selectGraph } from '../../src/store/oxe-graph.store'

// MOCK_GRAPH fixture from FIXTURE-PACK T5
const MOCK_GRAPH: OxeExecutionGraph = {
  nodes: [
    { id: 'spec-A1', type: 'spec_criterion', label: 'A1 — Renderiza sem erros', status: 'done', data: {}, filePath: '.oxe/SPEC.md' },
    { id: 'task-T1', type: 'plan_task', label: 'T1 — Tipos OXE', status: 'done', wave: 1, data: {}, filePath: '.oxe/PLAN.md' },
    { id: 'task-T2', type: 'plan_task', label: 'T2 — Parser', status: 'running', wave: 1, data: {}, filePath: '.oxe/PLAN.md' },
    { id: 'agent-exec', type: 'agent', label: 'executor', status: 'unknown', data: { role: 'executor' } },
    { id: 'artifact-STATE', type: 'artifact', label: 'STATE', status: 'unknown', data: { kind: 'state' }, filePath: '.oxe/STATE.md' }
  ],
  edges: [
    { id: 'e1', source: 'task-T1', target: 'spec-A1', type: 'verifies' },
    { id: 'e2', source: 'task-T2', target: 'task-T1', type: 'depends_on' },
    { id: 'e3', source: 'agent-exec', target: 'task-T1', type: 'assigns' },
    { id: 'e4', source: 'artifact-STATE', target: 'spec-A1', type: 'verifies' }
  ],
  meta: { compiledAt: '2026-05-10T00:00:00Z', planHash: 'abc123', specHash: 'def456', waveCount: 1 }
}

function makeOxeMock(overrides?: Partial<typeof window.oxe.oxe>) {
  window.oxe = {
    app: { version: '0.1.0' },
    workspace: {} as never,
    terminal: {} as never,
    agent: {} as never,
    agentWorkflow: {} as never,
    tasks: {} as never,
    fs: {} as never,
    oxe: {
      getStatus: vi.fn(),
      getStatusJson: vi.fn(),
      listArtifacts: vi.fn(),
      listArtifactsRich: vi.fn(),
      getFreshness: vi.fn(),
      onWorkspaceDrift: vi.fn().mockReturnValue(() => {}),
      getGraph: vi.fn().mockResolvedValue(MOCK_GRAPH),
      onGraphUpdate: vi.fn().mockReturnValue(() => {}),
      ...overrides,
    }
  }
}

describe('useOxeGraphStore.loadGraph', () => {
  beforeEach(() => {
    useOxeGraphStore.setState({ byWorkspaceId: {} })
    makeOxeMock()
  })

  test('stores graph on successful load', async () => {
    const { result } = renderHook(() => useOxeGraphStore())

    await act(async () => {
      await result.current.loadGraph('ws-1', '/projects/repo')
    })

    const state = selectGraphState('ws-1')(result.current)
    expect(state.graph).toEqual(MOCK_GRAPH)
    expect(state.isLoading).toBe(false)
    expect(state.error).toBeNull()
  })

  test('calls getGraph with workspaceId and rootPath', async () => {
    const { result } = renderHook(() => useOxeGraphStore())

    await act(async () => {
      await result.current.loadGraph('ws-1', '/projects/repo')
    })

    expect(window.oxe.oxe.getGraph).toHaveBeenCalledWith({ workspaceId: 'ws-1', rootPath: '/projects/repo' })
  })

  test('sets error state on failure', async () => {
    makeOxeMock({ getGraph: vi.fn().mockRejectedValue(new Error('IPC error')) })
    const { result } = renderHook(() => useOxeGraphStore())

    await act(async () => {
      await result.current.loadGraph('ws-1', '/projects/repo')
    })

    const state = selectGraphState('ws-1')(result.current)
    expect(state.error).toBe('IPC error')
    expect(state.graph).toBeNull()
  })

  test('returns null on failure', async () => {
    makeOxeMock({ getGraph: vi.fn().mockRejectedValue(new Error('fail')) })
    const { result } = renderHook(() => useOxeGraphStore())

    let returned: ReturnType<typeof result.current.loadGraph> extends Promise<infer T> ? T : never = null
    await act(async () => {
      returned = await result.current.loadGraph('ws-1', '/projects/repo')
    })

    expect(returned).toBeNull()
  })
})

describe('useOxeGraphStore.subscribeToGraphUpdates', () => {
  beforeEach(() => {
    useOxeGraphStore.setState({ byWorkspaceId: {} })
    makeOxeMock()
  })

  test('calls onGraphUpdate and returns unsubscribe function', () => {
    const unsubscribe = vi.fn()
    makeOxeMock({ onGraphUpdate: vi.fn().mockReturnValue(unsubscribe) })
    const { result } = renderHook(() => useOxeGraphStore())

    let cleanup: (() => void) | undefined
    act(() => {
      cleanup = result.current.subscribeToGraphUpdates('ws-1')
    })

    expect(window.oxe.oxe.onGraphUpdate).toHaveBeenCalledTimes(1)
    cleanup?.()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  test('updates graph when event arrives', () => {
    let capturedListener: ((g: OxeExecutionGraph) => void) | undefined
    makeOxeMock({
      onGraphUpdate: vi.fn((listener) => {
        capturedListener = listener
        return () => {}
      })
    })

    const { result } = renderHook(() => useOxeGraphStore())
    act(() => { result.current.subscribeToGraphUpdates('ws-1') })

    const updatedGraph = { ...MOCK_GRAPH, meta: { ...MOCK_GRAPH.meta, planHash: 'xyz' } }
    act(() => { capturedListener?.(updatedGraph) })

    expect(selectGraph('ws-1')(result.current)).toEqual(updatedGraph)
  })
})

describe('selectGraphState / selectGraph', () => {
  test('returns EMPTY_GRAPH_STATE for unknown workspaceId', () => {
    useOxeGraphStore.setState({ byWorkspaceId: {} })
    const state = useOxeGraphStore.getState()
    expect(selectGraph('unknown')(state)).toBeNull()
    expect(selectGraphState('unknown')(state).isLoading).toBe(false)
  })

  test('selectGraph returns correct graph from MOCK_GRAPH', () => {
    useOxeGraphStore.setState({
      byWorkspaceId: { 'ws-test': { graph: MOCK_GRAPH, isLoading: false, error: null } }
    })
    const state = useOxeGraphStore.getState()
    const graph = selectGraph('ws-test')(state)
    expect(graph?.nodes).toHaveLength(5)
    expect(graph?.edges).toHaveLength(4)
    expect(graph?.meta.planHash).toBe('abc123')
  })

  test('plan_task nodes are filterable by type', () => {
    useOxeGraphStore.setState({
      byWorkspaceId: { 'ws-1': { graph: MOCK_GRAPH, isLoading: false, error: null } }
    })
    const graph = selectGraph('ws-1')(useOxeGraphStore.getState())
    const planTasks = graph?.nodes.filter(n => n.type === 'plan_task')
    expect(planTasks).toHaveLength(2)
  })
})
