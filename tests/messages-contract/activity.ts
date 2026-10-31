import type { ActivityMessageParams } from '../../shared/messages/activity'

/** The parameter names each activity code carries, as the catalogs must interpolate them (C3 contract, S0.1 part 2b). */
export const ACTIVITY_PARAMETERS: Record<keyof ActivityMessageParams, string[]> = {
  'activity.invalid': [],
  'activity.tooMany': ['max'],
  'activity.titleTooLong': ['max'],
  'activity.detailTooLong': ['max'],
  'activity.hiddenCharacters': [],
  'activity.future': [],
  'activity.secret': []
}
