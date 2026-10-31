import type { OxepodMessageParams } from '../../shared/messages/oxepod'

/** The parameter names each oxepod code carries, as the catalogs must interpolate them (C3 contract, S0.1 part 2b). */
export const OXEPOD_PARAMETERS: Record<keyof OxepodMessageParams, string[]> = {
  'oxepod.startFailed': ['reason']
}
