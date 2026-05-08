import { FolderOpen, X } from 'lucide-react'
import { type FormEvent, type ReactElement, useMemo, useState } from 'react'
import type { ShellProfile, WorkspaceLayout } from '../../../shared/types/workspace'

const LAYOUTS: WorkspaceLayout[] = ['1x1', '1x2', '2x2', '3x4', '4x4']

interface NewWorkspaceModalProps {
  shellProfiles: ShellProfile[]
  onCreate: (input: {
    rootPath: string
    layout: WorkspaceLayout
    defaultShellProfileId?: string
    autoStart: boolean
  }) => Promise<unknown>
  onPickFolder: () => Promise<string | null>
  onClose: () => void
}

export function NewWorkspaceModal({ shellProfiles, onCreate, onClose, onPickFolder }: NewWorkspaceModalProps): ReactElement {
  const defaultShell = shellProfiles[0]?.id
  const [rootPath, setRootPath] = useState('')
  const [layout, setLayout] = useState<WorkspaceLayout>('2x2')
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
        layout,
        defaultShellProfileId: shellProfileId || undefined,
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
            <span>Layout</span>
            <div className="segmented">
              {LAYOUTS.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={layout === item ? 'segment segment-active' : 'segment'}
                  data-testid={`layout-${item}`}
                  onClick={() => setLayout(item)}
                >
                  {item}
                </button>
              ))}
            </div>
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
