import { ChevronDown, ChevronRight, GitBranch, Link2, MoreHorizontal, Network, Plus, Send, Trash2, X, Zap } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { IntegrationGroup, IntegrationRole, IntegrationStatus } from '../../../shared/types/integration'
import type { Workspace, WorkspacePane } from '../../../shared/types/workspace'
import { useIntegrationStore } from '../../store/integration.store'
import { useTerminalStore } from '../../store/terminal.store'
import { derivePaneDisplayState, formatPaneStatus, type PaneDisplayTone } from '../../utils/paneDisplay'
import { ActivityDot } from '../Indicators/ActivityDot'
import { HandoffInbox } from './HandoffInbox'
import { MemberEditButton, MemberEditor } from './MemberEditor'
import { Button, TextField, Select, EmptyState } from '../../ui'
import { humanizeError } from '../../utils/humanizeError'
import { i18n } from '../../i18n'

interface IntegrationPanelProps {
  activePaneId: string | null
  workspace: Workspace
  workspaces: Workspace[]
  onRunInTerminal: (command: string) => void
  onSelectWorkspace: (workspaceId: string) => void
}

const ROLES: IntegrationRole[] = ['fed', 'bff', 'srv', 'api', 'apim', 'mktapi', 'aut', 'lib', 'db', 'infra', 'docs', 'other']

