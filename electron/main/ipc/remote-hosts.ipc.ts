import { BrowserWindow, ipcMain } from 'electron'
import type { IPty } from 'node-pty'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type {
  RemoteHostActivePane,
  RemoteHostCallOp,
  RemoteHostCallResult,
  RemoteHostConnectionStatus,
  RemoteSshHostInput
} from '../../../shared/types/remote-hosts'
import type { AppDatabase } from '../db'
import type { SecretCipher } from '../services/oxequery/connection-store'
import { RemoteSshHostsService } from '../services/ssh/remote-ssh-hosts.service'
import { SshClientError } from '../services/ssh/ssh-client.service'
import { createSshHostedPty, type SshHostedPty } from '../services/ssh/ssh-hosted-pty'

export const REMOTE_HOSTS_OPS: readonly RemoteHostCallOp[] = [
  'hosts.list',
  'hosts.create',
  'hosts.update',
  'hosts.remove',
  'hosts.probeKey',
  'hosts.pinFingerprint',
  'hosts.importConfig',
  'hosts.openPane',
  'hosts.reconnectPane',
  'hosts.panes'
]

const VALID_OPS = new Set<string>(REMOTE_HOSTS_OPS)

export interface RemoteHostsIpcController {
  call(op: RemoteHostCallOp, input: unknown): Promise<RemoteHostCallResult>
  resolvePanePty(
    paneId: string,
    geometry: { cols: number; rows: number }
  ): Promise<{ pty: IPty; cwd: string; label: string; command?: string } | undefined>
}

export interface RemoteHostsControllerDeps {
  db: AppDatabase
  cipher: SecretCipher
  createWorkspacePane?: (input: { workspaceId: string; displayName: string }) => { paneId: string }
  onChanged?: () => void
}

interface TrackedRemotePane {
  paneId: string
  hostId: string
  workspaceId: string
  label: string
  status: RemoteHostConnectionStatus
  pty?: SshHostedPty
}

function toErrorResult(error: unknown): RemoteHostCallResult {
  if (error instanceof SshClientError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.reasons ? { reasons: error.reasons } : {})
      }
    }
  }
  return {
    ok: false,
    error: {
      code: 'failed',
      message: error instanceof Error ? error.message : 'Remote SSH host request failed'
    }
  }
}

