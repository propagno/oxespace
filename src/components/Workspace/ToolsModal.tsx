import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { Search, Settings2, X } from 'lucide-react'
import { useUIStore } from '../../store/ui.store'
import { TOOL_CATALOG, TOOL_GROUPS, type ToolGroup, type ToolId } from './toolCatalog'
import { ModalDescription, ModalRoot, ModalSurface, ModalTitle } from '../../ui/Modal'

export interface ToolsActiveState {
  github: boolean
  editor: boolean
  review: boolean
  background: boolean
  worktree: boolean
  scripts: boolean
  webPreview: boolean
  integration: boolean
  search: boolean
}

interface ToolsModalProps {
  active: ToolsActiveState
  onClose: () => void
  onOpenCommandPalette: () => void
  onOpenWorkspaceSettings: () => void
  onToggleEditor: () => void
  onToggleGitHub: () => void
  onToggleReview: () => void
  onToggleBackground: () => void
  onToggleWorktree: () => void
  onToggleScripts: () => void
  onToggleWebPreview: () => void
  onToggleSearch: () => void
  onOpenIntegration: () => void
  onOpenMcp: () => void
  onOpenSkills: () => void
  onOpenSemanticLogs: () => void
  /** Absent when no project is selected, which disables the Team entry. */
  onOpenTeam?: () => void
}

type ToolTone = 'project' | 'dev' | 'ai' | 'system'
const TONE: Record<ToolGroup, ToolTone> = { Project: 'project', Development: 'dev', 'AI & Agents': 'ai', System: 'system' }

interface ToolDef {
  id: string
  group: ToolGroup
  tone: ToolTone
  icon: ReactNode
  label: string
  detail: string
  shortcut?: string
  active?: boolean
  disabled?: boolean
  badge?: string
  onClick?: () => void
}

/**
 * App-level Tools hub. Opened from the sidebar footer gear — a searchable
 * catalogue of workspace panels and system actions.
 */
