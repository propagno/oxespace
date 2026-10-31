import type { AppMessageParams } from '../../shared/messages/app'

/** The parameter names each app code carries, as the catalogs must interpolate them (C3 contract, S0.1 part 2b). */
export const APP_PARAMETERS: Record<keyof AppMessageParams, string[]> = {
  'app.connectivity.offline': [],
  'oxe.status.unreadable': [],
  'oxe.dashboard.timeout': [],
  'memory.disabled': [],
  'memory.unavailable': [],
  'memory.runtimeUnavailable': []
}
