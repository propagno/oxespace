import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { AgentProvider } from '../../../shared/types/agent'
import type { AgentAccountContext } from '../../../shared/types/agentAuth'
import { rememberAppView } from '../../app/startView'
import { selectAccount, useAccountStore } from '../../store/account.store'
import { useAgentStore } from '../../store/agent.store'
import { useNavigationPrefs } from '../../store/navigation-prefs.store'
import { useThreadStore } from '../../store/thread.store'
import { accountContext } from '../Threads/accountMessages'
import { FirstRun, type FirstRunAgent, type FirstRunAgentStatus } from './FirstRun'

const PROVIDERS: Array<'claude' | 'codex'> = ['claude', 'codex']

export interface FirstRunHostProps {
  onOpenMode: (mode: 'code' | 'data') => void
  onStartConversation: (folder: string | null) => void
  onNewWorkspace: () => void
}

export function FirstRunHost({ onOpenMode, onStartConversation, onNewWorkspace }: FirstRunHostProps): ReactElement {
  const readiness = useAgentStore(state => state.readiness)
  const profiles = useAgentStore(state => state.allProfiles)
  const loadReadiness = useAgentStore(state => state.loadReadiness)
  const discover = useAgentStore(state => state.discover)
  const projects = useThreadStore(state => state.projects)
  const [pickedFolder, setPickedFolder] = useState<string | null>(null)
  const [signingIn, setSigningIn] = useState<Partial<Record<AgentProvider, boolean>>>({})
  const started = useRef(false)

  const folder = pickedFolder ?? projects[0]?.contexts[0]?.rootPath ?? null
  const claudeContext: AgentAccountContext = useMemo(() => accountContext('claude', 'thread:first-run'), [])
  const codexContext: AgentAccountContext = useMemo(() => accountContext('codex', 'thread:first-run'), [])
  const claudeAccount = useAccountStore(selectAccount(claudeContext))
  const codexAccount = useAccountStore(selectAccount(codexContext))

  useEffect(() => {
    if (started.current) return
    started.current = true
    void loadReadiness().then(() => {
      if (useAgentStore.getState().lastHealthCheckAt === null) void discover(false)
    })
    if (window.oxe?.thread?.projects) void useThreadStore.getState().loadProjects()
    if (window.oxe?.agentAccount) {
      void useAccountStore.getState().read(claudeContext)
      void useAccountStore.getState().read(codexContext)
    }
  }, [claudeContext, codexContext, discover, loadReadiness])

  const agents: FirstRunAgent[] = useMemo(() => PROVIDERS.map((provider): FirstRunAgent => {
    const entry = readiness.find(item => item.provider === provider)
    const profile = profiles.find(item => item.provider === provider)
    const account = provider === 'claude' ? claudeAccount : codexAccount
    let status: FirstRunAgentStatus
    if (signingIn[provider] || account?.state === 'connecting' || account?.state === 'awaiting-browser' || account?.state === 'awaiting-code') {
      status = 'signing-in'
    } else if (account?.state === 'missing-cli' || (!entry && !account) || entry?.status === 'missing') {
      status = 'missing'
    } else if (account?.state === 'signed-out' || account?.state === 'expired') {
      status = 'signed-out'
    } else if (entry?.status === 'ready' || account?.state === 'connected') {
      status = 'ready'
    } else {
      status = 'signed-out'
    }
    return {
      provider,
      status,
      model: profile?.model || undefined
    }
  }), [claudeAccount, codexAccount, profiles, readiness, signingIn])

  const handleOpenFolder = async (): Promise<void> => {
    const selected = await window.oxe?.workspace?.pickFolder?.()
    if (!selected) return
    setPickedFolder(selected)
    useNavigationPrefs.getState().completeFirstRunStep('folder')
    if (window.oxe?.thread?.addProject) {
      await window.oxe.thread.addProject(selected).catch(() => undefined)
      await useThreadStore.getState().loadProjects().catch(() => undefined)
    }
  }

  const handleSignIn = (provider: AgentProvider): void => {
    if (provider !== 'claude' && provider !== 'codex') return
    const ctx = provider === 'claude' ? claudeContext : codexContext
    setSigningIn(prev => ({ ...prev, [provider]: true }))
    if (window.oxe?.agentAccount) {
      void useAccountStore.getState().login(ctx).catch(() => undefined).finally(() => {
        setSigningIn(prev => ({ ...prev, [provider]: false }))
      })
    } else {
      setSigningIn(prev => ({ ...prev, [provider]: false }))
    }
  }

  const handleCancelSignIn = (provider: AgentProvider): void => {
    const account = provider === 'claude' ? claudeAccount : codexAccount
    if (account?.attemptId && window.oxe?.agentAccount?.cancel) {
      void window.oxe.agentAccount.cancel(account.attemptId).catch(() => undefined)
    }
    setSigningIn(prev => ({ ...prev, [provider]: false }))
  }

  const handleNewConversation = (): void => {
    useNavigationPrefs.getState().dismissFirstRun()
    rememberAppView('thread')
    onStartConversation(folder)
  }

  return (
    <FirstRun
      folder={folder}
      agents={agents}
      onOpenFolder={() => { void handleOpenFolder() }}
      onSignIn={handleSignIn}
      onCancelSignIn={handleCancelSignIn}
      onNewConversation={handleNewConversation}
      onOpenMode={(mode) => {
        useNavigationPrefs.getState().dismissFirstRun()
        onOpenMode(mode)
      }}
      onNewWorkspace={onNewWorkspace}
    />
  )
}
