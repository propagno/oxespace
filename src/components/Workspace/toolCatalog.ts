import { Activity, Brain, Code2, FileCode2, FolderTree, GitCompareArrows, MonitorPlay, Network, Users, Search, Slash, Wrench, type LucideIcon } from 'lucide-react'
import { Github } from '../Brand/GithubIcon'
import { i18n } from '../../i18n'
import type { KeybindingId } from '../../keyboard/keybindings'

export type ToolGroup = 'Project' | 'Development' | 'AI & Agents' | 'System'
export type ToolId = 'integration' | 'github' | 'worktrees' | 'scripts' | 'search' | 'web-preview' | 'background' | 'slash' | 'mcp' | 'semantic' | 'editor' | 'review' | 'team' | 'http-calls'

export interface ToolMeta {
  id: ToolId
  group: ToolGroup
  icon: LucideIcon
  /** Name and one-line detail, read in the interface language each time they are used. */
  readonly label: string
  readonly detail: string
  /** Shortcut from the keybinding registry; its label is read from there. */
  keybinding?: KeybindingId
  /** Search words; English ones always match, whatever the interface language. */
  keywords?: string[]
}

export const TOOL_GROUPS: ToolGroup[] = ['Project', 'Development', 'AI & Agents', 'System']

/** Tools that are side panels take the panel's name, so the palette, the Panels menu and Thread say the same thing. */
const PANEL_OF: Partial<Record<ToolId, string>> = { github: 'git', worktrees: 'worktrees', scripts: 'scripts', search: 'search', 'web-preview': 'browser', background: 'background', editor: 'files', review: 'changes', 'http-calls': 'httpCalls' }

function tool(id: ToolId, group: ToolGroup, icon: LucideIcon, rest: { keybinding?: KeybindingId; keywords?: string[] } = {}): ToolMeta {
  const key = id === 'web-preview' ? 'webPreview' : id === 'http-calls' ? 'httpCalls' : id
  return {
    id, group, icon, ...rest,
    // Words in the language on screen come from the catalog (tools.<id>.keywords, comma separated); code keeps English.
    get keywords() {
      const local = i18n.t(`tools.${key as 'team'}.keywords`, { ns: 'code', defaultValue: '' })
      const words = [...(rest.keywords ?? []), ...local.split(',').map(word => word.trim()).filter(Boolean)]
      return words.length ? words : undefined
    },
    get label() { return PANEL_OF[id] ? i18n.t(`panels.${PANEL_OF[id] as 'git'}`, { ns: 'code' }) : i18n.t(`tools.${key as 'team'}.label`, { ns: 'code' }) },
    get detail() { return i18n.t(`tools.${key as 'team'}.detail`, { ns: 'code' }) }
  }
}

/**
 * The workspace tools the command palette lists. Panels use the names, icons and
 * shortcuts of the shared panel catalog (src/components/Workbench/panelCatalog.ts).
 */
export const TOOL_CATALOG: ToolMeta[] = [
  tool('team', 'Project', Users, { keybinding: 'team.open', keywords: ['team', 'roles', 'coordinator', 'members', 'inbox', 'agents'] }),
  tool('integration', 'Project', Network, { keywords: ['integration', 'srv', 'bff', 'handoff'] }),
  tool('github', 'Development', Github, { keywords: ['git', 'pr', 'workflow', 'actions'] }),
  tool('worktrees', 'Development', FolderTree, { keywords: ['branch', 'checkout'] }),
  tool('scripts', 'Development', Code2, { keywords: ['npm', 'run', 'package'] }),
  tool('search', 'Development', Search, { keybinding: 'code.search', keywords: ['grep', 'ripgrep', 'regex', 'text'] }),
  tool('web-preview', 'Development', MonitorPlay, { keybinding: 'code.browser', keywords: ['web preview', 'browser', 'localhost', 'preview'] }),
  tool('http-calls', 'Development', Network, { keywords: ['http', 'curl', 'wget', 'network', 'calls', 'api'] }),
  tool('background', 'Development', Activity, { keywords: ['bg', 'job', 'task'] }),
  tool('slash', 'AI & Agents', Slash, { keybinding: 'terminal.slash', keywords: ['slash', 'command'] }),
  tool('mcp', 'AI & Agents', Wrench, { keywords: ['mcp', 'connections', 'tools'] }),
  tool('semantic', 'AI & Agents', Brain, { keywords: ['index', 'embedding', 'vector'] }),
  tool('editor', 'System', FileCode2, { keybinding: 'code.files', keywords: ['editor', 'monaco', 'files'] }),
  tool('review', 'System', GitCompareArrows, { keybinding: 'code.changes', keywords: ['review', 'diff', 'changes'] })
]
