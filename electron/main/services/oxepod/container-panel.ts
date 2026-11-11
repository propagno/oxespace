import type {
  ContainerEngine,
  ContainerEngineState,
  ContainerPanel as ContainerPanelView,
  ContainerPanelRow,
  ContainerPort,
  ContainerStartedBy
} from '../../../../shared/types/oxepod'
import { detectEngine, jsonEntries } from './container-parse'
import { ContainerRuntime, ContainerRuntimeError } from './container-runtime'

export interface InspectedContainer {
  id: string
  name: string
  image: string
  startedAt: number | null
  labels: Record<string, string>
  ports: ContainerPort[]
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function parseInspectPorts(value: unknown): ContainerPort[] {
  const result: ContainerPort[] = []
  for (const [key, bindings] of Object.entries(record(value))) {
    const match = /^(\d+)\/(tcp|udp)$/i.exec(key)
    if (!match) continue
    const containerPort = Number(match[1])
    const protocol = match[2].toLowerCase() as 'tcp' | 'udp'
    if (Array.isArray(bindings) && bindings.length) {
      const seen = new Set<string>()
      for (const binding of bindings) {
        const bound = record(binding)
        const hostPort = Number(bound.HostPort)
        if (!Number.isInteger(hostPort) || hostPort <= 0 || seen.has(String(hostPort))) continue
        seen.add(String(hostPort))
        result.push({ ...(text(bound.HostIp) ? { hostIp: text(bound.HostIp) } : {}), hostPort, containerPort, protocol })
      }
    } else {
      result.push({ containerPort, protocol })
    }
  }
  return result
}

function parseLabels(value: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, entry] of Object.entries(record(value)).slice(0, 64)) {
    if (typeof entry === 'string') out[key] = entry
  }
  return out
}

export function parseInspectedBatch(stdout: string): InspectedContainer[] {
  const out: InspectedContainer[] = []
  for (const raw of jsonEntries(stdout)) {
    const id = text(raw.Id).slice(0, 64)
    if (!id) continue
    const config = record(raw.Config)
    const state = record(raw.State)
    const network = record(raw.NetworkSettings)
    const parsedStarted = Date.parse(text(state.StartedAt))
    out.push({
      id,
      name: text(raw.Name).replace(/^\//, ''),
      image: text(config.Image),
      startedAt: Number.isFinite(parsedStarted) && parsedStarted > 0 ? parsedStarted : null,
      labels: parseLabels(config.Labels),
      ports: parseInspectPorts(network.Ports)
    })
  }
  return out
}

export type ResolveStartedBy = (
  engine: ContainerEngine,
  containers: Array<{ id: string; name: string; startedAt: number | null; labels: Record<string, string> }>
) => Map<string, ContainerStartedBy | null>

/**
 * Builds the window-only read model for the Containers panel: stack, status, uptime, ports,
 * database detection, and (when wired) who started each container.
 */
export class ContainerPanel {
  constructor(
    private readonly runtime: ContainerRuntime,
    private readonly resolveStartedBy?: ResolveStartedBy
  ) {}

  async read(requested?: ContainerEngine): Promise<ContainerPanelView> {
    const infos = await this.runtime.engines()
    const preferred = this.runtime.preferredEngine()
    let chosen: { engine: ContainerEngine; state: ContainerEngineState }
    if (requested) {
      const info = infos.find(entry => entry.engine === requested)
      chosen = { engine: requested, state: info?.available ? 'ready' : (info?.state ?? 'missing') }
    } else {
      const usable = infos.filter(entry => entry.available)
      const ready = usable.find(entry => entry.engine === preferred) ?? usable[0]
      if (ready) {
        chosen = { engine: ready.engine, state: 'ready' }
      } else {
        const blocked = infos.find(entry => entry.engine === preferred && (entry.state === 'stopped' || entry.state === 'denied'))
          ?? infos.find(entry => entry.state === 'stopped' || entry.state === 'denied')
        if (blocked?.state) {
          chosen = { engine: blocked.engine, state: blocked.state }
        } else {
          const fallback = infos.find(entry => entry.engine === preferred) ?? infos[0]
          chosen = { engine: fallback?.engine ?? 'docker', state: fallback?.state ?? 'missing' }
        }
      }
    }

    if (chosen.state !== 'ready') {
      return { engine: { state: chosen.state, engine: chosen.engine }, rows: [] }
    }

    try {
      const { containers } = await this.runtime.list(chosen.engine)
      if (containers.length === 0) {
        return { engine: { state: 'ready', engine: chosen.engine }, rows: [] }
      }

      const inspectedList = parseInspectedBatch(await this.runtime.inspectBatch(chosen.engine, containers.map(item => item.id)))
      const inspectedById = new Map<string, InspectedContainer>()
      for (const entry of inspectedList) inspectedById.set(entry.id, entry)

      const matched = containers.map(summary => {
        const inspected = inspectedById.get(summary.id)
          ?? inspectedList.find(entry => entry.id.startsWith(summary.id) || summary.id.startsWith(entry.id) || entry.name === summary.name)
        const labels = inspected && Object.keys(inspected.labels).length > 0 ? inspected.labels : summary.labels
        return { summary, inspected, labels }
      })

      const origins = this.resolveStartedBy?.(
        chosen.engine,
        matched.map(({ summary, inspected, labels }) => ({
          id: summary.id,
          name: summary.name,
          startedAt: inspected?.startedAt ?? null,
          labels
        }))
      )

      const rows: ContainerPanelRow[] = matched.map(({ summary, inspected, labels }) => {
        const stack = (labels['com.docker.compose.project'] ?? labels['io.podman.compose.project'])?.trim() || null
        const upSince = summary.state === 'running' ? (inspected?.startedAt ?? null) : null
        const ports = summary.ports.length > 0 ? summary.ports : (inspected?.ports ?? [])
        const isDatabase = Boolean(inspected) && detectEngine(inspected!.image || summary.image, inspected!.ports.map(port => port.containerPort)) !== null
        return {
          id: summary.id,
          name: summary.name,
          image: summary.image,
          status: summary.state,
          ports,
          stack,
          upSince,
          isDatabase,
          startedBy: origins?.get(summary.id) ?? null
        }
      })

      return { engine: { state: 'ready', engine: chosen.engine }, rows }
    } catch (error) {
      if (error instanceof ContainerRuntimeError) {
        if (error.code === 'engine-missing') return { engine: { state: 'missing', engine: chosen.engine }, rows: [] }
        if (error.code === 'daemon') {
          const state: ContainerEngineState = /permission/i.test(error.message) ? 'denied' : 'stopped'
          return { engine: { state, engine: chosen.engine }, rows: [] }
        }
      }
      throw error
    }
  }
}
