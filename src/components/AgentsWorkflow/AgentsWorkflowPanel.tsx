import { useEffect, useState, type ReactElement } from 'react'
import { ClipboardCheck, MessageSquareText, Play, Plus, Send, ShieldCheck } from 'lucide-react'
import type { AgentRole, AgentWorkflowStep } from '../../../shared/types/agent-workflow'
import { getRoleLabel, useAgentWorkflowStore } from '../../store/agent-workflow.store'

interface AgentsWorkflowPanelProps {
  workspaceId: string
  activePaneId: string | null
  onOpenArtifact: (content: string, title: string) => void
}

const STEP_ACTION_LABEL: Record<AgentRole, string> = {
  rubber_duck: 'Ask Duck',
  planner: 'Plan',
  executor: 'Execute',
  reviewer: 'Review',
  verifier: 'Verify',
  publisher: 'Publish'
}

export function AgentsWorkflowPanel({ activePaneId, onOpenArtifact, workspaceId }: AgentsWorkflowPanelProps): ReactElement {
  const runs = useAgentWorkflowStore((state) => state.runsByWorkspace[workspaceId] ?? [])
  const activeRunId = useAgentWorkflowStore((state) => state.activeRunIdByWorkspace[workspaceId] ?? null)
  const details = useAgentWorkflowStore((state) => activeRunId ? state.detailsByRun[activeRunId] : undefined)
  const isLoading = useAgentWorkflowStore((state) => state.isLoading)
  const error = useAgentWorkflowStore((state) => state.error)
  const { completeManualStep, createRun, loadRun, loadRuns, prepareStep, runStep, setActiveRun } = useAgentWorkflowStore()
  const [newRunTitle, setNewRunTitle] = useState('')
  const [newRunPrompt, setNewRunPrompt] = useState('')
  const [manualOutputByStep, setManualOutputByStep] = useState<Record<string, string>>({})
  const [selectedArtifact, setSelectedArtifact] = useState<{ title: string; content: string } | null>(null)

  useEffect(() => {
    void loadRuns(workspaceId)
  }, [loadRuns, workspaceId])

  useEffect(() => {
    if (activeRunId) void loadRun(activeRunId)
  }, [activeRunId, loadRun])

  const handleCreateRun = async (): Promise<void> => {
    const title = newRunTitle.trim()
    if (!title) return
    await createRun({ workspaceId, title, sourceType: 'manual', initialPrompt: newRunPrompt })
    setNewRunTitle('')
    setNewRunPrompt('')
  }

  const handleRunStep = async (step: AgentWorkflowStep): Promise<void> => {
    const prepared = step.prompt.trim() ? details : await prepareStep({ runId: step.runId, role: step.role })
    const preparedStep = prepared?.steps.find((item) => item.role === step.role) ?? step
    if (!activePaneId) {
      window.alert('Nenhum terminal ativo para receber o prompt.')
      return
    }
    await runStep({ stepId: preparedStep.id, paneId: activePaneId })
  }

  return (
    <div className="agents-workflow-panel">
      <section className="agents-run-create" aria-label="Create multi-agent run">
        <input value={newRunTitle} onChange={(event) => setNewRunTitle(event.target.value)} placeholder="New multi-agent run" />
        <textarea value={newRunPrompt} onChange={(event) => setNewRunPrompt(event.target.value)} placeholder="Idea, bug, task or context" />
        <button type="button" onClick={() => { void handleCreateRun() }} disabled={!newRunTitle.trim()}>
          <Plus size={12} aria-hidden="true" />
          New run
        </button>
      </section>

      {error ? <div className="agents-workflow-error" role="alert">{error}</div> : null}
      {isLoading ? <div className="agents-workflow-empty">Loading workflows</div> : null}

      <div className="agents-workflow-layout">
        <aside className="agents-run-list" aria-label="Multi-agent runs">
          {runs.length === 0 ? <div className="agents-workflow-empty">No runs yet</div> : null}
          {runs.map((run) => (
            <button key={run.id} type="button" className={run.id === activeRunId ? 'agents-run-item active' : 'agents-run-item'} onClick={() => setActiveRun(workspaceId, run.id)}>
              <strong>{run.title}</strong>
              <span>{run.status}</span>
            </button>
          ))}
        </aside>

        <section className="agents-run-detail" aria-label="Selected multi-agent run">
          {!details ? (
            <div className="agents-workflow-empty">Select or create a run</div>
          ) : (
            <>
              <header className="agents-run-detail-header">
                <strong>{details.run.title}</strong>
                <span>{details.run.status}</span>
              </header>
              <div className="agents-step-list">
                {details.steps.map((step) => {
                  const output = manualOutputByStep[step.id] ?? ''
                  return (
                    <article key={step.id} className={`agents-step-card status-${step.status}`}>
                      <header>
                        <span>{getRoleLabel(step.role)}</span>
                        <small>{step.status}</small>
                      </header>
                      {step.error ? <div className="agents-workflow-error">{step.error}</div> : null}
                      {step.prompt ? <pre>{step.prompt.slice(0, 900)}</pre> : <p>Prompt not prepared</p>}
                      <div className="agents-step-actions">
                        <button type="button" onClick={() => { void prepareStep({ runId: details.run.id, role: step.role }) }}>
                          <ClipboardCheck size={12} aria-hidden="true" />
                          Prepare
                        </button>
                        <button type="button" onClick={() => { void handleRunStep(step) }}>
                          <Send size={12} aria-hidden="true" />
                          Send
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const artifact = { title: `${STEP_ACTION_LABEL[step.role]} artifact`, content: step.output || step.prompt }
                            setSelectedArtifact(artifact)
                            onOpenArtifact(artifact.content, artifact.title)
                          }}
                        >
                          <MessageSquareText size={12} aria-hidden="true" />
                          Open
                        </button>
                      </div>
                      <textarea
                        value={output}
                        onChange={(event) => setManualOutputByStep((current) => ({ ...current, [step.id]: event.target.value }))}
                        placeholder="Paste agent output to complete this gated step"
                      />
                      <div className="agents-step-actions">
                        <button type="button" onClick={() => { void completeManualStep({ stepId: step.id, output, status: 'passed' }) }} disabled={!output.trim()}>
                          <ShieldCheck size={12} aria-hidden="true" />
                          Complete
                        </button>
                        <button type="button" onClick={() => { void completeManualStep({ stepId: step.id, output, status: 'failed' }) }} disabled={!output.trim()}>
                          <Play size={12} aria-hidden="true" />
                          Mark failed
                        </button>
                      </div>
                    </article>
                  )
                })}
              </div>
              {selectedArtifact ? (
                <section className="agents-artifact-preview" aria-label="Workflow artifact preview">
                  <header>
                    <strong>{selectedArtifact.title}</strong>
                    <button type="button" onClick={() => setSelectedArtifact(null)}>Close</button>
                  </header>
                  <pre>{selectedArtifact.content}</pre>
                </section>
              ) : null}
            </>
          )}
        </section>
      </div>
    </div>
  )
}
