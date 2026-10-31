import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { findRows, rowSearchText, textRanges } from '../src/components/Threads/threadFind'
import { ThreadFindBar } from '../src/components/Threads/ThreadFindBar'
import type { ThreadTimelineItem } from '../src/components/Threads/threadTimelineModel'

afterEach(cleanup)
const row = (key: string, event: ThreadTimelineItem['event']): ThreadTimelineItem => ({ key, event, turnId: 't', turnEvents: [], firstInTurn: false, lastInTurn: false })
const rows = [
  row('a', { type: 'message', id: 'm1', role: 'user', text: 'Fix the Login form' }),
  row('b', { type: 'activity-group', id: 'g', events: [{ type: 'tool', id: 'x', name: 'Bash', detail: 'npm run login-test', state: 'completed' }] } as never),
  row('c', { type: 'message', id: 'm2', role: 'assistant', text: 'Done.' }),
  row('d', { type: 'completed', status: 'failed', failure: { id: 'f', occurredAt: 1, code: 'network', message: 'Login server down' } })
]

describe('threadFind', () => {
  it('searches messages, tool details and failures, case-insensitively, in order', () => {
    expect(findRows(rows, 'login')).toEqual([0, 1, 3])
    expect(findRows(rows, '  ')).toEqual([])
    expect(rowSearchText(rows[1])).toContain('npm run login-test')
  })

  it('finds every occurrence inside a rendered row', () => {
    const div = document.createElement('div')
    div.innerHTML = '<p>login <b>LOGIN</b> logout</p>'
    expect(textRanges(div, 'login').map(range => range.toString())).toEqual(['login', 'LOGIN'])
  })
})

describe('ThreadFindBar', () => {
  it('counts matches, scrolls to each one and closes with Escape', () => {
    const scrollTo = vi.fn(), onClose = vi.fn()
    render(<ThreadFindBar rows={rows} scrollRoot={{ current: null }} scrollTo={scrollTo} onClose={onClose} />)
    const input = screen.getByRole('searchbox', { name: 'Find in conversation' })
    fireEvent.change(input, { target: { value: 'login' } })
    expect(screen.getByText('1 of 3')).toBeInTheDocument()
    expect(scrollTo).toHaveBeenLastCalledWith(0)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByText('2 of 3')).toBeInTheDocument()
    expect(scrollTo).toHaveBeenLastCalledWith(1)
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(screen.getByText('3 of 3')).toBeInTheDocument()
    fireEvent.change(input, { target: { value: 'nothing here' } })
    expect(screen.getByText('No results')).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
