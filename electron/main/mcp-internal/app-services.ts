/**
 * The app services the domain tools reach. Each is the same instance the IPC
 * layer uses, so an agent and the person see one state. All optional: a build
 * or a test that does not wire one gets an `unavailable` refusal, not a crash.
 */
export interface AppServices {
  github?: import('../services/github').GitHubService
  tasks?: Pick<import('../services/task.service').TaskService, 'list' | 'getReadyTaskIds' | 'executions'>
  skills?: Pick<import('../services/skill.service').SkillService, 'listSkills'>
  automations?: () => Pick<import('../services/automations/service').AutomationService, 'list' | 'runs'> | undefined
  linear?: Pick<import('../services/linear.service').LinearService, 'getStatus' | 'listTeams' | 'listIssues' | 'getIssue'>
  terminal?: { peek(paneId: string): { running: boolean; data: string; altScreen: boolean } | null }
  mcpServers?: Pick<import('../services/mcp.service').McpManager, 'list'>
  search?: Pick<import('../services/search.service').SearchService, 'search' | 'listFiles'>
  contextUsage?: Pick<import('../services/contextUsage').ContextUsageService, 'get'>
  credits?: Pick<import('../services/agentCredits').AgentCreditsService, 'getCredits'>
}
