import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { OxeGraphNode } from '../../../../shared/types/oxe-graph'

export type ArtifactNodeData = { oxe: OxeGraphNode }
export type ArtifactNodeType = Node<ArtifactNodeData, 'artifact'>

export function ArtifactNode({ data }: NodeProps<ArtifactNodeType>) {
  const { label, status } = data.oxe
  return (
    <div className={`graph-node graph-node--artifact graph-node--${status}`}>
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <div className="graph-node__label">{label}</div>
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  )
}
