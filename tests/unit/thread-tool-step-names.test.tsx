// Regression of OXE-167's T7: Codex and Antigravity name a command "commandExecution" and an edit "fileChange". Their
// steps read as a command and as an edit (AG-11 2.3 and 2.4), never as an unknown tool.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { ThreadActivityGroup } from '../../src/components/Threads/ThreadActivityGroup'
import type { ThreadEvent } from '../../shared/types/thread'
import '../../src/i18n'

type Tool = Extract<ThreadEvent, { type: 'tool' }>

afterEach(cleanup)

function renderStep(event: Partial<Tool> & Pick<Tool, 'name' | 'state'>): HTMLElement {
  const tool = { type: 'tool', id: 'step-1', detail: '', ...event } as Tool
  const { container } = render(<ThreadActivityGroup events={[tool]} mode="normal" rootPath="/repo" />)
  const steps = container.querySelectorAll<HTMLElement>('[data-ui="step"]')
  expect(steps).toHaveLength(1)
  return steps[0]
}

describe('the tool names of Codex and Antigravity', () => {
  test('commandExecution reads "$ command" in one closed line when it exits 0', () => {
    const step = renderStep({ name: 'commandExecution', state: 'completed', detail: 'npm run typecheck', output: 'checks passed', exitCode: 0 })
    expect(step).toHaveAttribute('data-kind', 'run')
    expect(step.querySelector('code')?.textContent).toBe('$ npm run typecheck')
    expect(step.querySelector('[data-ui="kind-badge"]')).toBeNull()
    expect(step.querySelector('.thread-step-toggle')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('checks passed')).toBeNull()
  })

  test('a failed commandExecution opens by itself with its output', () => {
    const step = renderStep({ name: 'commandExecution', state: 'failed', detail: 'npm test', output: 'FAIL auth', exitCode: 1 })
    expect(step).toHaveAttribute('data-kind', 'run')
    expect(step.querySelector('code')?.textContent).toBe('$ npm test')
    expect(step.querySelector('.thread-step-toggle')).toHaveAttribute('aria-expanded', 'true')
    expect(step.querySelector('[data-ui="step-output"]')?.textContent).toBe('FAIL auth')
  })

  test('fileChange reads as an edit, with the file pill and its added and removed lines', () => {
    const files = [{ path: '/repo/src/App.tsx', kind: 'update', state: 'completed', source: 'native-patch', additions: 6, deletions: 2 }] as Tool['files']
    const step = renderStep({ name: 'fileChange', state: 'completed', detail: '/repo/src/App.tsx', files })
    expect(step).toHaveAttribute('data-kind', 'edit')
    expect(step.querySelector('[data-ui="file-pill"]')?.textContent).toBe('src/App.tsx')
    expect(screen.getByText('+6 −2')).toBeInTheDocument()
  })
})
