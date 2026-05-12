import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { ReactFlow, Background, MiniMap, Controls, useNodesState, useEdgesState, type Node, type Edge } from '@xyflow/react'
import { graphlib, layout as dagreLayout } from '@dagrejs/dagre'
import type { NodeType, OxeExecutionGraph, OxeGraphEdge, OxeGraphNode } from '../../../shared/types/oxe-graph'
import { useOxeGraphStore, selectGraph } from '../../store/oxe-graph.store'
import { NODE_TYPES } from '../Graph'

const NODE_WIDTH = 180
const NODE_HEIGHT = 60

const FILTER_LABELS: Record<string, string> = {
  spec_criterion: 'Spec',
  plan_task: 'Tasks',
  artifact: 'Artifacts',
  agent: 'Agents',
}

type GraphNodeData = { oxe: OxeGraphNode }

export function applyDagreLayout(
  oxeNodes: OxeGraphNode[],
  oxeEdges: OxeGraphEdge[]
): { nodes: Node<GraphNodeData>[]; edges: Edge[] } {
  const dagreGraph = new graphlib.Graph()
  dagreGraph.setDefaultEdgeLabel(() => ({}))
  dagreGraph.setGraph({ rankdir: 'TB', nodesep: 80, ranksep: 120 })

  for (const node of oxeNodes) {
    dagreGraph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  }

  const nodeIds = new Set(oxeNodes.map(n => n.id))
  const validEdges = oxeEdges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))

  for (const edge of validEdges) {
    dagreGraph.setEdge(edge.source, edge.target)
  }

  dagreLayout(dagreGraph)

  const nodes: Node<GraphNodeData>[] = oxeNodes.map(node => {
    const { x, y } = dagreGraph.node(node.id)
    return {
      id: node.id,
      type: node.type,
      position: { x: x - NODE_WIDTH / 2, y: y - NODE_HEIGHT / 2 },
      data: { oxe: node },
    }
  })

  const edges: Edge[] = validEdges.map(edge => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: 'smoothstep',
    label: edge.label ?? edge.type,
  }))

  return { nodes, edges }
}

interface OxeGraphPanelProps {
  workspaceId: string
  rootPath: string
  onNodeClick?: (node: OxeGraphNode) => void
}

export function OxeGraphPanel({ workspaceId, rootPath, onNodeClick }: OxeGraphPanelProps): ReactElement {
  const graph = useOxeGraphStore(selectGraph(workspaceId))
  const { loadGraph, subscribeToGraphUpdates } = useOxeGraphStore()
  const [filter, setFilter] = useState<NodeType | null>(null)

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<Node<GraphNodeData>>([])
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>([])

  useEffect(() => {
    void loadGraph(workspaceId, rootPath)
    return subscribeToGraphUpdates(workspaceId)
  }, [loadGraph, subscribeToGraphUpdates, workspaceId, rootPath])

  const layouted = useMemo(() => {
    if (!graph || graph.nodes.length === 0) return null
    const filtered = filter ? graph.nodes.filter(n => n.type === filter) : graph.nodes
    const filteredIds = new Set(filtered.map(n => n.id))
    const filteredEdges = graph.edges.filter(e => filteredIds.has(e.source) && filteredIds.has(e.target))
    return applyDagreLayout(filtered, filteredEdges)
  }, [graph, filter])

  useEffect(() => {
    if (layouted) {
      setRfNodes(layouted.nodes)
      setRfEdges(layouted.edges)
    }
  }, [layouted, setRfNodes, setRfEdges])

  if (!graph || graph.nodes.length === 0) {
    return <div className="graph-empty">Nenhum artefato OXE encontrado</div>
  }

  return (
    <div className="oxe-graph-panel">
      <div className="oxe-graph-filters">
        {(['spec_criterion', 'plan_task', 'artifact', 'agent'] as NodeType[]).map(type => (
          <button
            key={type}
            type="button"
            className={`graph-filter-btn${filter === type ? ' active' : ''}`}
            onClick={() => setFilter(prev => (prev === type ? null : type))}
          >
            {FILTER_LABELS[type] ?? type}
          </button>
        ))}
      </div>
      <div className="oxe-graph-canvas">
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={NODE_TYPES}
          colorMode="dark"
          nodesDraggable={false}
          fitView
          onNodeClick={(_, node) => {
            const oxeNode = (node.data as GraphNodeData).oxe
            onNodeClick?.(oxeNode)
          }}
        >
          <Background />
          <MiniMap />
          <Controls />
        </ReactFlow>
      </div>
      {graph.meta.compiledAt ? (
        <div className="oxe-graph-meta">
          compiled {new Date(graph.meta.compiledAt).toLocaleTimeString()} · {graph.nodes.length} nodes · {graph.edges.length} edges
        </div>
      ) : null}
    </div>
  )
}

export function getLiveGraphFor(graph: OxeExecutionGraph | null, filter: NodeType | null) {
  if (!graph) return null
  const nodes = filter ? graph.nodes.filter(n => n.type === filter) : graph.nodes
  const ids = new Set(nodes.map(n => n.id))
  return { nodes, edges: graph.edges.filter(e => ids.has(e.source) && ids.has(e.target)) }
}
