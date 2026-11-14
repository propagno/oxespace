import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { CalendarClock, Pencil, Play, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Schedule, ScheduleRule, ScheduleRun, SchedulesState } from '../../../shared/schedule'
import { threadAgentName, THREAD_PROVIDERS } from '../../../shared/threadProviders'
import type { ThreadProvider } from '../../../shared/types/thread'
import { useThreadStore } from '../../store/thread.store'
import { Button, IconButton } from '../../ui/Button'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { Badge, EmptyState, Notice } from '../../ui/Display'
import { Checkbox, Select, Switch, TextArea, TextField } from '../../ui/Field'
import { Dialog } from '../../ui/Overlay'
import { toast } from '../../ui/Toast'
import { formatDateTime } from '../../utils/formatTime'
import { EVERY_DAY, formCheck, formOf, inputOf, newScheduleForm, type RuleKind, type ScheduleForm } from './scheduleForm'
import styles from './Schedules.module.css'

const WHEN: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
const WEEKDAYS = [1, 2, 3, 4, 5]
/** A rule's HH:MM as the dates beside it are written (09:00 AM or 09:00, by the system's habit). */
const clock = (time: string): string => { const [hours, minutes] = time.split(':').map(Number); return formatDateTime(new Date(2024, 0, 7, hours, minutes).getTime(), { hour: '2-digit', minute: '2-digit' }) }
/** 7 January 2024 is a Sunday: the days of the week in the order the rule numbers them. */
const dayName = (day: number, locale: string): string => new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(2024, 0, 7 + day))

function useRuleText(): (rule: ScheduleRule) => string {
  const { t, i18n } = useTranslation('thread')
  return useCallback((rule: ScheduleRule) => {
    if (rule.kind === 'once') return t('schedules.rule.once', { when: formatDateTime(rule.at, WHEN) })
    if (rule.kind === 'hours') return t('schedules.rule.hours', { count: rule.every })
    const days = [...rule.days].sort((a, b) => a - b)
    if (days.length === 7) return t('schedules.rule.everyDay', { time: clock(rule.time) })
    if (days.join() === WEEKDAYS.join()) return t('schedules.rule.weekdays', { time: clock(rule.time) })
    return t('schedules.rule.days', { days: days.map(day => dayName(day, i18n.language)).join(', '), time: clock(rule.time) })
  }, [t, i18n.language])
}

