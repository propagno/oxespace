export type NodeType = 'spec_criterion' | 'plan_task' | 'artifact' | 'agent' | 'run' | 'wave'

export type EdgeType = 'implements' | 'depends_on' | 'produces' | 'verifies' | 'assigns' | 'belongs_to'

export type NodeStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'unknown'

export interface OxeGraphNode {
  id: string
  type: NodeType
  label: string
  status: NodeStatus
  wave?: number
  data: Record<string, unknown>
  filePath?: string
}

export interface OxeGraphEdge {
  id: string
  source: string
  target: string
  type: EdgeType
  label?: string
}

export interface OxeExecutionGraphMeta {
  compiledAt: string
  planHash: string
  specHash: string
  waveCount: number
}

export interface OxeExecutionGraph {
  nodes: OxeGraphNode[]
  edges: OxeGraphEdge[]
  meta: OxeExecutionGraphMeta
}
