import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { Bot, Check, ChevronDown, ChevronRight, ClipboardCheck, FileText, Play, Plus, Send, ShieldCheck } from 'lucide-react'
import type { AgentWorkflowArtifact, AgentWorkflowRunDetails, AgentWorkflowStep, WorkflowArtifactKind } from '../../../shared/types/agent-workflow'
import { useAgentWorkflowStore } from '../../store/agent-workflow.store'

interface AgentsWorkflowPanelProps {
  workspaceId: string
  activePaneId: string | null
  onOpenArtifact: (content: string, title: string) => void
}

type WizardStage = 'draft' | 'plan' | 'exec' | 'result' | 'verify' | 'done'

const STAGES: Array<{ id: WizardStage; label: string }> = [
  { id: 'draft', label: 'Draft' },
  { id: 'plan', label: 'Plan' },
  { id: 'exec', label: 'Exec' },
  { id: 'result', label: 'Result' },
  { id: 'verify', label: 'Verify' },
  { id: 'done', label: 'Done' }
]

export function AgentsWorkflowPanel({ activePaneId, onOpenArtifact, workspaceId }: AgentsWorkflowPanelProps): ReactElement {
  const runs = useAgentWorkflowStore((state) => state.runsByWorkspace[workspaceId] ?? [])
  const activeRunId = useAgentWorkflowStore((state) => state.activeRunIdByWorkspace[workspaceId] ?? null)
  const details = useAgentWorkflowStore((state) => activeRunId ? state.detailsByRun[activeRunId] : undefined)
  const isLoading = useAgentWorkflowStore((state) => state.isLoading)
  const error = useAgentWorkflowStore((state) => state.error)
  const {
    advanceRun,
    approvePlan,
    createRun,
    loadRun,
    loadRuns,
    prepareStep,
    recordExecutionEvidence,
    requestPlanChanges,
    runStep,
    sendApprovedExecution,
    setActiveRun
  } = useAgentWorkflowStore()

  const [draftInput, setDraftInput] = useState('')
  const [planDraft, setPlanDraft] = useState('')
  const [resultDraft, setResultDraft] = useState('')
  const [verifyDraft, setVerifyDraft] = useState('')
  const [planFeedback, setPlanFeedback] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [panelError, setPanelError] = useState<string | null>(null)

  useEffect(() => {
    void loadRuns(workspaceId)
  }, [loadRuns, workspaceId])

  useEffect(() => {
    if (activeRunId) void loadRun(activeRunId)
  }, [activeRunId, loadRun])

  const artifacts = details?.artifacts ?? []
  const initialInput = useMemo(() => latestArtifact(artifacts, 'clarification'), [artifacts])
  const latestPlan = useMemo(() => latestArtifact(artifacts, 'approved_plan') ?? latestArtifact(artifacts, 'plan'), [artifacts])
  const approvedPlan = useMemo(() => latestArtifact(artifacts, 'approved_plan'), [artifacts])
  const executionPrompt = useMemo(() => latestArtifact(artifacts, 'execution_prompt'), [artifacts])
  const executionEvidence = useMemo(() => latestArtifact(artifacts, 'execution_evidence'), [artifacts])
  const verificationReport = useMemo(() => latestArtifact(artifacts, 'verification_report'), [artifacts])
  const plannerStep = details?.steps.find((step) => step.role === 'planner') ?? null
  const executorStep = details?.steps.find((step) => step.role === 'executor') ?? null
  const verifierStep = details?.steps.find((step) => step.role === 'verifier') ?? null
  const stage = getStage({ details, approvedPlan, executionPrompt, executionEvidence, verificationReport })

  useEffect(() => {
    setPlanDraft(latestPlan?.content ?? initialInput?.content ?? '')
    setResultDraft('')
    setVerifyDraft('')
    setPlanFeedback('')
    setAdvancedOpen(false)
  }, [details?.run.id, initialInput?.id, latestPlan?.id])

  const runAction = async (action: () => Promise<unknown>): Promise<void> => {
    setPanelError(null)
    try {
      await action()
    } catch (actionError) {
      setPanelError(toFriendlyMessage(actionError))
    }
  }

  const createDraft = async (): Promise<void> => {
    const prompt = draftInput.trim()
    if (!prompt) return
    await runAction(async () => {
      await createRun({
        workspaceId,
        title: titleFromPrompt(prompt),
        sourceType: 'manual',
        initialPrompt: prompt
      })
      setDraftInput('')
    })
  }

  const sendPlannerPrompt = async (): Promise<void> => {
    if (!details || !plannerStep) return
    if (!activePaneId) {
      setPanelError('Select or start a terminal before sending the planner prompt.')
      return
    }
    await runAction(async () => {
      const prepared = (await prepareStep({ runId: details.run.id, role: 'planner' })).steps.find((step) => step.role === 'planner') ?? plannerStep
      await runStep({ stepId: prepared.id, paneId: activePaneId })
    })
  }

  return (
    <div className="agents-workflow-panel plan-exec-panel plan-exec-wizard">
      {error ? <div className="agents-workflow-error" role="alert">{error}</div> : null}
      {panelError ? <div className="agents-workflow-error" role="alert">{panelError}</div> : null}
      {isLoading ? <div className="agents-workflow-empty">Loading Plan/Exec runs</div> : null}

      <div className="plan-exec-wizard-layout">
        <aside className="plan-exec-run-rail" aria-label="Plan/Exec runs">
          <header className="plan-exec-rail-header">
            <span>Runs</span>
            <button type="button" title="New run" onClick={() => setActiveRun(workspaceId, null)}>
              <Plus size={12} aria-hidden="true" />
            </button>
          </header>
          {runs.length === 0 ? <div className="agents-workflow-empty">No runs</div> : null}
          {runs.map((run) => (
            <button key={run.id} type="button" className={run.id === activeRunId ? 'plan-exec-run-card active' : 'plan-exec-run-card'} onClick={() => setActiveRun(workspaceId, run.id)}>
              <strong>{run.title}</strong>
              <span>{run.status}</span>
            </button>
          ))}
        </aside>

        <main className="plan-exec-main" aria-label="Plan/Exec workspace">
          {!details ? (
            <DraftStep draftInput={draftInput} onChange={setDraftInput} onCreate={() => { void createDraft() }} />
          ) : (
            <>
              <RunHeader details={details} stage={stage} />
              <StageProgress stage={stage} />
              {stage === 'plan' ? (
                <PlanStep
                  artifacts={artifacts}
                  details={details}
                  initialInput={initialInput}
                  planDraft={planDraft}
                  feedback={planFeedback}
                  advancedOpen={advancedOpen}
                  onAdvancedToggle={() => setAdvancedOpen((value) => !value)}
                  onFeedbackChange={setPlanFeedback}
                  onOpenArtifact={onOpenArtifact}
                  onPlanChange={setPlanDraft}
                  onApprove={() => runAction(() => approvePlan({ runId: details.run.id, planContent: planDraft }))}
                  onRequestChanges={() => runAction(() => requestPlanChanges({ runId: details.run.id, feedback: planFeedback }))}
                  onSendPlannerPrompt={sendPlannerPrompt}
                />
              ) : null}
              {stage === 'exec' ? (
                <ExecStep
                  activePaneId={activePaneId}
                  approvedPlan={approvedPlan}
                  executorStep={executorStep}
                  onOpenArtifact={onOpenArtifact}
                  onSend={() => runAction(async () => {
                    if (!executorStep) throw new Error('Executor step is missing for this run.')
                    if (!activePaneId) throw new Error('Select or start a terminal before sending execution.')
                    await sendApprovedExecution({ stepId: executorStep.id, paneId: activePaneId })
                  })}
                />
              ) : null}
              {stage === 'result' ? (
                <ResultStep
                  executionPrompt={executionPrompt}
                  executorStep={executorStep}
                  resultDraft={resultDraft}
                  onChange={setResultDraft}
                  onOpenArtifact={onOpenArtifact}
                  onRecord={() => runAction(async () => {
                    if (!executorStep) throw new Error('Executor step is missing for this run.')
                    await recordExecutionEvidence({ stepId: executorStep.id, output: resultDraft })
                  })}
                />
              ) : null}
              {stage === 'verify' ? (
                <VerifyStep
                  verifierStep={verifierStep}
                  verifyDraft={verifyDraft}
                  onChange={setVerifyDraft}
                  onComplete={() => runAction(async () => {
                    if (verifierStep && verifyDraft.trim()) {
                      await recordExecutionEvidence({ stepId: verifierStep.id, output: verifyDraft })
                      return
                    }
                    await advanceRun({ runId: details.run.id, targetStatus: 'done', overrideReason: 'Marked complete from Plan/Exec after execution evidence was recorded.' })
                  })}
                />
              ) : null}
              {stage === 'done' ? (
                <DoneStep artifacts={[approvedPlan, executionEvidence, verificationReport]} onOpenArtifact={onOpenArtifact} />
              ) : null}
            </>
          )}
        </main>
      </div>
    </div>
  )
}