/** A responsibility's name in the interface language. */
const roleLabel = (role: IntegrationRole): string => i18n.t(`integration.roles.${role}`, { ns: 'code' })
const STATUS_FILTERS = ['active', 'paused', 'done', 'all'] as const

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
  const { activeGroupId, activeMemberId, addMember, buildContext, createGroup, deleteGroup, error, groups, isLoading, load, removeMember, setActiveGroup, setActiveMember, updateGroup } = useIntegrationStore()
  const { t } = useTranslation('code')
  const getTerminalStatus = useTerminalStore((state) => state.getStatus)
  const [name, setName] = useState('')
  const [goal, setGoal] = useState('')
  const [initialRole, setInitialRole] = useState<IntegrationRole>('fed')
  const [memberRole, setMemberRole] = useState<IntegrationRole>('bff')
  const [memberWorkspaceId, setMemberWorkspaceId] = useState(workspace.id)
  const [memberPaneId, setMemberPaneId] = useState('')
  const [contextText, setContextText] = useState('')
  const [panelNotice, setPanelNotice] = useState<string | null>(null)
  const [confirmDeleteGroupId, setConfirmDeleteGroupId] = useState<string | null>(null)
  const [confirmRemoveMemberId, setConfirmRemoveMemberId] = useState<string | null>(null)
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null)
  const [memberActionError, setMemberActionError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<IntegrationStatus | 'all'>('active')
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null)
  // Create-form is collapsed by default; the user opens it via the "+" in
  // the toolbar. Always-visible inputs ate a banner of vertical space for
  // an action used a handful of times per workspace.
  const [showCreateForm, setShowCreateForm] = useState(false)
  // Handoffs are the main operational outcome, so leave them visible. The
  // generated brief remains secondary until the user explicitly requests it.
  const [showHandoffs, setShowHandoffs] = useState(true)
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
  const memberWorkspace = workspaces.find((item) => item.id === memberWorkspaceId) ?? null
  const memberPanes = memberWorkspace?.panes.filter((pane) => pane.type === 'terminal') ?? []

  const handleCreateGroup = async (): Promise<void> => {
    if (!name.trim() || !goal.trim()) return
    const group = await createGroup({ name, goal, activeWorkspaceId: workspace.id })
    await addMember({ groupId: group.id, workspaceId: workspace.id, paneId: activePaneId, role: initialRole, alias: workspace.name, rootPath: activePaneRootPath(workspace, activePaneId) })
    setName('')
    setGoal('')
    setShowCreateForm(false)
  }

  const handleAddMember = async (): Promise<void> => {
    if (!activeGroup || !memberWorkspaceId || !memberWorkspace) return
    const targetWorkspace = workspaces.find((item) => item.id === memberWorkspaceId)
    if (!targetWorkspace) return
    if (activeGroup.members.some((member) => member.workspaceId === targetWorkspace.id && member.role === memberRole)) {
      setPanelNotice(t('integration.roleTaken', { role: roleLabel(memberRole), workspace: targetWorkspace.name }))
      return
    }
    const targetPane = memberPanes.find((pane) => pane.id === memberPaneId) ?? null
    await addMember({
      groupId: activeGroup.id,
      workspaceId: targetWorkspace.id,
      paneId: targetPane?.id ?? null,
      role: memberRole,
      alias: `${roleLabel(memberRole)} · ${targetWorkspace.name}`,
      rootPath: targetPane?.rootPath ?? targetWorkspace.rootPath
    })
    setMemberPaneId('')
    setPanelNotice(targetPane
      ? t('integration.memberReady', { workspace: targetWorkspace.name })
      : t('integration.memberAdded', { workspace: targetWorkspace.name }))
  }

  const handleBuildContext = async (send: boolean): Promise<void> => {
    if (!activeGroup) return
    const result = await buildContext(activeGroup.id, currentMember?.id ?? null)
    setContextText(result.text)
    if (send) {
      onRunInTerminal(result.text)
      setPanelNotice(t('integration.briefSent'))
    } else {
      setPanelNotice(t('integration.briefGenerated'))
    }
  }

  const handlePrepareContext = (): void => {
    setShowGroupMenu(false)
    setShowContext(true)
    void handleBuildContext(false)
  }

  const handleSendContext = (): void => {
    if (!contextText.trim()) return
    onRunInTerminal(contextText)
    setPanelNotice(t('integration.briefEditedSent'))
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
    setPanelNotice(t('integration.removed'))
  }

  const handleRemoveMember = async (member: IntegrationGroup['members'][number]): Promise<void> => {
    setMemberActionError(null)
    if (confirmRemoveMemberId !== member.id) {
      setConfirmRemoveMemberId(member.id)
      return
    }
    setRemovingMemberId(member.id)
    try {
      await removeMember(member.id)
      setEditingMemberId(null)
      setConfirmRemoveMemberId(null)
      setPanelNotice(t('integration.memberRemoved', { member: member.alias }))
    } catch (err) {
      setMemberActionError(humanizeError(err))
    } finally {
      setRemovingMemberId(null)
    }
  }

  return (
    <div className="integration-panel">
      <div className="integration-toolbar">
        {groups.length > 0 ? (
          <div className="integration-status-filter" role="group" aria-label={t('integration.filter')}>
            {STATUS_FILTERS.map((value) => {
              const count = value === 'all' ? groups.length : groups.filter((g) => g.status === value).length
              return (
                <button
                  key={value}
                  type="button"
                  className={`integration-status-filter-chip${statusFilter === value ? ' active' : ''}`}
                  onClick={() => setStatusFilter(value)}
                  aria-pressed={statusFilter === value}
                >
                  {t(`integration.filters.${value}`)}
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
          title={showCreateForm ? t('integration.closeSetup') : t('integration.setupTitle')}
        >
          {showCreateForm ? <X size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
          {showCreateForm ? t('ui.close', { ns: 'common' }) : t('integration.setup')}
        </button>
      </div>

      {showCreateForm ? (
        <section id="integration-create-form" className="integration-create-card" aria-labelledby="integration-setup-title">
          <div className="integration-create-intro">
            <strong id="integration-setup-title">{t('integration.setupTitle')}</strong>
            <span>{t('integration.setupHint')}</span>
          </div>
          <div className="integration-create-grid">
            <label className="integration-field">
              <span>{t('integration.name')}</span>
              <TextField autoFocus value={name} onChange={(event) => setName(event.currentTarget.value)} placeholder={t('integration.namePlaceholder')} />
            </label>
            <label className="integration-field">
              <span>{t('integration.goal')}</span>
              <TextField value={goal} onChange={(event) => setGoal(event.currentTarget.value)} placeholder={t('integration.goalPlaceholder')} />
            </label>
            <label className="integration-field">
              <span>{t('integration.owns')}</span>
              <Select value={initialRole} onChange={(event) => setInitialRole(event.currentTarget.value as IntegrationRole)}>
                {ROLES.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
              </Select>
            </label>
            <Button
             
              variant="primary"
              onClick={() => void handleCreateGroup()}
              disabled={!name.trim() || !goal.trim()}
            >
              <Plus size={14} aria-hidden="true" />
              {t('integration.start')}
            </Button>
          </div>
        </section>
      ) : null}

      {error || memberActionError ? <div className="integration-error" role="alert">{memberActionError ?? error}</div> : null}
      {panelNotice ? <div className="integration-notice" role="status">{panelNotice}</div> : null}
      {isLoading ? <EmptyState compact title={t('integration.loading')} /> : null}

      {visibleGroups.length > 1 ? (
        <nav className="integration-group-tabs" aria-label={t('integration.groups')}>
          {visibleGroups.map((group) => (
            <button key={group.id} type="button" className={group.id === activeGroup?.id ? 'active' : ''} onClick={() => setActiveGroup(group.id)}>
              {group.name}
              <span className={`integration-group-tab-status status-${group.status}`}>{t(`integration.filters.${group.status}`)}</span>
            </button>
          ))}
        </nav>
      ) : null}

      {!activeGroup && !isLoading ? (
        <div className="integration-empty">
          <Network size={36} aria-hidden="true" />
          <strong>{statusFilter !== 'all' && groups.length > 0 ? t('integration.noneWithStatus', { status: t(`integration.filters.${statusFilter}`) }) : t('integration.none')}</strong>
          <span>
            {groups.length > 0 && statusFilter !== 'all'
              ? <>{t('integration.switchTo')} <button type="button" className="integration-empty-link" onClick={() => setStatusFilter('all')}>{t('integration.filters.all')}</button> {t('integration.orSetUp')}</>
              : <>{t('integration.emptyHint')}</>}
          </span>
          {groups.length === 0 ? (
            <Button variant="primary" size="sm" onClick={() => setShowCreateForm(true)}>
              <Plus size={12} aria-hidden="true" />
              {t('integration.setupShort')}
            </Button>
          ) : null}
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
                  <span className={`integration-group-tab-status status-${activeGroup.status}`}>{t(`integration.filters.${activeGroup.status}`)}</span>
                </div>
                {activeGroup.goal ? <span className="integration-active-goal">{activeGroup.goal}</span> : null}
              </div>
              <div className="integration-active-actions" ref={groupMenuRef}>
                <button
                  type="button"
                  className="integration-icon-btn"
                  onClick={handlePrepareContext}
                  title={t('integration.generateBriefTitle')}
                  aria-label={t('integration.generateBrief')}
                >
                  <Send size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={`integration-icon-btn${showGroupMenu ? ' active' : ''}`}
                  onClick={() => setShowGroupMenu((value) => !value)}
                  aria-haspopup="menu"
                  aria-expanded={showGroupMenu}
                  aria-label={t('integration.groupActions')}
                  title={t('integration.moreActions')}
                >
                  <MoreHorizontal size={14} aria-hidden="true" />
                </button>
                {showGroupMenu ? (
                  <div className="integration-active-menu" role="menu">
                    <div className="integration-active-menu-section">
                      <span className="integration-active-menu-label">{t('integration.status')}</span>
                      <div className="integration-status-segments" role="radiogroup" aria-label={t('integration.groupStatus')}>
                        {(['active', 'paused', 'done'] as const).map((value) => (
                          <button
                            key={value}
                            type="button"
                            role="radio"
                            aria-checked={activeGroup.status === value}
                            className={`integration-status-segment status-${value}${activeGroup.status === value ? ' active' : ''}`}
                            onClick={() => void updateGroup({ groupId: activeGroup.id, status: value })}
                          >
                            {t(`integration.filters.${value}`)}
                          </button>
                        ))}
                      </div>
                    </div>
                    <button
                      type="button"
                      role="menuitem"
                      className="integration-active-menu-item"
                      onClick={handlePrepareContext}
                    >
                      <Send size={12} aria-hidden="true" />
                      {t('integration.generateBrief')}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className={`integration-active-menu-item danger${confirmDeleteGroupId === activeGroup.id ? ' confirming' : ''}`}
                      onClick={() => void handleDeleteGroup()}
                    >
                      <Trash2 size={12} aria-hidden="true" />
                      {confirmDeleteGroupId === activeGroup.id ? t('integration.confirmAgain') : t('integration.remove')}
                    </button>
                  </div>
                ) : null}
              </div>
            </header>

            <ul className="integration-member-rows" aria-label={t('integration.members')}>
              {activeGroup.members.map((member) => {
                const terminal = member.paneId ? getTerminalStatus(member.paneId) : null
                let statusTone: PaneDisplayTone = 'idle'
                let statusLabel = t('integration.notBound')
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
                      <span className="integration-member-role" title={roleLabel(member.role)}>{member.role}</span>
                      <span className="integration-member-name">{member.alias}</span>
                      <span className="integration-member-branch" title={member.branch ?? t('integration.noGitBranch')}>
                        <GitBranch size={12} aria-hidden="true" />
                        {member.branch ?? t('integration.noBranch')}
                      </span>
                      <span className="integration-member-status">
                        <ActivityDot level={statusTone} ariaLabel={t('integration.memberStatus', { role: member.role, status: statusLabel })} />
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
                      <MemberEditor
                        member={member}
                        panes={workspaces.find((item) => item.id === member.workspaceId)?.panes.filter((pane) => pane.type === 'terminal') ?? []}
                        confirmingRemoval={confirmRemoveMemberId === member.id}
                        isRemoving={removingMemberId === member.id}
                        onClose={() => { setEditingMemberId(null); setConfirmRemoveMemberId(null) }}
                        onRemove={() => void handleRemoveMember(member)}
                      />
                    ) : null}
                  </li>
                )
              })}

              <li className="integration-add-member-row">
                <Link2 size={12} aria-hidden="true" className="integration-add-icon" />
                <select
                  className="integration-add-select"
                  value={memberWorkspaceId}
                  onChange={(event) => { setMemberWorkspaceId(event.currentTarget.value); setMemberPaneId('') }}
                  aria-label={t('integration.workspaceToAdd')}
                >
                  {workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <select
                  className="integration-add-select compact"
                  value={memberRole}
                  onChange={(event) => setMemberRole(event.currentTarget.value as IntegrationRole)}
                  aria-label={t('integration.memberRole')}
                >
                  {ROLES.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
                </select>
                <select className="integration-add-select" value={memberPaneId} onChange={(event) => setMemberPaneId(event.currentTarget.value)} aria-label={t('integration.terminalToLink')}>
                  <option value="">{t('integration.noTerminalYet')}</option>
                  {memberPanes.map((pane) => <option key={pane.id} value={pane.id}>{paneLabel(pane)}</option>)}
                </select>
                <button type="button" className="integration-add-action" onClick={() => void handleAddMember()} title={t('integration.addTitle')}>
                  <Plus size={12} aria-hidden="true" />
                  {t('integration.add')}
                </button>
              </li>
            </ul>
          </section>

          <DisclosureSection
            label={t('integration.handoffs')}
            icon={<Send size={14} aria-hidden="true" />}
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
            label={t('integration.brief')}
            icon={<Network size={14} aria-hidden="true" />}
            open={showContext}
            onToggle={() => setShowContext((value) => !value)}
          >
            <div className="integration-actions">
              <Button variant="ghost" size="sm" onClick={() => void handleBuildContext(false)}>{t('integration.generateBrief')}</Button>
              <Button variant="ghost" size="sm" onClick={handleSendContext} disabled={!activeGroup || !contextText.trim()}>{t('integration.sendBrief')}</Button>
              <Button
               
                variant="ghost" size="sm"
                onClick={() => { void navigator.clipboard.writeText(contextText); setPanelNotice(t('integration.copied')) }}
                disabled={!contextText}
              >
                {t('integration.copy')}
              </Button>
            </div>
            <textarea
              className="integration-context-preview"
              value={contextText}
              onChange={(event) => setContextText(event.currentTarget.value)}
              placeholder={t('integration.briefPlaceholder')}
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

function paneLabel(pane: WorkspacePane): string {
  return pane.displayName || pane.agentName || i18n.t('integration.terminalAt', { ns: 'code', position: `${pane.rowIndex + 1}.${pane.columnIndex + 1}` })
}
