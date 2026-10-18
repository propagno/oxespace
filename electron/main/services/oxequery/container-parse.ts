import type {
  ContainerInspect, ContainerPort, ContainerState, ContainerStat, ContainerSummary, ConnectionSuggestion, DatabaseEngine, DiskUsageRow, ImageInfo, NetworkInfo, VolumeInfo
} from '../../../../shared/types/oxequery'

const STATES = new Set<ContainerState>(['running', 'exited', 'paused', 'restarting', 'created', 'dead', 'removing'])
const MAX_RANGE = 64

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function text(value: unknown): string { return typeof value === 'string' ? value : '' }

export function containerState(value: unknown): ContainerState {
  const state = text(value).toLowerCase()
  return STATES.has(state as ContainerState) ? state as ContainerState : 'unknown'
}

/** `"0.0.0.0:5432->5432/tcp, [::]:5432->5432/tcp, 6379/tcp"` as Docker prints it. */
export function parseDockerPorts(value: unknown): ContainerPort[] {
  const result: ContainerPort[] = []
  const seen = new Set<string>()
  for (const part of text(value).split(',').map(item => item.trim()).filter(Boolean)) {
    const mapped = /^(?:(.*):)?(\d+)(?:-(\d+))?->(\d+)(?:-(\d+))?\/(tcp|udp)$/i.exec(part)
    const bare = /^(\d+)(?:-(\d+))?\/(tcp|udp)$/i.exec(part)
    const entries: ContainerPort[] = []
    if (mapped) {
      const [, ip, hostStart, hostEnd, containerStart, , protocol] = mapped
      const count = Math.min(MAX_RANGE, hostEnd ? Number(hostEnd) - Number(hostStart) + 1 : 1)
      for (let index = 0; index < count; index++) {
        entries.push({ ...(ip ? { hostIp: ip.replace(/^\[|\]$/g, '') } : {}), hostPort: Number(hostStart) + index, containerPort: Number(containerStart) + index, protocol: protocol.toLowerCase() as 'tcp' | 'udp' })
      }
    } else if (bare) {
      const [, start, end, protocol] = bare
      const count = Math.min(MAX_RANGE, end ? Number(end) - Number(start) + 1 : 1)
      for (let index = 0; index < count; index++) entries.push({ containerPort: Number(start) + index, protocol: protocol.toLowerCase() as 'tcp' | 'udp' })
    }
    for (const entry of entries) {
      // Docker lists IPv4 and IPv6 bindings separately; one row per mapping is enough.
      const key = `${entry.hostPort ?? ''}:${entry.containerPort}/${entry.protocol}`
      if (seen.has(key)) continue
      seen.add(key)
      result.push(entry)
    }
  }
  return result
}

function podmanPorts(value: unknown): ContainerPort[] {
  if (!Array.isArray(value)) return []
  const result: ContainerPort[] = []
  for (const item of value) {
    const port = record(item)
    const containerPort = Number(port.container_port)
    if (!Number.isInteger(containerPort)) continue
    const range = Math.max(1, Math.min(MAX_RANGE, Number(port.range) || 1))
    for (let index = 0; index < range; index++) {
      const hostPort = Number(port.host_port)
      result.push({
        ...(text(port.host_ip) ? { hostIp: text(port.host_ip) } : {}),
        ...(Number.isInteger(hostPort) && hostPort > 0 ? { hostPort: hostPort + index } : {}),
        containerPort: containerPort + index,
        protocol: text(port.protocol).toLowerCase() === 'udp' ? 'udp' : 'tcp'
      })
    }
  }
  return result
}

function labelMap(value: unknown): Record<string, string> {
  const labels: Record<string, string> = {}
  if (typeof value === 'string') {
    for (const pair of value.split(',')) {
      const index = pair.indexOf('=')
      if (index > 0) labels[pair.slice(0, index)] = pair.slice(index + 1)
    }
  } else {
    for (const [key, entry] of Object.entries(record(value))) if (typeof entry === 'string') labels[key] = entry
  }
  return Object.fromEntries(Object.entries(labels).slice(0, 64))
}