function DraftStep(props: { draftInput: string; onChange: (value: string) => void; onCreate: () => void }): ReactElement {
  return (
    <section className="plan-exec-step-card plan-exec-draft-step">
      <div className="plan-exec-step-title">
        <FileText size={18} aria-hidden="true" />
        <div>
          <strong>Start a Plan/Exec run</strong>
          <span>Describe the task once. The next screen turns it into an approved plan before anything reaches a terminal.</span>
        </div>
      </div>
      <textarea value={props.draftInput} onChange={(event) => props.onChange(event.target.value)} placeholder="Task, bug, idea or context" autoFocus />
      <button type="button" className="plan-exec-primary-action" onClick={props.onCreate} disabled={!props.draftInput.trim()} title={!props.draftInput.trim() ? 'Describe the task before creating a run.' : undefined}>
        <Plus size={14} aria-hidden="true" />
        Create Plan/Exec
      </button>
    </section>
  )
}

function RunHeader({ details, stage }: { details: AgentWorkflowRunDetails; stage: WizardStage }): ReactElement {
  return (
    <header className="plan-exec-run-header">
      <div>
        <strong>{details.run.title}</strong>
        <span>{details.run.sourceType}{details.run.sourceId ? `:${details.run.sourceId}` : ''}</span>
      </div>
      <span>{stage}</span>
    </header>
  )
}

