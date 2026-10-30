import { Check, FolderOpen, FolderX, Minus, Plus, Terminal } from 'lucide-react'
import { useId, useRef, useState, type ReactElement } from 'react'
import type { AgentProfile } from '../../../shared/types/agent'
import { isWorkspaceCreateRefusal, type PaneAgentBinding, type ShellProfile, type Workspace, type WorkspaceCreateRefusal, type WorkspaceLayoutPreset } from '../../../shared/types/workspace'
import { messageKey, messageValues } from '../../../shared/messages'
import { isSameRootPath } from '../../../shared/utils/path'
import { AgentProviderIcon } from '../Sidebar/AgentProviderIcon'
import { buildAgentSlots, type AgentCount } from './fleetUtils'
import { LAYOUT_PRESETS } from './workspaceOptions'
import { Button, Dialog, EmptyState, ErrorState, FieldError } from '../../ui'
import { humanizeError } from '../../utils/humanizeError'
import { useTranslation } from 'react-i18next'

export interface WizardLaunchInput {
  rootPath: string
  layoutPreset: WorkspaceLayoutPreset
  defaultShellProfileId: string
  agentSlots: string[]
  agentBindings: PaneAgentBinding[]
}

interface NewWorkspaceModalProps {
  agentProfiles: AgentProfile[]
  shellProfiles: ShellProfile[]
  onLaunch: (input: WizardLaunchInput) => Promise<void>
  existingWorkspaces?: Workspace[]
  activeWorkspaceId?: string | null
  platform?: string
  onOpenExisting?: (workspaceId: string) => Promise<void>
  onPickFolder: () => Promise<string | null>
  returnFocusTo?: HTMLElement | null
  onClose: () => void
}

/** Built-in profiles that launch an agent CLI rather than a plain shell. The
 *  remaining builtin is the neutral shell, whose identity varies by platform
 *  (builtin-powershell on Windows, builtin-bash on Linux/macOS). */
const AGENT_SHELL_PROFILE_IDS = new Set(['builtin-claude', 'builtin-copilot'])

/** Columns × rows of each layout; its name and description come from the catalog. */
/** The refusal a failed create carries (the workspace store's WorkspaceRootRefusedError), or null for any other failure. */
function rootRefusalOf(error: unknown): WorkspaceCreateRefusal | null {
  const refusal = error && typeof error === 'object' ? (error as { refusal?: unknown }).refusal : undefined
  return isWorkspaceCreateRefusal(refusal) ? refusal : null
}

const PRESET_GRID: Record<WorkspaceLayoutPreset, { cols: number; rows: number }> = {
  1: { cols: 1, rows: 1 }, 2: { cols: 2, rows: 1 }, 4: { cols: 2, rows: 2 }, 6: { cols: 3, rows: 2 }, 8: { cols: 4, rows: 2 },
  10: { cols: 5, rows: 2 }, 12: { cols: 4, rows: 3 }, 14: { cols: 7, rows: 2 }, 16: { cols: 4, rows: 4 }
}

