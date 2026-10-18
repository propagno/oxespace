import { describe, expect, it } from 'vitest'
import { parsePlan, planHints } from '../../electron/main/services/oxequery/plan-parser'

const analyzed = [{
  Plan: {
    'Node Type': 'Sort', 'Startup Cost': 10, 'Total Cost': 20, 'Plan Rows': 100, 'Actual Rows': 100, 'Actual Total Time': 10, 'Actual Loops': 1, 'Sort Key': ['a'],
    Plans: [{
      'Node Type': 'Seq Scan', 'Relation Name': 'orders', Schema: 'public', Alias: 'o', 'Startup Cost': 0, 'Total Cost': 15, 'Plan Rows': 2, 'Actual Rows': 5000,
      'Actual Total Time': 8, 'Actual Loops': 1, Filter: '(status = 1)'
    }]
  },
  'Planning Time': 0.1, 'Execution Time': 10.2
}]

describe('parsePlan', () => {
  it('computes self time and shares for an analyzed plan', () => {
    const { plan, nodeCount } = parsePlan(analyzed)
    expect(nodeCount).toBe(2)
    expect(plan.selfMs).toBeCloseTo(2)
    expect(plan.children[0].selfMs).toBeCloseTo(8)
    expect(plan.children[0].selfCostShare).toBeCloseTo(0.8)
    expect(plan.children[0].relation).toBe('public.orders')
    expect(plan.children[0].detail).toContain('Filter')
  })
  it('falls back to cost when the plan was not analyzed', () => {
    const { plan } = parsePlan([{ Plan: { 'Node Type': 'Limit', 'Total Cost': 10, 'Plan Rows': 1, Plans: [{ 'Node Type': 'Seq Scan', 'Total Cost': 9, 'Plan Rows': 1 }] } }])
    expect(plan.selfCostShare).toBeCloseTo(0.1)
    expect(plan.children[0].selfCostShare).toBeCloseTo(0.9)
  })
  it('caps a hostile plan instead of recursing forever', () => {
    let node: Record<string, unknown> = { 'Node Type': 'Result' }
    for (let i = 0; i < 500; i++) node = { 'Node Type': 'Result', Plans: [node] }
    expect(parsePlan([{ Plan: node }]).nodeCount).toBeLessThanOrEqual(2001)
  })
  it('tolerates garbage', () => {
    expect(parsePlan(null).plan.nodeType).toBe('Unknown')
  })
})

describe('planHints', () => {
  it('flags a misestimate', () => {
    const { plan } = parsePlan(analyzed)
    expect(planHints(plan).join(' ')).toMatch(/statistics/)
  })
})
