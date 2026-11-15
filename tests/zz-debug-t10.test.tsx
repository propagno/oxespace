// DEBUG ONLY (never committed): the DOM ExplainView renders for pq07-explain's fixture, with T10's failed patch applied.
import { cleanup, render } from '@testing-library/react'
import { afterEach, test, vi } from 'vitest'
import { ExplainView } from '../src/components/OxeQuery/ExplainView'
import type { SqlExplain } from '../shared/types/oxequery'

const node = (nodeType: string, selfCostShare: number, children: SqlExplain['plan'][] = []) =>
  ({ nodeType, startupCost: 0, totalCost: 10, planRows: 5, selfCostShare, children }) as SqlExplain['plan']
const explain: SqlExplain = { analyze: false, plan: node('Sort', 0.99, [node('Seq Scan', 0.01)]), nodeCount: 2, hints: [] }
afterEach(() => cleanup())

test('DIAG t10 dom', () => {
  render(<ExplainView explain={explain} onClose={vi.fn()} />)
  const steps = [...document.querySelectorAll<HTMLElement>('.oq-plan-node')]
  console.log(`DIAG steps=${steps.length}`)
  steps.forEach((step, i) => console.log(`DIAG step${i} hot=${step.getAttribute('data-hot')} text=${JSON.stringify(step.textContent?.slice(0, 80))} share=${!!step.querySelector('.oq-plan-share')} fill=${!!step.querySelector('.oq-plan-share > *')}`))
  steps.forEach((step, i) => console.log(`DIAG outer${i}=${step.outerHTML.slice(0, 1200)}`))
})