export function NewWorkspaceModal({
  agentProfiles,
  shellProfiles,
  onLaunch,
  existingWorkspaces = [],
  activeWorkspaceId = null,
  platform = 'win32',
  onOpenExisting,
  onPickFolder,
  returnFocusTo,
  onClose
}: NewWorkspaceModalProps): ReactElement {
  const { t } = useTranslation('code')
  // The refusal's sentence comes from the main process as a C3 code; the catalog test checks each code's values.
  const { t: tMain, i18n } = useTranslation('main')
  const tm = tMain as unknown as (key: string, values: Record<string, string>) => string
  const refusalId = useId()
  const folderInputRef = useRef<HTMLInputElement | null>(null)
  const [rootPath, setRootPath] = useState('')
  const [layoutPreset, setLayoutPreset] = useState<WorkspaceLayoutPreset>(4)
  const [agentCounts, setAgentCounts] = useState<Record<string, number>>({})
  const [shellCount, setShellCount] = useState(0)
  const [isPickingFolder, setIsPickingFolder] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Main refused this exact path; editing the path or choosing another folder hides it.
  const [rootRefusal, setRootRefusal] = useState<{ path: string; refusal: WorkspaceCreateRefusal } | null>(null)
  const [selectedExistingId, setSelectedExistingId] = useState<string | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null)
  const closeAndRestoreFocus = (): void => {
    onClose()
  }

  // The neutral shell profile is PowerShell on Windows and Bash on Linux, so
  // the chip is labelled from the profile the main process actually seeded
  // rather than from a hardcoded product name.
  const shellProfile = shellProfiles.find((profile) => !AGENT_SHELL_PROFILE_IDS.has(profile.id)) ?? null
  const shellLabel = shellProfile?.name ?? t('newWorkspace.shell')

  const totalSelected = Object.values(agentCounts).reduce((a, b) => a + b, 0) + shellCount
  const remaining = Math.max(0, layoutPreset - totalSelected)
  const hasFolder = rootPath.trim().length > 0
  const matchingWorkspaces = hasFolder ? existingWorkspaces.filter((workspace) => isSameRootPath(workspace.rootPath, rootPath.trim(), platform)) : []
  const selectedExisting = matchingWorkspaces.find((workspace) => workspace.id === selectedExistingId)
    ?? matchingWorkspaces.find((workspace) => workspace.id === activeWorkspaceId)
    ?? matchingWorkspaces[0]
  const shownRefusal = rootRefusal && rootRefusal.path === rootPath.trim() ? rootRefusal.refusal : null
  const folderBasename = hasFolder
    ? rootPath.trim().split(/[\\/]/).filter(Boolean).at(-1) ?? rootPath.trim()
    : null

  const handlePickFolder = async (): Promise<void> => {
    setIsPickingFolder(true)
    try {
      const folder = await onPickFolder()
      if (folder) setRootPath(folder)
    } catch (err) {
      setError(humanizeError(err))
    } finally {
      setIsPickingFolder(false)
    }
  }

  const chooseAnotherFolder = async (): Promise<void> => {
    await handlePickFolder()
    // The field is remounted when the path first fills, so focus it after React has rendered the new value.
    requestAnimationFrame(() => folderInputRef.current?.focus())
  }

  const incrementAgent = (agentProfileId: string): void => {
    if (totalSelected >= layoutPreset) return
    setAgentCounts((prev) => ({ ...prev, [agentProfileId]: (prev[agentProfileId] ?? 0) + 1 }))
  }

  const decrementAgent = (agentProfileId: string): void => {
    setAgentCounts((prev) => {
      const current = prev[agentProfileId] ?? 0
      if (current <= 0) return prev
      return { ...prev, [agentProfileId]: current - 1 }
    })
  }

  const clearAgents = (): void => {
    setAgentCounts({})
    setShellCount(0)
  }

  const handleLaunch = async (): Promise<void> => {
    if (!rootPath.trim()) {
      setError(t('newWorkspace.needFolder'))
      return
    }
    setIsSubmitting(true)
    setError(null)
    setRootRefusal(null)
    try {
      if (selectedExisting && onOpenExisting) {
        await onOpenExisting(selectedExisting.id)
        return
      }
      const defaultShellCount = layoutPreset - Object.values(agentCounts).reduce((a, b) => a + b, 0)
      if (defaultShellCount > 0 && !shellProfile) {
        throw new Error(t('newWorkspace.shellMissing', { name: shellLabel }))
      }
      const counts: AgentCount[] = Object.entries(agentCounts)
        .filter(([, c]) => c > 0)
        .map(([id, count]) => ({
          agentProfileId: id,
          command: agentProfiles.find((p) => p.agentProfileId === id)?.command ?? '',
          count
        }))
      const agentSlots = [
        // Unselected slots are the neutral host shell advertised by the UI.
        // Do not silently fill them with Copilot: on a clean Linux install the
        // CLI may not exist, leaving every initial pane failed instead of Bash.
        ...buildAgentSlots(counts, layoutPreset - shellCount, ''),
        ...Array<string>(shellCount).fill('')
      ]
      const agentBindings = agentSlots.flatMap((cmd, paneIndex) => {
        if (!cmd) return []
        const profile = agentProfiles.find((p) => p.command === cmd)
        if (!profile) return []
        return [{ paneIndex, agentProfileId: profile.agentProfileId, agentName: profile.name }]
      })
      const shellBindings = agentSlots.flatMap((command, paneIndex) => command
        ? []
        : [{ paneIndex, shellProfileId: shellProfile!.id }])
      await onLaunch({
        rootPath: rootPath.trim(),
        layoutPreset,
        defaultShellProfileId: shellProfile!.id,
        agentSlots,
        agentBindings: [...agentBindings, ...shellBindings]
      })
    } catch (err) {
      const refusal = rootRefusalOf(err)
      if (refusal) {
        // Nothing was created: keep the typed path and say why next to it.
        setRootRefusal({ path: rootPath.trim(), refusal })
        requestAnimationFrame(() => folderInputRef.current?.focus())
      } else {
        setError(humanizeError(err, t('newWorkspace.failed')))
      }
      setIsSubmitting(false)
    }
  }

  const canLaunch = hasFolder && !isSubmitting

  return (
    <Dialog
      size="lg"
      className="new-workspace-modal-v2"
      title={selectedExisting ? t('newWorkspace.openTitle') : t('newWorkspace.createTitle')}
      description={selectedExisting ? t('newWorkspace.openDescription') : t('newWorkspace.createDescription')}
      onClose={closeAndRestoreFocus}
      returnFocusTo={() => {
        const opener = returnFocusTo?.isConnected ? returnFocusTo : returnFocusRef.current
        return opener?.isConnected && opener !== document.body ? opener : document.querySelector<HTMLElement>('[data-testid="btn-new-workspace"]')
      }}
      footer={<>
        <Button variant="secondary" onClick={closeAndRestoreFocus}>{t('github.cancel')}</Button>
        <Button variant="primary" onClick={() => void handleLaunch()} disabled={!canLaunch} loading={isSubmitting} data-testid="wizard-launch-btn" title={!hasFolder ? t('newWorkspace.needFolder') : undefined}>
          {selectedExisting ? t('newWorkspace.open') : t('newWorkspace.create')}
        </Button>
      </>}
    >
        <div className="new-workspace-body">
          <section className="new-workspace-section">
            <div className="new-workspace-section-title">{t('worktree.create.folder')}</div>
            <div className={`new-workspace-folder-zone${hasFolder ? ' has-path' : ''}${shownRefusal ? ' is-refused' : ''}`}>
              <div className="new-workspace-folder-zone-icon" aria-hidden="true">
                {shownRefusal ? <FolderX size={16} /> : hasFolder ? <Check size={16} /> : <FolderOpen size={16} />}
              </div>
              <div className="new-workspace-folder-zone-main">
                {hasFolder ? (
                  <>
                    <span className="new-workspace-folder-name">{folderBasename}</span>
                    <input
                      type="text"
                      className="new-workspace-folder-input"
                      value={rootPath}
                      onChange={(event) => setRootPath(event.currentTarget.value)}
                      data-testid="wizard-dir-input"
                      ref={folderInputRef}
                      aria-invalid={shownRefusal ? true : undefined}
                      aria-describedby={shownRefusal ? refusalId : undefined}
                      spellCheck={false}
                      aria-label={t('newWorkspace.path')}
                    />
                  </>
                ) : (
                  <>
                    <span className="new-workspace-folder-prompt">{t('newWorkspace.choose')}</span>
                    <input
                      type="text"
                      className="new-workspace-folder-input"
                      placeholder="C:/projects/my-app"
                      value={rootPath}
                      onChange={(event) => setRootPath(event.currentTarget.value)}
                      data-testid="wizard-dir-input"
                      ref={folderInputRef}
                      aria-invalid={shownRefusal ? true : undefined}
                      aria-describedby={shownRefusal ? refusalId : undefined}
                      spellCheck={false}
                      autoFocus
                      aria-label={t('newWorkspace.path')}
                    />
                  </>
                )}
              </div>
              <Button icon={<FolderOpen size={14} aria-hidden="true" />} onClick={() => void handlePickFolder()} disabled={isPickingFolder}>
                {isPickingFolder ? t('newWorkspace.picking') : t('worktree.create.browse')}
              </Button>
            </div>
            {shownRefusal ? (
              <div className="new-workspace-root-refusal" data-testid="wizard-root-refusal" data-refusal={shownRefusal.refusal}>
                <FieldError id={refusalId}>{tm(messageKey(shownRefusal.message.code), messageValues(shownRefusal.message, i18n.language))}</FieldError>
                {shownRefusal.refusal === 'notFound' ? <p className="new-workspace-root-refusal-hint">{t('newWorkspace.rootNotFoundHint')}</p> : null}
                <div>
                  <Button size="sm" icon={<FolderOpen size={14} aria-hidden="true" />} onClick={() => void chooseAnotherFolder()} disabled={isPickingFolder} data-testid="wizard-choose-another">
                    {t('newWorkspace.chooseAnother')}
                  </Button>
                </div>
              </div>
            ) : null}
          </section>

          {selectedExisting && onOpenExisting ? (
            <section className="new-workspace-section new-workspace-existing" aria-label={t('newWorkspace.existing')}>
              <div className="new-workspace-section-title">{t('newWorkspace.alreadyOpen')}</div>
              <p>{t('newWorkspace.alreadyHint', { count: matchingWorkspaces.length })}</p>
              {matchingWorkspaces.length > 1 && <div className="new-workspace-existing-list">
                {matchingWorkspaces.map((workspace, index) => (
                  <button key={workspace.id} type="button" className={`new-workspace-existing-choice${selectedExisting.id === workspace.id ? ' selected' : ''}`}
                    aria-pressed={selectedExisting.id === workspace.id} onClick={() => setSelectedExistingId(workspace.id)}>
                    <span>{workspace.name} #{index + 1}</span>{' '}
                    <span>{t('sidebar.terminals', { count: workspace.panes.filter((pane) => pane.type === 'terminal' && pane.rowIndex >= 0).length })}</span>
                  </button>
                ))}
              </div>}
            </section>
          ) : null}

          {!selectedExisting && <section className="new-workspace-section">
            <div className="new-workspace-section-title">{t('workspace.settings.layout')}</div>
            <div className="new-workspace-layout-grid" role="radiogroup" aria-label={t('workspace.settings.layoutPreset')} data-testid="wizard-layout-grid">
              {LAYOUT_PRESETS.map((preset) => {
                const meta = { ...PRESET_GRID[preset], label: t('workspace.status.panes', { count: preset }), description: preset === 1 ? t('newWorkspace.oneTerminal') : preset === 2 ? t('newWorkspace.sideBySide') : t('newWorkspace.grid', { rows: PRESET_GRID[preset].rows, cols: PRESET_GRID[preset].cols }) }
                const selected = layoutPreset === preset
                return (
                  <button
                    key={preset}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={`new-workspace-layout-card${selected ? ' selected' : ''}`}
                    onClick={() => setLayoutPreset(preset)}
                    data-testid={`wizard-layout-card-${preset}`}
                    title={meta.description}
                  >
                    <LayoutPreview cols={meta.cols} rows={meta.rows} />
                    <span className="new-workspace-layout-label">{meta.label}</span>
                  </button>
                )
              })}
            </div>
          </section>}

          {!selectedExisting && <section className="new-workspace-section">
            <div className="new-workspace-section-title">
              <span>{t('newWorkspace.agents')}</span>
              <span className="new-workspace-fleet-badges" data-testid="wizard-agent-counter">
                <span className="new-workspace-fleet-badge">
                  {t('newWorkspace.slots', { filled: totalSelected, total: layoutPreset })}
                </span>
                {remaining > 0 ? (
                  <span className="new-workspace-fleet-badge muted">
                    {t('newWorkspace.defaultShells', { count: remaining })}
                  </span>
                ) : null}
              </span>
            </div>
            <div className="new-workspace-agent-chips" data-testid="wizard-agent-list">
              <AgentChip
                name={shellLabel}
                icon={<Terminal size={12} aria-hidden="true" />}
                count={shellCount}
                totalSelected={totalSelected}
                layoutPreset={layoutPreset}
                onIncrement={() => setShellCount((c) => c + 1)}
                onDecrement={() => setShellCount((c) => Math.max(0, c - 1))}
                testId="wizard-shell-only"
                countTestId="agent-count-shell"
                addLabel={t('newWorkspace.add', { name: shellLabel })}
                removeLabel={t('newWorkspace.removeOne', { name: shellLabel })}
                incLabel={t('newWorkspace.addAnother', { name: shellLabel })}
              />
              {agentProfiles.length === 0 ? (
                <EmptyState compact title={t('newWorkspace.noAgents')} />
              ) : (
                agentProfiles.map((agent) => {
                  const count = agentCounts[agent.agentProfileId] ?? 0
                  return (
                    <AgentChip
                      key={agent.agentProfileId}
                      name={agent.name}
                      icon={<AgentProviderIcon provider={agent.provider} />}
                      count={count}
                      totalSelected={totalSelected}
                      layoutPreset={layoutPreset}
                      onIncrement={() => incrementAgent(agent.agentProfileId)}
                      onDecrement={() => decrementAgent(agent.agentProfileId)}
                      testId={`agent-row-${agent.agentProfileId}`}
                      countTestId={`agent-count-${agent.agentProfileId}`}
                      addLabel={t('newWorkspace.add', { name: agent.name })}
                      removeLabel={t('newWorkspace.removeOne', { name: agent.name })}
                      incLabel={t('newWorkspace.addAnother', { name: agent.name })}
                      decTestId={`agent-dec-${agent.agentProfileId}`}
                      incTestId={`agent-inc-${agent.agentProfileId}`}
                    />
                  )
                })
              )}
            </div>
            {totalSelected > 0 ? (
              <Button variant="link" size="sm" className="new-workspace-clear" onClick={clearAgents}>
                {t('newWorkspace.clear')}
              </Button>
            ) : null}
          </section>}

          {error ? <ErrorState compact title={selectedExisting ? t('newWorkspace.openFailed') : t('newWorkspace.failed')} message={error} /> : null}
        </div>

    </Dialog>
  )
}

