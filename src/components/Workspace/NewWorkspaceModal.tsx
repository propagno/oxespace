import { useState, type ReactElement } from 'react'
import type { AgentProfile } from '../../../shared/types/agent'
import type { ShellProfile, WorkspaceLayoutPreset } from '../../../shared/types/workspace'
import { buildAgentSlots, getCopilotCommand, type AgentCount } from './fleetUtils'
import { WizardAgentFleet } from './WizardAgentFleet'
import { WizardConfigureLayout } from './WizardConfigureLayout'

export interface WizardLaunchInput {
  rootPath: string
  layoutPreset: WorkspaceLayoutPreset
  agentSlots: string[]
  agentBindings: Array<{ paneIndex: number; agentProfileId: string; agentName: string }>
}

interface NewWorkspaceModalProps {
  agentProfiles: AgentProfile[]
  shellProfiles: ShellProfile[]
  onLaunch: (input: WizardLaunchInput) => Promise<void>
  onPickFolder: () => Promise<string | null>
  onClose: () => void
}

export function NewWorkspaceModal({
  agentProfiles,
  onLaunch,
  onPickFolder,
  onClose
}: NewWorkspaceModalProps): ReactElement {
  const [step, setStep] = useState<1 | 2>(1)
  const [rootPath, setRootPath] = useState('')
  const [layoutPreset, setLayoutPreset] = useState<WorkspaceLayoutPreset>(4)
  const [agentCounts, setAgentCounts] = useState<Record<string, number>>({})
  const [isPickingFolder, setIsPickingFolder] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handlePickFolder = async (): Promise<void> => {
    setIsPickingFolder(true)
    try {
      const folder = await onPickFolder()
      if (folder) setRootPath(folder)
    } finally {
      setIsPickingFolder(false)
    }
  }

  const handleLaunch = async (): Promise<void> => {
    setIsSubmitting(true)
    setError(null)
    try {
      const copilotCmd = getCopilotCommand(agentProfiles)
      const counts: AgentCount[] = Object.entries(agentCounts)
        .filter(([, c]) => c > 0)
        .map(([id, count]) => ({
          agentProfileId: id,
          command: agentProfiles.find((p) => p.agentProfileId === id)?.command ?? '',
          count
        }))
      const agentSlots = buildAgentSlots(counts, layoutPreset, copilotCmd)
      const agentBindings = agentSlots.flatMap((cmd, paneIndex) => {
        if (!cmd) return []
        const profile = agentProfiles.find((p) => p.command === cmd)
        if (!profile) return []
        return [{ paneIndex, agentProfileId: profile.agentProfileId, agentName: profile.name }]
      })
      await onLaunch({ rootPath, layoutPreset, agentSlots, agentBindings })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workspace')
      setIsSubmitting(false)
    }
  }

  const handleSkip = async (): Promise<void> => {
    setIsSubmitting(true)
    setError(null)
    try {
      const copilotCmd = getCopilotCommand(agentProfiles)
      const agentSlots = Array<string>(layoutPreset).fill(copilotCmd)
      const copilotProfile = agentProfiles.find((p) => p.command === copilotCmd)
      const agentBindings = copilotProfile
        ? agentSlots.map((_, paneIndex) => ({ paneIndex, agentProfileId: copilotProfile.agentProfileId, agentName: copilotProfile.name }))
        : []
      await onLaunch({ rootPath, layoutPreset, agentSlots, agentBindings })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workspace')
      setIsSubmitting(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal wizard-modal" role="dialog" aria-modal="true" aria-labelledby="wizard-title">
        <div className="wizard-step-indicator" aria-label="Step indicator">
          <div className={`wizard-step-dot${step === 1 ? ' active' : ''}`} aria-label="Step 1" />
          <div className={`wizard-step-dot${step === 2 ? ' active' : ''}`} aria-label="Step 2" />
        </div>

        {step === 1 ? (
          <WizardConfigureLayout
            rootPath={rootPath}
            onRootPathChange={setRootPath}
            layoutPreset={layoutPreset}
            onLayoutPresetChange={setLayoutPreset}
            isPickingFolder={isPickingFolder}
            onPickFolder={() => void handlePickFolder()}
            onNext={() => setStep(2)}
            onCancel={onClose}
          />
        ) : (
          <WizardAgentFleet
            agents={agentProfiles}
            totalSlots={layoutPreset}
            agentCounts={agentCounts}
            onAgentCountsChange={setAgentCounts}
            onBack={() => setStep(1)}
            onSkip={() => void handleSkip()}
            onLaunch={() => void handleLaunch()}
            isSubmitting={isSubmitting}
          />
        )}

        {error ? (
          <div className="wizard-error" role="alert">
            {error}
          </div>
        ) : null}
      </section>
    </div>
  )
}
