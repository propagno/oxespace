import { useEffect, useRef, useState, type ReactElement } from 'react'
import { Activity, Brain, ChevronDown, Code2, Command, Compass, FolderTree, Github, GitCompareArrows, History, ListChecks, MonitorPlay, Network, PanelLeft, Settings2, Sparkles, Wrench, Slash } from 'lucide-react'
import { useUIStore } from '../../store/ui.store'

interface ToolsMenuProps {
  active: {
    github: boolean
    editor: boolean
    review: boolean
    background: boolean
    worktree: boolean
    scripts: boolean
    webPreview: boolean
    integration: boolean
    oxe: boolean
  }
  onOpenCommandPalette: () => void
  onOpenWorkspaceSettings: () => void
  onToggleEditor: () => void
  onToggleGitHub: () => void
  onToggleReview: () => void
  onToggleBackground: () => void
  onToggleWorktree: () => void
  onOpenScripts: () => void
  onOpenWebPreview: () => void
  onOpenIntegration: () => void
  onOpenHistory: () => void
  onOpenMcp: () => void
  onOpenSkills: () => void
  onOpenSemanticLogs: () => void
  onToggleOxe: () => void
}

export function ToolsMenu({
  active,
  onOpenCommandPalette,
  onOpenWorkspaceSettings,
  onToggleEditor,
  onToggleGitHub,
  onToggleReview,
  onToggleBackground,
  onToggleWorktree,
  onOpenScripts,
  onOpenWebPreview,
  onOpenIntegration,
  onOpenHistory,
  onOpenMcp,
  onOpenSkills,
  onOpenSemanticLogs,
  onToggleOxe
}: ToolsMenuProps): ReactElement {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)
  const activePaneId = useUIStore((s) => s.activePaneId)
  const openSlashOverlay = useUIStore((s) => s.openSlashOverlay)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const run = (action: () => void): void => {
    action()
    setOpen(false)
  }

  return (
    <div ref={ref} className="tools-menu-root">
      <button type="button" className={`workspace-toolbar-button tools-menu-trigger${open ? ' active' : ''}`} onClick={() => setOpen((value) => !value)}>
        <Settings2 size={13} aria-hidden="true" />
        <span>Tools</span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {open ? (
        <div className="tools-menu-popover" role="menu">
          <ToolsGroup title="Project Management">
            <ToolItem icon={<ListChecks size={14} />} label="Issues" detail="Issues" disabled />
            <ToolItem active={active.integration} icon={<Network size={14} />} label="Integration" detail="Multi-repo" onClick={() => run(onOpenIntegration)} />
          </ToolsGroup>
          <ToolsGroup title="Development">
            <ToolItem active={active.github} icon={<Github size={14} />} label="GitHub" detail="Github" onClick={() => run(onToggleGitHub)} />
            <ToolItem active={active.worktree} icon={<FolderTree size={14} />} label="Worktrees" detail="Git" onClick={() => run(onToggleWorktree)} />
            <ToolItem active={active.scripts} icon={<Code2 size={14} />} label="Scripts" detail="ScriptLauncher" onClick={() => run(onOpenScripts)} />
            <ToolItem active={active.webPreview} icon={<MonitorPlay size={14} />} label="Web Preview" detail="WebPreview" onClick={() => run(onOpenWebPreview)} />
            <ToolItem active={active.background} icon={<Activity size={14} />} label="Background Jobs" detail="Right dock" onClick={() => run(onToggleBackground)} />
          </ToolsGroup>
          <ToolsGroup title="AI & Agents">
            <ToolItem icon={<History size={14} />} label="History" detail="Ctrl+Shift+H" onClick={() => run(onOpenHistory)} />
            <ToolItem icon={<Slash size={14} />} label="Terminal Commands" detail="Ctrl+/" onClick={() => { if (activePaneId) run(() => openSlashOverlay(activePaneId)) }} disabled={!activePaneId} />
            <ToolItem icon={<Wrench size={14} />} label="MCP Servers" detail="Tools" onClick={() => run(onOpenMcp)} />
            <ToolItem icon={<Sparkles size={14} />} label="Skills" detail="Markdown" onClick={() => run(onOpenSkills)} />
            <ToolItem icon={<Brain size={14} />} label="Semantic Activity" detail="Logs" onClick={() => run(onOpenSemanticLogs)} />
            <ToolItem active={active.oxe} icon={<Compass size={14} />} label="OXE" detail="SDLC" onClick={() => run(onToggleOxe)} />
          </ToolsGroup>
          <ToolsGroup title="System">
            <ToolItem active={active.editor} icon={<span className="tool-item-symbol">⌘</span>} label="Editor" detail="Editor" onClick={() => run(onToggleEditor)} />
            <ToolItem active={active.review} icon={<GitCompareArrows size={14} />} label="Review" detail="Review" onClick={() => run(onToggleReview)} />
            <ToolItem icon={<Command size={14} />} label="Command Palette" detail="Palette" onClick={() => run(onOpenCommandPalette)} />
            <ToolItem icon={<PanelLeft size={14} />} label="Workspace Settings" detail="Settings" onClick={() => run(onOpenWorkspaceSettings)} />
          </ToolsGroup>
        </div>
      ) : null}
    </div>
  )
}

function ToolsGroup({ children, title }: { children: ReactElement | ReactElement[]; title: string }): ReactElement {
  return (
    <section className="tools-menu-group">
      <h3>{title}</h3>
      {children}
    </section>
  )
}

function ToolItem({ active = false, detail, disabled = false, icon, label, onClick }: { active?: boolean; detail: string; disabled?: boolean; icon: ReactElement; label: string; onClick?: () => void }): ReactElement {
  return (
    <button type="button" className={`tools-menu-item${active ? ' active' : ''}`} disabled={disabled} onClick={onClick} role="menuitem">
      <span className="tools-menu-item-icon">{icon}</span>
      <span className="tools-menu-item-label">{label}</span>
      <span className="tools-menu-item-detail">{detail}</span>
    </button>
  )
}
