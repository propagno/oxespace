import { describe, expect, it } from 'vitest'
import { buildAgentPrompt, describeTable } from '../../src/components/OxeQuery/agent-prompt'

const context = { connectionName: 'shop', engine: 'postgres' as const, environment: 'prod', sql: 'SELECT * FROM orders WHERE id = 1' }

describe('agent prompts', () => {
  it('explains a statement, naming the connection and sending the statement but no values from the database', () => {
    const prompt = buildAgentPrompt('explain', { ...context, tables: [describeTable('public', 'orders', [{ name: 'id', type: 'integer' }, { name: 'total', type: 'numeric' }])] })
    expect(prompt).toContain('PostgreSQL connection "shop" (prod)')
    expect(prompt).toContain('SELECT * FROM orders WHERE id = 1')
    expect(prompt).toContain('- public.orders (id integer, total numeric)')
    expect(prompt).toMatch(/oxespace_db_\* tools/)
    expect(prompt).toMatch(/Do not ask me to paste credentials/)
  })

  it('carries the error and its code for a fix, and the plan as lines for a plan', () => {
    const fix = buildAgentPrompt('fix', { ...context, errorMessage: 'relation "orders" does not exist', sqlState: '42P01' })
    expect(fix).toContain('SQLSTATE 42P01')
    expect(fix).toContain('relation "orders" does not exist')
    const plan = buildAgentPrompt('plan', { ...context, explain: { analyze: true, nodeCount: 2, hints: [], plan: { nodeType: 'Seq Scan', relation: 'orders', startupCost: 0, totalCost: 120, planRows: 10, actualRows: 9000, actualMs: 12.5, selfCostShare: 1, children: [{ nodeType: 'Hash', startupCost: 0, totalCost: 5, planRows: 1, selfCostShare: 0, children: [] }] } } })
    expect(plan).toContain('Seq Scan on orders (cost 120, rows 9000, 12.5 ms)')
    expect(plan).toContain('  Hash (cost 5, rows 1)')
    expect(plan).toContain('with timings')
  })

  it('asks for a query in the person\'s words and cuts a very long statement', () => {
    const write = buildAgentPrompt('write', { connectionName: 'logs', engine: 'mongodb', environment: 'dev', request: 'errors per hour' })
    expect(write).toContain('MongoDB query for this: errors per hour')
    const long = buildAgentPrompt('explain', { ...context, sql: 'x'.repeat(9000) })
    expect(long).toContain('3000 more characters left out')
    expect(long.length).toBeLessThan(8000)
  })
})