function createdAt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value > 1e12 ? value : value * 1000
  // Docker: "2026-10-11 20:00:00 -0300 -03"
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.\d+)? ([+-]\d{2})(\d{2})/.exec(text(value))
  const parsed = Date.parse(match ? `${match[1]}T${match[2]}${match[3]}:${match[4]}` : text(value))
  return Number.isFinite(parsed) ? parsed : undefined
}

function fromEntry(entry: Record<string, unknown>): ContainerSummary | null {
  const id = text(entry.ID) || text(entry.Id)
  if (!id) return null
  const names = Array.isArray(entry.Names) ? entry.Names.map(text).filter(Boolean) : text(entry.Names).split(',').filter(Boolean)
  const ports = Array.isArray(entry.Ports) ? podmanPorts(entry.Ports) : parseDockerPorts(entry.Ports)
  const created = createdAt(entry.Created) ?? createdAt(entry.CreatedAt)
  return {
    id: id.slice(0, 64),
    name: (names[0] ?? id.slice(0, 12)).replace(/^\//, ''),
    image: text(entry.Image),
    state: containerState(entry.State),
    status: text(entry.Status),
    ports,
    ...(created !== undefined ? { createdAt: created } : {}),
    labels: labelMap(entry.Labels)
  }
}

/** Docker prints one JSON object per line; Podman prints a JSON array. Both are accepted. */
export function parseContainerList(stdout: string): ContainerSummary[] {
  const trimmed = stdout.trim()
  if (!trimmed) return []
  let entries: unknown[]
  if (trimmed.startsWith('[')) {
    try { entries = JSON.parse(trimmed) as unknown[] } catch { return [] }
  } else {
    entries = []
    for (const line of trimmed.split(/\r?\n/)) {
      if (!line.trim()) continue
      try { entries.push(JSON.parse(line)) } catch { /* A partial trailing line is ignored. */ }
    }
  }
  return entries.map(value => fromEntry(record(value))).filter((value): value is ContainerSummary => value !== null)
}

function inspectPorts(value: unknown): ContainerPort[] {
  const result: ContainerPort[] = []
  for (const [key, bindings] of Object.entries(record(value))) {
    const match = /^(\d+)\/(tcp|udp)$/i.exec(key)
    if (!match) continue
    const containerPort = Number(match[1]), protocol = match[2].toLowerCase() as 'tcp' | 'udp'
    if (Array.isArray(bindings) && bindings.length) {
      const seen = new Set<string>()
      for (const binding of bindings) {
        const bound = record(binding), hostPort = Number(bound.HostPort)
        if (!Number.isInteger(hostPort) || hostPort <= 0 || seen.has(String(hostPort))) continue
        seen.add(String(hostPort))
        result.push({ ...(text(bound.HostIp) ? { hostIp: text(bound.HostIp) } : {}), hostPort, containerPort, protocol })
      }
    } else result.push({ containerPort, protocol })
  }
  return result
}

function inspectObject(stdout: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(stdout)
    const first = Array.isArray(parsed) ? parsed[0] : parsed
    return first && typeof first === 'object' ? first as Record<string, unknown> : null
  } catch { return null }
}

