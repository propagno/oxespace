/**
 * The app services the domain tools reach. Each is the same instance the IPC
 * layer uses, so an agent and the person see one state. All optional: a build
 * or a test that does not wire one gets an `unavailable` refusal, not a crash.
 */
export interface AppServices {
  github?: import('../services/github').GitHubService
  tasks?: Pick<import('../services/task.service').TaskService, 'list' | 'getReadyTaskIds' | 'executions' | 'create' | 'update' | 'reorder' | 'addDependency' | 'removeDependency' | 'verify' | 'delete'>
  skills?: Pick<import('../services/skill.service').SkillService, 'listSkills' | 'createSkill'>
  automations?: () => Pick<import('../services/automations/service').AutomationService, 'list' | 'runs' | 'create' | 'setEnabled' | 'remove' | 'runNow'> | undefined
  linear?: Pick<import('../services/linear.service').LinearService, 'getStatus' | 'listTeams' | 'listIssues' | 'getIssue' | 'createWorktreeFromIssue'>
  /** Shows a desktop notification; false when the system does not support them. */
  notify?: (title: string, body: string) => boolean
  terminal?: { peek(paneId: string): { running: boolean; data: string; altScreen: boolean } | null }
  mcpServers?: Pick<import('../services/mcp.service').McpManager, 'list' | 'start' | 'stopRuntime'>
  search?: Pick<import('../services/search.service').SearchService, 'search' | 'listFiles'>
  contextUsage?: Pick<import('../services/contextUsage').ContextUsageService, 'get'>
  credits?: Pick<import('../services/agentCredits').AgentCreditsService, 'getCredits'>
  /** Agents in panes: their lifecycle state, their terminals and the panes they live in. */
  agents?: {
    state: Pick<import('../services/agent-state/agent-state.service').AgentStateService, 'list' | 'get' | 'explain' | 'waitFor'>
    terminal: Pick<import('../services/terminal.service').TerminalManager, 'peek' | 'submit' | 'interrupt' | 'start' | 'stop'>
    profiles: () => import('../../../shared/types/agent').AgentProfile[]
    resolve: (agentProfileId: string) => { executable: string; provider: string }
    /** The MCP bridge arguments every agent OXESpace starts gets. */
    mcpArgs: (provider: string) => string[]
    createPane: (workspaceId: string) => { workspace: import('../../../shared/types/workspace').Workspace; paneId: string }
    setPaneAgent: (paneId: string, agentProfileId: string | null, agentName: string | null) => import('../../../shared/types/workspace').Workspace
    closePane: (paneId: string) => import('../../../shared/types/workspace').Workspace | null
    /** Tells the window a workspace changed (a pane opened or closed). */
    workspaceChanged: (workspace: import('../../../shared/types/workspace').Workspace) => void
  }
}
