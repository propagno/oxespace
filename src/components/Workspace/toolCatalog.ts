import { Activity, Brain, Code2, FileCode2, FolderTree, GitCompareArrows, MonitorPlay, Network, Users, Search, Slash, Sparkles, Wrench, type LucideIcon } from 'lucide-react'
import { Github } from '../Brand/GithubIcon'
import type { KeybindingId } from '../../keyboard/keybindings'

export type ToolGroup = 'Project' | 'Development' | 'AI & Agents' | 'System'
export type ToolId = 'integration' | 'github' | 'worktrees' | 'scripts' | 'search' | 'web-preview' | 'background' | 'slash' | 'mcp' | 'skills' | 'semantic' | 'editor' | 'review' | 'team'

export interface ToolMeta {
  id: ToolId
  group: ToolGroup
  icon: LucideIcon
  label: string
  detail: string
  /** Shortcut from the keybinding registry; its label is read from there. */
  keybinding?: KeybindingId
  keywords?: string[]
}

export const TOOL_GROUPS: ToolGroup[] = ['Project', 'Development', 'AI & Agents', 'System']

/**
 * The workspace tools the command palette lists. Panels use the names, icons and
 * shortcuts of the shared panel catalog (src/components/Workbench/panelCatalog.ts),
 * so the palette, the Panels menu and Thread say the same thing.
 */
export const TOOL_CATALOG: ToolMeta[] = [
  { id: 'team', group: 'Project', icon: Users, label: 'Team', detail: 'Project roles and agent inboxes', keywords: ['roles', 'coordinator', 'members', 'inbox', 'agents'] },
  { id: 'integration', group: 'Project', icon: Network, label: 'Multi-repo coordination', detail: 'Align agents, context & handoffs', keywords: ['integration', 'srv', 'bff', 'handoff'] },
  { id: 'github', group: 'Development', icon: Github, label: 'Commit & pull request', detail: 'Commits, pull requests and workflows', keywords: ['git', 'pr', 'workflow', 'actions'] },
  { id: 'worktrees', group: 'Development', icon: FolderTree, label: 'Worktrees', detail: 'Branch checkouts side-by-side', keywords: ['branch', 'checkout'] },
  { id: 'scripts', group: 'Development', icon: Code2, label: 'Scripts', detail: 'Discover and run project scripts', keywords: ['npm', 'run', 'package'] },
  { id: 'search', group: 'Development', icon: Search, label: 'Find in files', detail: 'ripgrep text & regex search', keybinding: 'code.search', keywords: ['grep', 'ripgrep', 'regex', 'text'] },
  { id: 'web-preview', group: 'Development', icon: MonitorPlay, label: 'Browser', detail: 'Preview a local page', keybinding: 'code.browser', keywords: ['web preview', 'browser', 'localhost', 'preview'] },
  { id: 'background', group: 'Development', icon: Activity, label: 'Background activity', detail: 'Local jobs and delegated work', keywords: ['bg', 'job', 'task'] },
  { id: 'slash', group: 'AI & Agents', icon: Slash, label: 'Terminal commands', detail: 'Slash commands in active pane', keybinding: 'terminal.slash', keywords: ['slash', 'command'] },
  { id: 'mcp', group: 'AI & Agents', icon: Wrench, label: 'MCP servers', detail: 'Servers and connectors your agents use', keywords: ['mcp', 'connections', 'tools'] },
  { id: 'skills', group: 'AI & Agents', icon: Sparkles, label: 'Skills', detail: 'Markdown skill prompts', keywords: ['skill', 'prompt'] },
  { id: 'semantic', group: 'AI & Agents', icon: Brain, label: 'Semantic index log', detail: 'Local vector index activity', keywords: ['index', 'embedding', 'vector'] },
  { id: 'editor', group: 'System', icon: FileCode2, label: 'Files', detail: 'Browse and edit project files', keybinding: 'code.files', keywords: ['editor', 'monaco', 'files'] },
  { id: 'review', group: 'System', icon: GitCompareArrows, label: 'Changes', detail: 'Branch and uncommitted changes', keybinding: 'code.changes', keywords: ['review', 'diff', 'changes'] }
]
