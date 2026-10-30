import { randomUUID } from 'node:crypto'
import type { ExecutionHost } from '../../runtime/execution-host'
import type { ContainerAction, ContainerEngine, OxePodErrorInfo, OxePodEvent, OxePodOp, OxePodOps, OxePodResponse } from '../../../../shared/types/oxepod'
import { ContainerRuntime, ContainerRuntimeError } from './container-runtime'
import { COMPOSE_ACTIONS, type ComposeAction } from './compose'

type Raw = Record<string, unknown>
const ACTIONS = new Set(['start', 'stop', 'restart', 'pause', 'unpause'])
const MAX_SHELLS = 32
/** The terminal service opens a container shell by this prefix; the renderer never supplies the command. */
const SHELL_PREFIX = 'oxequery-shell:'

/** A refusal of OxePod's own: bad input, or an action that waits for the person's confirmation. */
export class OxePodError extends Error {
  constructor(readonly code: OxePodErrorInfo['code'], message: string, readonly reasons: string[] = []) { super(message) }
}

function record(value: unknown): Raw {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new OxePodError('invalid', 'Invalid request.')
  return value as Raw
}
function str(value: unknown, label: string, max = 4096): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || value.includes('\0')) throw new OxePodError('invalid', `${label} is required.`)
  return value
}
function optionalInt(value: unknown, min: number, max: number): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) throw new OxePodError('invalid', 'Invalid number.')
  return value as number
}
function engine(value: unknown): ContainerEngine | undefined {
  if (value === undefined) return undefined
  if (value !== 'docker' && value !== 'podman') throw new OxePodError('invalid', 'Unknown container engine.')
  return value
}

export function toPodErrorInfo(error: unknown): OxePodErrorInfo {
  if (error instanceof OxePodError) return { code: error.code, message: error.message, ...(error.reasons.length ? { reasons: error.reasons } : {}) }
  if (error instanceof ContainerRuntimeError) return { code: error.code, message: error.message }
  return { code: 'failed', message: error instanceof Error ? error.message.slice(0, 400) : 'OxePod failed.' }
}

export interface OxePodServiceOptions {
  host: ExecutionHost
  emit: (event: OxePodEvent) => void
  preferredEngine?: () => ContainerEngine | undefined
  runtime?: ContainerRuntime
}

/** Validates every OxePod operation and routes it to the container runtime. */
export class OxePodService {
  /** Also what OxeQuery reaches, in process, for a database in a container and for the agents' container tools. */
  readonly containers: ContainerRuntime
  private readonly shells = new Map<string, { file: string; args: string[] }>()

  constructor(options: OxePodServiceOptions) {
    this.containers = options.runtime ?? new ContainerRuntime({ host: options.host, emit: options.emit, preferred: options.preferredEngine })
  }

  /** Lookup for the terminal service; the renderer can only ask to open a pane it was handed. */
  shellFor(paneId: string): { file: string; args: string[] } | undefined {
    return this.shells.get(paneId)
  }

  async call<K extends OxePodOp>(op: K, rawInput: unknown): Promise<OxePodResponse<OxePodOps[K]['output']>> {
    try {
      return { ok: true, value: await this.dispatch(op, rawInput) as OxePodOps[K]['output'] }
    } catch (error) {
      return { ok: false, error: toPodErrorInfo(error) }
    }
  }

