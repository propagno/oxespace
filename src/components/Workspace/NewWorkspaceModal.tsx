import { FolderOpen, X } from 'lucide-react'
import { type FormEvent, type ReactElement, useMemo, useState } from 'react'
import type { ShellProfile, WorkspaceDensity, WorkspaceLayoutPreset, WorkspaceThemeId } from '../../../shared/types/workspace'
import { LAYOUT_PRESETS, WORKSPACE_DENSITIES, WORKSPACE_TEMPLATES, WORKSPACE_THEMES } from './workspaceOptions'

interface NewWorkspaceModalProps {
  shellProfiles: ShellProfile[]
  onCreate: (input: {
    rootPath: string
    layoutPreset: WorkspaceLayoutPreset
    defaultShellProfileId?: string
    autoStart: boolean
    themeId: WorkspaceThemeId
    uiDensity: WorkspaceDensity
  }) => Promise<unknown>
  onPickFolder: () => Promise<string | null>
  onClose: () => void
}

export function NewWorkspaceModal({ shellProfiles, onCreate, onClose, onPickFolder }: NewWorkspaceModalProps): ReactElement {
  const defaultShell = shellProfiles[0]?.id
  const [rootPath, setRootPath] = useState('')
  const [layoutPreset, setLayoutPreset] = useState<WorkspaceLayoutPreset>(4)
  const [themeId, setThemeId] = useState<WorkspaceThemeId>('midnight')
  const [uiDensity, setUiDensity] = useState<WorkspaceDensity>('compact')
  const [shellProfileId, setShellProfileId] = useState(defaultShell ?? '')
  const [isSubmitting, setSubmitting] = useState(false)
  const [isPickingFolder, setPickingFolder] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const shellOptions = useMemo(() => shellProfiles, [shellProfiles])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!rootPath.trim()) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      await onCreate({
        rootPath: rootPath.trim(),
        layoutPreset,
        defaultShellProfileId: shellProfileId || undefined,
        themeId,
        uiDensity,
        autoStart: true
      })
      onClose()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create workspace')
    } finally {
      setSubmitting(false)
    }
  }

  const handlePickFolder = async (): Promise<void> => {
    setPickingFolder(true)
    try {
      const selectedPath = await onPickFolder()
      if (selectedPath) setRootPath(selectedPath)
    } finally {
      setPickingFolder(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="new-workspace-title">
        <header className="modal-header">
          <h2 id="new-workspace-title">New workspace</h2>
          <button type="button" className="icon-button" aria-label="Close modal" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <form className="modal-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>Path</span>
            <div className="path-input">
              <FolderOpen size={16} aria-hidden="true" />
              <input
                data-testid="input-workspace-path"
                value={rootPath}
                onChange={(event) => setRootPath(event.target.value)}
                placeholder="C:/projects/oxespace"
              />
              <button
                type="button"
                className="path-picker-button"
                aria-label="Browse folder"
                title="Browse folder"
                disabled={isPickingFolder}
                onClick={() => void handlePickFolder()}
              >
                <FolderOpen size={15} aria-hidden="true" />
                Browse
              </button>
            </div>
          </label>

          <label className="field">
            <span>Template</span>
            <div className="workspace-template-grid">
              {WORKSPACE_TEMPLATES.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className={`workspace-template-card${layoutPreset === template.layoutPreset && themeId === template.themeId ? ' active' : ''}`}
                  onClick={() => {
                    setLayoutPreset(template.layoutPreset)
                    setThemeId(template.themeId)
                    setUiDensity(template.uiDensity)
                  }}
                >
                  <strong>{template.label}</strong>
                  <span>{template.description}</span>
                </button>
              ))}
            </div>
          </label>

          <label className="field">
            <span>Layout</span>
            <div className="segmented segmented-wrap">
              {LAYOUT_PRESETS.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={layoutPreset === item ? 'segment segment-active' : 'segment'}
                  data-testid={`layout-${item}`}
                  onClick={() => setLayoutPreset(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </label>

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
            <span>Shell</span>
            <select value={shellProfileId} onChange={(event) => setShellProfileId(event.target.value)}>
              {shellOptions.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </label>

          {submitError ? (
            <div className="modal-error" role="alert">
              {submitError}
            </div>
          ) : null}

          <footer className="modal-actions">
            <button type="button" className="secondary-action" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary-action" data-testid="btn-create-workspace" disabled={isSubmitting}>
              Create
            </button>
          </footer>
        </form>
      </section>
    </div>
  )
}
