import type { RemoteMessageParams } from '../../shared/messages/remote'

/** The parameter names each remote code carries, as the catalogs must interpolate them (C3 contract, S0.1 part 2b). */
export const REMOTE_PARAMETERS: Record<keyof RemoteMessageParams, string[]> = {
  'remote.port.privileged': ['port'],
  'remote.port.inUse': ['port'],
  'remote.network.noPrivateInterface': [],
  'remote.certificate.failed': []
}
