import { ChevronDown, ChevronRight, GitBranch, Link2, MoreHorizontal, Network, Plus, Send, Trash2, X, Zap } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { IntegrationGroup, IntegrationRole, IntegrationStatus } from '../../../shared/types/integration'
import type { Workspace } from '../../../shared/types/workspace'
import { useIntegrationStore } from '../../store/integration.store'
import { useTerminalStore } from '../../store/terminal.store'
import { derivePaneDisplayState, formatPaneStatus, type PaneDisplayTone } from '../../utils/paneDisplay'
import { ActivityDot } from '../Indicators/ActivityDot'
import { HandoffInbox } from './HandoffInbox'
import { MemberEditButton, MemberEditor } from './MemberEditor'

interface IntegrationPanelProps {
  activePaneId: string | null
  workspace: Workspace
  workspaces: Workspace[]
  onRunInTerminal: (command: string) => void
  onSelectWorkspace: (workspaceId: string) => void
}

const ROLES: IntegrationRole[] = ['fed', 'bff', 'srv', 'api', 'apim', 'mktapi', 'aut', 'lib', 'db', 'infra', 'docs', 'other']

/**
 * Compact, single-column layout. The previous version stacked five
 * `section-card` boxes which competed for vertical space and broke the
 * scanning rhythm of the rest of the app. We now use a hierarchy of
 * collapsible blocks driven by progressive disclosure:
 *   1. Toolbar (filters + "+ New") — always visible, ~32px.
 *   2. Group tab strip — present only when there are visible groups.
 *   3. Active group "header strip" — name, goal, status, kebab — ~52px.
 *   4. Members as compact rows (role badge | alias | branch | dot | edit).
 *   5. Add-member footer row — fits under the member list.
 *   6. Handoffs + Context preview — collapsed by default behind disclosure
 *      buttons so empty states don't pay rent for vertical pixels.
 */
