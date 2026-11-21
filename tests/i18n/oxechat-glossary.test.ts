// Frozen acceptance test for 1.5.2 Polimento 2 (Jira OXE-270, PX-06·1, CA-1, CA-2 and CA-4; A5, A6, A8). Written by the
// planner; the executor must not edit it. Glossary §1, §5 and §7: one word per concept. Steering is "Orientar"
// (never "Direcionar"), retrying is "Tentar de novo" (never "Tentar novamente"), and a state label says "Concluído"
// while a sentence keeps its verb ("O turno terminou; …", "1 agente terminou"). The card's line numbers were of 17/11;
// on main f65fa5374 the keys are composerModel.steer / steerWithThis (thread.json), commandBar.fallback.steer
// (common.json), devices.scope.commands.threadSteer (settings.json), nowLine.actions.retry (thread.json) and
// messages.thread.steer.unavailable (main.json, "direcionada"). "redirecionam" (a shell redirect) is not steering.
// CA-4 is already true on main: this file pins it so it stays true.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const DIR = join(process.cwd(), 'shared/locales/pt-BR')
type Flat = Map<string, string>
function flatten(value: unknown, prefix = '', out: Flat = new Map()): Flat {
  if (typeof value === 'string') out.set(prefix, value)
  else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value as Record<string, unknown>)) flatten(child, prefix ? `${prefix}.${key}` : key, out)
  return out
}
const files = readdirSync(DIR).filter(name => name.endsWith('.json')).sort()
const pt = (file: string): Flat => flatten(JSON.parse(readFileSync(join(DIR, file), 'utf8')))
const everywhere = (pattern: RegExp): string[] => files.flatMap(file => [...pt(file)].filter(([, text]) => pattern.test(text)).map(([key, text]) => `${file} ${key}: "${text}"`))

describe('OXE-270 · PX-06·1 the OxeChat catalogs speak the glossary', () => {
  test('pt-BR catalogs use Orientar and never Direcion for steering', () => {
    const thread = pt('thread.json')
    expect(thread.get('composerModel.steer')).toBe('Oriente: o agente lê depois do passo atual')
    expect(thread.get('composerModel.steerWithThis')).toBe('Orientar com esta')
    expect(pt('common.json').get('commandBar.fallback.steer')).toBe('Orientar no OxeChat')
    expect(pt('settings.json').get('devices.scope.commands.threadSteer')).toBe('Orientar um turno em andamento')
    // "Direcionar", "Direcione", "direcionada"…: a word that starts with "direcion" (not "redirecionam", a shell redirect).
    expect(everywhere(/(?<![\p{L}])direcion/iu)).toEqual([])
  })

  test('pt-BR thread.json turnVerdict.actions.retry uses Tentar de novo instead of Tentar novamente', () => {
    expect(pt('thread.json').get('nowLine.actions.retry')).toBe('Tentar de novo o passo que falhou')
    expect(everywhere(/tentar novamente/iu)).toEqual([])
  })

  test('pt-BR status labels say Concluído while verbal sentences with terminou remain untouched', () => {
    const labels: Array<[string, string]> = [
      ['thread.json', 'status.completed'], ['thread.json', 'schedules.done'], ['thread.json', 'notify.finishedShort'],
      ['common.json', 'activity.kind.finished'], ['code.json', 'paneMenu.explain.states.done'], ['mobile.json', 'live.agentState.done']
    ]
    for (const [file, key] of labels) expect(pt(file).get(key), `${file} ${key}`).toBe('Concluído')
    const thread = pt('thread.json')
    expect(thread.get('outcome.turn-completed')).toMatch(/^O turno terminou; /)
    expect(thread.get('notify.agentsFinished_one')).toBe('{{count}} agente terminou')
  })
})