export function parseInspect(stdout: string): ContainerInspect | null {
  const raw = inspectObject(stdout)
  if (!raw) return null
  const config = record(raw.Config), state = record(raw.State), network = record(raw.NetworkSettings), host = record(raw.HostConfig)
  const command = [...(Array.isArray(config.Entrypoint) ? config.Entrypoint : []), ...(Array.isArray(config.Cmd) ? config.Cmd : [])].map(text).filter(Boolean).join(' ')
  const env = (Array.isArray(config.Env) ? config.Env : []).map(text).map(entry => entry.split('=')[0]).filter(Boolean)
  const started = Date.parse(text(state.StartedAt))
  return {
    id: text(raw.Id).slice(0, 64),
    name: text(raw.Name).replace(/^\//, ''),
    image: text(config.Image),
    state: containerState(state.Status),
    ...(Number.isFinite(started) && started > 0 ? { startedAt: started } : {}),
    ...(text(record(host.RestartPolicy).Name) ? { restartPolicy: text(record(host.RestartPolicy).Name) } : {}),
    ...(text(record(state.Health).Status) ? { health: text(record(state.Health).Status) } : {}),
    command: command.slice(0, 500),
    ...(text(config.WorkingDir) ? { workingDir: text(config.WorkingDir) } : {}),
    envNames: [...new Set(env)].slice(0, 200),
    mounts: (Array.isArray(raw.Mounts) ? raw.Mounts : []).slice(0, 100).map(value => {
      const mount = record(value)
      return { source: text(mount.Source), destination: text(mount.Destination), ...(text(mount.Mode) ? { mode: text(mount.Mode) } : {}) }
    }),
    networks: Object.keys(record(network.Networks)).slice(0, 20),
    ports: inspectPorts(network.Ports)
  }
}

const DEFAULTS: Record<DatabaseEngine, { port: number }> = { postgres: { port: 5432 }, mongodb: { port: 27017 } }

function envMap(raw: Record<string, unknown>): Record<string, string> {
  const values: Record<string, string> = {}
  for (const entry of Array.isArray(record(raw.Config).Env) ? record(raw.Config).Env as unknown[] : []) {
    const value = text(entry), index = value.indexOf('=')
    if (index > 0) values[value.slice(0, index)] = value.slice(index + 1)
  }
  return values
}

export function detectEngine(image: string, containerPorts: number[]): DatabaseEngine | null {
  const name = image.toLowerCase().split('/').pop()?.split(':')[0] ?? ''
  if (/postgres|postgis|timescale|pgvector|supabase\/postgres/.test(image.toLowerCase()) || name === 'postgres') return 'postgres'
  if (/mongo/.test(name)) return 'mongodb'
  if (containerPorts.includes(5432)) return 'postgres'
  if (containerPorts.includes(27017)) return 'mongodb'
  return null
}

/** A loopback host for a binding that listens on every interface. */
function connectHost(hostIp: string | undefined): string {
  return !hostIp || hostIp === '0.0.0.0' || hostIp === '::' || hostIp === '[::]' ? '127.0.0.1' : hostIp
}

/**
 * Connection details a container can offer. The password is returned separately
 * so the caller (main process) can store it without it ever being serialised
 * into a renderer-facing value.
 */
export function suggestFromInspect(stdout: string): { suggestion: ConnectionSuggestion; password?: string } | null {
  const raw = inspectObject(stdout)
  if (!raw) return null
  const inspect = parseInspect(stdout)
  if (!inspect) return null
  const engine = detectEngine(inspect.image, inspect.ports.map(port => port.containerPort))
  if (!engine) return null
  const env = envMap(raw)
  const containerPort = DEFAULTS[engine].port
  const binding = inspect.ports.find(port => port.containerPort === containerPort && port.protocol === 'tcp' && port.hostPort)
  let username: string | undefined, database: string | undefined, password: string | undefined
  if (engine === 'postgres') {
    username = env.POSTGRES_USER || 'postgres'
    database = env.POSTGRES_DB || username
    password = env.POSTGRES_PASSWORD || undefined
  } else {
    username = env.MONGO_INITDB_ROOT_USERNAME || undefined
    database = env.MONGO_INITDB_DATABASE || undefined
    password = env.MONGO_INITDB_ROOT_PASSWORD || undefined
  }
  return {
    suggestion: {
      engine, name: inspect.name || inspect.id.slice(0, 12),
      host: connectHost(binding?.hostIp), port: binding?.hostPort ?? 0,
      ...(database ? { database } : {}), ...(username ? { username } : {}), hasPassword: Boolean(password)
    },
    ...(password ? { password } : {})
  }
}

/**
 * The objects in a listing: one per line (Docker), one array (Podman), or objects written out over several
 * lines one after another (what a Go template's `json` can print). Scans for each top-level value, honoring
 * strings, so a brace inside a name cannot split an object.
 */
export function jsonEntries(stdout: string): Record<string, unknown>[] {
  const text = stdout.trim()
  if (!text) return []
  if (text.startsWith('[')) {
    try { return (JSON.parse(text) as unknown[]).map(record) } catch { return [] }
  }
  const out: Record<string, unknown>[] = []
  let depth = 0
  let begin = -1
  let inString = false
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!
    if (inString) {
      if (char === '\\') index++
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') { if (depth === 0) begin = index; depth++ }
    else if (char === '}' && depth > 0) {
      depth--
      if (depth === 0 && begin >= 0) {
        try { out.push(record(JSON.parse(text.slice(begin, index + 1)))) } catch { /* a partial object */ }
        begin = -1
      }
    }
  }
  return out
}

function percent(value: unknown): number {
  const number = Number.parseFloat(text(value).replace('%', ''))
  return Number.isFinite(number) ? number : 0
}

export function parseStats(stdout: string): ContainerStat[] {
  return jsonEntries(stdout).map(entry => ({
    id: (text(entry.ID) || text(entry.Container) || text(entry.id)).slice(0, 64),
    name: text(entry.Name) || text(entry.name),
    cpuPercent: percent(entry.CPUPerc ?? entry.CPU ?? entry.cpu_percent),
    memoryPercent: percent(entry.MemPerc ?? entry.mem_percent),
    memoryUsage: text(entry.MemUsage) || text(entry.mem_usage),
    netIO: text(entry.NetIO) || text(entry.net_io),
    blockIO: text(entry.BlockIO) || text(entry.block_io),
    pids: Number(entry.PIDs ?? entry.pids) || 0
  })).filter(item => item.id || item.name)
}

export function parseImages(stdout: string): ImageInfo[] {
  return jsonEntries(stdout).map(entry => {
    const names = Array.isArray(entry.Names) ? entry.Names.map(text) : []
    const named = names[0] ? /^(.*?)(?::([^:/]+))?$/.exec(names[0]) : null
    return {
      id: (text(entry.ID) || text(entry.Id)).replace(/^sha256:/, '').slice(0, 64),
      repository: text(entry.Repository) || named?.[1] || '<none>',
      tag: text(entry.Tag) || named?.[2] || '<none>',
      size: text(entry.Size) || (typeof entry.Size === 'number' ? `${(entry.Size / 1e6).toFixed(0)}MB` : ''),
      created: text(entry.CreatedSince) || text(entry.CreatedAt)
    }
  }).filter(item => item.id)
}

export function parseVolumes(stdout: string): VolumeInfo[] {
  return jsonEntries(stdout).map(entry => ({ name: text(entry.Name), driver: text(entry.Driver) || 'local' })).filter(item => item.name)
}

export function parseNetworks(stdout: string): NetworkInfo[] {
  return jsonEntries(stdout).map(entry => ({
    // Docker prints Name, ID, Driver, Scope; Podman prints the same fields in lower case.
    id: (text(entry.ID) || text(entry.Id) || text(entry.id)).slice(0, 64), name: text(entry.Name) || text(entry.name), driver: text(entry.Driver) || text(entry.driver), scope: text(entry.Scope) || text(entry.scope)
  })).filter(item => item.name)
}

export function parseDiskUsage(stdout: string): DiskUsageRow[] {
  return jsonEntries(stdout).map(entry => ({
    type: text(entry.Type), total: Number(entry.TotalCount ?? entry.Total) || 0, active: Number(entry.Active) || 0, size: text(entry.Size), reclaimable: text(entry.Reclaimable)
  })).filter(item => item.type)
}


export interface DockerContext { name: string; endpoint: string; current: boolean }

/** `docker context ls --format '{{json .}}'`: one object per line. */
export function parseContexts(stdout: string): DockerContext[] {
  const out: DockerContext[] = []
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const value = JSON.parse(line) as { Name?: unknown; DockerEndpoint?: unknown; Current?: unknown }
      if (typeof value.Name === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(value.Name)) {
        out.push({ name: value.Name, endpoint: typeof value.DockerEndpoint === 'string' ? value.DockerEndpoint : '', current: value.Current === true })
      }
    } catch { /* a line that is not JSON is not a context */ }
  }
  return out
}

/** Whether `docker ps` against one daemon worked, was refused for this user, or found nothing there. */
export function classifyProbe(code: number, stderr: string): 'ready' | 'denied' | 'unreachable' {
  if (code === 0) return 'ready'
  return /permission denied|got permission denied/i.test(stderr) ? 'denied' : 'unreachable'
}

/** Only local sockets and pipes are contacted; an ssh:// or tcp:// context is somebody else's machine. */
export const isLocalEndpoint = (endpoint: string): boolean => /^(unix:\/\/|npipe:\/\/)/.test(endpoint)
