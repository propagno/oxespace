import { Activity, Brain, Code2, Command, FileCode2, FolderTree, Github, GitCompareArrows, MonitorPlay, Network, PanelLeft, Users, Search, Slash, Sparkles, Wrench, type LucideIcon } from 'lucide-react'

export type ToolGroup = 'Project' | 'Development' | 'AI & Agents' | 'System'
export type ToolId = 'integration' | 'github' | 'worktrees' | 'scripts' | 'search' | 'web-preview' | 'background' | 'slash' | 'mcp' | 'skills' | 'semantic' | 'editor' | 'review' | 'palette' | 'ws-settings' | 'team'

export interface ToolMeta {
  id: ToolId
  group: ToolGroup
  icon: LucideIcon
  label: string
  detail: string
  shortcut?: string
  keywords?: string[]
}

export const TOOL_GROUPS: ToolGroup[] = ['Project', 'Development', 'AI & Agents', 'System']

/**
 * The single list of workspace tools. The Tools hub renders it as a navigable
 * view and the command palette lists the same entries as actions, so names,
 * descriptions, icons and shortcuts cannot drift apart.
 */
export const TOOL_CATALOG: ToolMeta[] = [
  { id: 'team', group: 'Project', icon: Users, label: 'Team', detail: 'Project roles and agent inboxes', keywords: ['roles', 'coordinator', 'members', 'inbox', 'agents'] },
  { id: 'integration', group: 'Project', icon: Network, label: 'Multi-repo coordination', detail: 'Align agents, context & handoffs', keywords: ['integration', 'srv', 'bff', 'handoff'] },
  { id: 'github', group: 'Development', icon: Github, label: 'GitHub', detail: 'PRs, commits, workflows', keywords: ['git', 'pr', 'workflow', 'actions'] },
  { id: 'worktrees', group: 'Development', icon: FolderTree, label: 'Worktrees', detail: 'Branch checkouts side-by-side', keywords: ['branch', 'checkout'] },
  { id: 'scripts', group: 'Development', icon: Code2, label: 'Scripts', detail: 'Discover and run project scripts', keywords: ['npm', 'run', 'package'] },
  { id: 'search', group: 'Development', icon: Search, label: 'Find in Files', detail: 'ripgrep text & regex search', shortcut: 'Ctrl+Shift+F', keywords: ['grep', 'ripgrep', 'regex', 'text'] },
  { id: 'web-preview', group: 'Development', icon: MonitorPlay, label: 'Web Preview', detail: 'Embed localhost previews', keywords: ['browser', 'localhost', 'preview'] },
  { id: 'background', group: 'Development', icon: Activity, label: 'Background Jobs', detail: 'Long-running tasks dock', keywords: ['bg', 'job', 'task'] },
  { id: 'slash', group: 'AI & Agents', icon: Slash, label: 'Terminal Commands', detail: 'Slash commands in active pane', shortcut: 'Ctrl+/', keywords: ['slash', 'command'] },
  { id: 'mcp', group: 'AI & Agents', icon: Wrench, label: 'MCP Servers', detail: 'Model Context Protocol tools', keywords: ['mcp', 'connections', 'tools'] },
  { id: 'skills', group: 'AI & Agents', icon: Sparkles, label: 'Skills', detail: 'Markdown skill prompts', keywords: ['skill', 'prompt'] },
  { id: 'semantic', group: 'AI & Agents', icon: Brain, label: 'Semantic Activity', detail: 'Local vector index logs', keywords: ['index', 'embedding', 'vector'] },
  { id: 'editor', group: 'System', icon: FileCode2, label: 'Editor', detail: 'Monaco file browser', shortcut: 'Ctrl+E', keywords: ['monaco', 'files'] },
  { id: 'review', group: 'System', icon: GitCompareArrows, label: 'Review', detail: 'Diff review pane', keywords: ['diff', 'changes'] },
  { id: 'palette', group: 'System', icon: Command, label: 'Command Palette', detail: 'Jump to any command', shortcut: 'Ctrl+K' },
  { id: 'ws-settings', group: 'System', icon: PanelLeft, label: 'Workspace Settings', detail: 'Layout, density and shell', keywords: ['density', 'layout', 'shell'] }
]
