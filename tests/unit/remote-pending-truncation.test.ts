import { describe, expect, test } from 'vitest'
import { toPendingRequest } from '../../electron/main/services/remote/filters'
import { REMOTE_TEXT_LIMITS } from '../../shared/remote/protocol'
import type { ConversationThread, ThreadRequest } from '../../shared/types/thread'

const ROOT = process.platform === 'win32' ? 'C:\\work\\app' : '/work/app'
const OUTSIDE = process.platform === 'win32' ? 'D:\\elsewhere' : '/elsewhere'
const thread = { id: 't1', workspaceId: 'w1', title: 'Fix it', rootPath: ROOT } as ConversationThread
const request = (fields: Partial<ThreadRequest>): ThreadRequest => ({
  id: 'r1', nativeId: 'r1', nativeMethod: 'can_use_tool:Bash', kind: 'approval', title: 'Run a command', generation: 1, createdAt: 0,
  state: 'pending', availableDecisions: ['accept', 'decline'], ...fields
} as ThreadRequest)
const pending = (fields: Partial<ThreadRequest>) => toPendingRequest({ thread, request: request(fields) }, [])

// Assessor BE-M-10: the phone used to get a command cut to REMOTE_TEXT_LIMITS.detail and still be offered accept.
describe('a pending request the phone cannot show whole', () => {
  test('a command one character over the limit is marked truncated and offers no accept', () => {
    const shown = pending({ command: 'x'.repeat(REMOTE_TEXT_LIMITS.detail + 1) })
    expect(shown.truncated).toBe(true)
    expect(shown.decisions).toEqual(['decline'])
    expect(shown.answerable).toBe(true)
  })

  test('a command at the limit is shown whole and keeps accept', () => {
    const shown = pending({ command: 'x'.repeat(REMOTE_TEXT_LIMITS.detail) })
    expect(shown.truncated).toBeUndefined()
    expect(shown.decisions).toEqual(['accept', 'decline'])
  })

  test('a cut detail, files outside the project and a working directory outside it count as not shown whole', () => {
    expect(pending({ detail: 'd'.repeat(REMOTE_TEXT_LIMITS.detail + 1) }).truncated).toBe(true)
    expect(pending({ paths: [`${ROOT}/a.ts`, `${OUTSIDE}/b.ts`] }).truncated).toBe(true)
    expect(pending({ cwd: OUTSIDE }).truncated).toBe(true)
    expect(pending({ paths: Array.from({ length: 101 }, (_, index) => `${ROOT}/f${index}.ts`) }).truncated).toBe(true)
  })

  test('a request shown whole is not marked', () => {
    const shown = pending({ command: 'npm test', cwd: ROOT, paths: [`${ROOT}/a.ts`] })
    expect(shown.truncated).toBeUndefined()
    expect(shown.decisions).toEqual(['accept', 'decline'])
  })
})
