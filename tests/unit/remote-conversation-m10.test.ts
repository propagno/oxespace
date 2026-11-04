// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { toThreadHeader, toThreadItem } from '../../electron/main/services/remote/filters'
import { fitItem } from '../../electron/main/services/remote/frames'
import { cutAtBoundary, toToolDiff } from '../../electron/main/services/remote/tool-diff'
import { REMOTE_DIFF_LIMITS, REMOTE_QUEUE_PREVIEW, type RemoteThreadItem } from '../../shared/remote/protocol'
import type { ConversationThread, ThreadEvent, ThreadFileChange, ThreadQueuedInput, ThreadTurn } from '../../shared/types/thread'

/** CCR #509: the phone's M10 conversation screen gets a turn timer, a quiet time, a queue preview and a tool's diff. */

const ROOT = process.platform === 'win32' ? 'C:\\work\\cajui' : '/work/cajui'
const OTHER = process.platform === 'win32' ? 'D:\\secret\\notes.md' : '/etc/secret/notes.md'
const KEY = 'sk-ant-abcdefghijklmnopqrstuvwxyz012345'

function thread(overrides: Partial<ConversationThread> = {}): ConversationThread {
  return { id: 't1', provider: 'claude', rootPath: ROOT, workspaceId: 'thread:p', status: 'running', generation: 1, title: 'Fix', createdAt: 1, updatedAt: 1, ...overrides } as ConversationThread
}
const turn = (startedAt: number, status: ThreadTurn['status'] = 'running'): ThreadTurn => ({ id: 'u1', sequence: 1, startedAt, status, configuration: {} as ThreadTurn['configuration'] })
const queued = (n: number, text = `message ${n}`, state: ThreadQueuedInput['state'] = 'queued'): ThreadQueuedInput => ({ id: `q${n}`, text, state, createdAt: n })
const file = (path: string, extra: Partial<ThreadFileChange> = {}): ThreadFileChange => ({ path, kind: 'update', source: 'native-patch', state: 'completed', additions: 3, deletions: 1, ...extra })
const hunk = (name: string, lines: number) => `diff --git a/${name} b/${name}\nindex 1..2 100644\n--- a/${name}\n+++ b/${name}\n@@ -1,${lines} +1,${lines} @@\n${Array.from({ length: lines }, (_, i) => `+line ${i} ${'x'.repeat(60)}`).join('\n')}\n`

describe('turn timer and quiet time (§1, §2)', () => {
  const now = 1_000_000
  test('a running turn sends how long it ran and how long the provider has been quiet', () => {
    const header = toThreadHeader(thread({ connection: { state: 'connected', attempt: 0, changedAt: 0, lastNativeSignalAt: now - 30_000 } }), 0, [ROOT], { turns: [turn(now - 120_000)], now })
    expect(header).toMatchObject({ turnElapsedMs: 120_000, quietMs: 30_000 })
  })
  test('with no signal since the turn began, quiet counts from the start; a signal from an earlier turn is ignored', () => {
    const header = toThreadHeader(thread({ connection: { state: 'connected', attempt: 0, changedAt: 0, lastNativeSignalAt: now - 500_000 } }), 0, [ROOT], { turns: [turn(now - 90_000)], now })
    expect(header).toMatchObject({ turnElapsedMs: 90_000, quietMs: 90_000 })
  })
  test('waiting for approval sends the timer but no quiet time; idle and older callers send neither', () => {
    expect(toThreadHeader(thread({ status: 'approval' }), 1, [ROOT], { turns: [turn(now - 5_000)], now })).toMatchObject({ turnElapsedMs: 5_000 })
    expect(toThreadHeader(thread({ status: 'approval' }), 1, [ROOT], { turns: [turn(now - 5_000)], now })).not.toHaveProperty('quietMs')
    for (const header of [toThreadHeader(thread({ status: 'idle' }), 0, [ROOT], { turns: [turn(now - 5_000, 'completed')], now }), toThreadHeader(thread(), 0, [ROOT])]) {
      expect(header).not.toHaveProperty('turnElapsedMs')
      expect(header).not.toHaveProperty('quietMs')
    }
  })
  test('a clock behind the turn start never sends a negative time', () => {
    expect(toThreadHeader(thread(), 0, [ROOT], { turns: [turn(now + 10_000)], now })).toMatchObject({ turnElapsedMs: 0, quietMs: 0 })
  })
})

