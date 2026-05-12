import type { NodeTypes } from '@xyflow/react'
import { SpecCriterionNode } from './nodes/SpecCriterionNode'
import { PlanTaskNode } from './nodes/PlanTaskNode'
import { ArtifactNode } from './nodes/ArtifactNode'
import { AgentNode } from './nodes/AgentNode'
import { DefaultNode } from './nodes/DefaultNode'

export const NODE_TYPES: NodeTypes = {
  spec_criterion: SpecCriterionNode,
  plan_task: PlanTaskNode,
  artifact: ArtifactNode,
  agent: AgentNode,
  run: DefaultNode,
  wave: DefaultNode,
}