export function createRemoteHostsController(deps: RemoteHostsControllerDeps): RemoteHostsIpcController {
  const service = new RemoteSshHostsService(deps.db, deps.cipher)
  const panes = new Map<string, TrackedRemotePane>()
  const notify = (): void => { deps.onChanged?.() }

  const listPanes = (): RemoteHostActivePane[] =>
    [...panes.values()].map(entry => ({
      paneId: entry.paneId,
      hostId: entry.hostId,
      workspaceId: entry.workspaceId,
      status: entry.status,
      label: entry.label
    }))

  return {
    async resolvePanePty(paneId, geometry) {
      const tracked = panes.get(paneId)
      if (!tracked) return undefined
      const host = service.get(tracked.hostId)
      if (!host) return undefined

      tracked.status = 'connecting'
      notify()
      try {
        const config = service.resolveConnectionConfig(host.id)
        const pty = await createSshHostedPty({
          config,
          cols: geometry.cols,
          rows: geometry.rows,
          ...(host.defaultRemoteDir ? { initialDir: host.defaultRemoteDir } : {})
        })
        tracked.pty = pty
        tracked.status = pty.state === 'connected' ? 'connected' : 'connecting'
        notify()
        pty.onState(next => {
          if (next === 'closed') {
            panes.delete(paneId)
          } else {
            tracked.status = next
          }
          notify()
        })
        return {
          pty,
          cwd: host.defaultRemoteDir || '~',
          label: `${host.name} (${host.username}@${host.host})`
        }
      } catch (error) {
        tracked.status = 'error'
        notify()
        throw error
      }
    },

    async call(op, input): Promise<RemoteHostCallResult> {
      try {
        const body = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>

        if (op === 'hosts.list') {
          return { ok: true, data: service.list() }
        }
        if (op === 'hosts.panes') {
          return { ok: true, data: listPanes() }
        }
        if (op === 'hosts.create') {
          const created = service.create(body as unknown as RemoteSshHostInput)
          notify()
          return { ok: true, data: created }
        }
        if (op === 'hosts.update') {
          const id = String(body.id ?? '')
          const patch = (body.patch && typeof body.patch === 'object' ? body.patch : body) as Partial<RemoteSshHostInput>
          const updated = service.update(id, patch)
          notify()
          return { ok: true, data: updated }
        }
        if (op === 'hosts.remove') {
          const id = String(body.id ?? '')
          service.remove(id)
          for (const [paneId, tracked] of [...panes.entries()]) {
            if (tracked.hostId === id) {
              tracked.pty?.kill()
              panes.delete(paneId)
            }
          }
          notify()
          return { ok: true, data: { removed: true } }
        }
        if (op === 'hosts.probeKey') {
          const host = String(body.host ?? '')
          const port = body.port !== undefined ? Number(body.port) : 22
          const fingerprint = await service.probeHostKey({ host, port })
          return { ok: true, data: { fingerprint } }
        }
        if (op === 'hosts.pinFingerprint') {
          const id = String(body.id ?? '')
          const fingerprint = String(body.fingerprint ?? '')
          const updated = service.pinFingerprint(id, fingerprint)
          notify()
          return { ok: true, data: updated }
        }
        if (op === 'hosts.importConfig') {
          const content = typeof body.content === 'string' ? body.content : undefined
          const result = service.importFromSshConfig(content)
          if (result.imported.length > 0) notify()
          return { ok: true, data: result }
        }
        if (op === 'hosts.openPane') {
          const hostId = String(body.hostId ?? '')
          const workspaceId = String(body.workspaceId ?? '')
          const host = service.get(hostId)
          if (!host) throw new Error(`Remote SSH host ${hostId} not found`)
          if (!host.pinnedFingerprint) {
            const presented = await service.probeHostKey({ host: host.host, port: host.port })
            throw new SshClientError(
              'host-key-unknown',
              `${host.host}:${host.port} presented an untrusted host key. Verify and pin its SHA-256 fingerprint before connecting.`,
              [presented]
            )
          }
          const label = `${host.name} (${host.username}@${host.host})`
          const paneId = typeof body.paneId === 'string' && body.paneId.trim()
            ? body.paneId.trim()
            : deps.createWorkspacePane
              ? deps.createWorkspacePane({ workspaceId, displayName: host.name }).paneId
              : `remote-ssh:${host.id}:${Date.now()}`

          const entry: TrackedRemotePane = {
            paneId,
            hostId: host.id,
            workspaceId,
            label,
            status: 'connecting'
          }
          panes.set(paneId, entry)
          notify()
          return {
            ok: true,
            data: { paneId, hostId: host.id, workspaceId, status: entry.status, label } satisfies RemoteHostActivePane
          }
        }
        if (op === 'hosts.reconnectPane') {
          const paneId = String(body.paneId ?? '')
          const tracked = panes.get(paneId)
          if (!tracked || !tracked.pty) throw new Error(`Remote SSH pane ${paneId} is not active`)
          await tracked.pty.reconnect()
          tracked.status = tracked.pty.state === 'connected' ? 'connected' : 'disconnected'
          notify()
          return { ok: true, data: { paneId, status: tracked.status } }
        }
        return { ok: false, error: { code: 'unknown_op', message: `Unsupported remote hosts operation: ${String(op)}` } }
      } catch (error) {
        return toErrorResult(error)
      }
    }
  }
}

/** Registers the single validated `remoteHosts:call` IPC channel using a lazy controller loader. */
export function registerRemoteHostsIpc(load: () => Promise<RemoteHostsIpcController>): void {
  ipcMain.handle(IPC_CHANNELS.remoteHosts.call, async (_event, request: unknown) => {
    const body = request && typeof request === 'object' ? request as { op?: unknown; input?: unknown } : {}
    if (typeof body.op !== 'string' || !VALID_OPS.has(body.op)) {
      return { ok: false, error: { code: 'invalid_op', message: 'Unknown remote hosts operation' } } satisfies RemoteHostCallResult
    }
    const controller = await load()
    return controller.call(body.op as RemoteHostCallOp, body.input)
  })
}

export function broadcastRemoteHostsChanged(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.remoteHosts.changed)
  }
}
