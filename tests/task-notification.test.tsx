import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { taskNotification } from '../shared/native-session-text'
import { ThreadMessageRow } from '../src/components/Threads/ThreadMessageRow'

afterEach(cleanup)

const notice = ['<task-notification>', '<task-id>bl1tppya5</task-id>', '<tool-use-id>toolu_01</tool-use-id>', '<output-file>C:\\tasks\\bl1tppya5.output</output-file>',
  '<status>completed</status>', '<summary>Background command "Wait for CI" completed (exit code 0)</summary>', '</task-notification>'].join('\n')

describe('background task notices', () => {
  it('are read from the message Claude Code adds, and nothing else is', () => {
    expect(taskNotification(notice)).toEqual({ status: 'completed', summary: 'Background command "Wait for CI" completed (exit code 0)' })
    expect(taskNotification('Please look at <task-notification> handling')).toBeNull()
    expect(taskNotification('<task-notification><task-id>x</task-id></task-notification>')).toEqual({ status: 'finished', summary: '' })
  })

  it('show as a note instead of a message from the person', () => {
    const props = { event: { type: 'message' as const, id: 'native:1', role: 'user' as const, text: notice }, turnEvents: [], snapshot: null, onCopy: () => {}, onQuickReply: () => {}, onQuote: () => {} }
    render(<ThreadMessageRow {...(props as unknown as Parameters<typeof ThreadMessageRow>[0])} />)
    expect(screen.getByRole('note')).toHaveTextContent('Background task completed: Background command "Wait for CI" completed (exit code 0)')
    expect(document.querySelector('.thread-message-user')).toBeNull()
  })
})
