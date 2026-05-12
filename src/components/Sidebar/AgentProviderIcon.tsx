import { Bot, Code2, Github, MousePointer2, Sparkles } from 'lucide-react'
import type { ReactElement } from 'react'
import type { AgentProvider } from '../../../shared/types/agent'
import { OxeLogo } from '../Brand/OxeLogo'

interface AgentProviderIconProps {
  provider: AgentProvider
}

function ClaudeAsterisk(): ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M6 1v10M1 6h10M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="white" strokeWidth="1.6" strokeLinecap="round"/>
    </svg>
  )
}

const PROVIDER_TOKENS: Record<AgentProvider, { bg: string; icon: ReactElement }> = {
  claude:       { bg: 'var(--provider-claude)',  icon: <ClaudeAsterisk /> },
  'gh-copilot': { bg: 'var(--provider-copilot)', icon: <Github size={11} color="white" /> },
  copilot:      { bg: 'var(--provider-copilot)', icon: <Github size={11} color="white" /> },
  gemini:       { bg: 'var(--provider-gemini)',  icon: <Sparkles size={10} color="white" /> },
  codex:        { bg: 'var(--provider-codex)',   icon: <Code2 size={10} color="white" /> },
  cursor:       { bg: 'var(--provider-cursor)',  icon: <MousePointer2 size={10} color="white" /> },
  oxe:          { bg: 'var(--provider-oxe)',     icon: <OxeLogo size={12} variant="compact" /> },
  custom:       { bg: 'var(--provider-custom)',  icon: <Bot size={10} color="white" /> },
}

export function AgentProviderIcon({ provider }: AgentProviderIconProps): ReactElement {
  const config = PROVIDER_TOKENS[provider] ?? PROVIDER_TOKENS.custom
  return (
    <div
      className="agent-provider-icon"
      style={{ background: config.bg }}
      aria-hidden="true"
    >
      {config.icon}
    </div>
  )
}