function StageProgress({ stage }: { stage: WizardStage }): ReactElement {
  const currentIndex = STAGES.findIndex((item) => item.id === stage)
  return (
    <nav className="plan-exec-progress" aria-label="Plan/Exec progress">
      {STAGES.map((item, index) => (
        <span key={item.id} className={index < currentIndex ? 'done' : item.id === stage ? 'active' : ''}>
          {item.label}
        </span>
      ))}
    </nav>
  )
}

function PlanStep(props: {
  artifacts: AgentWorkflowArtifact[]
  details: AgentWorkflowRunDetails
  initialInput: AgentWorkflowArtifact | undefined
  planDraft: string
  feedback: string
  advancedOpen: boolean
  onAdvancedToggle: () => void
  onFeedbackChange: (value: string) => void
  onOpenArtifact: (content: string, title: string) => void
  onPlanChange: (value: string) => void
  onApprove: () => Promise<void>
  onRequestChanges: () => Promise<void>
  onSendPlannerPrompt: () => Promise<void>
}): ReactElement {
  return (
    <section className="plan-exec-step-card plan-exec-plan-step">
      <div className="plan-exec-step-title">
        <ClipboardCheck size={18} aria-hidden="true" />
        <div>
          <strong>Approve the plan</strong>
          <span>This text becomes the canonical plan and will be sent to execution exactly as approved.</span>
        </div>
      </div>

      {props.initialInput ? (
        <ContextButton artifact={props.initialInput} onOpenArtifact={props.onOpenArtifact} />
      ) : null}

      <textarea className="plan-exec-large-editor" value={props.planDraft} onChange={(event) => props.onPlanChange(event.target.value)} placeholder="Write or paste the implementation plan here." />
      <button type="button" className="plan-exec-primary-action" onClick={() => { void props.onApprove() }} disabled={!props.planDraft.trim()} title={!props.planDraft.trim() ? 'Write a plan before approving.' : undefined}>
        <Check size={14} aria-hidden="true" />
        Approve Plan
      </button>

      <AdvancedPlanActions
        artifacts={props.artifacts}
        feedback={props.feedback}
        open={props.advancedOpen}
        onFeedbackChange={props.onFeedbackChange}
        onOpenArtifact={props.onOpenArtifact}
        onRequestChanges={props.onRequestChanges}
        onSendPlannerPrompt={props.onSendPlannerPrompt}
        onToggle={props.onAdvancedToggle}
      />
    </section>
  )
}

