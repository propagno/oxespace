/**
 * F6 A19 (TABS): the conversation's tabs, only for the tools it actually used, in fixed cockpit order.
 * A failed source (`null`) adds no tab: an unknown count never invents a tool the conversation may not have used.
 */
export const TOOL_TABS = [
  'conversation',
  'terminal',
  'queries',
  'network',
  'containers',
  'changes',
  'pullRequest'
] as const

export type ToolTab = (typeof TOOL_TABS)[number]

export interface ThreadToolTabEntry {
  tab: ToolTab
  count: number | null
}

export interface ThreadToolTabsInput {
  summary: {
    databases: number | null
    http: number | null
    containers: number | null
  } | null
  files: number | null
  panes: number | null
  pullRequest: { number: number } | null
}

function positive(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

export function threadToolTabs(input: ThreadToolTabsInput): Array<{ tab: ToolTab; count: number | null }> {
  const tabs: Array<{ tab: ToolTab; count: number | null }> = [{ tab: 'conversation', count: null }]
  if (positive(input.panes)) tabs.push({ tab: 'terminal', count: input.panes })
  if (positive(input.summary?.databases)) tabs.push({ tab: 'queries', count: input.summary!.databases })
  if (positive(input.summary?.http)) tabs.push({ tab: 'network', count: input.summary!.http })
  if (positive(input.summary?.containers)) tabs.push({ tab: 'containers', count: input.summary!.containers })
  if (positive(input.files)) tabs.push({ tab: 'changes', count: input.files })
  if (input.pullRequest) tabs.push({ tab: 'pullRequest', count: null })
  return tabs
}
