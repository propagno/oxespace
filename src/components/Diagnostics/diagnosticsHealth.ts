import type { DiagnosticsIncident, DiagnosticsMetrics, DiagnosticsProcessKind } from '../../../shared/types/diagnostics'

/**
 * What the Diagnostics cards say about one measurement. Pure: no words, only keys and values, so the thresholds are
 * tested on their own and the panel only translates. Thresholds are deliberately calm (a busy moment is not a
 * problem): CPU is averaged over the last samples, and every alert comes with what to do.
 */
export type HealthTone = 'ok' | 'warning' | 'error' | 'unknown'
export type HealthCardId = 'cpu' | 'memory' | 'disk' | 'database' | 'processes' | 'network'

export const HEALTH_CARDS: readonly HealthCardId[] = ['cpu', 'memory', 'disk', 'database', 'processes', 'network']

const GB = 1024 ** 3

export const HEALTH_THRESHOLDS = {
  /** The app's CPU, all processes together, averaged over CPU_SAMPLES measurements. */
  cpuWarningPercent: 75,
  cpuErrorPercent: 90,
  /** Memory of every OXESpace process together. The meter's scale is MEMORY_SCALE, so it turns at the same points. */
  memoryWarningBytes: 3 * GB,
  memoryErrorBytes: 3.6 * GB,
  memoryScaleBytes: 4 * GB,
  /** One process alone. */
  processWarningBytes: 1.5 * GB,
  /** Free space on the disk that holds the app's data. */
  diskWarningBytes: 10 * GB,
  diskErrorBytes: 2 * GB,
  databaseWarningBytes: 1 * GB,
  /** A database incident this recent makes the database card say so. */
  recentIncidentMs: 24 * 60 * 60 * 1000
} as const

export const CPU_SAMPLES = 3

/** One card: its tone, the key of its alert (under diagnostics.cards.<id>.alerts) and the values the words use. */
export interface HealthCard {
  id: HealthCardId
  tone: HealthTone
  /** Key under `diagnostics.cards.<id>.alerts`; its `.action` sibling says what to do. */
  alert: string
  values: Record<string, string | number>
  /** For a meter: the value and its scale. */
  meter?: { value: number; max: number }
}

export const sumCpu = (metrics: DiagnosticsMetrics): number => metrics.processes.reduce((total, process) => total + Math.max(0, process.cpuPercent), 0)
export const sumMemory = (metrics: DiagnosticsMetrics): number => metrics.processes.reduce((total, process) => total + Math.max(0, process.memoryBytes), 0)

/** The CPU the card shows: the average of the last samples, so one busy second does not raise an alert. */
export function averageCpu(samples: readonly number[]): number {
  const recent = samples.slice(-CPU_SAMPLES)
  return recent.length ? recent.reduce((total, value) => total + value, 0) / recent.length : 0
}

function cpuCard(cpu: number): HealthCard {
  const value = Math.round(Math.min(100, cpu))
  const tone: HealthTone = cpu >= HEALTH_THRESHOLDS.cpuErrorPercent ? 'error' : cpu >= HEALTH_THRESHOLDS.cpuWarningPercent ? 'warning' : 'ok'
  return { id: 'cpu', tone, alert: tone === 'ok' ? 'normal' : tone === 'error' ? 'veryHigh' : 'high', values: { percent: value }, meter: { value, max: 100 } }
}

function memoryCard(metrics: DiagnosticsMetrics): HealthCard {
  const bytes = sumMemory(metrics)
  const tone: HealthTone = bytes >= HEALTH_THRESHOLDS.memoryErrorBytes ? 'error' : bytes >= HEALTH_THRESHOLDS.memoryWarningBytes ? 'warning' : 'ok'
  return { id: 'memory', tone, alert: tone === 'ok' ? 'normal' : tone === 'error' ? 'veryHigh' : 'high', values: { bytes },
    meter: { value: Math.min(bytes, HEALTH_THRESHOLDS.memoryScaleBytes), max: HEALTH_THRESHOLDS.memoryScaleBytes } }
}