function ExecStep(props: {
  activePaneId: string | null
  approvedPlan: AgentWorkflowArtifact | undefined
  executorStep: AgentWorkflowStep | null
  onOpenArtifact: (content: string, title: string) => void
  onSend: () => Promise<void>
}): ReactElement {
  const disabledReason = !props.executorStep ? 'Executor step is missing for this run.' : !props.activePaneId ? 'Select or start a terminal before sending execution.' : null
  return (
    <section className="plan-exec-step-card">
      <div className="plan-exec-step-title">
        <Send size={18} aria-hidden="true" />
        <div>
          <strong>Send execution</strong>
          <span>{props.activePaneId ? `Target terminal: ${props.activePaneId.slice(0, 8)}` : 'No active terminal selected.'}</span>
        </div>
      </div>
      {props.approvedPlan ? <ContextButton artifact={props.approvedPlan} onOpenArtifact={props.onOpenArtifact} /> : null}
      <div className="plan-exec-helper-box">
        The execution prompt is generated from the approved plan and current run context. No execution is sent until this button is clicked.
      </div>
      {disabledReason ? <p className="plan-exec-disabled-reason">{disabledReason}</p> : null}
      <button type="button" className="plan-exec-primary-action" onClick={() => { void props.onSend() }} disabled={Boolean(disabledReason)} title={disabledReason ?? undefined}>
        <Send size={14} aria-hidden="true" />
        Send Execution
      </button>
    </section>
  )
}

function ResultStep(props: {
  executionPrompt: AgentWorkflowArtifact | undefined
  executorStep: AgentWorkflowStep | null
  resultDraft: string
  onChange: (value: string) => void
  onOpenArtifact: (content: string, title: string) => void
  onRecord: () => Promise<void>
}): ReactElement {
  return (
    <section className="plan-exec-step-card">
      <div className="plan-exec-step-title">
        <Play size={18} aria-hidden="true" />
        <div>
          <strong>Record result</strong>
          <span>Paste the terminal result, changed files and checks already run.</span>
        </div>
      </div>
      {props.executionPrompt ? <ContextButton artifact={props.executionPrompt} onOpenArtifact={props.onOpenArtifact} /> : null}
      <textarea value={props.resultDraft} onChange={(event) => props.onChange(event.target.value)} placeholder="Execution output, changed files, commands and notes" />
      <button type="button" className="plan-exec-primary-action" onClick={() => { void props.onRecord() }} disabled={!props.executorStep || !props.resultDraft.trim()} title={!props.resultDraft.trim() ? 'Record execution evidence before verification.' : undefined}>
        <Check size={14} aria-hidden="true" />
        Record Result
      </button>
    </section>
  )
}

function VerifyStep(props: { verifierStep: AgentWorkflowStep | null; verifyDraft: string; onChange: (value: string) => void; onComplete: () => Promise<void> }): ReactElement {
  return (
    <section className="plan-exec-step-card">
      <div className="plan-exec-step-title">
        <ShieldCheck size={18} aria-hidden="true" />
        <div>
          <strong>Verify and complete</strong>
          <span>Add validation evidence. If left empty, OXESpace records an explicit manual completion override.</span>
        </div>
      </div>
      <textarea value={props.verifyDraft} onChange={(event) => props.onChange(event.target.value)} placeholder="Typecheck, tests, build output or manual verification notes" />
      <button type="button" className="plan-exec-primary-action" onClick={() => { void props.onComplete() }}>
        <ShieldCheck size={14} aria-hidden="true" />
        Complete
      </button>
    </section>
  )
}

