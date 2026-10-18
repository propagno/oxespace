import { describe, expect, it } from 'vitest'
import { summarizeExplain } from '../../electron/main/services/oxequery/mongo-explain'

describe('summarizeExplain', () => {
  it('reads a classic find plan', () => {
    const summary = summarizeExplain({
      queryPlanner: { winningPlan: { stage: 'FETCH', inputStage: { stage: 'IXSCAN', indexName: 'sku_1' } } },
      executionStats: { totalDocsExamined: 1, totalKeysExamined: 1, nReturned: 1, executionTimeMillis: 0 }
    }, '{}')
    expect(summary).toMatchObject({ stage: 'IXSCAN', index: 'sku_1', docsExamined: 1, returned: 1 })
    expect(summary.warnings).toEqual([])
  })

  it('warns about a collection scan', () => {
    const summary = summarizeExplain({ queryPlanner: { winningPlan: { stage: 'COLLSCAN' } }, executionStats: { totalDocsExamined: 200, nReturned: 1 } }, '{}')
    expect(summary.stage).toBe('COLLSCAN')
    expect(summary.warnings.join(' ')).toMatch(/no index/)
  })

  it('reads the plan of an aggregate on the first $cursor stage', () => {
    const summary = summarizeExplain({ stages: [{ $cursor: { queryPlanner: { winningPlan: { stage: 'COUNT_SCAN', indexName: 'sku_1' } } } }] }, '{}')
    expect(summary).toMatchObject({ stage: 'COUNT_SCAN', index: 'sku_1' })
  })

  it('reads a MongoDB 8 plan wrapped in queryPlan next to a slot-based plan', () => {
    const summary = summarizeExplain({
      queryPlanner: { winningPlan: { queryPlan: { stage: 'GROUP', inputStage: { stage: 'FETCH', inputStage: { stage: 'IXSCAN', indexName: 'sku_1' } } }, slotBasedPlan: { slots: '$$RESULT=s1' } } }
    }, '{}')
    expect(summary).toMatchObject({ stage: 'IXSCAN', index: 'sku_1' })
    expect(summary.stages).toEqual(['GROUP', 'FETCH', 'IXSCAN'])
  })

  it('says unknown when the explain has no plan at all', () => {
    expect(summarizeExplain({}, '{}').stage).toBe('unknown')
  })
})
