export type RemoteSshAuthType = 'key' | 'password' | 'agent'

export interface RemoteSshHost {
  id: string
  name: string
  host: string
  port: number
  username: string
  authType: RemoteSshAuthType
  keyPath: string | null
  hasSecret: boolean
  pinnedFingerprint: string | null
  defaultRemoteDir: string | null
  createdAt: number
  updatedAt: number
}

export interface RemoteSshHostInput {
  name: string
  host: string
  port?: number
  username: string
  authType: RemoteSshAuthType
  keyPath?: string | null
  /** Password (authType='password') or private key passphrase (authType='key'). Never returned over IPC. */
  secret?: string | null
  pinnedFingerprint?: string | null
  defaultRemoteDir?: string | null
}

export type RemoteHostConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'

export interface RemoteHostActivePane {
  paneId: string
  hostId: string
  workspaceId: string
  status: RemoteHostConnectionStatus
  label: string
}

export type RemoteHostCallOp =
  | 'hosts.list'
  | 'hosts.create'
  | 'hosts.update'
  | 'hosts.remove'
  | 'hosts.probeKey'
  | 'hosts.pinFingerprint'
  | 'hosts.importConfig'
  | 'hosts.openPane'
  | 'hosts.reconnectPane'
  | 'hosts.panes'

export interface RemoteHostError {
  code: string
  message: string
  reasons?: string[]
}

export type RemoteHostCallResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: RemoteHostError }

export interface RemoteHostsApi {
  call<T = unknown>(op: RemoteHostCallOp, input?: unknown): Promise<RemoteHostCallResult<T>>
  onChanged(listener: () => void): () => void
}