function DoneStep(props: { artifacts: Array<AgentWorkflowArtifact | undefined>; onOpenArtifact: (content: string, title: string) => void }): ReactElement {
  return (
    <section className="plan-exec-step-card">
      <div className="plan-exec-step-title">
        <Check size={18} aria-hidden="true" />
        <div>
          <strong>Done</strong>
          <span>The run has an approved plan, execution evidence and verification report.</span>
        </div>
      </div>
      <div className="plan-exec-artifact-list">
        {props.artifacts.filter((artifact): artifact is AgentWorkflowArtifact => Boolean(artifact)).map((artifact) => (
          <ContextButton key={artifact.id} artifact={artifact} onOpenArtifact={props.onOpenArtifact} />
        ))}
      </div>
    </section>
  )
}

function AdvancedPlanActions(props: {
  artifacts: AgentWorkflowArtifact[]
  feedback: string
  open: boolean
  onFeedbackChange: (value: string) => void
  onOpenArtifact: (content: string, title: string) => void
  onRequestChanges: () => Promise<void>
  onSendPlannerPrompt: () => Promise<void>
  onToggle: () => void
}): ReactElement {
  return (
    <section className="plan-exec-advanced">
      <button type="button" className="plan-exec-advanced-toggle" onClick={props.onToggle}>
        {props.open ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
        Advanced planner actions
      </button>
      {props.open ? (
        <div className="plan-exec-advanced-body">
          <div className="plan-exec-context-grid">
            {props.artifacts.slice(-5).map((artifact) => (
              <ContextButton key={artifact.id} artifact={artifact} onOpenArtifact={props.onOpenArtifact} />
            ))}
          </div>
          <textarea value={props.feedback} onChange={(event) => props.onFeedbackChange(event.target.value)} placeholder="Feedback for planner changes" />
          <div className="plan-exec-secondary-actions">
            <button type="button" onClick={() => { void props.onSendPlannerPrompt() }}>
              <Bot size={13} aria-hidden="true" />
              Ask Planner
            </button>
            <button type="button" onClick={() => { void props.onRequestChanges() }} disabled={!props.feedback.trim()} title={!props.feedback.trim() ? 'Write feedback before requesting changes.' : undefined}>
              Request plan changes
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function ContextButton({ artifact, onOpenArtifact }: { artifact: AgentWorkflowArtifact; onOpenArtifact: (content: string, title: string) => void }): ReactElement {
  return (
    <button type="button" className="plan-exec-context-button" onClick={() => onOpenArtifact(artifact.content, artifact.title)}>
      <FileText size={12} aria-hidden="true" />
      <span>{artifact.title}</span>
    </button>
  )
}

function latestArtifact(artifacts: AgentWorkflowArtifact[], kind: WorkflowArtifactKind): AgentWorkflowArtifact | undefined {
  return [...artifacts].reverse().find((artifact) => artifact.kind === kind)
}

function getStage(input: {
  details: AgentWorkflowRunDetails | undefined
  approvedPlan: AgentWorkflowArtifact | undefined
  executionPrompt: AgentWorkflowArtifact | undefined
  executionEvidence: AgentWorkflowArtifact | undefined
  verificationReport: AgentWorkflowArtifact | undefined
}): WizardStage {
  if (!input.details) return 'draft'
  if (!input.approvedPlan) return 'plan'
  if (!input.executionPrompt && input.details.steps.find((step) => step.role === 'executor')?.status !== 'sent_to_terminal') return 'exec'
  if (!input.executionEvidence) return 'result'
  if (!input.verificationReport) return 'verify'
  return 'done'
}

function titleFromPrompt(prompt: string): string {
  const firstLine = prompt.split(/\r?\n/).find((line) => line.trim())?.trim() ?? 'Plan/Exec run'
  return firstLine.length > 58 ? `${firstLine.slice(0, 55)}...` : firstLine
}

function toFriendlyMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Plan/Exec action failed.'
  if (message.includes('No handler registered')) {
    return 'OXESpace precisa reiniciar para carregar os novos handlers do Plan/Exec.'
  }
  return message
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
}
