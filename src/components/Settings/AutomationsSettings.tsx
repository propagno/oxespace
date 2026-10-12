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

const STATUS_LABEL: Record<AutomationRunStatus, string> = {
  pending: 'na fila',
  running: 'executando',
  completed: 'concluída',
  failed: 'falhou',
  dispatch_failed: 'falha ao criar worktree',
  skipped_precheck: 'ignorada (verificação prévia)',
  skipped_missed: 'ignorada (horário perdido)',
  skipped_busy: 'ignorada (execução anterior ativa)'
}

const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

function describeSchedule(s: AutomationSchedule): string {
  const time = (h: number, m: number): string => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  switch (s.kind) {
    case 'interval': return `a cada ${s.everyMinutes} min`
    case 'daily': return `todo dia às ${time(s.hour, s.minute)}`
    case 'weekly': return `${s.days.map((d) => DAYS[d]).join(', ')} às ${time(s.hour, s.minute)}`
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
      setError(err instanceof Error ? err.message : String(err))
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
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const guard = async (action: () => Promise<unknown>): Promise<void> => {
    setError(null)
    try {
      await action()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="settings-form-group">
      <h3 className="settings-form-group-title">Automações agendadas</h3>
      <div className="settings-callout">
        Executa um agente com um prompt em um <strong>worktree novo</strong> no horário escolhido, sem terminal aberto. O app
        precisa estar rodando; horários perdidos são ignorados, não executados depois.
      </div>

      {items.length === 0 ? <p className="settings-field-hint">Nenhuma automação criada.</p> : null}
      {items.map((a) => {
        const last = runs[a.id]
        return (
          <div className="settings-toggle-row" key={a.id}>
            <span>
              <strong>{a.name}</strong>
              <small>
                {a.agent === 'codex' ? 'Codex' : 'Claude'} · {describeSchedule(a.schedule)}
                {a.nextRunAt && a.enabled ? ` · próxima: ${new Date(a.nextRunAt).toLocaleString()}` : ''}
                <br />
                {last ? `Última: ${STATUS_LABEL[last.status]}${last.message ? ` — ${last.message}` : ''}` : 'Ainda não executou.'}
                {last?.branch ? ` (${last.branch})` : ''}
              </small>
            </span>
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button type="button" className="settings-btn ghost" title="Executar agora" aria-label={`Executar ${a.name} agora`}
                onClick={() => void guard(() => api.runNow(a.id))}><Play size={12} aria-hidden="true" /></button>
              <button type="button" className="settings-btn ghost" title={a.enabled ? 'Desativar' : 'Ativar'}
                onClick={() => void guard(() => api.setEnabled({ id: a.id, enabled: !a.enabled }))}>
                {a.enabled ? 'Ativa' : 'Pausada'}
              </button>
              <button type="button" className="settings-btn ghost" title="Excluir" aria-label={`Excluir ${a.name}`}
                onClick={() => void guard(() => api.remove(a.id))}><Trash2 size={12} aria-hidden="true" /></button>
            </span>
          </div>
        )
      })}

      {error ? <p className="settings-field-hint" role="alert">{error}</p> : null}

      {creating ? (
        <div className="settings-form-group">
          <label className="settings-field">Nome
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Revisão noturna" />
          </label>
          <label className="settings-field">Repositório
            <select value={rootPath} onChange={(e) => setRootPath(e.target.value)}>
              <option value="">Selecione…</option>
              {workspaces.map((w) => <option key={w.id} value={w.rootPath}>{w.name} — {w.rootPath}</option>)}
            </select>
          </label>
          <label className="settings-field">Agente
            <select value={agent} onChange={(e) => setAgent(e.target.value as AutomationAgent)}>
              <option value="claude">Claude Code</option>
              <option value="codex">Codex</option>
            </select>
          </label>
          <label className="settings-field">Prompt
            <textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          </label>
          <label className="settings-field">Frequência
            <select value={kind} onChange={(e) => setKind(e.target.value as ScheduleKind)}>
              <option value="interval">A cada N minutos</option>
              <option value="daily">Diária</option>
              <option value="weekly">Semanal</option>
              <option value="cron">Cron</option>
            </select>
          </label>
          {kind === 'interval' ? (
            <label className="settings-field">Minutos (mín. 5)
              <input type="number" min={5} value={every} onChange={(e) => setEvery(Number(e.target.value))} />
            </label>
          ) : null}
          {kind === 'daily' || kind === 'weekly' ? (
            <label className="settings-field">Horário
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </label>
          ) : null}
          {kind === 'weekly' ? (
            <div className="settings-field" role="group" aria-label="Dias da semana">
              {DAYS.map((label, day) => (
                <label key={label} style={{ marginRight: 8 }}>
                  <input type="checkbox" checked={days.includes(day)}
                    onChange={(e) => setDays((cur) => e.target.checked ? [...cur, day] : cur.filter((d) => d !== day))} /> {label}
                </label>
              ))}
            </div>
          ) : null}
          {kind === 'cron' ? (
            <label className="settings-field">Expressão (min hora dia mês dia-semana)
              <input value={cron} onChange={(e) => setCron(e.target.value)} />
            </label>
          ) : null}
          <label className="settings-field">Verificação prévia (opcional)
            <input value={precheck} onChange={(e) => setPrecheck(e.target.value)} placeholder="git diff --quiet origin/main || exit 0" />
            <span className="settings-field-hint">Comando executado na raiz do repositório; a execução só segue se sair com código 0.</span>
          </label>
          <label className="settings-field">Argumentos extras do agente (opcional)
            <input value={extraArgs} onChange={(e) => setExtraArgs(e.target.value)} placeholder="--permission-mode acceptEdits" />
            <span className="settings-field-hint">Sem aprovação interativa, o agente só usa o que estes argumentos permitirem.</span>
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="settings-btn" onClick={() => void submit()}>Criar automação</button>
            <button type="button" className="settings-btn ghost" onClick={() => setCreating(false)}>Cancelar</button>
          </div>
        </div>
      ) : (
        <button type="button" className="settings-btn ghost" onClick={() => setCreating(true)}>
          <Plus size={13} aria-hidden="true" /> Nova automação
        </button>
      )}
    </div>
  )
}
