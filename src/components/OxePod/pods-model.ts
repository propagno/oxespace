import type { ContainerPort, ContainerStat, ContainerSummary } from '../../../shared/types/oxequery'
import type { Status } from '../../ui'

/** The label Docker Compose and Podman Compose put on every container of a project. */
export const COMPOSE_LABEL = 'com.docker.compose.project'
export const KNOWN_STATES = new Set(['running', 'exited', 'created', 'paused', 'restarting', 'dead', 'removing'])

/** "8080→80, 5432→5432"; internal ports only when nothing is published. */
export function formatPorts(ports: ContainerPort[]): string {
  const published = ports.filter(port => port.hostPort).map(port => `${port.hostPort}→${port.containerPort}`)
  const internal = ports.filter(port => !port.hostPort).map(port => String(port.containerPort))
  return [...new Set(published), ...(published.length ? [] : [...new Set(internal)])].slice(0, 6).join(', ')
}

/** The first published host port, shown beside a container in the list. */
export function firstHostPort(ports: ContainerPort[]): number | undefined {
  return ports.find(port => port.hostPort)?.hostPort
}

export type DatabaseKind = 'postgres' | 'mongodb'

/** The databases OxeQuery can open, recognized by the image name. */
export function databaseKind(image: string): DatabaseKind | null {
  if (/mongo/i.test(image)) return 'mongodb'
  if (/postgres|postgis|timescale|pgvector/i.test(image)) return 'postgres'
  return null
}

export function isDatabaseImage(image: string): boolean {
  return databaseKind(image) !== null
}

/** The dot beside a container: green running, amber in between, grey stopped, red dead. */
export function stateStatus(state: string): Status {
  if (state === 'running') return 'success'
  if (state === 'restarting' || state === 'paused' || state === 'removing' || state === 'created') return 'attention'
  if (state === 'dead') return 'danger'
  return 'idle'
}

export interface ContainerGroup {
  /** The Compose project, or null for containers outside any project ("Others"). */
  project: string | null
  containers: ContainerSummary[]
}

/** Running first, then by name. */
export function byState(a: ContainerSummary, b: ContainerSummary): number {
  return Number(b.state === 'running') - Number(a.state === 'running') || a.name.localeCompare(b.name)
}

/** The list of the sidebar: one group per Compose project (by name), then the rest; the filter matches name or image. */
export function groupContainers(containers: ContainerSummary[], filter = ''): ContainerGroup[] {
  const needle = filter.trim().toLowerCase()
  const shown = needle ? containers.filter(item => item.name.toLowerCase().includes(needle) || item.image.toLowerCase().includes(needle)) : containers
  const projects = new Map<string, ContainerSummary[]>()
  const others: ContainerSummary[] = []
  for (const container of shown) {
    const project = container.labels?.[COMPOSE_LABEL]
    if (project) projects.set(project, [...(projects.get(project) ?? []), container])
    else others.push(container)
  }
  const groups: ContainerGroup[] = [...projects].sort(([a], [b]) => a.localeCompare(b)).map(([project, items]) => ({ project, containers: [...items].sort(byState) }))
  if (others.length) groups.push({ project: null, containers: [...others].sort(byState) })
  return groups
}

/** The container to show when none is chosen yet: the first running one, else the first listed. */
export function defaultSelection(containers: ContainerSummary[]): string | null {
  const first = groupContainers(containers).flatMap(group => group.containers)
  return (first.find(item => item.state === 'running') ?? first[0])?.id ?? null
}

const UNITS: Record<string, number> = { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4 }

/** "84.2MiB" → bytes; NaN when the engine wrote something else. */
export function parseSize(text: string): number {
  const match = /^\s*([\d.]+)\s*([a-z]+)?\s*$/i.exec(text)
  if (!match) return Number.NaN
  const unit = UNITS[(match[2] ?? 'b').toLowerCase()]
  return unit ? Number(match[1]) * unit : Number.NaN
}

/** Memory in use and its limit from the engine's "84MiB / 512MiB". */
export function memoryOf(stat: Pick<ContainerStat, 'memoryUsage'>): { used: number; limit: number } | null {
  const [used, limit] = stat.memoryUsage.split('/').map(parseSize)
  return Number.isFinite(used) && Number.isFinite(limit) && limit > 0 ? { used, limit } : null
}

/** The stats row of one container; the engine reports a short id or the name. */
export function statFor(stats: ContainerStat[], container: Pick<ContainerSummary, 'id' | 'name'>): ContainerStat | undefined {
  return stats.find(stat => stat.name === container.name || (stat.id.length >= 12 && container.id.startsWith(stat.id.slice(0, 12))))
}
