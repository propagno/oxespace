import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AGENT_IDLE_TTL_CHOICES,
  DEFAULT_AGENT_PROCESS_POLICY,
  DIAGNOSTICS_LIMITS,
  type AgentProcessActionResult,
  type AgentProcessGovernancePolicy,
  type AgentProcessPriority,
  type AgentProcessPriorityResult,
  type AgentProcessesSnapshot,
  type ManagedAgentProcessTree
} from '../../../shared/types/diagnostics'
import { Button } from '../../ui/Button'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { Badge, EmptyState, Notice, Spinner } from '../../ui/Display'
import { Select, Switch } from '../../ui/Field'
import { SettingRow, SettingsSection } from '../../ui/Settings'
import { humanizeError } from '../../utils/humanizeError'
import styles from './AgentProcessesSection.module.css'

const MB = 1024 * 1024
const GB = 1024 * MB

function formatMemory(bytes: number, t: ReturnType<typeof useTranslation<'settings'>>['t']): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return t('diagnostics.agentProcesses.units.mb', { value: 0 })
  if (bytes >= GB) return t('diagnostics.agentProcesses.units.gb', { value: (bytes / GB).toFixed(1) })
  return t('diagnostics.agentProcesses.units.mb', { value: Math.round(bytes / MB) })
}

