import { ipcMain } from 'electron'
import type { AutomationInput, AutomationSchedule } from '../../../shared/types/automation'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { AutomationService } from '../services/automations/service'

function expectString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`)
  return value
}

function expectSchedule(value: unknown): AutomationSchedule {
  if (!value || typeof value !== 'object') throw new Error('schedule is required')
  const s = value as Record<string, unknown>
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : NaN)
  switch (s.kind) {
    case 'interval': return { kind: 'interval', everyMinutes: num(s.everyMinutes) }
    case 'daily': return { kind: 'daily', hour: num(s.hour), minute: num(s.minute) }
    case 'weekly': {
      if (!Array.isArray(s.days)) throw new Error('days is required')
      return { kind: 'weekly', days: s.days.map(num), hour: num(s.hour), minute: num(s.minute) }
    }
    case 'cron': return { kind: 'cron', expression: expectString(s.expression, 'expression') }
    default: throw new Error('invalid schedule kind')
  }
}

export function parseAutomationInput(value: unknown): AutomationInput {
  if (!value || typeof value !== 'object') throw new Error('Invalid automation input')
  const i = value as Record<string, unknown>
  if (i.agent !== 'claude' && i.agent !== 'codex') throw new Error('agent must be "claude" or "codex"')
  const optional = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const optionalInt = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : undefined)
  return {
    name: expectString(i.name, 'name').trim(),
    prompt: expectString(i.prompt, 'prompt'),
    rootPath: expectString(i.rootPath, 'rootPath'),
    agent: i.agent,
    baseBranch: optional(i.baseBranch),
    schedule: expectSchedule(i.schedule),
    precheck: optional(i.precheck),
    extraArgs: typeof i.extraArgs === 'string' ? i.extraArgs.trim().slice(0, 500) : '',
    timeoutMinutes: optionalInt(i.timeoutMinutes),
    graceMinutes: optionalInt(i.graceMinutes),
    enabled: i.enabled !== false
  }
}

export function registerAutomationsIpc(service: AutomationService): void {
  ipcMain.handle(IPC_CHANNELS.automations.list, () => service.list())
  ipcMain.handle(IPC_CHANNELS.automations.create, (_event, input: unknown) => service.create(parseAutomationInput(input)))
  ipcMain.handle(IPC_CHANNELS.automations.setEnabled, (_event, input: unknown) => {
    const { id, enabled } = (input ?? {}) as { id?: unknown; enabled?: unknown }
    return service.setEnabled(expectString(id, 'id'), enabled === true)
  })
  ipcMain.handle(IPC_CHANNELS.automations.remove, (_event, id: unknown) => service.remove(expectString(id, 'id')))
  ipcMain.handle(IPC_CHANNELS.automations.runNow, (_event, id: unknown) => service.runNow(expectString(id, 'id')))
  ipcMain.handle(IPC_CHANNELS.automations.runs, (_event, id: unknown) => service.runs(expectString(id, 'id')))
}
