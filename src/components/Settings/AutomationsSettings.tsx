import { Play, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactElement } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { RichText } from '../../i18n/RichText'
import type {
  Automation,
  AutomationAgent,
  AutomationRun,
  AutomationRunStatus,
  AutomationSchedule
} from '../../../shared/types/automation'
import { useWorkspaceStore } from '../../store/workspace.store'
import { Button, TextField, Select, TextArea } from '../../ui'
import { humanizeError } from '../../utils/humanizeError'
import { formatDateTime } from '../../utils/formatTime'

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6]
/** A weekday's short name in the interface language; 4 January 2026 was a Sunday. */
const dayName = (day: number): string => formatDateTime(new Date(2026, 0, 4 + day), { weekday: 'short' })
const PRECHECK_EXAMPLE = 'git diff --quiet origin/main || exit 0'
const EXTRA_ARGS_EXAMPLE = '--permission-mode acceptEdits'

function describeSchedule(s: AutomationSchedule, t: TFunction<'settings'>): string {
  const time = (h: number, m: number): string => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  switch (s.kind) {
    case 'interval': return t('automations.schedule.interval', { minutes: s.everyMinutes })
    case 'daily': return t('automations.schedule.daily', { time: time(s.hour, s.minute) })
    case 'weekly': return t('automations.schedule.weekly', { days: s.days.map(dayName).join(', '), time: time(s.hour, s.minute) })
    case 'cron': return t('automations.schedule.cron', { expression: s.expression })
  }
}

const statusLabel = (status: AutomationRunStatus, t: TFunction<'settings'>): string => t(`automations.status.${status}`)

type ScheduleKind = AutomationSchedule['kind']

