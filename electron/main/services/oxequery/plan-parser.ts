import type { PlanNode } from '../../../../shared/types/oxequery'

const MAX_NODES = 2000
const MAX_DEPTH = 64

type Raw = Record<string, unknown>

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value.slice(0, 300) : undefined
}

/** The most useful single condition of a node, in the words of the plan. */
function detailOf(raw: Raw): string | undefined {
  for (const key of ['Index Cond', 'Hash Cond', 'Merge Cond', 'Join Filter', 'Filter', 'Recheck Cond', 'Sort Key', 'Group Key', 'One-Time Filter']) {
    const value = raw[key]
    if (typeof value === 'string' && value) return `${key}: ${value.slice(0, 240)}`
    if (Array.isArray(value) && value.length) return `${key}: ${value.map(String).join(', ').slice(0, 240)}`
  }
  return undefined
}

/**
 * Turns the JSON of `EXPLAIN (FORMAT JSON)` into a tree the page can draw.
 * `selfMs` is a node's own time (its total minus its children's), which is what
 * points at the slow step; without ANALYZE the same idea is applied to cost.
 */
export function parsePlan(root: unknown): { plan: PlanNode; nodeCount: number } {
  let nodeCount = 0
  const walk = (value: unknown, depth: number): PlanNode => {
    const raw = (value && typeof value === 'object' ? value : {}) as Raw
    if (++nodeCount > MAX_NODES || depth > MAX_DEPTH) return { nodeType: '…', startupCost: 0, totalCost: 0, planRows: 0, selfCostShare: 0, children: [] }
    const plans = Array.isArray(raw.Plans) ? raw.Plans : []
    const children = plans.map(child => walk(child, depth + 1))
    const loops = num(raw['Actual Loops']) ?? 1
    const actualMs = num(raw['Actual Total Time'])
    const totalCost = num(raw['Total Cost']) ?? 0
    const childMs = children.reduce((sum, child) => sum + (child.actualMs !== undefined ? child.actualMs * (child.loops ?? 1) : 0), 0)
    const childCost = children.reduce((sum, child) => sum + child.totalCost, 0)
    const node: PlanNode = {
      nodeType: text(raw['Node Type']) ?? 'Unknown',
      startupCost: num(raw['Startup Cost']) ?? 0,
      totalCost,
      planRows: num(raw['Plan Rows']) ?? 0,
      selfCostShare: 0,
      children,
      ...(text(raw['Relation Name']) ? { relation: `${text(raw['Schema']) ? `${text(raw['Schema'])}.` : ''}${text(raw['Relation Name'])}` } : {}),
      ...(text(raw['Index Name']) ? { index: text(raw['Index Name']) } : {}),
      ...(text(raw['Alias']) && text(raw['Alias']) !== text(raw['Relation Name']) ? { alias: text(raw['Alias']) } : {}),
      ...(text(raw['Join Type']) ? { joinType: text(raw['Join Type']) } : {}),
      ...(detailOf(raw) ? { detail: detailOf(raw) } : {}),
      ...(actualMs !== undefined ? { actualMs, selfMs: Math.max(0, actualMs * loops - childMs) } : {}),
      ...(num(raw['Actual Rows']) !== undefined ? { actualRows: num(raw['Actual Rows']), loops } : {}),
      ...(num(raw['Shared Read Blocks']) ? { readBlocks: num(raw['Shared Read Blocks']) } : {}),
      // Cost left after removing what the children cost; kept as an absolute for the share below.
      ...(totalCost - childCost > 0 ? { selfCost: totalCost - childCost } : {})
    }
    return node
  }

  const first = Array.isArray(root) ? root[0] : root
  const planRoot = (first && typeof first === 'object' ? (first as Raw).Plan : undefined) ?? first
  const plan = walk(planRoot, 0)

  // Shares are relative to the whole plan so the heaviest steps stand out.
  const total = plan.actualMs !== undefined ? plan.actualMs * (plan.loops ?? 1) : plan.totalCost
  const mark = (node: PlanNode): void => {
    const own = node.selfMs !== undefined ? node.selfMs : node.selfCost ?? 0
    node.selfCostShare = total > 0 ? Math.min(1, own / total) : 0
    for (const child of node.children) mark(child)
  }
  mark(plan)
  return { plan, nodeCount }
}

/** A plain-language note per notable pattern, most useful first. Kept short on purpose. */
export function planHints(plan: PlanNode): string[] {
  const hints: string[] = []
  const visit = (node: PlanNode): void => {
    if (node.nodeType === 'Seq Scan' && node.relation && (node.actualRows ?? node.planRows) > 10_000 && node.detail?.startsWith('Filter')) {
      hints.push(`${node.relation} is read in full and filtered (${(node.actualRows ?? node.planRows).toLocaleString()} rows). An index on the filtered column may help.`)
    }
    if (node.actualRows !== undefined && node.planRows > 0 && node.actualRows / node.planRows > 50) {
      hints.push(`${node.nodeType}${node.relation ? ` on ${node.relation}` : ''} returned ${node.actualRows.toLocaleString()} rows where ${node.planRows.toLocaleString()} were expected; statistics may be stale (ANALYZE).`)
    }
    for (const child of node.children) visit(child)
  }
  visit(plan)
  return hints.slice(0, 5)
}
