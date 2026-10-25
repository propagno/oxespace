import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import { findMentions, MAX_FILE_BYTES, MAX_TOTAL_BYTES, resolveMentionContext } from '../../electron/main/services/conversation/thread-context-resolver'
import { ThreadManager } from '../../electron/main/services/conversation/thread-manager'
import type { AgentConversationAdapter } from '../../shared/types/thread'
import { removeTempDir } from '../helpers/removeTempDir'

const roots: string[] = []
const databases: AppDatabase[] = []
afterEach(() => {
  for (const db of databases.splice(0)) db.close()
  for (const root of roots.splice(0)) removeTempDir(root)
})

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'oxe-mentions-')); roots.push(root)
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src', 'app.ts'), 'export const answer = 42\n')
  writeFileSync(join(root, 'README.md'), '# Project\n')
  writeFileSync(join(root, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]))
  writeFileSync(join(root, 'big.txt'), 'x'.repeat(MAX_FILE_BYTES + 100))
  return root
}

describe('findMentions', () => {
  it('finds @path tokens and ignores emails and bare @ words', () => {
    expect(findMentions('Look at @src/app.ts and @README.md, then mail me@example.com @everyone')).toEqual(['src/app.ts', 'README.md'])
    expect(findMentions('@./src/app.ts twice @src/app.ts')).toEqual(['src/app.ts'])
    expect(findMentions('windows @src\\app.ts')).toEqual(['src/app.ts'])
  })
})

describe('resolveMentionContext', () => {
  it('attaches mentioned project files with their content', async () => {
    const root = project()
    const context = await resolveMentionContext(root, 'Explain @src/app.ts please')
    expect(context.files).toEqual([{ path: 'src/app.ts', bytes: 25 }])
    expect(context.block).toContain('<attached_file path="src/app.ts">')
    expect(context.block).toContain('export const answer = 42')
  })

  it('skips binary, missing and outside files, and truncates large ones', async () => {
    const root = project()
    const outside = mkdtempSync(join(tmpdir(), 'oxe-outside-')); roots.push(outside)
    writeFileSync(join(outside, 'secret.txt'), 'secret')
    const context = await resolveMentionContext(root, `@logo.png @missing.ts @../${outside.split(/[\\/]/).pop()}/secret.txt @big.txt`)
    expect(context.files).toEqual([{ path: 'big.txt', bytes: MAX_FILE_BYTES, truncated: true }])
    expect(context.block).not.toContain('secret')
    expect(context.block).toContain('truncated="true"')
    expect(context.block).toContain(`First ${MAX_FILE_BYTES} bytes only; read the rest of the file with your tools`)
  })

  it('keeps the attached files within the total budget', async () => {
    const root = project()
    for (const name of ['a', 'b', 'c', 'd']) writeFileSync(join(root, `${name}.txt`), 'y'.repeat(MAX_FILE_BYTES))
    const context = await resolveMentionContext(root, '@a.txt @b.txt @c.txt @d.txt')
    expect(MAX_FILE_BYTES).toBe(16 * 1024)
    expect(MAX_TOTAL_BYTES).toBe(48 * 1024)
    expect(context.files.reduce((sum, file) => sum + file.bytes, 0)).toBeLessThanOrEqual(MAX_TOTAL_BYTES)
    expect(context.files.map(file => file.path)).toEqual(['a.txt', 'b.txt', 'c.txt'])
  })

  it('returns nothing when no mention resolves', async () => {
    expect(await resolveMentionContext(project(), 'No mentions here')).toEqual({ block: '', files: [] })
  })
})

describe('sending a message with @ mentions', () => {
  it('sends the file content to the agent but stores the message as typed, with a context summary', { timeout: 30_000 }, async () => {
    const root = project()
    const db = openInMemoryDatabase(); databases.push(db)
    db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES ('A', 'A', ?, '1x1', 'builtin-claude')").run(root)
    const send = vi.fn(async () => {})
    const factory = vi.fn(async () => ({
      capabilities: { resume: true, approvals: true, attachments: false, modelSelection: false },
      start: vi.fn(async (_c, emit) => emit({ type: 'session', nativeSessionId: 'n' })),
      send, interrupt: vi.fn(async () => {}), approve: vi.fn(async () => {}), dispose: vi.fn(async () => {})
    }) as AgentConversationAdapter)
    const manager = new ThreadManager(db, factory, vi.fn())
    vi.spyOn((manager as unknown as { turns: { workingState: () => Promise<undefined> } }).turns, 'workingState').mockResolvedValue(undefined)
    const id = manager.create({ workspaceId: 'A', projectId: 'p', rootPath: root, provider: 'claude' }).thread.id
    await manager.send(id, 'Review @src/app.ts')
    const sent = send.mock.calls[0][0] as unknown as string
    expect(sent.startsWith('Review @src/app.ts')).toBe(true)
    expect(sent).toContain('export const answer = 42')
    const message = manager.read(id).events.find(event => event.type === 'message' && event.role === 'user')
    expect(message).toMatchObject({ text: 'Review @src/app.ts', context: [{ path: 'src/app.ts', bytes: 25 }] })
    await manager.stop()
  })
})
