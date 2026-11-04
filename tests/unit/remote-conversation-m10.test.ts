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
  const own = (name: string, text: string) => `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n${text.slice(text.indexOf('@@ '))}`
  test(`the patch fits ${REMOTE_DIFF_LIMITS.patchBytes} bytes, cut at a file or hunk boundary, with truncated`, () => {
    patches.a = hunk('a.ts', 60)
    patches.b = hunk('b.ts', 60)
    const result = toToolDiff([file('a.ts', { artifactId: 'a' }), file('b.ts', { artifactId: 'b' })], [ROOT], patchOf)
    expect(Buffer.byteLength(result.diff!.patch!)).toBeLessThanOrEqual(REMOTE_DIFF_LIMITS.patchBytes)
    expect(result.diff!.patch).toBe(own('a.ts', patches.a))
    expect(result.diff!.truncated).toBe(true)
  })
  test('SECURITY H1: a tool-input artifact (Claude Edit/Write JSON) is never sent as a patch', () => {
    patches.json = JSON.stringify({ file_path: '/work/cajui/config.ts', old_string: 'password = ""', new_string: 'password = "hunter2hunter2"', api_key: 'plainsecretvalue123' })
    let reads = 0
    const result = toToolDiff([file('config.ts', { artifactId: 'json', source: 'tool-input' })], [ROOT], id => { reads += 1; return patches[id] })
    expect(result.diff).toEqual({ files: [{ path: 'config.ts', additions: 3, deletions: 1 }] })
    expect(reads).toBe(0)
  })
  test('SECURITY L2: header lines come from the checked path, never from the evidence (--no-index, spaces, absolute)', () => {
    patches.h = `diff --git a/home/eduardo/secret/y.txt b/home/eduardo/secret/y.txt\n--- "a/C:/Users/John Doe/secret/y.txt"\n+++ "b/C:/Users/John Doe/secret/y.txt"\n@@ -1 +1 @@\n-a\n+b\n`
    const patch = toToolDiff([file('src/y.txt', { artifactId: 'h' })], [ROOT], patchOf).diff!.patch!
    expect(patch).toBe('diff --git a/src/y.txt b/src/y.txt\n--- a/src/y.txt\n+++ b/src/y.txt\n@@ -1 +1 @@\n-a\n+b\n')
    expect(patch).not.toMatch(/eduardo|Doe|secret/)
  })
  test('SECURITY L1: key material (a marker, or a run of base64 lines) sends no patch for that file', () => {
    const body = Array.from({ length: 3 }, () => `+${'A'.repeat(64)}`).join('\n')
    patches.k1 = `@@ -0,0 +1,3 @@\n${body}\n`
    patches.k2 = '@@ -0,0 +1 @@\n+-----BEGIN OPENSSH PRIVATE KEY-----\n'
    for (const id of ['k1', 'k2']) expect(toToolDiff([file('id', { artifactId: id })], [ROOT], patchOf).diff).not.toHaveProperty('patch')
  })
  test('evidence describing more than one file, or with no hunk, sends no patch', () => {
    patches.multi = `${hunk('a.ts', 1)}${hunk('b.ts', 1)}`
    patches.none = 'diff --git a/x b/x\nindex 1..2\n'
    for (const id of ['multi', 'none']) expect(toToolDiff([file('a.ts', { artifactId: id })], [ROOT], patchOf).diff).not.toHaveProperty('patch')
  })
  test('SECURITY M1: reading stops once the item has enough evidence', () => {
    for (let i = 0; i < 20; i++) patches[`r${i}`] = hunk(`r${i}.ts`, 200)
    let reads = 0
    const result = toToolDiff(Array.from({ length: 20 }, (_, i) => file(`r${i}.ts`, { artifactId: `r${i}` })), [ROOT], id => { reads += 1; return patches[id] })
    expect(result.diff!.files).toHaveLength(20)
    expect(reads).toBeLessThanOrEqual(2)
    expect(Buffer.byteLength(result.diff!.patch ?? '')).toBeLessThanOrEqual(REMOTE_DIFF_LIMITS.patchBytes)
  })
  test('SECURITY L3: a path with control characters or over 512 bytes is dropped; multibyte patches stay under the byte cap', () => {
    expect(toToolDiff([file('a\u0007b.ts'), file(`${'é'.repeat(300)}.ts`)], [ROOT]).diff).toBeUndefined()
    patches.mb = `@@ -0,0 +1,400 @@\n${Array.from({ length: 400 }, () => `+${'ção'.repeat(10)}`).join('\n')}\n@@ -500 +500 @@\n+fim\n`
    const patch = toToolDiff([file('mb.ts', { artifactId: 'mb' })], [ROOT], patchOf).diff
    expect(Buffer.byteLength(patch?.patch ?? '')).toBeLessThanOrEqual(REMOTE_DIFF_LIMITS.patchBytes)
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
  test('SECURITY L3: a file list over the budget is halved, never the frame lost', () => {
    const files = Array.from({ length: 20 }, (_, i) => ({ path: `${i}-${'ç'.repeat(250)}.ts`, additions: 1, deletions: 0 }))
    const fitted = fitItem({ type: 'tool', id: 'x', name: 'Edit', state: 'completed', detail: 'edit', diff: { files } }, 4_000) as Extract<RemoteThreadItem, { type: 'tool' }>
    expect(Buffer.byteLength(JSON.stringify(fitted))).toBeLessThanOrEqual(4_000)
    expect(fitted.diff?.truncated).toBe(true)
    expect(fitted.diff!.files.length).toBeGreaterThan(0)
  })
})
