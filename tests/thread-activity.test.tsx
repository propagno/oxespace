import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { groupThreadEvents, ThreadActivityGroup } from '../src/components/Threads/ThreadActivityGroup'
import type { ThreadEvent } from '../shared/types/thread'
afterEach(cleanup)
it('collapses twelve consecutive tools without swallowing messages or approvals', () => {
  const tools: Extract<ThreadEvent, { type: 'tool' }>[] = Array.from({ length: 12 }, (_, i) => ({ type: 'tool', id: String(i), name: 'commandExecution', state: 'completed', detail: `git show ${i}`, output: `result ${i}`, exitCode: 0, turnId: 'turn' }))
  const blocks = groupThreadEvents([...tools, { type: 'approval', id: 'permission', title: 'Approve', detail: 'Write' }, { ...tools[0], id: 'next' }])
  expect(blocks.map(block => block.type)).toEqual(['activity-group', 'approval', 'activity-group'])
  render(<ThreadActivityGroup events={tools} />)
  expect(screen.getByText(/12 actions/)).toBeVisible()
  expect(screen.getByText(/result 0/, { selector: 'pre' })).not.toBeVisible()
  fireEvent.click(screen.getByText('Ran commands'))
  fireEvent.click(screen.getByText('Completed actions'))
  fireEvent.click(screen.getByText('git show 0', { selector: 'small' }))
  fireEvent.click(screen.getAllByText('Technical details')[0])
  expect(screen.getByText(/result 0/, { selector: 'pre' })).toBeVisible()
})

it('classifies infrastructure failures and keeps verbose MCP payloads behind technical details', () => {
  const tool: Extract<ThreadEvent, { type: 'tool' }> = {
    type: 'tool', id: 'mcp', name: 'mcpToolCall', state: 'failed', detail: 'oxespace_quality_check',
    output: `OXESpace main unavailable after 3 attempts: request timed out\n${'diagnostic line\n'.repeat(80)}`
  }
  render(<ThreadActivityGroup events={[tool]} />)
  fireEvent.click(screen.getByText('Used integration'))
  expect(screen.getByText('Response timed out')).toBeVisible()
  expect(screen.getByText('Technical details')).toBeVisible()
  expect(screen.getByText(/diagnostic line/, { selector: 'pre' })).not.toBeVisible()
  fireEvent.click(screen.getByText('Technical details'))
  expect(screen.getByText(/diagnostic line/, { selector: 'pre' })).toBeVisible()
})
