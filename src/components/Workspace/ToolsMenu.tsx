import { useEffect, useRef, useState, type ReactElement } from 'react'
import { Bot, ChevronDown, Code2, Command, Github, GitCompareArrows, ListChecks, MonitorPlay, PanelLeft, Settings2, Workflow } from 'lucide-react'

interface ToolsMenuProps {
  active: {
    github: boolean
    editor: boolean
    oxe: boolean
    agents: boolean
    review: boolean
  }
  onOpenCommandPalette: () => void
  onOpenWorkspaceSettings: () => void
  onToggleAgents: () => void
  onToggleEditor: () => void
  onToggleGitHub: () => void
  onToggleOxe: () => void
  onToggleReview: () => void
}

export function ToolsMenu({
  active,
  onOpenCommandPalette,
  onOpenWorkspaceSettings,
  onToggleAgents,
  onToggleEditor,
  onToggleGitHub,
  onToggleOxe,
  onToggleReview
}: ToolsMenuProps): ReactElement {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

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
          </ToolsGroup>
          <ToolsGroup title="Development">
            <ToolItem active={active.github} icon={<Github size={14} />} label="GitHub" detail="Github" onClick={() => run(onToggleGitHub)} />
            <ToolItem icon={<Code2 size={14} />} label="Scripts" detail="ScriptLauncher" disabled />
            <ToolItem icon={<MonitorPlay size={14} />} label="Web Preview" detail="WebPreview" disabled />
          </ToolsGroup>
          <ToolsGroup title="AI & Agents">
            <ToolItem active={active.agents} icon={<Bot size={14} />} label="Plan/Exec" detail="Gated workflow" onClick={() => run(onToggleAgents)} />
          </ToolsGroup>
          <ToolsGroup title="System">
            <ToolItem active={active.editor} icon={<span className="tool-item-symbol">⌘</span>} label="Editor" detail="Editor" onClick={() => run(onToggleEditor)} />
            <ToolItem active={active.oxe} icon={<Workflow size={14} />} label="OXE" detail="OXE" onClick={() => run(onToggleOxe)} />
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
