export const FEATURE_USAGE_KEYS = [
  'approvalsQueue',
  'commandBar',
  'agentBrowser',
  'deviceEmulation',
  'androidMirror',
  'showOnPhone',
  'paneConversation',
  'splitConversations',
  'approvalPreview',
  'alwaysAllow',
  'agentPermissions',
  'httpCalls',
  'agentActivity',
  'containersPanel',
  'worktreesPanel',
  'prSummary',
  'timeTravel',
  'branchFromCheckpoint'
] as const

export type FeatureUsageKey = (typeof FEATURE_USAGE_KEYS)[number]

const CATALOG: ReadonlySet<string> = new Set<string>(FEATURE_USAGE_KEYS)

export function isFeatureUsageKey(value: unknown): value is FeatureUsageKey {
  return typeof value === 'string' && CATALOG.has(value)
}

export interface FeatureUsageRow {
  feature: FeatureUsageKey
  uses: number
  lastUsed: number
}

export interface FeatureUsageStatus {
  enabled: boolean
  since: number | null
  rows: FeatureUsageRow[]
}

export interface FeatureUsageExport {
  exportedAt: number
  since: number | null
  rows: FeatureUsageRow[]
}
