import { afterEach, describe, expect, it } from 'vitest'
import en from '../shared/locales/en/settings.json'
import ptBR from '../shared/locales/pt-BR/settings.json'
import { DIAGNOSTICS_INCIDENT_CODES, type DiagnosticsMetrics } from '../shared/types/diagnostics'
import { HEALTH_CARDS, HEALTH_THRESHOLDS, alerting, averageCpu, healthCards } from '../src/components/Diagnostics/diagnosticsHealth'
import { changeLanguage } from '../src/i18n'
import { formatMainMessage, mainMessageFromError } from '../src/i18n/messages'

const GB = 1024 ** 3
const base = (patch: Partial<DiagnosticsMetrics> = {}): DiagnosticsMetrics => ({
  at: 1, processes: [{ kind: 'main', pid: 1, cpuPercent: 5, memoryBytes: 200e6 }], terminals: { running: 0, agents: 0 },
  storage: { freeBytes: 100 * GB, databaseBytes: 1e6, logsBytes: 1e6 }, connectivity: { state: 'online', checkedAt: 1 },
  gateway: null, clis: [], accounts: [], mcpServers: { total: 0, healthy: 0, quarantined: 0, failing: 0 }, ...patch
})
const card = (metrics: DiagnosticsMetrics, id: string, cpu: number[] = [], now = Date.now()) => healthCards(metrics, cpu, [], now).find(item => item.id === id)!

afterEach(async () => { await changeLanguage('en') })

describe('diagnostics health thresholds', () => {
  it('is calm when everything is ordinary', () => {
    expect(alerting(healthCards(base(), [], []))).toEqual([])
  })

  it('averages CPU so one busy measurement does not alert', () => {
    expect(averageCpu([10, 10, 100])).toBe(40)
    expect(card(base(), 'cpu', [10, 10, 100]).tone).toBe('ok')
    expect(card(base(), 'cpu', [80, 76, 78]).tone).toBe('warning')
    expect(card(base(), 'cpu', [95, 92, 99]).tone).toBe('error')
  })

  it('turns memory and the meter at the same points', () => {
    const memory = (bytes: number) => card(base({ processes: [{ kind: 'main', pid: 1, cpuPercent: 0, memoryBytes: bytes }] }), 'memory')
    expect(memory(2 * GB).tone).toBe('ok')
    expect(memory(HEALTH_THRESHOLDS.memoryWarningBytes).tone).toBe('warning')
    expect(memory(HEALTH_THRESHOLDS.memoryErrorBytes).tone).toBe('error')
    expect(HEALTH_THRESHOLDS.memoryWarningBytes / HEALTH_THRESHOLDS.memoryScaleBytes).toBe(0.75)
    expect(HEALTH_THRESHOLDS.memoryErrorBytes / HEALTH_THRESHOLDS.memoryScaleBytes).toBeCloseTo(0.9)
  })

  it('reads free disk, database, processes and network', () => {
    expect(card(base({ storage: { freeBytes: 5 * GB, databaseBytes: 0, logsBytes: 0 } }), 'disk').alert).toBe('low')
    expect(card(base({ storage: { freeBytes: 1 * GB, databaseBytes: 0, logsBytes: 0 } }), 'disk').alert).toBe('almostFull')
    expect(card(base({ storage: { freeBytes: null, databaseBytes: 0, logsBytes: 0 } }), 'disk').tone).toBe('unknown')
    expect(card(base({ storage: { freeBytes: 100 * GB, databaseBytes: 2 * GB, logsBytes: 0 } }), 'database').alert).toBe('large')
    const now = Date.now()
    const busy = healthCards(base(), [], [{ id: 'd', code: 'incident.database.busy', area: 'database', firstAt: now - 1000, lastAt: now - 1000, count: 3 }], now).find(item => item.id === 'database')!
    expect(busy).toMatchObject({ tone: 'warning', alert: 'busy', values: { count: 3 } })
    expect(card(base({ mcpServers: { total: 2, healthy: 1, quarantined: 0, failing: 1 } }), 'processes').alert).toBe('mcpFailing')
    expect(card(base({ connectivity: { state: 'offline', checkedAt: 1 } }), 'network').tone).toBe('error')
    expect(card(base({ gateway: { enabled: true, devices: 1, connected: 0 } }), 'network').alert).toBe('phoneAway')
    expect(card(base({ gateway: null }), 'network').values.phone).toBe('phoneUnavailable')
  })

  it('has words and, for every alert, an action in both languages', () => {
    for (const catalog of [en, ptBR]) {
      const cards = (catalog.diagnostics.cards as Record<string, { alerts: Record<string, Record<string, string>> }>)
      for (const id of HEALTH_CARDS) {
        for (const [name, alert] of Object.entries(cards[id].alerts)) {
          expect(Object.keys(alert).some(key => key.startsWith('text')), `${id}.${name}`).toBe(true)
          if (name !== 'normal') expect(alert.action, `${id}.${name}.action`).toBeTruthy()
        }
      }
      const areas = new Set(Object.values(DIAGNOSTICS_INCIDENT_CODES))
      for (const area of areas) expect((catalog.diagnostics.journal.actions as Record<string, string>)[area]).toBeTruthy()
    }
  })
})

describe('formatMainMessage', () => {
  it('turns a C3 code into words in the interface language', async () => {
    await changeLanguage('en')
    expect(formatMainMessage({ code: 'incident.database.busy', params: {} })).toBe('The local database was busy and a write had to wait.')
    await changeLanguage('pt-BR')
    expect(formatMainMessage({ code: 'incident.database.busy', params: {} })).toBe('O banco de dados local estava ocupado e uma gravação precisou esperar.')
    expect(formatMainMessage({ code: 'mcp.quarantine.added', params: { tools: ['a', 'b'] } })).toBe('Ele adicionou a e b.')
  })

  it('words a refusal code a failed request carries, and leaves other errors alone', async () => {
    await changeLanguage('en')
    const refusal = new Error("Error invoking remote method 'diagnostics:export-bundle': Error: diagnostics.bundle.tooLarge")
    expect(mainMessageFromError(refusal, ['diagnostics.bundle.tooLarge'])).toBe(formatMainMessage({ code: 'diagnostics.bundle.tooLarge', params: {} }))
    expect(mainMessageFromError(refusal, ['diagnostics.bundle.tooLarge'])).not.toContain('diagnostics.bundle')
    expect(mainMessageFromError(refusal, ['diagnostics.bundle.fileTooLarge'])).toBeNull()
    expect(mainMessageFromError(new Error('disk full'), ['diagnostics.bundle.tooLarge'])).toBeNull()
  })
})