function AgentChip({
  name,
  icon,
  count,
  totalSelected,
  layoutPreset,
  onIncrement,
  onDecrement,
  testId,
  countTestId,
  addLabel,
  removeLabel,
  incLabel,
  decTestId,
  incTestId
}: {
  name: string
  icon: ReactElement
  count: number
  totalSelected: number
  layoutPreset: number
  onIncrement: () => void
  onDecrement: () => void
  testId: string
  countTestId: string
  addLabel: string
  removeLabel: string
  incLabel: string
  decTestId?: string
  incTestId?: string
}): ReactElement {
  const selected = count > 0
  const slotsFull = totalSelected >= layoutPreset
  return (
    <div
      className={`new-workspace-agent-chip${selected ? ' selected' : ''}`}
      data-testid={testId}
    >
      <button
        type="button"
        className="new-workspace-agent-chip-body"
        onClick={onIncrement}
        disabled={!selected && slotsFull}
        aria-label={addLabel}
      >
        {icon}
        <span className="new-workspace-agent-chip-name">{name}</span>
      </button>
      <span className="new-workspace-agent-chip-count" aria-live="polite">
        <button
          type="button"
          className="new-workspace-agent-chip-step"
          onClick={onDecrement}
          disabled={count <= 0}
          aria-label={removeLabel}
          data-testid={decTestId}
        >
          <Minus size={12} aria-hidden="true" />
        </button>
        <span data-testid={countTestId}>{count}</span>
        <button
          type="button"
          className="new-workspace-agent-chip-step"
          onClick={onIncrement}
          disabled={slotsFull}
          aria-label={incLabel}
          data-testid={incTestId}
        >
          <Plus size={12} aria-hidden="true" />
        </button>
      </span>
    </div>
  )
}

function LayoutPreview({ rows, cols }: { rows: number; cols: number }): ReactElement {
  const cells: ReactElement[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push(<span key={`${r}:${c}`} className="new-workspace-layout-cell" />)
    }
  }
  return (
    <div
      className="new-workspace-layout-preview"
      style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}
      aria-hidden="true"
    >
      {cells}
    </div>
  )
}
