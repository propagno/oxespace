import { useEffect, useId, useRef, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentProvider } from '../../../shared/types/agent'
import { Button } from '../../ui'
import { PROVIDER_INSTALL_DOCS } from '../Settings/providerInstallDocs'
import { openInstallDocs } from './AgentCliOnboarding'
import styles from './FirstRunChecklist.module.css'

export type FirstRunAgentStatus = 'ready' | 'missing' | 'signed-out' | 'signing-in'

export interface FirstRunAgent {
  provider: AgentProvider
  status: FirstRunAgentStatus
  model?: string
}

export interface FirstRunProps {
  folder: string | null
  agents: FirstRunAgent[]
  onOpenFolder: () => void
  onSignIn: (provider: AgentProvider) => void
  onCancelSignIn: (provider: AgentProvider) => void
  onNewConversation: () => void
  onOpenMode: (mode: 'code' | 'data') => void
}

function providerTitle(provider: AgentProvider): string {
  if (provider === 'claude') return 'Claude Code'
  if (provider === 'codex') return 'Codex'
  return PROVIDER_INSTALL_DOCS[provider]?.product ?? provider
}

export function FirstRun({
  folder,
  agents,
  onOpenFolder,
  onSignIn,
  onCancelSignIn,
  onNewConversation,
  onOpenMode
}: FirstRunProps): ReactElement {
  const { t } = useTranslation()
  const reasonId = useId()
  const step3HeadingRef = useRef<HTMLHeadingElement>(null)
  const hasReadyAgent = agents.some(agent => agent.status === 'ready')
  const isSigningIn = agents.some(agent => agent.status === 'signing-in')
  const wasWaitingForSignIn = useRef(false)

  useEffect(() => {
    if (isSigningIn && !hasReadyAgent) {
      wasWaitingForSignIn.current = true
      return
    }
    if (wasWaitingForSignIn.current && hasReadyAgent) {
      wasWaitingForSignIn.current = false
      step3HeadingRef.current?.focus()
    }
  }, [isSigningIn, hasReadyAgent])

  const disabledReason = !hasReadyAgent ? t('firstRun.v2.connectFirst') : undefined

  return (
    <section className={styles.card} data-testid="first-run">
      <ol className={styles.steps}>
        <li className={styles.step} data-done={Boolean(folder) || undefined}>
          <div className={styles.body}>
            <h3 className={styles.stepTitle}>{t('firstRun.v2.folderStep')}</h3>
            {folder ? <p className={styles.detail}>{folder}</p> : null}
            <div className={styles.actions}>
              <Button variant="secondary" size="sm" onClick={onOpenFolder}>{t('firstRun.v2.chooseFolder')}</Button>
            </div>
          </div>
        </li>
        <li className={styles.step} data-done={hasReadyAgent || undefined}>
          <div className={styles.body}>
            <h3 className={styles.stepTitle}>{t('firstRun.v2.agentStep')}</h3>
            {agents.map((agent) => {
              const label = providerTitle(agent.provider)
              const docUrl = PROVIDER_INSTALL_DOCS[agent.provider]?.url ?? 'https://github.com'
              return (
                <div key={agent.provider} className={styles.row}>
                  <span className={styles.headline}>{label}</span>
                  {agent.status === 'missing' ? (
                    <Button variant="ghost" size="sm" onClick={() => openInstallDocs(docUrl)}>
                      {t('firstRun.v2.howToInstall')}
                    </Button>
                  ) : agent.status === 'signed-out' ? (
                    <Button variant="secondary" size="sm" onClick={() => onSignIn(agent.provider)}>
                      {t('firstRun.v2.signIn', { provider: label })}
                    </Button>
                  ) : agent.status === 'signing-in' ? (
                    <>
                      <span className={styles.detail}>{t('firstRun.v2.waiting')}</span>
                      <Button variant="ghost" size="sm" onClick={() => onCancelSignIn(agent.provider)}>
                        {t('firstRun.v2.cancel')}
                      </Button>
                    </>
                  ) : (
                    <span className={styles.detail}>
                      {agent.model ? t('firstRun.v2.readyModel', { model: agent.model }) : t('firstRun.v2.ready')}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </li>
        <li className={styles.step}>
          <div className={styles.body}>
            <h3 ref={step3HeadingRef} tabIndex={-1} className={styles.stepTitle}>
              {t('firstRun.v2.conversationStep')}
            </h3>
            <div className={styles.actions}>
              <Button
                variant="primary"
                size="sm"
                disabled={!hasReadyAgent}
                title={disabledReason}
                aria-describedby={disabledReason ? reasonId : undefined}
                onClick={onNewConversation}
              >
                {t('firstRun.v2.newConversation')}
              </Button>
              {disabledReason ? <span id={reasonId} className="sr-only">{disabledReason}</span> : null}
            </div>
          </div>
        </li>
      </ol>
      <div className={styles.actions}>
        <span>{t('firstRun.v2.openModeAlone')}</span>
        <Button variant="ghost" size="sm" onClick={() => onOpenMode('code')}>OxeCode</Button>
        <Button variant="ghost" size="sm" onClick={() => onOpenMode('data')}>OxeQuery</Button>
      </div>
    </section>
  )
}