describe('queue preview (§4)', () => {
  test('at most five waiting messages in send order, each cut to 200 characters; failed ones are left out', () => {
    const queue = [queued(1, 'a'.repeat(250)), queued(2, 'failed', 'failed'), ...[3, 4, 5, 6, 7].map(n => queued(n))]
    const header = toThreadHeader(thread({ queue }), 0, [ROOT])
    expect(header.queued).toBe(7)
    expect(header.queuedPreview?.map(item => item.id)).toEqual(['q1', 'q3', 'q4', 'q5', 'q6'])
    expect(header.queuedPreview).toHaveLength(REMOTE_QUEUE_PREVIEW.items)
    expect(header.queuedPreview?.[0]).toEqual({ id: 'q1', text: 'a'.repeat(REMOTE_QUEUE_PREVIEW.text), truncated: true })
  })
  test('queued text is redacted and its absolute paths replaced, like every other free text', () => {
    const header = toThreadHeader(thread({ queue: [queued(1, `use ${KEY} and read ${OTHER}`)] }), 0, [ROOT])
    expect(header.queuedPreview?.[0].text).not.toContain(KEY)
    expect(header.queuedPreview?.[0].text).not.toContain(OTHER)
  })
  test('an empty queue sends no preview', () => {
    expect(toThreadHeader(thread(), 0, [ROOT])).not.toHaveProperty('queuedPreview')
  })
})

