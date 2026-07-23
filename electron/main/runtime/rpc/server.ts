import { randomBytes } from 'node:crypto'
import { chmodSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppDatabase } from '../../db/index'
import type { GitHubService } from '../../services/github.service'
import { LocalExecutionHost, type ExecutionHost } from '../execution-host'
import { RpcDispatcher } from './dispatcher'
import { registerRpcMethods } from './methods'
import { defaultRpcEndpoint, RpcTransport } from './transport'

export interface RpcServerHandle {
  endpoint: string
  token: string
  dispatcher: RpcDispatcher
  executionHost: ExecutionHost
  stop: () => Promise<void>
}

export interface StartRpcServerOptions {
  db: AppDatabase
  gitHubService: GitHubService
  appVersion: string
  /** userData directory — holds the endpoint descriptor for out-of-process callers. */
  userDataPath: string
  instanceId?: string
  executionHost?: ExecutionHost
  onError?: (error: Error) => void
}

/**
 * F3 · Starts the local RPC bus and publishes its endpoint + token to
 * `<userData>/rpc-endpoint.json` so a CLI can find it without guessing.
 */
export async function startRpcServer(options: StartRpcServerOptions): Promise<RpcServerHandle> {
  const instanceId = options.instanceId ?? randomBytes(4).toString('hex')
  const token = randomBytes(32).toString('hex')
  const executionHost = options.executionHost ?? new LocalExecutionHost()

  const dispatcher = new RpcDispatcher()
  registerRpcMethods(dispatcher, {
    db: options.db,
    gitHubService: options.gitHubService,
    executionHost,
    appVersion: options.appVersion
  })

  const endpoint = defaultRpcEndpoint(instanceId, options.userDataPath)
  const transport = new RpcTransport({ dispatcher, token, endpoint, onError: options.onError })
  await transport.start()

  const descriptorPath = join(options.userDataPath, 'rpc-endpoint.json')
  writeFileSync(descriptorPath, JSON.stringify({ endpoint, token, pid: process.pid }, null, 2), 'utf8')
  // Best effort on Windows (POSIX modes are advisory there); the pipe itself is
  // already scoped to the logged-in user.
  try {
    chmodSync(descriptorPath, 0o600)
  } catch {
    /* ignore */
  }

  return {
    endpoint,
    token,
    dispatcher,
    executionHost,
    stop: () => transport.stop()
  }
}
