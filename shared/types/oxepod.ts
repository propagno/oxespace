/**
 * OxePod: local containers (Docker/Podman), their logs, shells, Compose projects and resources.
 *
 * Everything crosses one IPC call, `oxePod:call`, described by `OxePodOps`. A container's
 * environment reaches the page redacted; a database password found in it never leaves the
 * main process (OxeQuery reads it there, in process, through `connections.fromContainer`).
 */

import type { DatabaseEngine } from './oxequery'

export type ContainerEngine = 'docker' | 'podman'

export type ContainerEngineState = 'ready' | 'missing' | 'stopped' | 'denied'

export interface ContainerEngineInfo {
  engine: ContainerEngine
  available: boolean
  /** ready: usable; missing: CLI not found; stopped: CLI found but the daemon does not answer; denied: socket permission. */
  state?: ContainerEngineState
  /** The executable that answered (a full path when PATH did not have it). */
  binary?: string
  version?: string
  /** `docker context show`; a remote context means the daemon is not local. */
  context?: string
  error?: string
}

/** A Docker daemon this computer can reach: a named context or the system socket. */
export interface ContainerEngineCandidate {
  /** `context:<name>` or `socket:system`; the only values `containers.useCandidate` accepts. */
  id: string
  label: string
  endpoint: string
  /** The one the Docker CLI uses when nothing is chosen. */
  current: boolean
  /** The one OxePod is using now. */
  selected: boolean
  /** ready: answered; denied: the socket refuses this user; unreachable: no daemon; not-checked: remote endpoints are never contacted. */
  state: 'ready' | 'denied' | 'unreachable' | 'not-checked'
  containers?: number
}

export interface ContainerPort {
  hostIp?: string
  hostPort?: number
  containerPort: number
  protocol: 'tcp' | 'udp'
}

export type ContainerState = 'running' | 'exited' | 'paused' | 'restarting' | 'created' | 'dead' | 'removing' | 'unknown'

export interface ContainerSummary {
  id: string
  name: string
  image: string
  state: ContainerState
  status: string
  ports: ContainerPort[]
  createdAt?: number
  labels: Record<string, string>
}

export interface ContainerStat {
  id: string
  name: string
  cpuPercent: number
  memoryPercent: number
  memoryUsage: string
  netIO: string
  blockIO: string
  pids: number
}
export interface ImageInfo { id: string; repository: string; tag: string; size: string; created: string }
export interface VolumeInfo { name: string; driver: string }
export interface NetworkInfo { id: string; name: string; driver: string; scope: string }
export interface DiskUsageRow { type: string; total: number; active: number; size: string; reclaimable: string }
export type ResourceKind = 'image' | 'volume' | 'network'
export type PruneKind = 'containers' | 'images'

/** One environment variable; `value` is absent when it is, or may be, a secret. */
export interface ContainerEnvEntry { name: string; value?: string }

export interface ContainerInspect {
  id: string
  name: string
  image: string
  state: ContainerState
  startedAt?: number
  restartPolicy?: string
  health?: string
  command: string
  workingDir?: string
  /** The environment with secrets already removed in the main process: a hidden value never reaches the renderer. */
  environment: ContainerEnvEntry[]
  /** `volume` names a named volume; it outlives the container. */
  mounts: { source: string; destination: string; mode?: string; volume?: string }[]
  networks: string[]
  ports: ContainerPort[]
}

export type ContainerAction = 'start' | 'stop' | 'restart' | 'pause' | 'unpause'

export interface ContainerExecResult {
  exitCode: number | null
  stdout: string
  stderr: string
  truncated: boolean
  timedOut: boolean
}

export interface ConnectionSuggestion {
  engine: DatabaseEngine
  name: string
  host: string
  port: number
  database?: string
  username?: string
  /** True when the container environment holds a password the main process can use. */
  hasPassword: boolean
}

export type ContainerLogEvent = { type: 'container-log'; streamId: string; lines: string[] } | { type: 'container-log-end'; streamId: string; reason: string }
export type OxePodEvent = ContainerLogEvent | { type: 'containers-changed' }

export interface OxePodOps {
  'containers.engines': { input: { refresh?: boolean }; output: ContainerEngineInfo[] }
  'containers.candidates': { input: Record<string, never>; output: ContainerEngineCandidate[] }
  'containers.useCandidate': { input: { id: string | null }; output: ContainerEngineCandidate[] }
  'containers.list': { input: { engine?: ContainerEngine }; output: { engine: ContainerEngine; containers: ContainerSummary[] } }
  'containers.inspect': { input: { engine?: ContainerEngine; id: string }; output: ContainerInspect }
  'containers.stats': { input: { engine?: ContainerEngine }; output: ContainerStat[] }
  'containers.action': { input: { engine?: ContainerEngine; id: string; action: ContainerAction }; output: { ok: true } }
  /** Removes one container (stopping it first). Its volumes stay. Refused unless the person confirmed. */
  'containers.remove': { input: { id: string; engine?: ContainerEngine; confirmed?: boolean }; output: { ok: true } }
  'containers.compose': { input: { engine?: ContainerEngine; id: string; action: 'up' | 'down' | 'start' | 'stop' | 'restart' | 'logs'; confirmed?: boolean; tail?: number }; output: { output: string } }
  'containers.exec': { input: { engine?: ContainerEngine; id: string; argv: string[]; timeoutMs?: number }; output: ContainerExecResult }
  'containers.logsStart': { input: { engine?: ContainerEngine; id: string; tail?: number }; output: { streamId: string } }
  'containers.logsStop': { input: { streamId: string }; output: { ok: true } }
  'containers.shell': { input: { engine?: ContainerEngine; id: string; shell?: 'sh' | 'bash' }; output: { paneId: string } }
  /** What a connection to the database in this container would be; never its password. */
  'containers.suggestConnection': { input: { engine?: ContainerEngine; id: string }; output: ConnectionSuggestion | null }
  'resources.images': { input: { engine?: ContainerEngine }; output: ImageInfo[] }
  'resources.volumes': { input: { engine?: ContainerEngine }; output: VolumeInfo[] }
  'resources.networks': { input: { engine?: ContainerEngine }; output: NetworkInfo[] }
  'resources.usage': { input: { engine?: ContainerEngine }; output: DiskUsageRow[] }
  'resources.remove': { input: { kind: ResourceKind; id: string; engine?: ContainerEngine; confirmed?: boolean }; output: { ok: true } }
  /** Stopped containers or dangling images, all at once. Refused unless the person confirmed. */
  'resources.prune': { input: { kind: PruneKind; engine?: ContainerEngine; confirmed?: boolean }; output: { output: string } }
}

export type OxePodOp = keyof OxePodOps

export interface OxePodErrorInfo {
  /** The sentence above as a message code the window translates (C3); the text stays for logs and older clients. */
  messageCode?: import('../messages').MainMessage
  code: 'engine-missing' | 'daemon' | 'not-found' | 'invalid' | 'failed' | 'confirm'
  message: string
  /** What the person is asked to accept, when code is 'confirm'. */
  reasons?: string[]
}

/** Errors travel as data so the renderer keeps their code (a rejected IPC call loses it). */
export type OxePodResponse<T> = { ok: true; value: T } | { ok: false; error: OxePodErrorInfo }

export interface OxePodApi {
  call<K extends OxePodOp>(op: K, input: OxePodOps[K]['input']): Promise<OxePodResponse<OxePodOps[K]['output']>>
  onEvent(listener: (event: OxePodEvent) => void): () => void
}
