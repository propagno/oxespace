import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { branchNameFor } from '../../../shared/branch-name'
import { messageFromError } from '../../../shared/messages'
import type { ThreadBranchResult, ThreadTimeline, ThreadTimelineCheckpoint } from '../../../shared/types/thread'
import { useThreadStore } from '../../store/thread.store'
import { Button, IconButton } from '../../ui/Button'
import { EmptyState, Notice } from '../../ui/Display'
import { Checkbox, TextField } from '../../ui/Field'
import { Dialog } from '../../ui/Overlay'
import { useModalSurface } from '../../ui/useModalSurface'
import styles from './TimeTravelBar.module.css'

export interface TimeTravelBranchedResult {
  ok: true
  threadId: string
  workspaceId: string
  worktreePath: string
}

export interface TimeTravelBarProps {
  threadId: string
  title: string
  agent: string
  onBranched: (result: TimeTravelBranchedResult) => void
  onClose: () => void
}

type ThreadBranchRefusal = Extract<ThreadBranchResult, { ok: false }>['refusal'] | { code: string; params?: Record<string, unknown> }
type ThreadCantGoBack = ThreadTimeline['cantGoBack']

type CantGoBackBucket = 'dbWrites' | 'pushes' | 'containers' | 'commands' | 'httpWrites'

const BUCKET_ORDER: readonly CantGoBackBucket[] = ['dbWrites', 'pushes', 'containers', 'commands', 'httpWrites']

function formatCheckpointTime(timestamp: number, language: string): string {
  return new Intl.DateTimeFormat(language, { hour: 'numeric', minute: '2-digit' })
    .format(new Date(timestamp))
    .replace(/\u202f/g, ' ')
}

function formatProviderName(raw: unknown, fallbackAgent: string): string {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text) return fallbackAgent
  if (text.toLowerCase() === 'codex') return 'Codex'
  if (text.toLowerCase() === 'claude') return 'Claude'
  return text
}

function formatBranchRefusal(
  refusal: ThreadBranchRefusal,
  agent: string,
  t: TFunction<'thread'>
): string {
  const params = (refusal.params ?? {}) as Record<string, unknown>
  switch (refusal.code) {
    case 'thread.branch.pathExists':
      return t('timeTravel.refusal.pathExists', { path: String(params.path ?? '') })
    case 'thread.branch.exists':
      return t('timeTravel.refusal.exists')
    case 'thread.branch.unsafeName':
      return t('timeTravel.refusal.unsafeName')
    case 'thread.branch.baseGone':
      return t('timeTravel.refusal.baseGone')
    case 'thread.branch.notGit':
      return t('timeTravel.refusal.notGit')
    case 'thread.branch.sessionGone':
      return t('timeTravel.refusal.sessionGone', { agent })
    case 'thread.branch.checkpointGone':
      return t('timeTravel.refusal.checkpointGone')
    case 'thread.branch.checkpointFailed':
      return t('timeTravel.refusal.checkpointFailed')
    case 'thread.branch.unsupported':
      return t('timeTravel.branchUnsupported', { agent: formatProviderName(params.provider, agent) })
    case 'thread.branch.failed': {
      const step = String(params.step ?? '')
      if (step === 'restore') return t('timeTravel.refusal.failedRestore')
      if (step === 'register') return t('timeTravel.refusal.failedRegister')
      if (step === 'fork') return t('timeTravel.refusal.failedFork', { agent })
      return t('timeTravel.refusal.failedConversation')
    }
    default:
      return t('timeTravel.refusal.failedConversation')
  }
}