export function ToolsModal({
  active,
  onClose,
  onOpenCommandPalette,
  onOpenWorkspaceSettings,
  onToggleEditor,
  onToggleGitHub,
  onToggleReview,
  onToggleBackground,
  onToggleWorktree,
  onToggleScripts,
  onToggleWebPreview,
  onToggleSearch,
  onOpenIntegration,
  onOpenMcp,
  onOpenSkills,
  onOpenSemanticLogs,
  onOpenTeam
}: ToolsModalProps): ReactElement {
  const activePaneId = useUIStore((s) => s.activePaneId)
  const openSlashOverlay = useUIStore((s) => s.openSlashOverlay)
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement | null>(null)
  // Capture the opener before the portal mounts and the search input takes focus.
  const returnFocusRef = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null)
  const navigatingRef = useRef(false)

  useEffect(() => {
    const t = window.setTimeout(() => searchRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [])

  const run = (action: () => void): void => {
    navigatingRef.current = true
    onClose()
    // Close the hub before opening the destination surface. Keeping the
    // state transition order deterministic avoids Radix focus/portal cleanup
    // racing a second dialog (notably Workspace Settings on native builds).
    action()
  }

  const handlers: Record<ToolId, (() => void) | undefined> = {
    integration: onOpenIntegration, github: onToggleGitHub, worktrees: onToggleWorktree, scripts: onToggleScripts, search: onToggleSearch,
    'web-preview': onToggleWebPreview, background: onToggleBackground, mcp: onOpenMcp, skills: onOpenSkills, semantic: onOpenSemanticLogs,
    editor: onToggleEditor, review: onToggleReview, palette: onOpenCommandPalette, 'ws-settings': onOpenWorkspaceSettings,
    slash: activePaneId ? () => openSlashOverlay(activePaneId) : undefined,
    team: onOpenTeam
  }
  const activeById: Partial<Record<ToolId, boolean>> = {
    integration: active.integration, github: active.github, worktrees: active.worktree, scripts: active.scripts, search: active.search,
    'web-preview': active.webPreview, background: active.background, editor: active.editor, review: active.review
  }
  const tools: ToolDef[] = TOOL_CATALOG.map(meta => {
    const handler = handlers[meta.id]
    const Icon = meta.icon
    return {
      id: meta.id,
      group: meta.group,
      tone: TONE[meta.group],
      icon: <Icon size={16} aria-hidden="true" />,
      label: meta.label,
      detail: meta.id === 'slash' && !activePaneId ? 'Focus a terminal first' : meta.id === 'team' && !onOpenTeam ? 'Select a project first' : meta.detail,
      shortcut: meta.shortcut,
      active: activeById[meta.id],
      disabled: meta.id === 'slash' ? !activePaneId : meta.id === 'team' ? !onOpenTeam : undefined,
      onClick: () => { if (handler) run(handler) }
    }
  })

  const q = query.trim().toLowerCase()
  const filtered = !q
    ? tools
    : tools.filter((t) =>
      t.label.toLowerCase().includes(q) ||
      t.detail.toLowerCase().includes(q) ||
      t.group.toLowerCase().includes(q) ||
      (t.shortcut?.toLowerCase().includes(q) ?? false)
    )

  const groups = TOOL_GROUPS
    .map((name) => ({ name, items: filtered.filter((t) => t.group === name) }))
    .filter((g) => g.items.length > 0)

  const activeCount = tools.filter((t) => t.active).length
  const hasAnyResults = groups.length > 0

  return (
    <ModalRoot open onOpenChange={(next) => { if (!next) onClose() }}>
      {/* `unstyled`: the hub keeps its own layered-gradient surface and only
          borrows Radix's focus trap, Escape and outside-click behaviour. */}
      <ModalSurface
        onCloseAutoFocus={event => {
          event.preventDefault()
          if (!navigatingRef.current) requestAnimationFrame(() => {
            const opener = returnFocusRef.current
            // Lazy loading can temporarily replace the opener with a Suspense
            // fallback. Restore to its current instance if the old node is gone.
            const target = opener?.isConnected && opener !== document.body
              ? opener : document.querySelector<HTMLElement>('[data-testid="btn-open-tools"]')
            target?.focus({ preventScroll: true })
          })
        }}
        scrimClassName="desktop-dialog-overlay"
        className="tools-modal desktop-dialog"
        data-testid="tools-modal"
      >
        <header className="tools-modal-header">
          <div className="tools-modal-brand">
            <span className="tools-modal-brand-icon" aria-hidden="true">
              <Settings2 size={16} />
            </span>
            <div>
              <ModalTitle asChild>
                <strong>Tools</strong>
              </ModalTitle>
              <ModalDescription asChild>
                <span>
                  {activeCount > 0
                    ? `${activeCount} panel${activeCount === 1 ? '' : 's'} open · workspace hub`
                    : 'Panels, agents & system actions'}
                </span>
              </ModalDescription>
            </div>
          </div>
          <button
            type="button"
            className="tools-modal-close"
            aria-label="Close tools"
            title="Close (Esc)"
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <div className="tools-modal-search">
          <Search size={14} className="tools-modal-search-icon" aria-hidden="true" />
          <input
            ref={searchRef}
            type="search"
            className="tools-modal-search-input"
            placeholder="Search tools…"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            aria-label="Search tools"
            autoComplete="off"
            spellCheck={false}
          />
          {query ? (
            <button
              type="button"
              className="tools-modal-search-clear"
              aria-label="Clear search"
              onClick={() => setQuery('')}
            >
              <X size={12} aria-hidden="true" />
            </button>
          ) : (
            <kbd className="tools-modal-search-kbd">/</kbd>
          )}
        </div>

        <div className="tools-modal-body">
          {!hasAnyResults ? (
            <div className="tools-modal-empty" role="status">
              <Search size={20} aria-hidden="true" />
              <p>No tools match <strong>{query}</strong></p>
              <button type="button" className="tools-modal-empty-clear" onClick={() => setQuery('')}>
                Clear search
              </button>
            </div>
          ) : (
            groups.map((group) => (
              <section key={group.name} className="tools-modal-group">
                <header className="tools-modal-group-header">
                  <h3>{group.name}</h3>
                  <span className="tools-modal-group-count">{group.items.length}</span>
                </header>
                <div className="tools-modal-group-grid">
                  {group.items.map((tool) => (
                    <ToolCard key={tool.id} tool={tool} />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>

        <footer className="tools-modal-footer">
          <span className="tools-modal-footer-hint">
            <kbd>Esc</kbd> close
            <span className="tools-modal-footer-sep" aria-hidden="true" />
            <kbd>Tab</kbd> navigate
            <span className="tools-modal-footer-sep" aria-hidden="true" />
            <kbd>Enter</kbd> open
          </span>
          <span className="tools-modal-footer-meta">{filtered.length} tools</span>
        </footer>
      </ModalSurface>
    </ModalRoot>
  )
}

function ToolCard({ tool }: { tool: ToolDef }): ReactElement {
  return (
    <button
      type="button"
      className={`tools-modal-card tone-${tool.tone}${tool.active ? ' active' : ''}${tool.disabled ? ' disabled' : ''}`}
      disabled={tool.disabled}
      onClick={tool.onClick}
      role="menuitem"
      aria-pressed={tool.active || undefined}
      aria-label={tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label}
    >
      <span className={`tools-modal-card-icon tone-${tool.tone}`} aria-hidden="true">
        {tool.icon}
      </span>
      <span className="tools-modal-card-body">
        <span className="tools-modal-card-title-row">
          <span className="tools-modal-card-label">{tool.label}</span>
          {/* These two pills stay on their own CSS rules on purpose. Expressing
              their one-off brand tint as Tailwind arbitrary values (color-mix
              border/background, 9.5px type) emitted a unique utility per value
              and cost ~2 kB — enough to blow the renderer CSS budget — for two
              badges that are never reused. Utilities earn their keep on
              repeated patterns, not on bespoke one-offs. */}
          {tool.active ? <span className="tools-modal-card-on">On</span> : null}
          {tool.badge ? <span className="tools-modal-card-badge">{tool.badge}</span> : null}
        </span>
        <span className="tools-modal-card-detail">{tool.detail}</span>
      </span>
      {tool.shortcut ? <kbd className="tools-modal-card-shortcut" title={tool.shortcut}>{tool.shortcut}</kbd> : null}
    </button>
  )
}
