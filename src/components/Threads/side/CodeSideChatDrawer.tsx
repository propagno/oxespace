import { useMemo, type ReactElement } from 'react'
import { THREAD_PROVIDERS } from '../../../../shared/threadProviders'
import type { AgentProfile } from '../../../../shared/types/agent'
import type { ThreadProvider } from '../../../../shared/types/thread'
import { terminalSideKey } from './sideChatStore'
import { ThreadSideChat } from './ThreadSideChat'

export interface CodeSideChatDrawerProps {
  paneId: string
  agentProfileId?: string | null
  workspaceId: string
  rootPath: string
  agentProfiles: AgentProfile[]
  onClose: () => void
  onLeave: () => void
}

/** Lazy-loaded OxeCode terminal Side Chat wrapper so sideChatStore and ThreadSideChat stay out of the boot bundle (OXE-466). */
export function CodeSideChatDrawer({
  paneId,
  agentProfileId,
  workspaceId,
  rootPath,
  agentProfiles,
  onClose,
  onLeave
}: CodeSideChatDrawerProps): ReactElement {
  const sideChatKey = terminalSideKey(paneId)
  const availableProviders = useMemo<ThreadProvider[]>(() => {
    const configured = THREAD_PROVIDERS.filter(provider => agentProfiles.some(profile => !profile.parentProvider && profile.provider === provider))
    return configured.length ? configured : [...THREAD_PROVIDERS]
  }, [agentProfiles])
  const defaultProvider = useMemo<ThreadProvider>(() => {
    const bound = agentProfileId ? agentProfiles.find(profile => profile.agentProfileId === agentProfileId) : undefined
    const resolved = bound?.parentProvider ?? bound?.provider
    if (resolved === 'claude' || resolved === 'codex' || resolved === 'antigravity') return resolved
    return availableProviders[0] ?? 'claude'
  }, [agentProfileId, agentProfiles, availableProviders])
  const openOptions = useMemo(() => ({
    source: 'terminal' as const,
    paneId,
    workspaceId,
    rootPath,
    provider: defaultProvider
  }), [paneId, workspaceId, rootPath, defaultProvider])

  return (
    <ThreadSideChat
      key={sideChatKey}
      threadId={sideChatKey}
      defaultProvider={defaultProvider}
      availableProviders={availableProviders}
      openOptions={openOptions}
      shortcutId="code.sideChat"
      onClose={onClose}
      onLeave={onLeave}
    />
  )
}
