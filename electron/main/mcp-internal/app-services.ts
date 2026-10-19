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
  mcpServers?: Pick<import('../services/mcp.service').McpManager, 'list'>
  search?: Pick<import('../services/search.service').SearchService, 'search' | 'listFiles'>
  contextUsage?: Pick<import('../services/contextUsage').ContextUsageService, 'get'>
  credits?: Pick<import('../services/agentCredits').AgentCreditsService, 'getCredits'>
}
