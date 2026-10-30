import { DIAGNOSTICS_LIMITS, type DiagnosticsIncident, type DiagnosticsMetrics } from '../../../../shared/types/diagnostics'

/**
 * The Markdown "Ask for an analysis" attaches to a Thread, and the exact text `oxespace_diagnostics` returns (B8.3):
 * incident codes, areas and counts, then processes and storage in aggregate. Never content, paths, names or raw
 * errors, and never more than 4,000 characters. One function, so the window and the tool cannot drift apart.
 */
export interface SummaryInput {
  incidents: DiagnosticsIncident[]
  metrics: DiagnosticsMetrics
  version: string
  platform: string
  arch: string
  now: number
}

const MB = 1024 * 1024
const size = (bytes: number | null): string => bytes === null ? 'unknown'
  : bytes >= 1024 * MB ? `${(bytes / 1024 / MB).toFixed(1)} GB` : `${Math.round(bytes / MB)} MB`
const day = (at: number): string => new Date(at).toISOString().slice(0, 10)

export function buildAnalysisSummary(input: SummaryInput): string {
  const max = DIAGNOSTICS_LIMITS.maxSummaryChars
  const { metrics } = input
  const head = [
    '# OXESpace diagnostics',
    '',
    `OXESpace ${input.version} on ${input.platform} ${input.arch}; measured ${new Date(input.now).toISOString()}.`,
    '',
    '## Incidents (last 30 days)'
  ]
  const kinds = [...input.incidents].sort((a, b) => b.count - a.count || b.lastAt - a.lastAt)
  const incidentLines = kinds.length
    ? kinds.map(item => `- ${item.code} (${item.area}): ${item.count} time${item.count === 1 ? '' : 's'}, last ${day(item.lastAt)}`)
    : ['- none recorded']

  const groups = new Map<string, { count: number; cpu: number; memory: number }>()
  for (const process of metrics.processes) {
    const group = groups.get(process.kind) ?? { count: 0, cpu: 0, memory: 0 }
    group.count++; group.cpu += process.cpuPercent; group.memory += process.memoryBytes
    groups.set(process.kind, group)
  }
  const totalMemory = [...groups.values()].reduce((sum, group) => sum + group.memory, 0)
  const servers = metrics.mcpServers
  const tail = [
    '',
    '## Processes',
    ...[...groups].map(([kind, group]) => `- ${kind}: ${group.count} process${group.count === 1 ? '' : 'es'}, CPU ${group.cpu.toFixed(1)}%, ${size(group.memory)}`),
    `- total memory: ${size(totalMemory)}`,
    `- terminals running: ${metrics.terminals.running}; with an agent: ${metrics.terminals.agents}`,
    '',
    '## Storage',
    `- free on the data volume: ${size(metrics.storage.freeBytes)}`,
    `- database: ${size(metrics.storage.databaseBytes)}; logs: ${size(metrics.storage.logsBytes)}`,
    '',
    '## Connections',
    `- network: ${metrics.connectivity.state}`,
    `- MCP servers: ${servers.total} total, ${servers.healthy} healthy, ${servers.quarantined} quarantined, ${servers.failing} failing`,
    `- CLIs found: ${metrics.clis.filter(cli => cli.found).map(cli => cli.version ? `${cli.id} ${cli.version}` : cli.id).join(', ') || 'none'}`
  ]

  // The incidents give way first, so the totals below always fit.
  const fixed = [...head, ...tail].join('\n').length + 1
  const kept: string[] = []
  let used = fixed
  for (let index = 0; index < incidentLines.length; index++) {
    const line = incidentLines[index]
    const more = `- … ${incidentLines.length - index} more kinds`
    if (used + line.length + 1 + more.length + 1 > max && index < incidentLines.length - 1) { kept.push(more); break }
    if (used + line.length + 1 > max) { kept.push(more); break }
    kept.push(line); used += line.length + 1
  }
  return [...head, ...kept, ...tail].join('\n').slice(0, max)
}