function diskCard(metrics: DiagnosticsMetrics): HealthCard {
  const free = metrics.storage.freeBytes
  if (free === null) return { id: 'disk', tone: 'unknown', alert: 'unknown', values: {} }
  const tone: HealthTone = free < HEALTH_THRESHOLDS.diskErrorBytes ? 'error' : free < HEALTH_THRESHOLDS.diskWarningBytes ? 'warning' : 'ok'
  return { id: 'disk', tone, alert: tone === 'ok' ? 'normal' : tone === 'error' ? 'almostFull' : 'low', values: { bytes: free } }
}

function databaseCard(metrics: DiagnosticsMetrics, incidents: readonly DiagnosticsIncident[], now: number): HealthCard {
  const { databaseBytes, logsBytes } = metrics.storage
  const busy = incidents.filter(incident => incident.area === 'database' && now - incident.lastAt <= HEALTH_THRESHOLDS.recentIncidentMs)
  const values = { bytes: databaseBytes, logs: logsBytes, count: busy.reduce((total, incident) => total + incident.count, 0) }
  if (busy.length) return { id: 'database', tone: 'warning', alert: 'busy', values }
  if (databaseBytes >= HEALTH_THRESHOLDS.databaseWarningBytes) return { id: 'database', tone: 'warning', alert: 'large', values }
  return { id: 'database', tone: 'ok', alert: 'normal', values }
}

function processesCard(metrics: DiagnosticsMetrics): HealthCard {
  const { mcpServers, terminals, processes } = metrics
  const heaviest = [...processes].sort((a, b) => b.memoryBytes - a.memoryBytes)[0]
  const values: Record<string, string | number> = { processes: processes.length, terminals: terminals.running, agents: terminals.agents,
    mcpHealthy: mcpServers.healthy, mcpTotal: mcpServers.total }
  if (mcpServers.failing > 0) return { id: 'processes', tone: 'warning', alert: 'mcpFailing', values: { ...values, count: mcpServers.failing } }
  if (mcpServers.quarantined > 0) return { id: 'processes', tone: 'warning', alert: 'mcpQuarantined', values: { ...values, count: mcpServers.quarantined } }
  if (heaviest && heaviest.memoryBytes >= HEALTH_THRESHOLDS.processWarningBytes) {
    return { id: 'processes', tone: 'warning', alert: 'heavyProcess', values: { ...values, kind: heaviest.kind satisfies DiagnosticsProcessKind, bytes: heaviest.memoryBytes } }
  }
  return { id: 'processes', tone: 'ok', alert: 'normal', values }
}

function networkCard(metrics: DiagnosticsMetrics): HealthCard {
  const { connectivity, gateway } = metrics
  const phone = !gateway ? 'phoneUnavailable' : !gateway.enabled ? 'phoneOff' : gateway.devices === 0 ? 'phoneNone' : gateway.connected > 0 ? 'phoneConnected' : 'phoneAway'
  const values = { phone, connected: gateway?.connected ?? 0, devices: gateway?.devices ?? 0 }
  if (connectivity.state === 'offline') return { id: 'network', tone: 'error', alert: 'offline', values }
  if (phone === 'phoneAway') return { id: 'network', tone: 'warning', alert: 'phoneAway', values }
  if (connectivity.state === 'unknown') return { id: 'network', tone: 'unknown', alert: 'unknown', values }
  return { id: 'network', tone: 'ok', alert: 'normal', values }
}

/** Every card for one measurement. `cpuSamples` are the app's total CPU of the latest measurements, oldest first. */
export function healthCards(metrics: DiagnosticsMetrics, cpuSamples: readonly number[], incidents: readonly DiagnosticsIncident[], now = Date.now()): HealthCard[] {
  return [cpuCard(averageCpu(cpuSamples.length ? cpuSamples : [sumCpu(metrics)])), memoryCard(metrics), diskCard(metrics),
    databaseCard(metrics, incidents, now), processesCard(metrics), networkCard(metrics)]
}

/** The cards that need attention, worst first: what the live region says when it changes. */
export function alerting(cards: readonly HealthCard[]): HealthCard[] {
  const rank: Record<HealthTone, number> = { error: 0, warning: 1, unknown: 2, ok: 3 }
  return cards.filter(card => card.tone === 'error' || card.tone === 'warning').sort((a, b) => rank[a.tone] - rank[b.tone])
}