/** The person's schedules: what is set up, when each is next due, how its last run went, and the form to add or change one. */
export function SchedulesDialog({ onClose, onOpenThread }: { onClose: () => void; onOpenThread: (threadId: string) => void }): ReactElement {
  const { t, i18n } = useTranslation('thread')
  const ruleText = useRuleText()
  const projects = useThreadStore(state => state.projects)
  const openProjects = useMemo(() => projects.filter(project => !project.hidden && project.contexts.length > 0), [projects])
  const [state, setState] = useState<SchedulesState | null>(null)
  const [lastRuns, setLastRuns] = useState<Record<string, ScheduleRun | undefined>>({})
  const [form, setForm] = useState<ScheduleForm | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmWrite, setConfirmWrite] = useState(false)
  const [removing, setRemoving] = useState<Schedule | null>(null)
  const [history, setHistory] = useState<{ schedule: Schedule; runs: ScheduleRun[] } | null>(null)
  const [now, setNow] = useState(Date.now())

  const load = useCallback(async () => {
    const api = window.oxe?.schedules
    if (!api) return
    const next = await api.state()
    setState(next)
    const runs = await Promise.all(next.schedules.map(schedule => api.runs(schedule.id).then(list => [schedule.id, list[0]] as const, () => [schedule.id, undefined] as const)))
    setLastRuns(Object.fromEntries(runs))
  }, [])
  useEffect(() => {
    void load()
    void useThreadStore.getState().loadProjects()
    const off = window.oxe?.schedules?.onChanged(() => { void load() })
    const clock = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => { off?.(); window.clearInterval(clock) }
  }, [load])

  const projectName = (schedule: Schedule): string => projects.find(project => project.projectId === schedule.projectId)?.displayName ?? t('schedules.projectGone')
  const refusalText = (code: string): string => t(`schedules.refusal.${code}`, { defaultValue: t('schedules.refusal.other', { code }) })
  const outcomeText = (run: ScheduleRun): string => run.outcome === 'failed' && run.detail ? t('schedules.outcome.failedWith', { reason: run.detail }) : t(`schedules.outcome.${run.outcome}`)

  const check = form ? formCheck(form, now) : null
  const save = async (confirmedWrite: boolean): Promise<void> => {
    if (!form || !check || check.refusal) return
    // Changing files with no one watching: the person says yes each time such a schedule is saved.
    if (form.access === 'workspace-write' && !confirmedWrite) { setConfirmWrite(true); return }
    setSaving(true); setError(null)
    try {
      const answer = await window.oxe.schedules!.save(inputOf(form, Date.now(), confirmedWrite))
      if (answer.ok) { setForm(null); toast({ intent: 'success', title: t('schedules.saved', { name: answer.value.name }) }); await load() }
      else setError(refusalText(answer.refusal))
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setSaving(false); setConfirmWrite(false) }
  }
  const setEnabled = async (schedule: Schedule, enabled: boolean): Promise<void> => {
    const answer = await window.oxe.schedules!.setEnabled({ id: schedule.id, enabled })
    if (!answer.ok) toast({ intent: 'warning', title: refusalText(answer.refusal) })
    await load()
  }
  const runNow = async (schedule: Schedule): Promise<void> => {
    const answer = await window.oxe.schedules!.runNow(schedule.id)
    if (!answer.ok) toast({ intent: 'danger', title: refusalText(answer.refusal) })
    else if (answer.value.outcome !== 'started') toast({ intent: 'danger', title: t('schedules.runFailed', { name: schedule.name }), description: outcomeText(answer.value) })
    await load()
  }

  if (form) {
    const patch = (change: Partial<ScheduleForm>): void => { setForm({ ...form, ...change }); setError(null) }
    const project = openProjects.find(item => item.projectId === form.projectId)
    const toggleDay = (day: number): void => patch({ days: form.days.includes(day) ? form.days.filter(each => each !== day) : [...form.days, day].sort((a, b) => a - b) })
    const problem = check?.refusal && !['name', 'prompt'].includes(check.refusal) ? refusalText(check.refusal) : null
    return <Dialog size="lg" testId="schedule-form" title={form.id ? t('schedules.editTitle') : t('schedules.newTitle')} description={t('schedules.formDescription')} onClose={() => { if (!saving) setForm(null) }}
      actions={{ cancel: { label: t('schedules.back'), onClick: () => setForm(null), disabled: saving }, primary: { label: saving ? t('schedules.saving') : t('schedules.save'), disabled: saving || Boolean(check?.refusal), onClick: () => void save(false) } }}>
      <div className={styles.form}>
        <TextField label={t('schedules.name')} value={form.name} maxLength={80} placeholder={t('schedules.namePlaceholder')} onChange={event => patch({ name: event.target.value })} />
        <div className={styles.columns}>
          <Select label={t('schedules.project')} value={form.projectId} onChange={event => { const next = openProjects.find(item => item.projectId === event.target.value); patch({ projectId: event.target.value, rootPath: next?.contexts[0]?.rootPath ?? '' }) }}
            options={[...(project ? [] : [{ value: form.projectId, label: t('schedules.chooseProject'), disabled: true }]), ...openProjects.map(item => ({ value: item.projectId, label: item.displayName }))]} />
          <Select label={t('schedules.agent')} value={form.provider} onChange={event => patch({ provider: event.target.value as ThreadProvider })} options={THREAD_PROVIDERS.map(provider => ({ value: provider, label: threadAgentName(provider) }))} />
          <Select label={t('schedules.access')} value={form.access} aria-describedby="schedule-access-hint" onChange={event => patch({ access: event.target.value as Schedule['access'] })}
            options={[{ value: 'read-only', label: t('schedules.accessRead') }, { value: 'workspace-write', label: t('schedules.accessWrite') }]} />
          {/* Under the three fields, not under one: a hint in the last column alone left the row uneven. */}
          <p id="schedule-access-hint" className={styles.columnsHint}>{form.access === 'workspace-write' ? t('schedules.accessWriteHint') : t('schedules.accessReadHint')}</p>
        </div>
        {project && project.contexts.length > 1 && <Select label={t('schedules.folder')} value={form.rootPath} onChange={event => patch({ rootPath: event.target.value })} options={project.contexts.map(context => ({ value: context.rootPath, label: context.label || context.rootPath }))} />}
        <TextArea label={t('schedules.prompt')} rows={5} value={form.prompt} maxLength={8000} placeholder={t('schedules.promptPlaceholder')} onChange={event => patch({ prompt: event.target.value })} />
        <fieldset className={styles.when}>
          <legend>{t('schedules.when')}</legend>
          <div className={styles.kinds} role="radiogroup" aria-label={t('schedules.when')}>
            {(['daily', 'hours', 'once'] as RuleKind[]).map(kind => <Button key={kind} size="sm" variant="ghost" role="radio" aria-checked={form.kind === kind} className={form.kind === kind ? styles.kindOn : undefined} onClick={() => patch({ kind })}>{t(`schedules.kind.${kind}`)}</Button>)}
          </div>
          {form.kind === 'daily' && <div className={styles.rule}>
            <TextField label={t('schedules.time')} type="time" value={form.time} onChange={event => patch({ time: event.target.value })} />
            <div className={styles.days} role="group" aria-label={t('schedules.days')}>
              {EVERY_DAY.map(day => <Button key={day} size="sm" variant="ghost" aria-pressed={form.days.includes(day)} className={form.days.includes(day) ? styles.kindOn : undefined} onClick={() => toggleDay(day)}>{dayName(day, i18n.language)}</Button>)}
            </div>
          </div>}
          {form.kind === 'hours' && <div className={styles.rule}><TextField label={t('schedules.every')} type="number" min={1} max={24} step={1} value={form.every} hint={t('schedules.everyHint')} onChange={event => patch({ every: event.target.value })} /></div>}
          {form.kind === 'once' && <div className={styles.rule}><TextField label={t('schedules.onceAt')} type="datetime-local" value={form.onceAt} onChange={event => patch({ onceAt: event.target.value })} /></div>}
          <Checkbox label={t('schedules.catchUp')} checked={form.catchUp} onChange={event => patch({ catchUp: event.target.checked })} />
          <p className={styles.note}>{form.catchUp ? t('schedules.catchUpOn') : t('schedules.catchUpOff')}</p>
        </fieldset>
        {problem && <Notice intent="warning">{problem}</Notice>}
        {error && <Notice intent="danger">{error}</Notice>}
        {check?.firstRun != null && <p className={styles.preview} data-testid="schedule-preview">
          <CalendarClock size={14} aria-hidden="true" />
          {t('schedules.preview', { when: formatDateTime(check.firstRun, WHEN), agent: threadAgentName(form.provider), access: form.access === 'workspace-write' ? t('schedules.accessWrite') : t('schedules.accessRead'), project: project?.displayName ?? '' })}
        </p>}
      </div>
      {confirmWrite && <ConfirmDialog testId="schedule-confirm-write" title={t('schedules.confirmWriteTitle')} description={t('schedules.confirmWriteDetail', { name: form.name.trim(), agent: threadAgentName(form.provider), project: project?.displayName ?? '' })}
        confirmLabel={t('schedules.confirmWrite')} acknowledge={t('schedules.confirmWriteAck')} busy={saving} onConfirm={() => void save(true)} onCancel={() => setConfirmWrite(false)} />}
    </Dialog>
  }

  const schedules = state?.schedules ?? []
  return <Dialog size="lg" testId="schedules-dialog" title={t('schedules.title')} description={t('schedules.description')} onClose={onClose}>
    <div className={styles.toolbar}>
      <Switch label={t('schedules.pauseAll')} description={t('schedules.pauseAllHint')} checked={state?.paused ?? false} disabled={!state} onChange={paused => { void window.oxe.schedules!.setPaused(paused).then(load) }} />
      <Button variant="primary" size="sm" disabled={!openProjects.length} title={openProjects.length ? undefined : t('schedules.needProject')} onClick={() => { setError(null); setForm(newScheduleForm(openProjects[0] ? { projectId: openProjects[0].projectId, rootPath: openProjects[0].contexts[0].rootPath } : null, Date.now())) }}>{t('schedules.new')}</Button>
    </div>
    {state?.paused && <Notice intent="warning">{t('schedules.pausedNotice')}</Notice>}
    {state && schedules.length === 0 && <EmptyState icon={<CalendarClock size={20} />} title={t('schedules.emptyTitle')}>{openProjects.length ? t('schedules.emptyDetail') : t('schedules.needProject')}</EmptyState>}
    <ul className={styles.list} aria-label={t('schedules.title')}>
      {schedules.map(schedule => {
        const last = lastRuns[schedule.id]
        return <li key={schedule.id} className={styles.item} data-testid="schedule-row">
          <div className={styles.head}>
            <strong>{schedule.name}</strong>
            {schedule.pausedReason === 'failures' ? <Badge intent="danger">{t('schedules.stoppedAfterFailures')}</Badge> : !schedule.enabled ? <Badge>{schedule.rule.kind === 'once' && schedule.lastRunAt ? t('schedules.done') : t('schedules.off')}</Badge> : null}
            <span className={styles.spacer} />
            <Switch ariaLabel={t('schedules.enabledLabel', { name: schedule.name })} checked={schedule.enabled} onChange={enabled => void setEnabled(schedule, enabled)} />
            <IconButton size="sm" label={t('schedules.runNow', { name: schedule.name })} icon={<Play size={14} />} onClick={() => void runNow(schedule)} />
            <IconButton size="sm" label={t('schedules.edit', { name: schedule.name })} icon={<Pencil size={14} />} onClick={() => { setError(null); setForm(formOf(schedule, Date.now())) }} />
            <IconButton size="sm" label={t('schedules.remove', { name: schedule.name })} icon={<Trash2 size={14} />} onClick={() => setRemoving(schedule)} />
          </div>
          <p className={styles.meta}>{ruleText(schedule.rule)} · {threadAgentName(schedule.provider)} · {projectName(schedule)} · {schedule.access === 'workspace-write' ? t('schedules.accessWrite') : t('schedules.accessRead')}</p>
          <p className={styles.meta}>
            {schedule.enabled && schedule.nextRunAt ? t('schedules.next', { when: formatDateTime(schedule.nextRunAt, WHEN) }) : t('schedules.noNext')}
            {last && <> · {t('schedules.last', { when: formatDateTime(last.at, WHEN), outcome: outcomeText(last) })}</>}
            {last?.threadId && <> · <Button variant="link" size="sm" onClick={() => { onOpenThread(last.threadId!); onClose() }}>{t('schedules.openConversation')}</Button></>}
            {last && <> · <Button variant="link" size="sm" onClick={() => { void window.oxe.schedules!.runs(schedule.id).then(runs => setHistory({ schedule, runs })) }}>{t('schedules.history')}</Button></>}
          </p>
          {schedule.pausedReason === 'failures' && <Notice intent="danger">{t('schedules.stoppedDetail', { count: schedule.failures })}</Notice>}
        </li>
      })}
    </ul>
    <p className={styles.note}>{t('schedules.footnote')}</p>
    {removing && <ConfirmDialog danger title={t('schedules.removeTitle', { name: removing.name })} description={t('schedules.removeDetail')} confirmLabel={t('schedules.removeConfirm')}
      onConfirm={() => { const id = removing.id; setRemoving(null); void window.oxe.schedules!.remove(id).then(load) }} onCancel={() => setRemoving(null)} />}
    {history && <Dialog size="md" testId="schedule-history" title={t('schedules.historyTitle', { name: history.schedule.name })} onClose={() => setHistory(null)}>
      <ul className={styles.runs}>
        {history.runs.map(run => <li key={run.id}>
          <span>{formatDateTime(run.at, WHEN)}</span>
          <span>{outcomeText(run)}</span>
          {run.threadId ? <Button variant="link" size="sm" onClick={() => { onOpenThread(run.threadId!); setHistory(null); onClose() }}>{t('schedules.openConversation')}</Button> : <span />}
        </li>)}
      </ul>
    </Dialog>}
  </Dialog>
}
