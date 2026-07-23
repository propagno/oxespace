import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { Activity, ArrowRight, Bot, Brain, Code2, Command, FolderTree, Github, GitCompareArrows, MonitorPlay, Network, PanelLeft, Search, Settings2, Sparkles, Wrench, X, Slash, FileCode2 } from 'lucide-react'
import { useUIStore } from '../../store/ui.store'

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
  /** Opens Agent Settings (CLI providers, discovery, updates). Featured at the top of the hub. */
  onOpenAgentSettings: () => void
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
}

type ToolTone = 'project' | 'dev' | 'ai' | 'system'

interface ToolDef {
  id: string
  group: 'Project' | 'Development' | 'AI & Agents' | 'System'
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
  onOpenAgentSettings,
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
  onOpenSemanticLogs
}: ToolsModalProps): ReactElement {
  const activePaneId = useUIStore((s) => s.activePaneId)
  const openSlashOverlay = useUIStore((s) => s.openSlashOverlay)
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const t = window.setTimeout(() => searchRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const run = (action: () => void): void => {
    action()
    onClose()
  }

  const tools: ToolDef[] = [
    {
      id: 'integration',
      group: 'Project',
      tone: 'project',
      icon: <Network size={16} aria-hidden="true" />,
      label: 'Multi-repo coordination',
      detail: 'Align agents, context & handoffs',
      active: active.integration,
      onClick: () => run(onOpenIntegration)
    },
    {
      id: 'github',
      group: 'Development',
      tone: 'dev',
      icon: <Github size={16} aria-hidden="true" />,
      label: 'GitHub',
      detail: 'PRs, commits, workflows',
      active: active.github,
      onClick: () => run(onToggleGitHub)
    },
    {
      id: 'worktrees',
      group: 'Development',
      tone: 'dev',
      icon: <FolderTree size={16} aria-hidden="true" />,
      label: 'Worktrees',
      detail: 'Branch checkouts side-by-side',
      active: active.worktree,
      onClick: () => run(onToggleWorktree)
    },
    {
      id: 'scripts',
      group: 'Development',
      tone: 'dev',
      icon: <Code2 size={16} aria-hidden="true" />,
      label: 'Scripts',
      detail: 'Discover and run project scripts',
      active: active.scripts,
      onClick: () => run(onToggleScripts)
    },
    {
      id: 'search',
      group: 'Development',
      tone: 'dev',
      icon: <Search size={16} aria-hidden="true" />,
      label: 'Find in Files',
      detail: 'ripgrep text & regex search',
      shortcut: 'Ctrl+Shift+F',
      active: active.search,
      onClick: () => run(onToggleSearch)
    },
    {
      id: 'web-preview',
      group: 'Development',
      tone: 'dev',
      icon: <MonitorPlay size={16} aria-hidden="true" />,
      label: 'Web Preview',
      detail: 'Embed localhost previews',
      active: active.webPreview,
      onClick: () => run(onToggleWebPreview)
    },
    {
      id: 'background',
      group: 'Development',
      tone: 'dev',
      icon: <Activity size={16} aria-hidden="true" />,
      label: 'Background Jobs',
      detail: 'Long-running tasks dock',
      active: active.background,
      onClick: () => run(onToggleBackground)
    },
    {
      id: 'slash',
      group: 'AI & Agents',
      tone: 'ai',
      icon: <Slash size={16} aria-hidden="true" />,
      label: 'Terminal Commands',
      detail: activePaneId ? 'Slash commands in active pane' : 'Focus a terminal first',
      shortcut: 'Ctrl+/',
      disabled: !activePaneId,
      onClick: () => {
        if (activePaneId) run(() => openSlashOverlay(activePaneId))
      }
    },
    {
      id: 'mcp',
      group: 'AI & Agents',
      tone: 'ai',
      icon: <Wrench size={16} aria-hidden="true" />,
      label: 'MCP Servers',
      detail: 'Model Context Protocol tools',
      onClick: () => run(onOpenMcp)
    },
    {
      id: 'skills',
      group: 'AI & Agents',
      tone: 'ai',
      icon: <Sparkles size={16} aria-hidden="true" />,
      label: 'Skills',
      detail: 'Markdown skill prompts',
      onClick: () => run(onOpenSkills)
    },
    {
      id: 'semantic',
      group: 'AI & Agents',
      tone: 'ai',
      icon: <Brain size={16} aria-hidden="true" />,
      label: 'Semantic Activity',
      detail: 'Local vector index logs',
      onClick: () => run(onOpenSemanticLogs)
    },
    {
      id: 'editor',
      group: 'System',
      tone: 'system',
      icon: <FileCode2 size={16} aria-hidden="true" />,
      label: 'Editor',
      detail: 'Monaco file browser',
      active: active.editor,
      onClick: () => run(onToggleEditor)
    },
    {
      id: 'review',
      group: 'System',
      tone: 'system',
      icon: <GitCompareArrows size={16} aria-hidden="true" />,
      label: 'Review',
      detail: 'Diff review pane',
      active: active.review,
      onClick: () => run(onToggleReview)
    },
    {
      id: 'palette',
      group: 'System',
      tone: 'system',
      icon: <Command size={16} aria-hidden="true" />,
      label: 'Command Palette',
      detail: 'Jump to any command',
      shortcut: 'Ctrl+K',
      onClick: () => run(onOpenCommandPalette)
    },
    {
      id: 'ws-settings',
      group: 'System',
      tone: 'system',
      icon: <PanelLeft size={16} aria-hidden="true" />,
      label: 'Workspace Settings',
      detail: 'Theme, layout, density, shell',
      onClick: () => run(onOpenWorkspaceSettings)
    }
  ]

  const q = query.trim().toLowerCase()
  const agentSettingsKeywords = ['agent', 'settings', 'cli', 'provider', 'discovery', 'update', 'ai']
  const showAgentSettingsFeature =
    !q || agentSettingsKeywords.some((k) => k.includes(q) || q.includes(k)) ||
    'agent settings'.includes(q) ||
    'open agent settings'.includes(q)

  const filtered = !q
    ? tools
    : tools.filter((t) =>
      t.label.toLowerCase().includes(q) ||
      t.detail.toLowerCase().includes(q) ||
      t.group.toLowerCase().includes(q) ||
      (t.shortcut?.toLowerCase().includes(q) ?? false)
    )

  const groupOrder: ToolDef['group'][] = ['Project', 'Development', 'AI & Agents', 'System']
  const groups = groupOrder
    .map((name) => ({ name, items: filtered.filter((t) => t.group === name) }))
    .filter((g) => g.items.length > 0)

  const activeCount = tools.filter((t) => t.active).length
  const hasAnyResults = showAgentSettingsFeature || groups.length > 0

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <section
        className="tools-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tools-modal-title"
        data-testid="tools-modal"
      >
        <header className="tools-modal-header">
          <div className="tools-modal-brand">
            <span className="tools-modal-brand-icon" aria-hidden="true">
              <Settings2 size={18} />
            </span>
            <div>
              <strong id="tools-modal-title">Tools</strong>
              <span>
                {activeCount > 0
                  ? `${activeCount} panel${activeCount === 1 ? '' : 's'} open · workspace hub`
                  : 'Panels, agents & system actions'}
              </span>
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
          {showAgentSettingsFeature ? (
            <button
              type="button"
              className="tools-modal-featured"
              data-testid="tools-agent-settings"
              onClick={() => run(onOpenAgentSettings)}
              aria-label="Open Agent Settings"
            >
              <span className="tools-modal-featured-icon" aria-hidden="true">
                <Bot size={20} />
              </span>
              <span className="tools-modal-featured-body">
                <span className="tools-modal-featured-kicker">AI &amp; Agents</span>
                <span className="tools-modal-featured-title">Agent Settings</span>
                <span className="tools-modal-featured-detail">
                  CLIs, discovery, providers &amp; app updates
                </span>
              </span>
              <span className="tools-modal-featured-cta" aria-hidden="true">
                Open
                <ArrowRight size={14} />
              </span>
            </button>
          ) : null}

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
            <kbd>↑↓</kbd> not required — click a card
          </span>
          <span className="tools-modal-footer-meta">{filtered.length} tools</span>
        </footer>
      </section>
    </div>
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
          {tool.active ? <span className="tools-modal-card-on">On</span> : null}
          {tool.badge ? <span className="tools-modal-card-badge">{tool.badge}</span> : null}
        </span>
        <span className="tools-modal-card-detail">{tool.detail}</span>
      </span>
      {tool.shortcut ? <kbd className="tools-modal-card-shortcut">{tool.shortcut}</kbd> : null}
    </button>
  )
}
