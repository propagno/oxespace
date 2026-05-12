import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { OxeGraphNode } from '../../../../shared/types/oxe-graph'

export type DefaultNodeData = { oxe: OxeGraphNode }
export type DefaultNodeType = Node<DefaultNodeData, string>

export function DefaultNode({ data }: NodeProps<DefaultNodeType>) {
  const { label, status } = data.oxe
  return (
    <div className={`graph-node graph-node--default graph-node--${status}`}>
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <div className="graph-node__label">{label}</div>
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  )
}
