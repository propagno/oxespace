import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { OxeGraphNode } from '../../../../shared/types/oxe-graph'

export type PlanTaskNodeData = { oxe: OxeGraphNode }
export type PlanTaskNodeType = Node<PlanTaskNodeData, 'plan_task'>

export function PlanTaskNode({ data }: NodeProps<PlanTaskNodeType>) {
  const { label, status, wave } = data.oxe
  return (
    <div className={`graph-node graph-node--task graph-node--${status}`}>
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <div className="graph-node__label">{label}</div>
      {wave !== undefined ? <div className="graph-node__badge">W{wave}</div> : null}
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  )
}
