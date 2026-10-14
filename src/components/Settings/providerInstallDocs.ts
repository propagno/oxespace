import type { AgentProvider } from '../../../shared/types/agent'

/** Official install / docs links for built-in agent CLIs (opened externally). */
export const PROVIDER_INSTALL_DOCS: Partial<Record<AgentProvider, { label: string; url: string }>> = {
  claude: { label: 'Install Claude Code', url: 'https://docs.anthropic.com/en/docs/claude-code/overview' },
  copilot: { label: 'Install Copilot CLI', url: 'https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli' },
  codex: { label: 'Install Codex CLI', url: 'https://github.com/openai/codex' },
  cursor: { label: 'Cursor CLI docs', url: 'https://cursor.com/docs' },
  antigravity: { label: 'Antigravity (agy)', url: 'https://github.com/search?q=antigravity+cli+agy&type=repositories' },
  grok: { label: 'Grok CLI docs', url: 'https://docs.x.ai/' }
}
