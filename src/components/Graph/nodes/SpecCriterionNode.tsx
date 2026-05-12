import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { OxeGraphNode } from '../../../../shared/types/oxe-graph'

export type SpecCriterionNodeData = { oxe: OxeGraphNode }
export type SpecCriterionNodeType = Node<SpecCriterionNodeData, 'spec_criterion'>

export function SpecCriterionNode({ data }: NodeProps<SpecCriterionNodeType>) {
  const { label, status } = data.oxe
  return (
    <div className={`graph-node graph-node--spec graph-node--${status}`}>
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <div className="graph-node__label">{label}</div>
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  )
}