  private async dispatch(op: string, rawInput: unknown): Promise<unknown> {
    const input = record(rawInput ?? {})
    switch (op) {
      case 'containers.engines': return this.containers.engines(input.refresh === true)
      case 'containers.candidates': return this.containers.candidates()
      case 'containers.useCandidate': {
        if (input.id !== null && input.id !== undefined && typeof input.id !== 'string') throw new OxePodError('invalid', 'Invalid engine choice.')
        return this.containers.useCandidate(typeof input.id === 'string' ? input.id : null)
      }
      case 'containers.list': return this.containers.list(engine(input.engine))
      case 'containers.inspect': return this.containers.inspect(str(input.id, 'Container', 128), engine(input.engine))
      case 'containers.stats': return this.containers.stats(engine(input.engine))
      case 'resources.images': return this.containers.images(engine(input.engine))
      case 'resources.volumes': return this.containers.volumes(engine(input.engine))
      case 'resources.networks': return this.containers.networks(engine(input.engine))
      case 'resources.usage': return this.containers.usage(engine(input.engine))
      case 'resources.remove': {
        const kind = str(input.kind, 'Kind', 16)
        if (kind !== 'image' && kind !== 'volume' && kind !== 'network') throw new OxePodError('invalid', 'Unsupported resource kind.')
        // A volume is somebody's data: the main process asks for the confirmation itself.
        if (kind === 'volume' && input.confirmed !== true) throw new OxePodError('confirm', 'Removing a volume deletes the data in it.', ['Removing a volume deletes the data in it for good.'])
        await this.containers.removeResource(kind, str(input.id, 'Resource', 200), engine(input.engine))
        return { ok: true }
      }
      // Removing and cleaning up cannot be undone: the main process refuses until the person confirmed (roadmap P6).
      case 'resources.prune': {
        const kind = str(input.kind, 'Kind', 16)
        if (kind !== 'containers' && kind !== 'images') throw new OxePodError('invalid', 'Unsupported clean-up.')
        if (input.confirmed !== true) throw new OxePodError('confirm', kind === 'containers' ? 'Every stopped container is removed.' : 'Every dangling image is removed.', ['This cannot be undone.'])
        return this.containers.prune(kind, engine(input.engine))
      }
      case 'containers.remove': {
        const id = str(input.id, 'Container', 128)
        if (input.confirmed !== true) throw new OxePodError('confirm', 'Removing a container cannot be undone.', ['Its volumes are kept.'])
        await this.containers.removeContainer(id, engine(input.engine))
        return { ok: true }
      }
      case 'containers.action': {
        const action = str(input.action, 'Action', 16)
        if (!ACTIONS.has(action)) throw new OxePodError('invalid', 'Unsupported container action.')
        await this.containers.action(str(input.id, 'Container', 128), action as ContainerAction, engine(input.engine))
        return { ok: true }
      }
      case 'containers.compose': {
        const action = str(input.action, 'Action', 16)
        if (!COMPOSE_ACTIONS.has(action)) throw new OxePodError('invalid', 'Unsupported Compose action.')
        if (action === 'down' && input.confirmed !== true) {
          throw new OxePodError('confirm', 'Taking a project down removes its containers and networks.', ['Named volumes are kept.', 'Anything running from this project stops.'])
        }
        const tail = optionalInt(input.tail, 1, 500)
        return this.containers.compose(str(input.id, 'Container', 128), action as ComposeAction, tail !== undefined ? { tail } : {}, engine(input.engine))
      }
      case 'containers.exec': {
        const argv = input.argv
        if (!Array.isArray(argv)) throw new OxePodError('invalid', 'A command is required.')
        return this.containers.exec(str(input.id, 'Container', 128), argv as string[], optionalInt(input.timeoutMs, 1000, 120_000), engine(input.engine))
      }
      case 'containers.logsStart': return { streamId: await this.containers.logsStart(str(input.id, 'Container', 128), optionalInt(input.tail, 0, 5000), engine(input.engine)) }
      case 'containers.logsStop': this.containers.logsStop(str(input.streamId, 'Stream', 64)); return { ok: true }
      case 'containers.shell': {
        const shell = input.shell === 'bash' ? 'bash' : 'sh'
        const command = await this.containers.shellCommand(str(input.id, 'Container', 128), shell, engine(input.engine))
        if (this.shells.size >= MAX_SHELLS) this.shells.delete(this.shells.keys().next().value as string)
        const paneId = `${SHELL_PREFIX}${randomUUID()}`
        this.shells.set(paneId, { file: command.file, args: command.args })
        return { paneId }
      }
      case 'containers.suggestConnection': {
        // The suggestion only: a password found in the container stays in the main process.
        const found = await this.containers.suggestConnection(str(input.id, 'Container', 128), engine(input.engine))
        return found?.suggestion ?? null
      }
      default: throw new OxePodError('invalid', 'Unknown OxePod operation.')
    }
  }

  dispose(): void {
    this.containers.dispose()
  }
}
