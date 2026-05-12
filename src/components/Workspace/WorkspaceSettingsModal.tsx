import { X } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactElement } from 'react'
import type { AgentProfile } from '../../../shared/types/agent'
import type { AgentRole, WorkspaceAgentRoleBinding } from '../../../shared/types/agent-workflow'
import type { ShellProfile, UpdateWorkspaceSettingsInput, Workspace, WorkspaceDensity, WorkspaceLayoutPreset, WorkspaceThemeId } from '../../../shared/types/workspace'
import { useAgentWorkflowStore } from '../../store/agent-workflow.store'
import { LAYOUT_PRESETS, WORKSPACE_DENSITIES, WORKSPACE_THEMES } from './workspaceOptions'

interface WorkspaceSettingsModalProps {
  workspace: Workspace
  agentProfiles: AgentProfile[]
  shellProfiles: ShellProfile[]
  onClose: () => void
  onSave: (input: UpdateWorkspaceSettingsInput) => Promise<void>
}

const AGENT_ROLES: AgentRole[] = ['rubber_duck', 'planner', 'executor', 'reviewer', 'verifier', 'publisher']

const ROLE_LABELS: Record<AgentRole, string> = {
  rubber_duck: 'Rubber Duck',
  planner: 'Planner',
  executor: 'Executor',
  reviewer: 'Reviewer',
  verifier: 'Verifier',
  publisher: 'Publisher'
}

export function WorkspaceSettingsModal({ agentProfiles, onClose, onSave, shellProfiles, workspace }: WorkspaceSettingsModalProps): ReactElement {
  const [themeId, setThemeId] = useState<WorkspaceThemeId>(workspace.themeId)
  const [uiDensity, setUiDensity] = useState<WorkspaceDensity>(workspace.uiDensity)
  const [layoutPreset, setLayoutPreset] = useState<WorkspaceLayoutPreset>(workspace.layoutPreset)
  const [defaultShellProfileId, setDefaultShellProfileId] = useState(workspace.defaultShellProfileId)
  const [applyShellToIdlePanes, setApplyShellToIdlePanes] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setSaving] = useState(false)
  const bindings = useAgentWorkflowStore((state) => state.bindingsByWorkspace[workspace.id] ?? [])
  const loadRoleBindings = useAgentWorkflowStore((state) => state.loadRoleBindings)
  const updateRoleBindings = useAgentWorkflowStore((state) => state.updateRoleBindings)
  const [roleBindings, setRoleBindings] = useState<Record<AgentRole, WorkspaceAgentRoleBinding | undefined>>({} as Record<AgentRole, WorkspaceAgentRoleBinding | undefined>)

  useEffect(() => {
    void loadRoleBindings(workspace.id)
  }, [loadRoleBindings, workspace.id])

  useEffect(() => {
    setRoleBindings(Object.fromEntries(bindings.map((binding) => [binding.role, binding])) as Record<AgentRole, WorkspaceAgentRoleBinding>)
  }, [bindings])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await onSave({
        workspaceId: workspace.id,
        themeId,
        uiDensity,
        layoutPreset,
        defaultShellProfileId,
        applyShellToIdlePanes
      })
      await updateRoleBindings({
        workspaceId: workspace.id,
        bindings: AGENT_ROLES.map((role) => ({
          role,
          agentProfileId: roleBindings[role]?.agentProfileId ?? null,
          shellProfileId: roleBindings[role]?.shellProfileId ?? null,
          model: roleBindings[role]?.model ?? null,
          enabled: roleBindings[role]?.enabled ?? role !== 'publisher'
        }))
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update workspace settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal workspace-settings-modal" role="dialog" aria-modal="true" aria-labelledby="workspace-settings-title">
        <header className="modal-header">
          <h2 id="workspace-settings-title">Workspace settings</h2>
          <button type="button" className="icon-button" aria-label="Close workspace settings" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <form className="modal-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>Theme</span>
            <select value={themeId} onChange={(event) => setThemeId(event.target.value as WorkspaceThemeId)}>
              {WORKSPACE_THEMES.map((theme) => (
                <option key={theme.id} value={theme.id}>
                  {theme.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Density</span>
            <select value={uiDensity} onChange={(event) => setUiDensity(event.target.value as WorkspaceDensity)}>
              {WORKSPACE_DENSITIES.map((density) => (
                <option key={density.id} value={density.id}>
                  {density.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Layout preset</span>
            <div className="segmented segmented-wrap">
              {LAYOUT_PRESETS.map((preset) => (
                <button key={preset} type="button" className={layoutPreset === preset ? 'segment segment-active' : 'segment'} onClick={() => setLayoutPreset(preset)}>
                  {preset}
                </button>
              ))}
            </div>
          </label>

          <label className="field">
            <span>Shell</span>
            <select value={defaultShellProfileId} onChange={(event) => setDefaultShellProfileId(event.target.value)}>
              {shellProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </label>

          <label className="checkbox-field">
            <input type="checkbox" checked={applyShellToIdlePanes} onChange={(event) => setApplyShellToIdlePanes(event.currentTarget.checked)} />
            <span>Apply shell to idle panes</span>
          </label>

          <section className="workspace-role-settings" aria-label="Agent role bindings">
            <h3>Agent roles</h3>
            {AGENT_ROLES.map((role) => {
              const binding = roleBindings[role]
              return (
                <div key={role} className="workspace-role-row">
                  <label className="checkbox-field workspace-role-label">
                    <input
                      type="checkbox"
                      checked={binding?.enabled ?? role !== 'publisher'}
                      onChange={(event) =>
                        setRoleBindings((current) => ({
                          ...current,
                          [role]: { ...current[role], workspaceId: workspace.id, role, enabled: event.currentTarget.checked, agentProfileId: current[role]?.agentProfileId ?? null, shellProfileId: current[role]?.shellProfileId ?? null }
                        }))
                      }
                    />
                    <span>{ROLE_LABELS[role]}</span>
                  </label>
                  <div className="workspace-role-selects">
                    <select
                      value={binding?.agentProfileId ?? ''}
                      onChange={(event) =>
                        setRoleBindings((current) => ({
                          ...current,
                          [role]: { ...current[role], workspaceId: workspace.id, role, enabled: current[role]?.enabled ?? true, agentProfileId: event.target.value || null, shellProfileId: current[role]?.shellProfileId ?? null }
                        }))
                      }
                    >
                      <option value="">Manual/OXE</option>
                      {agentProfiles.map((profile) => (
                        <option key={profile.agentProfileId} value={profile.agentProfileId}>
                          {profile.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={binding?.shellProfileId ?? ''}
                      onChange={(event) =>
                        setRoleBindings((current) => ({
                          ...current,
                          [role]: { ...current[role], workspaceId: workspace.id, role, enabled: current[role]?.enabled ?? true, agentProfileId: current[role]?.agentProfileId ?? null, shellProfileId: event.target.value || null }
                        }))
                      }
                    >
                      <option value="">No terminal</option>
                      {shellProfiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )
            })}
          </section>

          {error ? <div className="modal-error" role="alert">{error}</div> : null}

          <footer className="modal-actions">
            <button type="button" className="secondary-action" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary-action" disabled={isSaving}>
              Save
            </button>
          </footer>
        </form>
      </section>
    </div>
  )
}
