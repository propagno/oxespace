import { Check } from 'lucide-react'
import { useEffect, useId, useRef, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentProvider } from '../../../shared/types/agent'
import { OxeCodeIcon } from '../../design/icons/OxeCodeIcon'
import { OxeQueryIcon } from '../../design/icons/OxeQueryIcon'
import { Button, cx } from '../../ui'
import { PROVIDER_INSTALL_DOCS } from '../Settings/providerInstallDocs'
import { openInstallDocs } from './AgentCliOnboarding'
import styles from './FirstRun.module.css'

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
  onNewWorkspace?: () => void
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
  onOpenMode,
  onNewWorkspace
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
    <section className={styles.screen} data-testid="first-run">
      <div className={styles.inner}>
        <header className={styles.hero}>
          <h1 className={styles.heroTitle}>{t('firstRun.v2.heroTitle')}</h1>
          <p className={styles.heroLead}>{t('firstRun.v2.heroLead')}</p>
        </header>

        <ol className={styles.steps}>
          <li className={cx(styles.step, !folder && styles.stepActive)} data-done={Boolean(folder) || undefined}>
            <span className={styles.stepNum} aria-hidden="true">
              {folder ? <Check size={13} /> : '1'}
            </span>
            <div className={styles.body}>
              <div className={styles.stepHeader}>
                <h3 className={styles.stepTitle}>{t('firstRun.v2.folderStep')}</h3>
                <div className={styles.actions}>
                  <Button variant={folder ? 'secondary' : 'primary'} size="sm" onClick={onOpenFolder}>{t('firstRun.v2.chooseFolder')}</Button>
                </div>
              </div>
              {folder ? <p className={styles.folderBadge}>{folder}</p> : null}
            </div>
          </li>

          <li className={cx(styles.step, Boolean(folder) && !hasReadyAgent && styles.stepActive)} data-done={hasReadyAgent || undefined}>
            <span className={styles.stepNum} aria-hidden="true">
              {hasReadyAgent ? <Check size={13} /> : '2'}
            </span>
            <div className={styles.body}>
              <h3 className={styles.stepTitle}>{t('firstRun.v2.agentStep')}</h3>
              <div className={styles.agentList}>
                {agents.map((agent) => {
                  const label = providerTitle(agent.provider)
                  const docUrl = PROVIDER_INSTALL_DOCS[agent.provider]?.url ?? 'https://github.com'
                  return (
                    <div key={agent.provider} className={styles.agentRow}>
                      <span className={styles.agentIdentity}>
                        <span className={cx(styles.agentDot, agent.status === 'ready' && styles.agentDotReady)} aria-hidden="true" />
                        <span className={styles.headline}>{label}</span>
                      </span>
                      <span className={styles.agentActions}>
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
                          <span className={cx(styles.detail, styles.detailReady)}>
                            {agent.model ? t('firstRun.v2.readyModel', { model: agent.model }) : t('firstRun.v2.ready')}
                          </span>
                        )}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          </li>

          <li className={styles.step}>
            <span className={styles.stepNum} aria-hidden="true">3</span>
            <div className={styles.body}>
              <div className={styles.stepHeader}>
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
            </div>
          </li>
        </ol>

        <div className={styles.modesFooter}>
          <div className={styles.modesCaptionRow}>
            <span className={styles.modesCaption}>{t('firstRun.v2.openModeAlone')}</span>
            {onNewWorkspace ? (
              <Button variant="ghost" size="sm" data-testid="btn-new-workspace" onClick={onNewWorkspace}>
                {t('app.start.newWorkspace')}
              </Button>
            ) : null}
          </div>
          <div className={styles.modeGrid}>
            <Button variant="ghost" className={styles.modeTile} onClick={() => onOpenMode('code')}>
              <OxeCodeIcon size={16} className={styles.modeIcon} />
              <span className={styles.modeText}>
                <span className={styles.modeName}>OxeCode</span>{' '}
                <span className={styles.modeDesc}>{t('firstRun.v2.modeDescCode')}</span>
              </span>
            </Button>
            <Button variant="ghost" className={styles.modeTile} onClick={() => onOpenMode('data')}>
              <OxeQueryIcon size={16} className={styles.modeIcon} />
              <span className={styles.modeText}>
                <span className={styles.modeName}>OxeQuery</span>{' '}
                <span className={styles.modeDesc}>{t('firstRun.v2.modeDescQuery')}</span>
              </span>
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