export function AgentProcessesSection(): ReactElement {
  const { t } = useTranslation('settings')
  const [snapshot, setSnapshot] = useState<AgentProcessesSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyPid, setBusyPid] = useState<number | null>(null)
  const [policyBusy, setPolicyBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmStopTree, setConfirmStopTree] = useState<ManagedAgentProcessTree | null>(null)
  const mountedRef = useRef(true)

  const fetchSnapshot = useCallback(async (): Promise<void> => {
    const api = window.oxe?.diagnostics?.agentProcesses
    if (!api) {
      if (mountedRef.current) setLoading(false)
      return
    }
    try {
      const next = await api({ op: 'snapshot' }) as AgentProcessesSnapshot
      if (mountedRef.current && next && typeof next === 'object' && Array.isArray(next.managed)) {
        setSnapshot(next)
        setError(null)
      }
    } catch (cause) {
      if (mountedRef.current) setError(humanizeError(cause, t('diagnostics.agentProcesses.loadFailed')))
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [t])

  useEffect(() => {
    mountedRef.current = true
    const api = window.oxe?.diagnostics
    let cancelled = false
    let subscriptionId: string | null = null

    const unsubscribeMetrics = api?.onMetrics?.(metrics => {
      if (!cancelled && metrics.agentProcesses) {
        setSnapshot(metrics.agentProcesses)
        setLoading(false)
      }
    })

    if (api?.watch) {
      void api.watch({ intervalMs: DIAGNOSTICS_LIMITS.defaultIntervalMs })
        .then(result => {
          if (cancelled) {
            if (result?.subscriptionId) void api.unwatch?.({ subscriptionId: result.subscriptionId }).catch(() => undefined)
            return
          }
          subscriptionId = result?.subscriptionId ?? null
        })
        .catch(() => undefined)
    }

    void fetchSnapshot()

    return () => {
      cancelled = true
      mountedRef.current = false
      unsubscribeMetrics?.()
      if (subscriptionId) {
        void api?.unwatch?.({ subscriptionId }).catch(() => undefined)
      }
    }
  }, [fetchSnapshot])

  const policy: AgentProcessGovernancePolicy = snapshot?.policy ?? DEFAULT_AGENT_PROCESS_POLICY

  const updatePolicy = async (patch: Partial<AgentProcessGovernancePolicy>): Promise<void> => {
    const api = window.oxe?.diagnostics?.agentProcesses
    if (!api || policyBusy) return
    setPolicyBusy(true)
    setError(null)
    try {
      const nextPolicy = await api({ op: 'setPolicy', policy: patch }) as AgentProcessGovernancePolicy
      if (mountedRef.current) {
        setSnapshot(prev => prev ? { ...prev, policy: nextPolicy } : prev)
      }
      await fetchSnapshot()
    } catch (cause) {
      if (mountedRef.current) setError(humanizeError(cause, t('diagnostics.agentProcesses.actionFailed')))
    } finally {
      if (mountedRef.current) setPolicyBusy(false)
    }
  }

  const handleTogglePriority = async (tree: ManagedAgentProcessTree): Promise<void> => {
    const api = window.oxe?.diagnostics?.agentProcesses
    if (!api || busyPid !== null) return
    const nextPriority: AgentProcessPriority = tree.priority === 'normal' ? 'belowNormal' : 'normal'
    setBusyPid(tree.rootPid)
    setError(null)
    try {
      const res = await api({ op: 'setPriority', rootPid: tree.rootPid, priority: nextPriority }) as AgentProcessPriorityResult
      if (!res?.ok && mountedRef.current) {
        setError(t('diagnostics.agentProcesses.priorityFailed'))
      }
      await fetchSnapshot()
    } catch (cause) {
      if (mountedRef.current) setError(humanizeError(cause, t('diagnostics.agentProcesses.priorityFailed')))
    } finally {
      if (mountedRef.current) setBusyPid(null)
    }
  }

  const handleHibernate = async (tree: ManagedAgentProcessTree): Promise<void> => {
    const api = window.oxe?.diagnostics?.agentProcesses
    if (!api || busyPid !== null) return
    setBusyPid(tree.rootPid)
    setError(null)
    try {
      const res = await api({ op: 'hibernate', rootPid: tree.rootPid }) as AgentProcessActionResult
      if (!res?.ok && mountedRef.current) {
        setError(t('diagnostics.agentProcesses.hibernateFailed'))
      }
      await fetchSnapshot()
    } catch (cause) {
      if (mountedRef.current) setError(humanizeError(cause, t('diagnostics.agentProcesses.hibernateFailed')))
    } finally {
      if (mountedRef.current) setBusyPid(null)
    }
  }

  const runKillTree = async (tree: ManagedAgentProcessTree): Promise<void> => {
    const api = window.oxe?.diagnostics?.agentProcesses
    if (!api || busyPid !== null) return
    setConfirmStopTree(null)
    setBusyPid(tree.rootPid)
    setError(null)
    try {
      const res = await api({ op: 'killTree', rootPid: tree.rootPid }) as AgentProcessActionResult
      if (!res?.ok && mountedRef.current) {
        setError(t('diagnostics.agentProcesses.stopFailed'))
      }
      await fetchSnapshot()
    } catch (cause) {
      if (mountedRef.current) setError(humanizeError(cause, t('diagnostics.agentProcesses.stopFailed')))
    } finally {
      if (mountedRef.current) setBusyPid(null)
    }
  }

  const handleStopClick = (tree: ManagedAgentProcessTree): void => {
    if (tree.state === 'active') {
      setConfirmStopTree(tree)
      return
    }
    void runKillTree(tree)
  }

  return (
    <div className={styles.root} data-testid="agent-processes-section">
      <SettingsSection
        title={t('diagnostics.agentProcesses.title')}
        description={t('diagnostics.agentProcesses.description')}
      >
        {loading && !snapshot ? (
          <Spinner label={t('diagnostics.agentProcesses.loading')} />
        ) : null}

        {snapshot ? (
          <div className={styles.summaryBar} data-testid="agent-processes-summary">
            <div className={styles.stat}>
              <span className={styles.statLabel}>{t('diagnostics.agentProcesses.summary.managedCpu')}</span>
              <span className={styles.statValue}>
                {t('diagnostics.agentProcesses.units.percent', { value: snapshot.totals.managedCpuPercent.toFixed(1) })}
              </span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>{t('diagnostics.agentProcesses.summary.managedRam')}</span>
              <span className={styles.statValue}>{formatMemory(snapshot.totals.managedMemoryBytes, t)}</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>{t('diagnostics.agentProcesses.summary.activeIdle')}</span>
              <span className={styles.statValue}>
                {t('diagnostics.agentProcesses.summary.activeIdleValue', {
                  active: snapshot.totals.activeCount,
                  idle: snapshot.totals.idleCount
                })}
              </span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>{t('diagnostics.agentProcesses.summary.externalCount')}</span>
              <span className={styles.statValue}>{snapshot.totals.externalCount}</span>
            </div>
          </div>
        ) : null}

        {snapshot?.antivirusHighCpu ? (
          <div data-testid="agent-processes-antivirus-hint">
            <Notice intent="warning">
              {t('diagnostics.agentProcesses.antivirusHint', {
                percent: (snapshot.antivirusCpuPercent ?? 0).toFixed(1)
              })}
            </Notice>
          </div>
        ) : null}

        {error ? <Notice intent="danger">{error}</Notice> : null}

        <div className={styles.policies}>
          <SettingRow
            label={t('diagnostics.agentProcesses.policy.autoEcoLabel')}
            description={t('diagnostics.agentProcesses.policy.autoEcoHint')}
            control={
              <Switch
                checked={policy.autoEcoBackground}
                disabled={policyBusy}
                ariaLabel={t('diagnostics.agentProcesses.policy.autoEcoLabel')}
                onChange={checked => void updatePolicy({ autoEcoBackground: checked })}
              />
            }
          />
          <SettingRow
            htmlFor="agent-idle-reaper-ttl"
            label={t('diagnostics.agentProcesses.policy.idleTtlLabel')}
            description={t('diagnostics.agentProcesses.policy.idleTtlHint')}
            control={
              <Select
                id="agent-idle-reaper-ttl"
                aria-label={t('diagnostics.agentProcesses.policy.idleTtlLabel')}
                disabled={policyBusy}
                value={policy.idleReaperEnabled ? policy.idleTtlMinutes : 0}
                onChange={event => {
                  const minutes = Number(event.target.value)
                  void updatePolicy({ idleReaperEnabled: minutes > 0, idleTtlMinutes: minutes })
                }}
              >
                {AGENT_IDLE_TTL_CHOICES.map(minutes => (
                  <option key={minutes} value={minutes}>
                    {minutes === 0
                      ? t('diagnostics.agentProcesses.policy.disabled')
                      : t('diagnostics.agentProcesses.policy.minutes', { count: minutes })}
                  </option>
                ))}
              </Select>
            }
          />
        </div>

        <div className={styles.subHeader}>
          <h4 className={styles.subTitle}>{t('diagnostics.agentProcesses.managedTitle')}</h4>
        </div>

        {snapshot && snapshot.managed.length === 0 ? (
          <EmptyState compact title={t('diagnostics.agentProcesses.managedEmpty')} />
        ) : snapshot ? (
          <table className={styles.table} data-testid="agent-processes-managed-table">
            <thead>
              <tr>
                <th scope="col">{t('diagnostics.agentProcesses.columns.agent')}</th>
                <th scope="col">{t('diagnostics.agentProcesses.columns.pid')}</th>
                <th scope="col">{t('diagnostics.agentProcesses.columns.cpu')}</th>
                <th scope="col">{t('diagnostics.agentProcesses.columns.ram')}</th>
                <th scope="col">{t('diagnostics.agentProcesses.columns.priority')}</th>
                <th scope="col">{t('diagnostics.agentProcesses.columns.state')}</th>
                <th scope="col">{t('diagnostics.agentProcesses.columns.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.managed.map(tree => {
                const isBusy = busyPid === tree.rootPid
                const isEco = tree.priority !== 'normal'
                return (
                  <tr key={tree.rootPid}>
                    <td>
                      <div className={styles.providerCell}>
                        <span className={styles.providerName}>{tree.provider}</span>
                        <span className={styles.metaText}>
                          {t(`diagnostics.agentProcesses.kinds.${tree.kind}`)}
                        </span>
                      </div>
                    </td>
                    <td className={styles.numCell}>
                      <div>{tree.rootPid}</div>
                      {tree.childCount > 0 ? (
                        <div className={styles.metaText}>
                          {t('diagnostics.agentProcesses.childrenCount', { count: tree.childCount })}
                        </div>
                      ) : null}
                    </td>
                    <td className={styles.numCell}>
                      {t('diagnostics.agentProcesses.units.percent', { value: tree.cpuPercent.toFixed(1) })}
                    </td>
                    <td className={styles.numCell}>{formatMemory(tree.memoryBytes, t)}</td>
                    <td>
                      <Badge intent={isEco ? 'success' : 'neutral'}>
                        {t(`diagnostics.agentProcesses.priorities.${tree.priority}`)}
                      </Badge>
                    </td>
                    <td>
                      <Badge intent={tree.state === 'active' ? 'info' : 'warning'}>
                        {t(`diagnostics.agentProcesses.states.${tree.state}`)}
                      </Badge>
                    </td>
                    <td>
                      <div className={styles.actionsCell}>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={isBusy}
                          onClick={() => void handleTogglePriority(tree)}
                        >
                          {isEco
                            ? t('diagnostics.agentProcesses.actions.normalPriority')
                            : t('diagnostics.agentProcesses.actions.ecoPriority')}
                        </Button>
                        {tree.state === 'idle' ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={isBusy}
                            onClick={() => void handleHibernate(tree)}
                          >
                            {t('diagnostics.agentProcesses.actions.hibernate')}
                          </Button>
                        ) : null}
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={isBusy}
                          onClick={() => handleStopClick(tree)}
                        >
                          {t('diagnostics.agentProcesses.actions.stop')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : null}

        <div className={styles.subHeader}>
          <h4 className={styles.subTitle}>{t('diagnostics.agentProcesses.externalTitle')}</h4>
          <span className={styles.subHint}>{t('diagnostics.agentProcesses.externalReadOnly')}</span>
        </div>

        {snapshot && snapshot.external.length === 0 ? (
          <EmptyState compact title={t('diagnostics.agentProcesses.externalEmpty')} />
        ) : snapshot ? (
          <table className={styles.table} data-testid="agent-processes-external-table">
            <thead>
              <tr>
                <th scope="col">{t('diagnostics.agentProcesses.columns.agent')}</th>
                <th scope="col">{t('diagnostics.agentProcesses.columns.pid')}</th>
                <th scope="col">{t('diagnostics.agentProcesses.columns.cpu')}</th>
                <th scope="col">{t('diagnostics.agentProcesses.columns.ram')}</th>
                <th scope="col">{t('diagnostics.agentProcesses.columns.ownership')}</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.external.map(proc => (
                <tr key={proc.pid}>
                  <td>
                    <div className={styles.providerCell}>
                      <span className={styles.providerName}>{proc.provider}</span>
                      <span className={styles.metaText}>{proc.name}</span>
                    </div>
                  </td>
                  <td className={styles.numCell}>{proc.pid}</td>
                  <td className={styles.numCell}>
                    {t('diagnostics.agentProcesses.units.percent', { value: proc.cpuPercent.toFixed(1) })}
                  </td>
                  <td className={styles.numCell}>{formatMemory(proc.memoryBytes, t)}</td>
                  <td>
                    <Badge intent="neutral">{t('diagnostics.agentProcesses.externalBadge')}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </SettingsSection>

      {confirmStopTree ? (
        <ConfirmDialog
          title={t('diagnostics.agentProcesses.confirmStop.title', { provider: confirmStopTree.provider })}
          description={t('diagnostics.agentProcesses.confirmStop.description', {
            pid: confirmStopTree.rootPid,
            children: confirmStopTree.childCount
          })}
          cancelLabel={t('diagnostics.agentProcesses.confirmStop.cancel')}
          confirmLabel={t('diagnostics.agentProcesses.confirmStop.confirm')}
          danger
          hideClose
          onCancel={() => setConfirmStopTree(null)}
          onConfirm={() => void runKillTree(confirmStopTree)}
        />
      ) : null}
    </div>
  )
}
