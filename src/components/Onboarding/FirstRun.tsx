import { Check } from 'lucide-react'
import { useEffect, useRef, type ReactElement, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentProvider } from '../../../shared/types/agent'
import { Button, cx, StatusSignal, type SignalState } from '../../ui'
import { OxeMark } from '../Brand/OxeLogo'
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

/** Where a step stands (BRD-12): finished ones are done, the first one not done is current, the rest next. */
export type FirstRunStepState = 'done' | 'current' | 'next'

function stepStates(done: readonly boolean[]): FirstRunStepState[] {
  const current = done.findIndex(item => !item)
  return done.map((item, index) => (item ? 'done' : index === current ? 'current' : 'next'))
}

function providerTitle(provider: AgentProvider): string {
  if (provider === 'claude') return 'Claude Code'
  if (provider === 'codex') return 'Codex'
  return PROVIDER_INSTALL_DOCS[provider]?.product ?? provider
}

/** Each agent's state as the brand's signal (PU-03·1): ready is done, signing in is working; missing and signed out wait for you. */
const AGENT_SIGNAL: Record<FirstRunAgentStatus, SignalState> = {
  ready: 'done',
  'signing-in': 'working',
  missing: 'waiting',
  'signed-out': 'waiting'
}

function Step({ index, state, children }: { index: number; state: FirstRunStepState; children: ReactNode }): ReactElement {
  return (
    <li className={styles.step} data-ui="first-run-step" data-state={state} aria-current={state === 'current' ? 'step' : undefined}>
      <span className={styles.stepNum} data-ui="first-run-step-num" aria-hidden="true">{state === 'done' ? <Check size={13} /> : index}</span>
      <div className={styles.body}>{children}</div>
    </li>
  )
}

/** The first run (OXE-77, BRD-12): the Ramo mark, the display title, three steps with state and one line below. */
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

  const [folderState, agentState, conversationState] = stepStates([Boolean(folder), hasReadyAgent, false])
  // Step 1's action is what creates the workspace; the first run has no other New workspace button.
  const createWorkspace = onNewWorkspace ?? onOpenFolder

  return (
    <section className={styles.screen} data-testid="first-run">
      <div className={styles.inner}>
        <header className={styles.hero}>
          <OxeMark size={40} tile />
          <h1 className={styles.heroTitle} data-ui="first-run-title">{t('firstRun.v2.heroTitle')}</h1>
          <p className={styles.heroLead}>{t('firstRun.v2.heroLead')}</p>
        </header>

        <ol className={styles.steps}>
          <Step index={1} state={folderState}>
            <div className={styles.stepHeader}>
              <h3 className={styles.stepTitle}>{t('firstRun.v2.folderStep')}</h3>
              <div className={styles.actions}>
                {folder
                  ? <Button variant="secondary" size="sm" onClick={onOpenFolder}>{t('firstRun.v2.change')}</Button>
                  : <Button variant="primary" size="sm" data-testid="btn-new-workspace" onClick={createWorkspace}>{t('firstRun.v2.chooseFolder')}</Button>}
              </div>
            </div>
            {folder ? <p className={styles.folderBadge} title={folder}>{folder}</p> : null}
          </Step>

          <Step index={2} state={agentState}>
            <h3 className={styles.stepTitle}>{t('firstRun.v2.agentStep')}</h3>
            <div className={styles.agentList}>
              {agents.map((agent) => {
                const label = providerTitle(agent.provider)
                const docUrl = PROVIDER_INSTALL_DOCS[agent.provider]?.url ?? 'https://github.com'
                const signalLabel = agent.status === 'ready'
                  ? t('firstRun.v2.ready')
                  : agent.status === 'signing-in'
                    ? t('firstRun.v2.waiting')
                    : agent.status === 'signed-out'
                      ? t('firstRun.v2.signIn', { provider: label })
                      : t('firstRun.v2.howToInstall')
                return (
                  <div key={agent.provider} className={styles.agentRow}>
                    <span className={styles.agentIdentity}>
                      <StatusSignal state={AGENT_SIGNAL[agent.status]} label={`${label}: ${signalLabel}`} size={14} />
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
          </Step>

          <Step index={3} state={conversationState}>
            <div className={styles.stepHeader}>
              <h3 ref={step3HeadingRef} tabIndex={-1} className={styles.stepTitle}>
                {t('firstRun.v2.conversationStep')}
              </h3>
              {hasReadyAgent ? (
                <div className={styles.actions}>
                  <Button variant="primary" size="sm" onClick={onNewConversation}>{t('firstRun.v2.newConversation')}</Button>
                </div>
              ) : null}
            </div>
            {hasReadyAgent ? null : <p className={styles.note}>{t('firstRun.v2.waitsForAgent')}</p>}
          </Step>
        </ol>

        <p className={styles.modesLine}>
          {t('firstRun.v2.openAloneBefore')}{' '}
          <Button variant="ghost" size="sm" onClick={() => onOpenMode('code')}>OxeCode</Button>{' '}
          {t('firstRun.v2.openAloneOr')}{' '}
          <Button variant="ghost" size="sm" onClick={() => onOpenMode('data')}>OxeQuery</Button>{' '}
          {t('firstRun.v2.openAloneAfter')}
        </p>
      </div>
    </section>
  )
}