function buildCantGoBack(
  cantGoBack: ThreadCantGoBack,
  t: TFunction<'thread'>
): { text: string; tooltip?: string } {
  const nonZero = BUCKET_ORDER
    .map(bucket => ({ bucket, count: Number(cantGoBack[bucket] ?? 0) }))
    .filter(item => item.count > 0)
    .sort((a, b) => b.count - a.count)

  if (nonZero.length === 0) {
    return { text: t('timeTravel.cantGoBackNone') }
  }
  const labels = nonZero.map(item => t(`timeTravel.cantGoBackKind.${item.bucket}`, { count: item.count }))
  if (labels.length <= 3) {
    return { text: t('timeTravel.cantGoBackList', { items: labels.join(', ') }) }
  }
  return {
    text: t('timeTravel.cantGoBackMore', { items: labels.slice(0, 3).join(', ') }),
    tooltip: labels.join(', ')
  }
}

export function TimeTravelBar({ threadId, title, agent, onBranched, onClose }: TimeTravelBarProps) {
  const { t, i18n } = useTranslation('thread')
  const [timeline, setTimeline] = useState<ThreadTimeline | null>(null)
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [restoreDialog, setRestoreDialog] = useState<{ cp: ThreadTimelineCheckpoint; restoreFiles: boolean } | null>(null)
  const [foreignDialog, setForeignDialog] = useState<{ cp: ThreadTimelineCheckpoint; restoreFiles: boolean; count: number; files: string[] } | null>(null)
  const [branchDialog, setBranchDialog] = useState<{ cp: ThreadTimelineCheckpoint; name: string; refusal: ThreadBranchRefusal | null } | null>(null)

  const branchInputRef = useRef<HTMLInputElement>(null)
  const foreignCancelRef = useRef<HTMLButtonElement>(null)
  const foreignTitleId = useId()
  const foreignModal = useModalSurface<HTMLDivElement>(() => { if (!busy) setForeignDialog(null) }, Boolean(foreignDialog))

  const loadTimeline = useCallback(async (resetToLatest: boolean) => {
    const data = await window.oxe?.thread?.timeline?.(threadId)
    if (!data) return
    setTimeline(data)
    if (resetToLatest) {
      setStep(Math.max(0, 2 * (data.checkpoints.length - 1)))
    } else {
      setStep(prev => Math.min(prev, Math.max(0, 2 * (data.checkpoints.length - 1))))
    }
  }, [threadId])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const data = await window.oxe?.thread?.timeline?.(threadId)
      if (cancelled || !data) return
      setTimeline(data)
      setStep(Math.max(0, 2 * (data.checkpoints.length - 1)))
    })()
    return () => { cancelled = true }
  }, [threadId])

  const restoreOpen = Boolean(restoreDialog)
  useLayoutEffect(() => {
    if (!restoreOpen) return
    const cancel = [...document.querySelectorAll<HTMLElement>('[role="dialog"] [data-dialog-cancel]')].at(-1)
    cancel?.focus({ preventScroll: true })
  }, [restoreOpen])

  const foreignOpen = Boolean(foreignDialog)
  useLayoutEffect(() => {
    if (!foreignOpen) return
    foreignCancelRef.current?.focus({ preventScroll: true })
  }, [foreignOpen])

  const branchRefusal = branchDialog?.refusal
  useLayoutEffect(() => {
    if (!branchRefusal) return
    if (branchRefusal.code === 'thread.branch.pathExists' || branchRefusal.code === 'thread.branch.exists' || branchRefusal.code === 'thread.branch.unsafeName') {
      branchInputRef.current?.focus({ preventScroll: true })
    }
  }, [branchRefusal])

  if (!timeline) {
    return <section className={styles.bar} aria-label={t('timeTravel.region')} />
  }

  const { checkpoints, cantGoBack, canBranch } = timeline
  const cantGoBackNote = buildCantGoBack(cantGoBack, t)

  if (checkpoints.length === 0) {
    return (
      <section className={styles.bar} aria-label={t('timeTravel.region')}>
        <div className={styles.header}>
          <EmptyState compact title={t('timeTravel.noCheckpoints')} />
          <IconButton size="sm" label={t('timeTravel.close')} icon={<X size={14} />} onClick={onClose} />
        </div>
        <p role="note" className={styles.cantGoBack} title={cantGoBackNote.tooltip}>{cantGoBackNote.text}</p>
      </section>
    )
  }

  const maxStep = Math.max(0, 2 * checkpoints.length - 2)
  const clampedStep = Math.min(step, maxStep)
  const isBetween = clampedStep % 2 === 1
  const currentCheckpoint = isBetween ? null : checkpoints[clampedStep / 2] ?? null
  const laterStartIndex = isBetween ? Math.ceil(clampedStep / 2) : clampedStep / 2 + 1
  const laterCheckpoints = checkpoints.slice(laterStartIndex)

  const statusText = isBetween
    ? t('timeTravel.betweenCheckpoints')
    : currentCheckpoint?.failed
      ? t('timeTravel.checkpointFailed')
      : currentCheckpoint
        ? t('timeTravel.filesAt', { count: currentCheckpoint.files.length, time: formatCheckpointTime(currentCheckpoint.at, i18n.language) })
        : ''

  const unsupportedAgent = formatProviderName(timeline.branchRefusal?.params?.provider, agent)
  const unsupportedText = !canBranch ? t('timeTravel.branchUnsupported', { agent: unsupportedAgent }) : undefined

  const restoreDisabled = isBetween || Boolean(currentCheckpoint?.failed)
  const restoreReason = isBetween
    ? t('timeTravel.betweenCheckpoints')
    : currentCheckpoint?.failed
      ? t('timeTravel.checkpointFailed')
      : undefined

  const branchDisabled = !canBranch || isBetween || Boolean(currentCheckpoint?.failed)
  const branchReason = !canBranch
    ? unsupportedText
    : isBetween
      ? t('timeTravel.betweenCheckpoints')
      : currentCheckpoint?.failed
        ? t('timeTravel.checkpointFailed')
        : undefined

  const restoreLabel = currentCheckpoint
    ? t('timeTravel.restoreTo', { target: formatCheckpointTime(currentCheckpoint.at, i18n.language) })
    : t('timeTravel.restoreDisabledLabel')

  const onKnobKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    switch (event.key) {
      case 'Home':
        event.preventDefault()
        setStep(0)
        break
      case 'End':
        event.preventDefault()
        setStep(maxStep)
        break
      case 'ArrowLeft':
        event.preventDefault()
        setStep(cur => Math.max(0, Math.min(cur, maxStep) - 1))
        break
      case 'ArrowRight':
        event.preventDefault()
        setStep(cur => Math.min(maxStep, Math.min(cur, maxStep) + 1))
        break
      case '[':
        event.preventDefault()
        setStep(cur => {
          const s = Math.min(cur, maxStep)
          return s % 2 === 1 ? s - 1 : Math.max(0, s - 2)
        })
        break
      case ']':
        event.preventDefault()
        setStep(cur => {
          const s = Math.min(cur, maxStep)
          return s % 2 === 1 ? s + 1 : Math.min(maxStep, s + 2)
        })
        break
    }
  }

  const onTrackClick = (event: MouseEvent<HTMLDivElement>): void => {
    if (maxStep === 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width <= 0) return
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
    setStep(Math.round(ratio * maxStep))
  }

  const runRestore = async (): Promise<void> => {
    if (!restoreDialog || busy) return
    const { cp, restoreFiles } = restoreDialog
    setBusy(true)
    try {
      await window.oxe?.thread?.rewind?.(threadId, cp.turnId, { restoreFiles })
      setBusy(false)
      setRestoreDialog(null)
      void useThreadStore.getState().refresh(threadId).catch(() => undefined)
      void loadTimeline(false)
    } catch (error) {
      const msg = messageFromError(error)
      if (msg?.code === 'thread.restore.foreignChanges') {
        const params = (msg.params ?? {}) as { count?: number; files?: string[] }
        setBusy(false)
        setRestoreDialog(null)
        setForeignDialog({
          cp,
          restoreFiles,
          count: Number(params.count ?? params.files?.length ?? 1),
          files: Array.isArray(params.files) ? params.files : []
        })
        return
      }
      setBusy(false)
      setRestoreDialog(null)
    }
  }

  const confirmForeignRestore = async (): Promise<void> => {
    if (!foreignDialog || busy) return
    const { cp, restoreFiles } = foreignDialog
    setBusy(true)
    try {
      await window.oxe?.thread?.rewind?.(threadId, cp.turnId, { restoreFiles, confirmed: true })
      setBusy(false)
      setForeignDialog(null)
      void useThreadStore.getState().refresh(threadId).catch(() => undefined)
      void loadTimeline(false)
    } catch {
      setBusy(false)
      setForeignDialog(null)
    }
  }

  const submitBranch = async (): Promise<void> => {
    if (!branchDialog || busy) return
    const { cp, name } = branchDialog
    setBusy(true)
    try {
      const result = await window.oxe?.thread?.branchFromCheckpoint?.(threadId, cp.id, { branch: name })
      if (!result) {
        setBusy(false)
        return
      }
      if (result.ok) {
        setBusy(false)
        setBranchDialog(null)
        onBranched(result)
        return
      }
      setBusy(false)
      setBranchDialog(current => current ? { ...current, refusal: { ...result.refusal } } : null)
    } catch {
      setBusy(false)
      setBranchDialog(current => current ? { ...current, refusal: { code: 'thread.branch.failed', params: { step: 'conversation' } } } : null)
    }
  }

  return (
    <section className={styles.bar} aria-label={t('timeTravel.region')}>
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <span className={styles.status}>{statusText}</span>
          {currentCheckpoint && <span className={styles.checkpointLabel}>{currentCheckpoint.label}</span>}
        </div>
        <IconButton size="sm" label={t('timeTravel.close')} icon={<X size={14} />} onClick={onClose} />
      </div>

      <div className={styles.trackRow}>
        <div className={styles.track} data-track="" onClick={onTrackClick}>
          {checkpoints.map((cp, index) => (
            <span
              key={cp.id}
              className={styles.tick}
              data-failed={cp.failed ? '' : undefined}
              style={{ '--pos': maxStep > 0 ? `${(2 * index / maxStep) * 100}%` : '50%' } as CSSProperties}
              aria-hidden="true"
            />
          ))}
          <div
            role="slider"
            tabIndex={0}
            className={styles.knob}
            style={{ '--pos': maxStep > 0 ? `${(clampedStep / maxStep) * 100}%` : '50%' } as CSSProperties}
            aria-label={t('timeTravel.sliderLabel')}
            aria-valuemin={0}
            aria-valuemax={maxStep}
            aria-valuenow={clampedStep}
            aria-valuetext={statusText}
            onKeyDown={onKnobKeyDown}
          />
        </div>
      </div>

      {currentCheckpoint && !currentCheckpoint.failed && currentCheckpoint.files.length > 0 && (
        <ul className={styles.fileList}>
          {currentCheckpoint.files.map(file => (
            <li key={file} className={styles.fileChip}>{file}</li>
          ))}
        </ul>
      )}

      {laterCheckpoints.length > 0 && (
        <section role="region" className={styles.setAside} aria-label={t('timeTravel.setAside')}>
          <span className={styles.setAsideHeading}>{t('timeTravel.setAside')}</span>
          <ul className={styles.setAsideList}>
            {laterCheckpoints.map(cp => (
              <li key={cp.id}>{cp.label}</li>
            ))}
          </ul>
        </section>
      )}

      <p role="note" className={styles.cantGoBack} title={cantGoBackNote.tooltip}>
        {cantGoBackNote.text}
      </p>

      <div className={styles.actionsRow}>
        <Button
          size="sm"
          variant="secondary"
          disabled={restoreDisabled}
          title={restoreReason}
          aria-description={restoreReason}
          onClick={() => { if (currentCheckpoint) setRestoreDialog({ cp: currentCheckpoint, restoreFiles: true }) }}
        >
          {restoreLabel}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={branchDisabled}
          title={branchReason}
          aria-description={branchReason}
          onClick={() => {
            if (currentCheckpoint) {
              setBranchDialog({ cp: currentCheckpoint, name: branchNameFor(title, currentCheckpoint.at), refusal: null })
            }
          }}
        >
          {t('timeTravel.branchButton')}
        </Button>
        {unsupportedText && <span className={styles.unsupportedNote}>{unsupportedText}</span>}
      </div>

      {restoreDialog && (
        <Dialog
          size="sm"
          title={t('timeTravel.restoreConfirmTitle', { time: formatCheckpointTime(restoreDialog.cp.at, i18n.language) })}
          onClose={() => { if (!busy) setRestoreDialog(null) }}
          actions={{
            cancel: {
              label: t('timeTravel.cancel'),
              focus: true,
              unavailable: busy,
              onClick: () => { if (!busy) setRestoreDialog(null) }
            },
            primary: {
              label: t('timeTravel.restoreAction'),
              loading: busy,
              onClick: () => void runRestore()
            }
          }}
        >
          <div className={styles.dialogStack}>
            <p className={styles.dialogText}>
              {t('timeTravel.restoreConfirmBody', { time: formatCheckpointTime(restoreDialog.cp.at, i18n.language) })}
            </p>
            <Checkbox
              label={t('timeTravel.alsoRestoreFiles')}
              checked={restoreDialog.restoreFiles}
              onChange={event => {
                const checked = event.currentTarget.checked
                setRestoreDialog(cur => cur ? { ...cur, restoreFiles: checked } : null)
              }}
            />
          </div>
        </Dialog>
      )}

      {foreignDialog && createPortal(
        <>
          <div className={styles.scrim} aria-hidden="true" onClick={() => { if (!busy) setForeignDialog(null) }} />
          <div
            {...foreignModal}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={foreignTitleId}
            className={styles.alertDialog}
          >
            <h2 id={foreignTitleId} className={styles.alertTitle}>
              {t('timeTravel.foreignTitle', { time: formatCheckpointTime(foreignDialog.cp.at, i18n.language) })}
            </h2>
            <p className={styles.alertBody}>
              {t('timeTravel.foreignBody', { count: foreignDialog.count })}
            </p>
            <ul className={styles.fileList}>
              {foreignDialog.files.map(file => (
                <li key={file} className={styles.fileChip}>{file}</li>
              ))}
            </ul>
            <div className={styles.alertFooter}>
              <Button ref={foreignCancelRef} autoFocus variant="secondary" onClick={() => { if (!busy) setForeignDialog(null) }}>
                {t('timeTravel.cancel')}
              </Button>
              <Button variant="danger" loading={busy} onClick={() => void confirmForeignRestore()}>
                {t('timeTravel.restoreOverThem')}
              </Button>
            </div>
          </div>
        </>,
        document.body
      )}

      {branchDialog && (
        <Dialog
          size="sm"
          title={t('timeTravel.branchTitle')}
          description={t('timeTravel.branchDescription', { agent })}
          onClose={() => { if (!busy) setBranchDialog(null) }}
          actions={{
            cancel: {
              label: t('timeTravel.cancel'),
              unavailable: busy,
              onClick: () => { if (!busy) setBranchDialog(null) }
            },
            primary: {
              label: branchDialog.refusal?.code === 'thread.branch.failed' ? t('timeTravel.tryAgain') : t('timeTravel.branchAction'),
              loading: busy,
              disabled: !branchDialog.name.trim(),
              onClick: () => void submitBranch()
            }
          }}
        >
          <div className={styles.dialogStack}>
            <TextField
              ref={branchInputRef}
              mono
              label={t('timeTravel.branchNameLabel')}
              value={branchDialog.name}
              onChange={event => {
                const value = event.currentTarget.value
                setBranchDialog(cur => cur ? { ...cur, name: value, refusal: cur.refusal?.code === 'thread.branch.failed' ? null : cur.refusal } : null)
              }}
            />
            {branchDialog.refusal && (
              <Notice intent="danger">
                {formatBranchRefusal(branchDialog.refusal, agent, t)}
              </Notice>
            )}
          </div>
        </Dialog>
      )}
    </section>
  )
}
