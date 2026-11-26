import { Bot } from 'lucide-react'
import type { ReactElement } from 'react'
import type { AgentProvider } from '../../../shared/types/agent'
import {
  AntigravityMark,
  ClaudeMark,
  CodexMark,
  CopilotMark,
  CursorMark,
  GrokMark
} from './ProviderMarks'

interface AgentProviderIconProps {
  provider: AgentProvider
  size?: number
}

interface ProviderBadgeStyle {
  bg: string
  border?: string
}

const PROVIDER_BADGES: Record<AgentProvider, ProviderBadgeStyle> = {
  claude:       { bg: 'var(--provider-claude)' },
  'gh-copilot': { bg: 'var(--provider-copilot)' },
  copilot:      { bg: 'var(--provider-copilot)' },
  // Multicolor Google gradient needs a neutral theme-aware surface badge so the blue legs and rainbow arch read cleanly in both light and dark modes.
  antigravity:  { bg: 'var(--surface-sunken)', border: 'var(--bd-subtle)' },
  codex:        { bg: 'var(--provider-codex)' },
  cursor:       { bg: 'var(--provider-cursor)' },
  grok:         { bg: 'var(--provider-grok)' },
  custom:       { bg: 'var(--provider-custom)' },
}

function renderProviderMark(provider: AgentProvider, glyphSize: number): ReactElement {
  switch (provider) {
    case 'antigravity':
      return <AntigravityMark size={glyphSize} />
    case 'claude':
      return <ClaudeMark size={glyphSize} />
    case 'codex':
      return <CodexMark size={glyphSize} />
    case 'cursor':
      return <CursorMark size={glyphSize} />
    case 'copilot':
    case 'gh-copilot':
      return <CopilotMark size={glyphSize} />
    case 'grok':
      return <GrokMark size={glyphSize} />
    case 'custom':
    default:
      return <Bot size={glyphSize} color="white" aria-hidden="true" />
  }
}

export function AgentProviderIcon({ provider, size = 20 }: AgentProviderIconProps): ReactElement {
  const badge = PROVIDER_BADGES[provider] ?? PROVIDER_BADGES.custom
  const glyphSize = Math.max(8, Math.round(size * 0.72))

  return (
    <span
      className="agent-provider-icon"
      data-provider={provider}
      style={{
        backgroundColor: badge.bg,
        boxShadow: badge.border ? `inset 0 0 0 1px ${badge.border}` : undefined,
        width: size,
        height: size,
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
      aria-hidden="true"
    >
      {renderProviderMark(provider, glyphSize)}
    </span>
  )
}
