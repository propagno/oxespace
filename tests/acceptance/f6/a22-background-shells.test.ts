// Frozen acceptance test for 1.5.0 A22 / T77 (OXE program, phase F6): a conversation's background shells, from the
// provider's background-command events and OXESpace's own background jobs. Each one is running, stopped (with its exit
// code), or unknown since the last signal; never running forever. Only OXESpace's own jobs can be stopped from the card.
// Written by the planner; the executor must not edit it. Stop-signal fixtures only.
// CCR: docs/roadmap-1.5/ccr-f6-conversation.md §A22; DESIGN 1.5.0-f6-design.md U6.4.
import { describe, expect, test } from 'vitest'
import { BACKGROUND_SIGNAL_TIMEOUT_MS, backgroundShells, type BackgroundShellsInput } from '../../../electron/main/services/conversation/thread-background'
import type { BackgroundJob } from '../../../shared/types/background'
import type { ThreadEvent } from '../../../shared/types/thread'

type Task = Extract<ThreadEvent, { type: 'subagent' }>
const NOW = 10_000_000
const task = (state: Task['state'], over: Partial<Task> = {}): Task => ({
  type: 'subagent', id: 'claude-task:s1:b1', action: 'Background command', state, receiverThreadIds: ['b1'], agents: [{ threadId: 'b1', status: state }],
  prompt: 'npm run dev', startedAt: NOW - 60_000, ...over
} as Task)
const job = (status: BackgroundJob['status'], over: Partial<BackgroundJob> = {}): BackgroundJob => ({
  id: 'job-1', workspaceId: 'ws-1', label: 'dev server', command: 'npm run dev', cwd: '/w', status, exitCode: null, startedAtMs: NOW - 30_000, finishedAtMs: null, ...over
})
const input = (over: Partial<BackgroundShellsInput>): BackgroundShellsInput => ({ events: [], jobs: [], live: true, now: NOW, ...over })

describe('A22 · background shells (T77)', () => {
  test('A22: an agent\'s background command that started is running, started by the agent, with the command and since', () => {
    expect(backgroundShells(input({ events: [task('running')] }))).toEqual([
      { id: 'claude-task:s1:b1', command: 'npm run dev', startedBy: 'agent', state: 'running', since: NOW - 60_000, tail: [], canStop: false }
    ])
  })

  test('A22: the stop signal moves it to stopped; the latest event for the same id wins', () => {
    const stopped = backgroundShells(input({ events: [task('running'), task('completed', { completedAt: NOW - 1000 })] }))
    expect(stopped).toHaveLength(1)
    expect(stopped[0]).toMatchObject({ state: 'stopped', since: NOW - 1000 })
    expect(backgroundShells(input({ events: [task('running'), task('failed', { completedAt: NOW - 500 })] }))[0]).toMatchObject({ state: 'stopped' })
    expect(backgroundShells(input({ events: [task('running'), task('interrupted', { completedAt: NOW - 500 })] }))[0]).toMatchObject({ state: 'stopped' })
  })

  test('A22: the provider saying it lost the task is unknown since then', () => {
    expect(backgroundShells(input({ events: [task('running'), task('unknown', { completedAt: NOW - 2000 })] }))[0]).toMatchObject({ state: 'unknown', since: NOW - 2000 })
  })

  test('A22: a running shell of a conversation with no live session (the app restarted) is unknown since its last signal, never running', () => {
    expect(backgroundShells(input({ events: [task('running')], live: false }))[0]).toMatchObject({ state: 'unknown', since: NOW - 60_000 })
  })

  test('A22: a live session that sent no signal for longer than the timeout is unknown too', () => {
    const quiet = task('running', { startedAt: NOW - BACKGROUND_SIGNAL_TIMEOUT_MS - 1 })
    expect(backgroundShells(input({ events: [quiet] }))[0]).toMatchObject({ state: 'unknown' })
    const recent = task('running', { startedAt: NOW - BACKGROUND_SIGNAL_TIMEOUT_MS + 1000 })
    expect(backgroundShells(input({ events: [recent] }))[0]).toMatchObject({ state: 'running' })
  })

  test('A22: the tail is the last 5 lines of the latest output the provider reported', () => {
    const message = Array.from({ length: 9 }, (_, index) => `line ${index}`).join('\n')
    const shell = backgroundShells(input({ events: [task('running', { agents: [{ threadId: 'b1', status: 'running', message }] } as Partial<Task>)] }))[0]
    expect(shell.tail).toEqual(['line 4', 'line 5', 'line 6', 'line 7', 'line 8'])
  })

  test('A22: background agents (not commands) are not shells', () => {
    expect(backgroundShells(input({ events: [task('running', { action: 'Background agent', id: 'claude-task:s1:a1' })] }))).toEqual([])
  })

  test('A22: OXESpace jobs: running, stopped with their exit code, and stoppable from the card', () => {
    const shells = backgroundShells(input({ jobs: [
      { job: job('running'), tail: ['ready on :3000'] },
      { job: job('exited', { id: 'job-2', exitCode: 1, finishedAtMs: NOW - 100 }), tail: ['Error: boom'] },
      { job: job('killed', { id: 'job-3', finishedAtMs: NOW - 50 }), tail: [] },
      { job: job('pending', { id: 'job-4' }), tail: [] }
    ] }))
    expect(shells.map(shell => [shell.id, shell.state, shell.exitCode ?? null, shell.startedBy, shell.canStop])).toEqual([
      ['job-1', 'running', null, 'oxespace', true], ['job-2', 'stopped', 1, 'oxespace', false], ['job-3', 'stopped', null, 'oxespace', false], ['job-4', 'running', null, 'oxespace', true]
    ])
    expect(shells[0].tail).toEqual(['ready on :3000'])
  })

  test('A22: an OXESpace job whose updates stopped longer than the timeout is unknown, not running', () => {
    const stale = backgroundShells(input({ jobs: [{ job: job('running', { startedAtMs: NOW - BACKGROUND_SIGNAL_TIMEOUT_MS - 1 }), tail: [], lastSignalAt: NOW - BACKGROUND_SIGNAL_TIMEOUT_MS - 1 }] }))
    expect(stale[0]).toMatchObject({ state: 'unknown', canStop: true })
  })

  test('A22: running ones first, then by newest signal', () => {
    const shells = backgroundShells(input({
      events: [task('completed', { id: 'claude-task:s1:old', receiverThreadIds: ['old'], completedAt: NOW - 10 })],
      jobs: [{ job: job('running', { id: 'job-r' }), tail: [] }]
    }))
    expect(shells.map(shell => shell.id)).toEqual(['job-r', 'claude-task:s1:old'])
  })
})