export function IntegrationPanel({ activePaneId, onRunInTerminal, onSelectWorkspace, workspace, workspaces }: IntegrationPanelProps): ReactElement {
  const { activeGroupId, activeMemberId, addMember, buildContext, createGroup, deleteGroup, error, groups, isLoading, load, setActiveGroup, setActiveMember, updateGroup } = useIntegrationStore()
  const getTerminalStatus = useTerminalStore((state) => state.getStatus)
  const [name, setName] = useState('')
  const [goal, setGoal] = useState('')
  const [memberRole, setMemberRole] = useState<IntegrationRole>('bff')
  const [memberWorkspaceId, setMemberWorkspaceId] = useState(workspace.id)
  const [contextText, setContextText] = useState('')
  const [panelNotice, setPanelNotice] = useState<string | null>(null)
  const [confirmDeleteGroupId, setConfirmDeleteGroupId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<IntegrationStatus | 'all'>('active')
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null)
  // Create-form is collapsed by default; the user opens it via the "+" in
  // the toolbar. Always-visible inputs ate a banner of vertical space for
  // an action used a handful of times per workspace.
  const [showCreateForm, setShowCreateForm] = useState(false)
  // Disclosure state for the two heavy lower sections. Off by default so
  // the panel reads as "header + members" until the user opts in.
  const [showHandoffs, setShowHandoffs] = useState(false)
  const [showContext, setShowContext] = useState(false)
  // Kebab menu on the group header — keeps secondary actions (Send context,
  // Remove) out of the always-visible toolbar.
  const [showGroupMenu, setShowGroupMenu] = useState(false)
  const groupMenuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    void load(null)
  }, [load])

  useEffect(() => {
    if (!showGroupMenu) return
    const handler = (event: MouseEvent): void => {
      if (groupMenuRef.current && !groupMenuRef.current.contains(event.target as Node)) {
        setShowGroupMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showGroupMenu])

  const visibleGroups = useMemo(
    () => statusFilter === 'all' ? groups : groups.filter((group) => group.status === statusFilter),
    [groups, statusFilter]
  )
  const activeGroup = useMemo<IntegrationGroup | null>(() => {
    if (activeGroupId) {
      const direct = visibleGroups.find((group) => group.id === activeGroupId)
      if (direct) return direct
    }
    return visibleGroups[0] ?? null
  }, [visibleGroups, activeGroupId])
  const currentMember = useMemo(() => {
    if (!activeGroup) return null
    return activeGroup.members.find((member) => member.id === activeMemberId)
      ?? activeGroup.members.find((member) => member.workspaceId === workspace.id && (!member.paneId || member.paneId === activePaneId))
      ?? activeGroup.members.find((member) => member.workspaceId === workspace.id)
      ?? null
  }, [activeGroup, activeMemberId, activePaneId, workspace.id])

  const handleCreateGroup = async (): Promise<void> => {
    if (!name.trim() || !goal.trim()) return
    const group = await createGroup({ name, goal, activeWorkspaceId: workspace.id })
    await addMember({ groupId: group.id, workspaceId: workspace.id, paneId: activePaneId, role: 'other', alias: workspace.name, rootPath: activePaneRootPath(workspace, activePaneId) })
    setName('')
    setGoal('')
    setShowCreateForm(false)
  }

  const handleAddMember = async (): Promise<void> => {
    if (!activeGroup || !memberWorkspaceId) return
    const targetWorkspace = workspaces.find((item) => item.id === memberWorkspaceId)
    if (!targetWorkspace) return
    await addMember({
      groupId: activeGroup.id,
      workspaceId: targetWorkspace.id,
      role: memberRole,
      alias: `${memberRole.toUpperCase()} · ${targetWorkspace.name}`,
      rootPath: targetWorkspace.rootPath
    })
  }

  const handleBuildContext = async (send: boolean): Promise<void> => {
    if (!activeGroup) return
    const result = await buildContext(activeGroup.id, currentMember?.id ?? null)
    setContextText(result.text)
    if (send) {
      onRunInTerminal(result.text)
      setPanelNotice('Context sent to the active terminal.')
    }
  }

  const handleSendContext = (): void => {
    setShowGroupMenu(false)
    if (contextText.trim()) {
      onRunInTerminal(contextText)
      setPanelNotice('Edited context sent to the active terminal.')
      return
    }
    void handleBuildContext(true)
  }

  const handleDeleteGroup = async (): Promise<void> => {
    if (!activeGroup || confirmDeleteGroupId !== activeGroup.id) {
      setConfirmDeleteGroupId(activeGroup?.id ?? null)
      return
    }
    await deleteGroup(activeGroup.id)
    setConfirmDeleteGroupId(null)
    setShowGroupMenu(false)
    setContextText('')
    setPanelNotice('Integration removed.')
  }

  return (
    <div className="integration-panel">
      <div className="integration-toolbar">
        {groups.length > 0 ? (
          <div className="integration-status-filter" role="group" aria-label="Filter integrations by status">
            {(['active', 'paused', 'done', 'all'] as const).map((value) => {
              const count = value === 'all' ? groups.length : groups.filter((g) => g.status === value).length
              return (
                <button
                  key={value}
                  type="button"
                  className={`integration-status-filter-chip${statusFilter === value ? ' active' : ''}`}
                  onClick={() => setStatusFilter(value)}
                  aria-pressed={statusFilter === value}
                >
                  {value === 'all' ? 'All' : value.charAt(0).toUpperCase() + value.slice(1)}
                  <span className="integration-status-filter-count">{count}</span>
                </button>
              )
            })}
          </div>
        ) : <div className="integration-toolbar-spacer" />}
        <button
          type="button"
          className={`integration-toolbar-action${showCreateForm ? ' active' : ''}`}
          onClick={() => setShowCreateForm((value) => !value)}
          aria-expanded={showCreateForm}
          aria-controls="integration-create-form"
          title={showCreateForm ? 'Close create form' : 'New integration group'}
        >
          {showCreateForm ? <X size={13} aria-hidden="true" /> : <Plus size={13} aria-hidden="true" />}
          {showCreateForm ? 'Close' : 'New'}
        </button>
      </div>

      {showCreateForm ? (
        <section id="integration-create-form" className="integration-create-card">
          <div className="integration-create-grid">
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              placeholder="Feature name, e.g. Payment flow"
            />
            <input
              value={goal}
              onChange={(event) => setGoal(event.currentTarget.value)}
              placeholder="Current integration goal"
            />
            <button
              type="button"
              className="primary-btn"
              onClick={() => void handleCreateGroup()}
              disabled={!name.trim() || !goal.trim()}
            >
              <Plus size={13} aria-hidden="true" />
              Create
            </button>
          </div>
        </section>
      ) : null}

      {error ? <div className="integration-error">{error}</div> : null}
      {panelNotice ? <div className="integration-notice">{panelNotice}</div> : null}
      {isLoading ? <div className="integration-empty">Loading integration groups...</div> : null}

      {visibleGroups.length > 1 ? (
        <nav className="integration-group-tabs" aria-label="Integration groups">
          {visibleGroups.map((group) => (
            <button key={group.id} type="button" className={group.id === activeGroup?.id ? 'active' : ''} onClick={() => setActiveGroup(group.id)}>
              {group.name}
              <span className={`integration-group-tab-status status-${group.status}`}>{group.status}</span>
            </button>
          ))}
        </nav>
      ) : null}

      {!activeGroup && !isLoading ? (
        <div className="integration-empty">
          <Network size={36} aria-hidden="true" />
          <strong>No integration group {statusFilter !== 'all' && groups.length > 0 ? `with status ${statusFilter}` : 'yet'}</strong>
          <span>
            {groups.length > 0 && statusFilter !== 'all'
              ? <>Switch to <button type="button" className="integration-empty-link" onClick={() => setStatusFilter('all')}>All</button> or create a new one.</>
              : <>Connect SRV/BFF/FED workspaces and send concise context to the current terminal.</>}
          </span>
        </div>
      ) : null}

      {activeGroup ? (
        <>
          <section className="integration-active-group">
            <header className="integration-active-header">
              <div className="integration-active-meta">
                <div className="integration-active-title-row">
                  <Zap size={14} aria-hidden="true" className="integration-active-icon" />
                  <strong>{activeGroup.name}</strong>
                  <span className={`integration-group-tab-status status-${activeGroup.status}`}>{activeGroup.status}</span>
                </div>
                {activeGroup.goal ? <span className="integration-active-goal">{activeGroup.goal}</span> : null}
              </div>
              <div className="integration-active-actions" ref={groupMenuRef}>
                <button
                  type="button"
                  className="integration-icon-btn"
                  onClick={handleSendContext}
                  title="Send integration context to the active terminal"
                  aria-label="Send context"
                >
                  <Send size={13} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={`integration-icon-btn${showGroupMenu ? ' active' : ''}`}
                  onClick={() => setShowGroupMenu((value) => !value)}
                  aria-haspopup="menu"
                  aria-expanded={showGroupMenu}
                  aria-label="Group actions"
                  title="More actions"
                >
                  <MoreHorizontal size={13} aria-hidden="true" />
                </button>
                {showGroupMenu ? (
                  <div className="integration-active-menu" role="menu">
                    <div className="integration-active-menu-section">
                      <span className="integration-active-menu-label">Status</span>
                      <div className="integration-status-segments" role="radiogroup" aria-label="Group status">
                        {(['active', 'paused', 'done'] as const).map((value) => (
                          <button
                            key={value}
                            type="button"
                            role="radio"
                            aria-checked={activeGroup.status === value}
                            className={`integration-status-segment status-${value}${activeGroup.status === value ? ' active' : ''}`}
                            onClick={() => void updateGroup({ groupId: activeGroup.id, status: value })}
                          >
                            {value}
                          </button>
                        ))}
                      </div>
                    </div>
                    <button
                      type="button"
                      role="menuitem"
                      className="integration-active-menu-item"
                      onClick={handleSendContext}
                    >
                      <Send size={12} aria-hidden="true" />
                      Send context now
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className={`integration-active-menu-item danger${confirmDeleteGroupId === activeGroup.id ? ' confirming' : ''}`}
                      onClick={() => void handleDeleteGroup()}
                    >
                      <Trash2 size={12} aria-hidden="true" />
                      {confirmDeleteGroupId === activeGroup.id ? 'Click again to confirm' : 'Remove integration'}
                    </button>
                  </div>
                ) : null}
              </div>
            </header>

            <ul className="integration-member-rows" aria-label="Members">
              {activeGroup.members.map((member) => {
                const terminal = member.paneId ? getTerminalStatus(member.paneId) : null
                let statusTone: PaneDisplayTone = 'idle'
                let statusLabel = 'not bound'
                if (member.paneId && terminal) {
                  const fakePane = {
                    id: member.paneId,
                    workspaceId: member.workspaceId,
                    rootPath: member.rootPath,
                    displayName: member.alias,
                    agentProfileId: null,
                    agentName: member.activeProvider ?? null
                  } as unknown as Parameters<typeof derivePaneDisplayState>[0]['pane']
                  const display = derivePaneDisplayState({
                    pane: fakePane,
                    workspace: { name: member.workspaceName, rootPath: member.rootPath },
                    terminal,
                    profile: null,
                    paneIndex: 0
                  })
                  statusTone = display.statusTone
                  statusLabel = formatPaneStatus(display.statusTone)
                }
                const isEditing = editingMemberId === member.id
                const isCurrent = member.id === currentMember?.id
                return (
                  <li key={member.id} className={`integration-member-row${isCurrent ? ' current' : ''}${isEditing ? ' editing' : ''}`}>
                    <button
                      type="button"
                      className="integration-member-trigger"
                      aria-pressed={isCurrent}
                      onClick={() => {
                        setActiveMember(member.id)
                        onSelectWorkspace(member.workspaceId)
                      }}
                    >
                      <span className="integration-member-role">{member.role}</span>
                      <span className="integration-member-name">{member.alias}</span>
                      <span className="integration-member-branch" title={member.branch ?? 'no git branch'}>
                        <GitBranch size={10} aria-hidden="true" />
                        {member.branch ?? 'no branch'}
                      </span>
                      <span className="integration-member-status">
                        <ActivityDot level={statusTone} ariaLabel={`${member.role} is ${statusLabel}`} />
                        <span>{member.activeProvider ? `${member.activeProvider} · ${statusLabel}` : statusLabel}</span>
                      </span>
                    </button>
                    <MemberEditButton
                      isEditing={isEditing}
                      onClick={(event) => {
                        event.stopPropagation()
                        setEditingMemberId(isEditing ? null : member.id)
                      }}
                    />
                    {member.blockers ? (
                      <div className="integration-member-blockers-strip" title={member.blockers}>
                        <span aria-hidden="true">⚠</span>
                        <span>{member.blockers.length > 80 ? member.blockers.slice(0, 77) + '…' : member.blockers}</span>
                      </div>
                    ) : null}
                    {isEditing ? (
                      <MemberEditor member={member} onClose={() => setEditingMemberId(null)} />
                    ) : null}
                  </li>
                )
              })}

              <li className="integration-add-member-row">
                <Link2 size={11} aria-hidden="true" className="integration-add-icon" />
                <select
                  className="integration-add-select"
                  value={memberWorkspaceId}
                  onChange={(event) => setMemberWorkspaceId(event.currentTarget.value)}
                  aria-label="Workspace to add"
                >
                  {workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <select
                  className="integration-add-select compact"
                  value={memberRole}
                  onChange={(event) => setMemberRole(event.currentTarget.value as IntegrationRole)}
                  aria-label="Member role"
                >
                  {ROLES.map((role) => <option key={role} value={role}>{role.toUpperCase()}</option>)}
                </select>
                <button type="button" className="integration-add-action" onClick={() => void handleAddMember()}>
                  <Plus size={11} aria-hidden="true" />
                  Add
                </button>
              </li>
            </ul>
          </section>

          <DisclosureSection
            label="Handoffs"
            icon={<Send size={13} aria-hidden="true" />}
            badge={useIntegrationStore.getState().handoffs[activeGroup.id]?.filter((h) => h.status !== 'saved').length || 0}
            open={showHandoffs}
            onToggle={() => setShowHandoffs((value) => !value)}
          >
            <HandoffInbox
              group={activeGroup}
              currentMemberId={currentMember?.id ?? null}
              onSelectMember={(memberId) => {
                setActiveMember(memberId)
                const target = activeGroup.members.find((m) => m.id === memberId)
                if (target) onSelectWorkspace(target.workspaceId)
              }}
            />
          </DisclosureSection>

          <DisclosureSection
            label="Context preview"
            icon={<Network size={13} aria-hidden="true" />}
            open={showContext}
            onToggle={() => setShowContext((value) => !value)}
          >
            <div className="integration-actions">
              <button type="button" className="ghost-btn small" onClick={() => void handleBuildContext(false)}>Refresh preview</button>
              <button type="button" className="ghost-btn small" onClick={handleSendContext} disabled={!activeGroup}>Send edited</button>
              <button
                type="button"
                className="ghost-btn small"
                onClick={() => { void navigator.clipboard.writeText(contextText); setPanelNotice('Context copied.') }}
                disabled={!contextText}
              >
                Copy
              </button>
            </div>
            <textarea
              className="integration-context-preview"
              value={contextText}
              onChange={(event) => setContextText(event.currentTarget.value)}
              placeholder="Generate a context preview, then edit it before sending to the terminal."
              spellCheck={false}
            />
          </DisclosureSection>
        </>
      ) : null}
    </div>
  )
}

interface DisclosureSectionProps {
  label: string
  icon: ReactElement
  badge?: number
  open: boolean
  onToggle: () => void
  children: ReactElement | ReactElement[]
}

function DisclosureSection({ label, icon, badge, open, onToggle, children }: DisclosureSectionProps): ReactElement {
  return (
    <section className={`integration-disclosure${open ? ' open' : ''}`}>
      <button type="button" className="integration-disclosure-header" onClick={onToggle} aria-expanded={open}>
        {open ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
        {icon}
        <span>{label}</span>
        {badge ? <span className="integration-disclosure-badge">{badge}</span> : null}
      </button>
      {open ? <div className="integration-disclosure-body">{children}</div> : null}
    </section>
  )
}

function activePaneRootPath(workspace: Workspace, activePaneId: string | null): string {
  const pane = activePaneId ? workspace.panes.find((item) => item.id === activePaneId) : null
  return pane?.rootPath ?? workspace.rootPath
}
