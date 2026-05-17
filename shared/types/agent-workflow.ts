import type { AgentProvider } from './agent'

export type AgentRole = 'rubber_duck' | 'planner' | 'executor' | 'reviewer' | 'verifier' | 'publisher'

export type WorkflowRunStatus =
  | 'draft'
  | 'clarifying'
  | 'planned'
  | 'executing'
  | 'reviewing'
  | 'verifying'
  | 'ready_to_publish'
  | 'done'
  | 'failed'
  | 'blocked'

export type WorkflowStepStatus =
  | 'pending'
  | 'prepared'
  | 'waiting_user'
  | 'approved'
  | 'running'
  | 'sent_to_terminal'
  | 'completed'
  | 'passed'
  | 'failed'
  | 'skipped'
  | 'blocked'
  | 'rejected'

export type WorkflowSourceType = 'manual' | 'task' | 'oxe'

export type WorkflowArtifactKind =
  | 'question_set'
  | 'clarification'
  | 'plan'
  | 'approved_plan'
  | 'execution_notes'
  | 'execution_prompt'
  | 'execution_evidence'
  | 'review'
  | 'review_findings'
  | 'verification'
  | 'verification_report'
  | 'publish_notes'
  | 'rejection'
  | 'plan_feedback'

export interface WorkspaceAgentRoleBinding {
  workspaceId: string
  role: AgentRole
  agentProfileId: string | null
  shellProfileId: string | null
  model?: string
  enabled: boolean
}

export interface AgentWorkflowRun {
  id: string
  workspaceId: string
  sourceType: WorkflowSourceType
  sourceId: string | null
  title: string
  status: WorkflowRunStatus
  createdAt: number
  updatedAt: number
}

export interface AgentWorkflowStep {
  id: string
  runId: string
  role: AgentRole
  agentProfileId: string | null
  shellProfileId: string | null
  status: WorkflowStepStatus
  prompt: string
  output: string
  error: string | null
  startedAt: number | null
  completedAt: number | null
}

export interface AgentWorkflowArtifact {
  id: string
  runId: string
  stepId: string | null
  kind: WorkflowArtifactKind
  title: string
  content: string
  createdAt: number
}

export interface AgentWorkflowRunDetails {
  run: AgentWorkflowRun
  steps: AgentWorkflowStep[]
  artifacts: AgentWorkflowArtifact[]
}

export interface CreateAgentWorkflowRunInput {
  workspaceId: string
  title: string
  sourceType?: WorkflowSourceType
  sourceId?: string | null
  initialPrompt?: string
}

export interface UpdateWorkspaceAgentRoleBindingsInput {
  workspaceId: string
  bindings: Array<{
    role: AgentRole
    agentProfileId?: string | null
    shellProfileId?: string | null
    model?: string | null
    enabled?: boolean
  }>
}

export interface PrepareAgentWorkflowStepInput {
  runId: string
  role: AgentRole
}

export interface RunAgentWorkflowStepInput {
  stepId: string
  paneId: string
}

export interface ApproveAgentWorkflowPlanInput {
  runId: string
  planContent: string
}

export interface RejectAgentWorkflowPlanInput {
  runId: string
  reason: string
}

export interface RequestAgentWorkflowPlanChangesInput {
  runId: string
  feedback: string
}

export interface SendApprovedAgentWorkflowExecutionInput {
  stepId: string
  paneId: string
}

export interface RecordAgentWorkflowExecutionEvidenceInput {
  stepId: string
  output: string
}

export interface AdvanceAgentWorkflowRunInput {
  runId: string
  targetStatus: WorkflowRunStatus
  overrideReason?: string
}

export interface CompleteManualAgentWorkflowStepInput {
  stepId: string
  output: string
  status?: Extract<WorkflowStepStatus, 'passed' | 'failed' | 'blocked'>
}

export interface AppendAgentWorkflowArtifactInput {
  runId: string
  stepId?: string | null
  kind: WorkflowArtifactKind
  title: string
  content: string
}

export interface AgentWorkflowPromptContext {
  role: AgentRole
  provider: AgentProvider | null
  model: string | null
  sourceTitle: string
  previousArtifacts: AgentWorkflowArtifact[]
}