describe('a tool step\'s diff (§3)', () => {
  const tool = (files: ThreadFileChange[]): ThreadEvent => ({ type: 'tool', id: 'x', name: 'Edit', state: 'completed', detail: 'edit', files })
  const patches: Record<string, string> = {}
  const patchOf = (id: string) => patches[id]

  test('paths are relative to the project; a file outside every root is dropped; counts come with it', () => {
    const abs = process.platform === 'win32' ? `${ROOT}\\src\\a.ts` : `${ROOT}/src/a.ts`
    const result = toToolDiff([file('src/b.ts'), file(abs), file(OTHER), file('../escape.ts')], [ROOT])
    expect(result.diff?.files).toEqual([{ path: 'src/b.ts', additions: 3, deletions: 1 }, { path: 'src/a.ts', additions: 3, deletions: 1 }])
  })
  test(`at most ${REMOTE_DIFF_LIMITS.files} files, with truncated`, () => {
    const result = toToolDiff(Array.from({ length: 25 }, (_, i) => file(`f${i}.ts`)), [ROOT])
    expect(result.diff?.files).toHaveLength(REMOTE_DIFF_LIMITS.files)
    expect(result.diff?.truncated).toBe(true)
  })
  test('a binary file is listed with zero counts and no patch', () => {
    patches.bin = 'diff --git a/logo.png b/logo.png\nBinary files a/logo.png and b/logo.png differ\n'
    const result = toToolDiff([file('logo.png', { artifactId: 'bin', additions: 9, deletions: 9 })], [ROOT], patchOf)
    expect(result.diff).toEqual({ files: [{ path: 'logo.png', additions: 0, deletions: 0 }] })
  })
  test('the patch is redacted and counted, and an absolute path in it is replaced', () => {
    patches.s = `diff --git a/.env b/.env\n--- a/.env\n+++ b/.env\n@@ -0,0 +1,2 @@\n+KEY=${KEY}\n+# copied from ${OTHER}\n`
    const result = toToolDiff([file('.env', { artifactId: 's' })], [ROOT], patchOf)
    expect(result.diff?.patch).toBeDefined()
    expect(result.diff?.patch).not.toContain(KEY)
    expect(result.diff?.patch).not.toContain(OTHER)
    expect(result.redacted).toBeGreaterThan(0)
  })
  test(`the patch fits ${REMOTE_DIFF_LIMITS.patchBytes} bytes, cut at a file or hunk boundary, with truncated`, () => {
    patches.a = hunk('a.ts', 60)
    patches.b = hunk('b.ts', 60)
    const result = toToolDiff([file('a.ts', { artifactId: 'a' }), file('b.ts', { artifactId: 'b' })], [ROOT], patchOf)
    expect(Buffer.byteLength(result.diff!.patch!)).toBeLessThanOrEqual(REMOTE_DIFF_LIMITS.patchBytes)
    expect(result.diff!.patch).toBe(patches.a)
    expect(result.diff!.truncated).toBe(true)
  })
  test('a first hunk larger than the cap sends no patch at all, never half a hunk', () => {
    patches.big = hunk('big.ts', 400)
    const result = toToolDiff([file('big.ts', { artifactId: 'big' })], [ROOT], patchOf)
    expect(result.diff).toEqual({ files: [{ path: 'big.ts', additions: 3, deletions: 1 }], truncated: true })
  })
  test('a cut never lands inside a git file header', () => {
    const text = `${hunk('a.ts', 2)}diff --git a/b.ts b/b.ts\nindex 1..2 100644\n--- a/b.ts\n+++ b/b.ts\n@@ -1 +1 @@\n+b\n`
    const at = text.indexOf('--- a/b.ts')
    const cut = cutAtBoundary(text, Buffer.byteLength(text.slice(0, at + 4)))
    expect(cut.text).toBe(hunk('a.ts', 2))
  })
  test('a removed SQL comment line ("--- …") inside a hunk is never taken for a file header', () => {
    const first = `--- a/m.sql\n+++ b/m.sql\n@@ -1,2 +1,1 @@\n--- old comment\n select 1;\n`
    const second = `@@ -9 +9 @@\n+${'y'.repeat(200)}\n`
    const cut = cutAtBoundary(first + second, Buffer.byteLength(first) + 10)
    expect(cut.text).toBe(first)
  })
  test('the tool item carries the diff and adds its redactions to the count; no evidence reader still lists the files', () => {
    patches.k = `--- a/k.ts\n+++ b/k.ts\n@@ -1 +1 @@\n+const key = '${KEY}'\n`
    const item = toThreadItem(tool([file('k.ts', { artifactId: 'k' })]), 1, [ROOT], patchOf) as Extract<RemoteThreadItem, { type: 'tool' }>
    expect(item).toMatchObject({ filesChanged: 1, diff: { files: [{ path: 'k.ts' }] } })
    expect(item.redacted).toBeGreaterThan(0)
    expect((toThreadItem(tool([file('k.ts', { artifactId: 'k' })]), 1, [ROOT]) as Extract<RemoteThreadItem, { type: 'tool' }>).diff).toEqual({ files: [{ path: 'k.ts', additions: 3, deletions: 1 }] })
  })
  test('a step whose files are all outside the project sends no diff', () => {
    expect(toThreadItem(tool([file(OTHER)]), 1, [ROOT], patchOf)).not.toHaveProperty('diff')
  })
  test('an item over the frame budget drops the patch before it cuts any text', () => {
    const item: RemoteThreadItem = { type: 'tool', id: 'x', name: 'Edit', state: 'completed', detail: 'edit', output: 'o'.repeat(100), diff: { files: [{ path: 'a.ts', additions: 1, deletions: 0 }], patch: 'p'.repeat(4_000) } }
    const fitted = fitItem(item, 1_000) as Extract<RemoteThreadItem, { type: 'tool' }>
    expect(fitted.diff).toEqual({ files: [{ path: 'a.ts', additions: 1, deletions: 0 }], truncated: true })
    expect(fitted.output).toBe('o'.repeat(100))
  })
})
