/** C3 message codes of the remote domain (`remote.*`); merged into `MessageParams` and `MESSAGE_CODES` by shared/messages.ts. */

export interface RemoteMessageParams {
  /** The person picked a port below 1024 for the remote gateway. */
  'remote.port.privileged': { port: number }
  /** Another program already listens on the gateway's port. */
  'remote.port.inUse': { port: number }
  /** No private network interface (RFC 1918, link-local, ULA) to listen on. */
  'remote.network.noPrivateInterface': Record<string, never>
  /** The gateway's certificate could not be made or read back from secure storage. */
  'remote.certificate.failed': Record<string, never>
}

export const REMOTE_MESSAGE_CODES = [
  'remote.port.privileged',
  'remote.port.inUse',
  'remote.network.noPrivateInterface',
  'remote.certificate.failed'
] as const satisfies readonly (keyof RemoteMessageParams)[]