export function AutomationsSettings(): ReactElement | null {
  const { t } = useTranslation('settings')
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const [items, setItems] = useState<Automation[] | null>(null)
  const [runs, setRuns] = useState<Record<string, AutomationRun | undefined>>({})
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [rootPath, setRootPath] = useState('')
  const [agent, setAgent] = useState<AutomationAgent>('claude')
  const [prompt, setPrompt] = useState('')
  const [kind, setKind] = useState<ScheduleKind>('daily')
  const [every, setEvery] = useState(60)
  const [time, setTime] = useState('09:00')
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5])
  const [cron, setCron] = useState('0 9 * * 1-5')
  const [precheck, setPrecheck] = useState('')
  const [extraArgs, setExtraArgs] = useState('')

  const api = window.oxe?.automations

  const load = useCallback(async (): Promise<void> => {
    if (!api) return
    try {
      const list = await api.list()
      setItems(list)
      const latest = await Promise.all(list.map(async (a) => [a.id, (await api.runs(a.id))[0]] as const))
      setRuns(Object.fromEntries(latest))
    } catch (err) {
      setError(humanizeError(err))
    }
  }, [api])

  useEffect(() => {
    void load()
    return api?.onChange(() => void load())
  }, [api, load])

  if (!api || items === null) return null

  const buildSchedule = (): AutomationSchedule => {
    const [h, m] = time.split(':').map(Number)
    if (kind === 'interval') return { kind, everyMinutes: every }
    if (kind === 'daily') return { kind, hour: h, minute: m }
    if (kind === 'weekly') return { kind, days, hour: h, minute: m }
    return { kind, expression: cron }
  }

  const submit = async (): Promise<void> => {
    setError(null)
    try {
      await api.create({
        name,
        prompt,
        rootPath,
        agent,
        schedule: buildSchedule(),
        precheck: precheck || null,
        extraArgs
      })
      setCreating(false)
      setName('')
      setPrompt('')
      await load()
    } catch (err) {
      setError(humanizeError(err))
    }
  }

  const guard = async (action: () => Promise<unknown>): Promise<void> => {
    setError(null)
    try {
      await action()
      await load()
    } catch (err) {
      setError(humanizeError(err))
    }
  }

  return (
    <div className="settings-form-group">
      <h3 className="settings-form-group-title">{t('automations.title')}</h3>
      <div className="settings-callout"><RichText text={t('automations.callout')} /></div>

      {items.length === 0 ? <p className="settings-field-hint">{t('automations.empty')}</p> : null}
      {items.map((a) => {
        const last = runs[a.id]
        return (
          <div className="settings-toggle-row" key={a.id}>
            <span>
              <strong>{a.name}</strong>
              <small>
                {a.agent === 'codex' ? 'Codex' : 'Claude'} · {describeSchedule(a.schedule, t)}
                {a.nextRunAt && a.enabled ? ` · ${t('automations.next', { time: formatDateTime(a.nextRunAt) })}` : ''}
                <br />
                {last ? `${t('automations.last', { status: statusLabel(last.status, t) })}${last.message ? ` — ${last.message}` : ''}` : t('automations.neverRan')}
                {last?.branch ? ` (${last.branch})` : ''}
              </small>
            </span>
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <Button variant="ghost" title={t('automations.runNow')} aria-label={t('automations.runNamed', { name: a.name })}
                onClick={() => void guard(() => api.runNow(a.id))}><Play size={12} aria-hidden="true" /></Button>
              <Button variant="ghost" title={a.enabled ? t('automations.disable') : t('automations.enable')}
                onClick={() => void guard(() => api.setEnabled({ id: a.id, enabled: !a.enabled }))}>
                {a.enabled ? t('automations.active') : t('automations.paused')}
              </Button>
              <Button variant="ghost" title={t('automations.delete')} aria-label={t('automations.deleteNamed', { name: a.name })}
                onClick={() => void guard(() => api.remove(a.id))}><Trash2 size={12} aria-hidden="true" /></Button>
            </span>
          </div>
        )
      })}

      {error ? <p className="settings-field-hint" role="alert">{error}</p> : null}

      {creating ? (
        <div className="settings-form-group">
          <label className="settings-field">{t('automations.form.name')}
            <TextField value={name} onChange={(e) => setName(e.target.value)} placeholder={t('automations.form.namePlaceholder')} />
          </label>
          <label className="settings-field">{t('automations.form.repository')}
            <Select value={rootPath} onChange={(e) => setRootPath(e.target.value)}>
              <option value="">{t('automations.form.select')}</option>
              {workspaces.map((w) => <option key={w.id} value={w.rootPath}>{w.name} — {w.rootPath}</option>)}
            </Select>
          </label>
          <label className="settings-field">{t('automations.form.agent')}
            <Select value={agent} onChange={(e) => setAgent(e.target.value as AutomationAgent)}>
              <option value="claude">Claude Code</option>
              <option value="codex">Codex</option>
            </Select>
          </label>
          <label className="settings-field">{t('automations.form.prompt')}
            <TextArea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          </label>
          <label className="settings-field">{t('automations.form.frequency')}
            <Select value={kind} onChange={(e) => setKind(e.target.value as ScheduleKind)}>
              {(['interval', 'daily', 'weekly', 'cron'] as const).map(value => <option key={value} value={value}>{t(`automations.form.${value}`)}</option>)}
            </Select>
          </label>
          {kind === 'interval' ? (
            <label className="settings-field">{t('automations.form.minutes')}
              <TextField type="number" min={5} value={every} onChange={(e) => setEvery(Number(e.target.value))} />
            </label>
          ) : null}
          {kind === 'daily' || kind === 'weekly' ? (
            <label className="settings-field">{t('automations.form.time')}
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </label>
          ) : null}
          {kind === 'weekly' ? (
            <div className="settings-field" role="group" aria-label={t('automations.form.days')}>
              {WEEKDAYS.map((day) => (
                <label key={day} style={{ marginRight: 8 }}>
                  <input type="checkbox" checked={days.includes(day)}
                    onChange={(e) => setDays((cur) => e.target.checked ? [...cur, day] : cur.filter((d) => d !== day))} /> {dayName(day)}
                </label>
              ))}
            </div>
          ) : null}
          {kind === 'cron' ? (
            <label className="settings-field">{t('automations.form.expression')}
              <TextField value={cron} onChange={(e) => setCron(e.target.value)} />
            </label>
          ) : null}
          <label className="settings-field">{t('automations.form.precheck')}
            <TextField value={precheck} onChange={(e) => setPrecheck(e.target.value)} placeholder={PRECHECK_EXAMPLE} />
            <span className="settings-field-hint">{t('automations.form.precheckHint')}</span>
          </label>
          <label className="settings-field">{t('automations.form.extraArgs')}
            <TextField value={extraArgs} onChange={(e) => setExtraArgs(e.target.value)} placeholder={EXTRA_ARGS_EXAMPLE} />
            <span className="settings-field-hint">{t('automations.form.extraArgsHint')}</span>
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" onClick={() => void submit()}>{t('automations.form.create')}</Button>
            <Button variant="ghost" onClick={() => setCreating(false)}>{t('automations.form.cancel')}</Button>
          </div>
        </div>
      ) : (
        <Button variant="ghost" onClick={() => setCreating(true)}>
          <Plus size={14} aria-hidden="true" /> {t('automations.new')}
        </Button>
      )}
    </div>
  )
}
