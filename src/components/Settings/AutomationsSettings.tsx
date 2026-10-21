import { Play, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactElement } from 'react'
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

const STATUS_LABEL: Record<AutomationRunStatus, string> = {
  pending: 'queued',
  running: 'running',
  completed: 'completed',
  failed: 'failed',
  dispatch_failed: 'could not create the worktree',
  skipped_precheck: 'skipped (pre-check)',
  skipped_missed: 'skipped (missed time)',
  skipped_busy: 'skipped (previous run still active)'
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function describeSchedule(s: AutomationSchedule): string {
  const time = (h: number, m: number): string => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  switch (s.kind) {
    case 'interval': return `every ${s.everyMinutes} min`
    case 'daily': return `every day at ${time(s.hour, s.minute)}`
    case 'weekly': return `${s.days.map((d) => DAYS[d]).join(', ')} at ${time(s.hour, s.minute)}`
    case 'cron': return `cron ${s.expression}`
  }
}

type ScheduleKind = AutomationSchedule['kind']

export function AutomationsSettings(): ReactElement | null {
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
      <h3 className="settings-form-group-title">Scheduled automations</h3>
      <div className="settings-callout">
        Runs an agent with a prompt in a <strong>new worktree</strong> at the chosen time, with no terminal open. The app
        must be running; missed times are skipped, not run later.
      </div>

      {items.length === 0 ? <p className="settings-field-hint">No automations yet.</p> : null}
      {items.map((a) => {
        const last = runs[a.id]
        return (
          <div className="settings-toggle-row" key={a.id}>
            <span>
              <strong>{a.name}</strong>
              <small>
                {a.agent === 'codex' ? 'Codex' : 'Claude'} · {describeSchedule(a.schedule)}
                {a.nextRunAt && a.enabled ? ` · next: ${new Date(a.nextRunAt).toLocaleString()}` : ''}
                <br />
                {last ? `Last: ${STATUS_LABEL[last.status]}${last.message ? ` — ${last.message}` : ''}` : 'Has not run yet.'}
                {last?.branch ? ` (${last.branch})` : ''}
              </small>
            </span>
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <Button variant="ghost" title="Run now" aria-label={`Run ${a.name} now`}
                onClick={() => void guard(() => api.runNow(a.id))}><Play size={12} aria-hidden="true" /></Button>
              <Button variant="ghost" title={a.enabled ? 'Disable' : 'Enable'}
                onClick={() => void guard(() => api.setEnabled({ id: a.id, enabled: !a.enabled }))}>
                {a.enabled ? 'Active' : 'Paused'}
              </Button>
              <Button variant="ghost" title="Delete" aria-label={`Delete ${a.name}`}
                onClick={() => void guard(() => api.remove(a.id))}><Trash2 size={12} aria-hidden="true" /></Button>
            </span>
          </div>
        )
      })}

      {error ? <p className="settings-field-hint" role="alert">{error}</p> : null}

      {creating ? (
        <div className="settings-form-group">
          <label className="settings-field">Name
            <TextField value={name} onChange={(e) => setName(e.target.value)} placeholder="Nightly review" />
          </label>
          <label className="settings-field">Repository
            <Select value={rootPath} onChange={(e) => setRootPath(e.target.value)}>
              <option value="">Select…</option>
              {workspaces.map((w) => <option key={w.id} value={w.rootPath}>{w.name} — {w.rootPath}</option>)}
            </Select>
          </label>
          <label className="settings-field">Agent
            <Select value={agent} onChange={(e) => setAgent(e.target.value as AutomationAgent)}>
              <option value="claude">Claude Code</option>
              <option value="codex">Codex</option>
            </Select>
          </label>
          <label className="settings-field">Prompt
            <TextArea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          </label>
          <label className="settings-field">Frequency
            <Select value={kind} onChange={(e) => setKind(e.target.value as ScheduleKind)}>
              <option value="interval">Every N minutes</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="cron">Cron</option>
            </Select>
          </label>
          {kind === 'interval' ? (
            <label className="settings-field">Minutes (min. 5)
              <TextField type="number" min={5} value={every} onChange={(e) => setEvery(Number(e.target.value))} />
            </label>
          ) : null}
          {kind === 'daily' || kind === 'weekly' ? (
            <label className="settings-field">Time
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </label>
          ) : null}
          {kind === 'weekly' ? (
            <div className="settings-field" role="group" aria-label="Days of the week">
              {DAYS.map((label, day) => (
                <label key={label} style={{ marginRight: 8 }}>
                  <input type="checkbox" checked={days.includes(day)}
                    onChange={(e) => setDays((cur) => e.target.checked ? [...cur, day] : cur.filter((d) => d !== day))} /> {label}
                </label>
              ))}
            </div>
          ) : null}
          {kind === 'cron' ? (
            <label className="settings-field">Expression (minute hour day month weekday)
              <TextField value={cron} onChange={(e) => setCron(e.target.value)} />
            </label>
          ) : null}
          <label className="settings-field">Pre-check (optional)
            <TextField value={precheck} onChange={(e) => setPrecheck(e.target.value)} placeholder="git diff --quiet origin/main || exit 0" />
            <span className="settings-field-hint">Command run at the repository root; the run only continues if it exits with code 0.</span>
          </label>
          <label className="settings-field">Extra agent arguments (optional)
            <TextField value={extraArgs} onChange={(e) => setExtraArgs(e.target.value)} placeholder="--permission-mode acceptEdits" />
            <span className="settings-field-hint">There is no interactive approval, so the agent only uses what these arguments allow.</span>
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" onClick={() => void submit()}>Create automation</Button>
            <Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <Button variant="ghost" onClick={() => setCreating(true)}>
          <Plus size={14} aria-hidden="true" /> New automation
        </Button>
      )}
    </div>
  )
}
