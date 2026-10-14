import type { MongoExplainSummary } from '../../../../shared/types/oxequery'

type Plan = Record<string, unknown>

const asRecord = (value: unknown): Plan | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Plan : null
const asNumber = (value: unknown): number | undefined => typeof value === 'number' ? value : undefined

/** Stage names from the outermost to the innermost input of a winning plan. */
function stagesOf(plan: Plan | null): string[] {
  const names: string[] = []
  for (let node = plan, depth = 0; node && depth < 32; depth++) {
    if (typeof node.stage === 'string') names.push(node.stage)
    const inputs = Array.isArray(node.inputStages) ? asRecord(node.inputStages[0]) : null
    node = asRecord(node.inputStage) ?? inputs
  }
  return names
}

function indexOf(plan: Plan | null): string | undefined {
  for (let node = plan, depth = 0; node && depth < 32; depth++) {
    if (typeof node.indexName === 'string') return node.indexName
    node = asRecord(node.inputStage) ?? (Array.isArray(node.inputStages) ? asRecord(node.inputStages[0]) : null)
  }
  return undefined
}

/** Where the planner output lives for a find (top level) and for an aggregate (inside the first `$cursor` stage). */
function plannerOf(explain: Plan): { planner: Plan | null; stats: Plan | null } {
  const top = asRecord(explain.queryPlanner)
  if (top) return { planner: top, stats: asRecord(explain.executionStats) }
  const stages = Array.isArray(explain.stages) ? explain.stages : []
  const cursor = asRecord(asRecord(stages[0])?.$cursor)
  return { planner: asRecord(cursor?.queryPlanner), stats: asRecord(cursor?.executionStats) }
}

/** What an explain says in words: the access path, the work done and what to look at. */
export function summarizeExplain(explain: Plan, raw: string): MongoExplainSummary {
  const { planner, stats } = plannerOf(explain)
  const winning = asRecord(planner?.winningPlan)
  const stages = stagesOf(winning)
  const stage = ['COLLSCAN', 'IXSCAN', 'COUNT_SCAN', 'DISTINCT_SCAN'].find(name => stages.includes(name)) ?? stages[stages.length - 1] ?? 'unknown'
  const docsExamined = asNumber(stats?.totalDocsExamined)
  const keysExamined = asNumber(stats?.totalKeysExamined)
  const returned = asNumber(stats?.nReturned)
  const warnings: string[] = []
  if (stage === 'COLLSCAN') warnings.push('The whole collection is read: no index serves this query. An index on the filtered or sorted fields would help.')
  if (stages.includes('SORT')) warnings.push('The sort happens in memory because no index provides the order. A large result can exceed the sort memory limit.')
  if (docsExamined !== undefined && returned !== undefined && returned > 0 && docsExamined / returned > 100) {
    warnings.push(`${docsExamined} documents were read to return ${returned}. The index is not selective for this filter.`)
  }
  const index = indexOf(winning)
  return {
    stage, ...(index ? { index } : {}), ...(keysExamined !== undefined ? { keysExamined } : {}), ...(docsExamined !== undefined ? { docsExamined } : {}),
    ...(returned !== undefined ? { returned } : {}), ...(asNumber(stats?.executionTimeMillis) !== undefined ? { timeMs: asNumber(stats?.executionTimeMillis)! } : {}),
    stages, warnings, raw
  }
}
