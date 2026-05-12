import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { OxeGraphNode } from '../../../../shared/types/oxe-graph'

export type AgentNodeData = { oxe: OxeGraphNode }
export type AgentNodeType = Node<AgentNodeData, 'agent'>

export function AgentNode({ data }: NodeProps<AgentNodeType>) {
  const { label, status, data: nodeData } = data.oxe
  const role = typeof nodeData.role === 'string' ? nodeData.role : ''
  return (
    <div className={`graph-node graph-node--agent graph-node--${status}`}>
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <div className="graph-node__label">{label}</div>
      {role ? <div className="graph-node__badge">{role}</div> : null}
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  )
}
