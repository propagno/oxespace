// Frozen acceptance test for 1.5.2 OxeChat F5 · conversa AG-10/11, criterion A2 (task T2, backend first). Written by
// the planner; the executor must not edit it. Source: AG-11-CRITERIOS-F5.md, row "Cartão de prompt" (MARCA 15/11):
// "No hover ou com foco dentro: Copiar (existe) e Editar (falta)" — "Editar um prompt já enviado: falta"; AG-11 §5.1
// ("na main atual só há edição para item da fila (editLabel); editar prompt enviado requer reenvio truncado/bifurcação
// no backend"); AG-10 §2.1 and board 1C. Rule of the coordinator: backend first, as its own task, before the prompt
// card (T5). Product rule of 12/11: Rewind and Branch left 1.5.0, so an edit never rewrites the agent's session: it is a
// new turn with the edited text, and the edited turn stays in the history, marked.
// Today (main 12b8e900b) only a queued message can be edited (thread.updateQueued); ThreadManager has no editPrompt,
// IPC_CHANNELS.thread has no editPrompt, and shared/threadPromptEdit.ts does not exist.
// Contract:
// - shared/threadPromptEdit.ts exports editablePrompt(snapshot) → { turnId, messageId } | null: the prompt of the LATEST
//   turn, once that turn ended (completed, failed or interrupted), while the conversation is not running nor waiting
//   (status idle, failed or interrupted), the native CLI does not own it (thread.cliActive), and that turn was not edited
//   already (turn.editedInto); otherwise null. The window shows "Editar" from this same function (T5); main refuses with it.
// - ThreadManager (ThreadOrchestrator).editPrompt(id, turnId, text, { restoreFiles? }): refuses (rejects) when the turn
//   is not editablePrompt's, or the text is empty or over THREAD_MESSAGE_MAX_CHARS (shared/threadLimits), sending
//   nothing; with restoreFiles it first undoes that turn's file changes from its checkpoint, the same way retryTurn does
//   (src: thread-retry.ts), and refuses before sending when the turn has no usable checkpoint; then it sends the edited
//   text as the next turn and records on the edited turn `editedInto: <the new turn's id>` (ThreadTurn, saved), so the
//   window can show it as edited history. The old prompt and its turn stay in the events; nothing is deleted.
// - IPC: IPC_CHANNELS.thread.editPrompt = 'thread:edit-prompt' (thread.ipc.ts, preload api.editPrompt, ThreadApi.editPrompt?
//   (id, turnId, text, { restoreFiles? })), declared in shared/mcp-coverage.ts as the person's window only (`excluded`).
import { execFileSync } from 'node:child_process'
import { existsSync as pbExists, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, join as pbJoin } from 'node:path'
import { pathToFileURL as pbFileUrl } from 'node:url'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../../electron/main/db'
import { ThreadHistory } from '../../../electron/main/services/conversation/thread-history'
import { ThreadManager } from '../../../electron/main/services/conversation/thread-manager'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { MCP_COVERAGE } from '../../../shared/mcp-coverage'
import { THREAD_MESSAGE_MAX_CHARS } from '../../../shared/threadLimits'
import type { AgentConversationAdapter, ThreadEvent } from '../../../shared/types/thread'
import { removeTempDir } from '../../helpers/removeTempDir'
// ---- a module the task adds, loaded in the case: a clear "does not exist yet" failure instead of a broken import ----
async function load<T>(rel: string): Promise<T> {
  const file = ['.tsx', '.ts'].map(ext => pbJoin(process.cwd(), `${rel}${ext}`)).find(candidate => pbExists(candidate))
  if (!file) throw new Error(`${rel} does not exist yet`)
  return import(/* @vite-ignore */ pbFileUrl(file).href) as Promise<T>
}
// ---- the real ThreadManager over an in-memory database and a fake agent adapter (inlined so every task's PR stands alone) ----
// The same fixture as tests/integration/thread-location.test.ts: the real orchestrator, history, checkpoints and git;
// only the provider process is a double whose `emit` the cases drive and whose `send` calls they read back.
const pbCleanup: (() => void | Promise<void>)[] = []
afterEach(async () => { for (const step of pbCleanup.splice(0).reverse()) await step() })

/** A git repository with one committed file a.txt ("a\n"). */
function repository(): string {
  const repo = mkdtempSync(join(tmpdir(), 'oxe-chat-f5-'))
  const git = (...args: string[]): void => { execFileSync('git', args, { cwd: repo }) }
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 'e@x'); git('config', 'user.name', 'E')
  writeFileSync(join(repo, 'a.txt'), 'a\n'); git('add', '.'); git('commit', '-qm', 'a')
  pbCleanup.push(() => removeTempDir(repo))
  return repo
}

function backend(root: string, options: { realWorkingState?: boolean } = {}) {
  const db: AppDatabase = openInMemoryDatabase()
  pbCleanup.push(() => db.close())
  db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES ('A', 'A', ?, '1x1', 'builtin-claude')").run(root)
  const callbacks: ((event: ThreadEvent) => void)[] = []
  const adapters: AgentConversationAdapter[] = []
  const factory = vi.fn(async () => {
    const adapter = {
      capabilities: { resume: true, approvals: true, attachments: false, modelSelection: false },
      start: vi.fn(async (_context, emit) => { callbacks.push(emit); emit({ type: 'session', nativeSessionId: 'native-1' }) }),
      send: vi.fn(async () => {}), interrupt: vi.fn(async () => {}), approve: vi.fn(async () => {}), dispose: vi.fn(async () => {}),
      respondRequest: vi.fn(async () => {})
    } as unknown as AgentConversationAdapter
    adapters.push(adapter)
    return adapter
  })
  const models = { list: vi.fn(async () => ({ defaultModel: 'm', models: [] })), stop: vi.fn(async () => {}) }
  const manager = new ThreadManager(db, factory, vi.fn(), undefined, undefined, undefined, models as never)
  if (!options.realWorkingState) vi.spyOn((manager as unknown as { turns: { workingState: () => Promise<undefined> } }).turns, 'workingState').mockResolvedValue(undefined)
  const id = manager.create({ workspaceId: 'A', projectId: 'project-A', rootPath: root, provider: 'claude' }).thread.id
  pbCleanup.push(() => manager.stop())
  const read = () => new ThreadHistory(db).read(id)
  /** Every text the agent received, across the adapters main started (a configuration change can start a new one). */
  const sent = (): string[] => adapters.flatMap(adapter => (adapter.send as unknown as ReturnType<typeof vi.fn>).mock.calls.map(call => typeof call[0] === 'string' ? call[0] : String((call[0] as { text?: string })?.text ?? '')))
  /** The agent's latest emit (the adapter of the running turn). */
  const emit = (event: ThreadEvent): void => callbacks.at(-1)!(event)
  return { db, manager, id, read, sent, emit, callbacks }
}
type Backend = ReturnType<typeof backend>

/** Polls until the condition holds, failing loudly after 8 s instead of carrying on in the wrong state. */
async function until(condition: () => boolean, label = 'condition'): Promise<void> {
  const end = Date.now() + 8_000
  while (!condition()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${label}`)
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 400))
/** One turn of the agent: the person's text, then what the agent emits, then the end; waits until the conversation is idle. */
async function turn(b: Backend, text: string, agent: ThreadEvent[], status: 'completed' | 'failed' = 'completed'): Promise<string> {
  const before = b.read().turns?.length ?? 0
  await b.manager.send(b.id, text)
  await until(() => (b.read().turns?.length ?? 0) > before && b.read().turns!.at(-1)!.status === 'running', 'the turn to start')
  for (const event of agent) b.emit(event)
  b.emit({ type: 'completed', status } as ThreadEvent)
  await until(() => b.read().thread.status !== 'running' && b.read().turns!.at(-1)!.status !== 'running', 'the turn to end')
  await settle()
  return b.read().turns!.at(-1)!.id
}
/** Waits until the running turn has its checkpoint and baseline (what an undo restores to), as thread-location.test.ts does. */
async function turnReady(b: Backend): Promise<void> {
  const turns = (b.manager as unknown as { turns: { checkpointIds: Map<string, string[]>; baselines: Map<string, unknown[]> } }).turns
  await until(() => {
    const turnId = b.read().turns?.at(-1)?.id
    return Boolean(turnId && b.read().turns!.at(-1)!.status === 'running' && (turns.checkpointIds.get(turnId)?.length ?? 0) >= 1 && (turns.baselines.get(b.id)?.length ?? 0) >= 1)
  }, 'the turn baseline')
}
type EditModule = { editablePrompt(snapshot: unknown): { turnId: string; messageId: string } | null }
let editModule: EditModule
beforeEach(async () => { editModule = await load<EditModule>('shared/threadPromptEdit') })
type EditApi = { editPrompt(id: string, turnId: string, text: string, options?: { restoreFiles?: boolean }): Promise<unknown> }
const editPrompt = (b: Backend, turnId: string, text: string, options: { restoreFiles?: boolean } = {}): Promise<unknown> => (b.manager as unknown as EditApi).editPrompt(b.id, turnId, text, options)
const editedInto = (b: Backend, turnId: string): unknown => (b.read().turns!.find(value => value.id === turnId) as { editedInto?: string } | undefined)?.editedInto
const answer = (text: string): ThreadEvent => ({ type: 'message', id: `a-${text.length}`, role: 'assistant', text } as ThreadEvent)

/** Waits until the turn's checkpoint is no longer open (the turn bookkeeping writes it after the end). */
async function checkpointed(b: Backend, turnId: string): Promise<void> {
  const checkpoints = (b.manager as unknown as { checkpoints: { list(id: string): Array<{ turnId?: string; state: string }> } }).checkpoints
  await until(() => checkpoints.list(b.id).some(item => item.turnId === turnId) && checkpoints.list(b.id).filter(item => item.turnId === turnId).every(item => item.state !== 'open'), 'the turn checkpoint')
}

describe('A2 · OxeChat F5 backend: edit a prompt already sent (AG-10 §2.1, the prompt card\'s Editar)', { timeout: 30_000 }, () => {
  test('editablePrompt names the prompt of the latest finished turn, and nothing while a turn runs', async () => {
    const b = backend(repository())
    const first = await turn(b, 'Explain the refund flow', [answer('It posts to /refunds.')])
    expect(editModule.editablePrompt(b.read())).toEqual({ turnId: first, messageId: first })
    const second = await turn(b, 'Add an idempotency key', [answer('Done.')], 'failed')
    expect(editModule.editablePrompt(b.read()), 'a failed turn can be edited too').toEqual({ turnId: second, messageId: second })
    await b.manager.send(b.id, 'And the tests')
    await until(() => b.read().turns!.at(-1)!.status === 'running', 'the next turn to run')
    expect(editModule.editablePrompt(b.read()), 'nothing while a turn runs').toBeNull()
  })

  test('edits the latest prompt: the agent receives the edited text as the next turn, and the edited turn stays in the history, marked', async () => {
    const b = backend(repository())
    const turnId = await turn(b, 'Add an idempotency key to refunds', [answer('Which header?')])
    const before = b.sent().length
    await editPrompt(b, turnId, 'Add an idempotency key to refunds, read from the Idempotency-Key header')
    await until(() => b.sent().length > before, 'the edited text')
    expect(b.sent().at(-1)).toContain('read from the Idempotency-Key header')
    const turns = b.read().turns!
    const next = turns.at(-1)!.id
    expect(next, 'a new turn').not.toBe(turnId)
    expect(editedInto(b, turnId), 'the edited turn points at the new one').toBe(next)
    const prompts = b.read().events.filter(event => event.type === 'message' && event.role === 'user').map(event => (event as { text: string }).text)
    expect(prompts, 'nothing is deleted: both prompts are in the history').toEqual(['Add an idempotency key to refunds', 'Add an idempotency key to refunds, read from the Idempotency-Key header'])
    b.emit({ type: 'completed', status: 'completed' } as ThreadEvent)
    await until(() => b.read().thread.status !== 'running', 'the edited turn to end')
    await settle()
    expect(editModule.editablePrompt(b.read()), 'the new prompt is the one to edit now').toEqual({ turnId: next, messageId: next })
  })

  test('with restoreFiles the turn\'s file changes are undone first, from its checkpoint, then the edited text goes', async () => {
    const repo = repository()
    const b = backend(repo, { realWorkingState: true })
    await b.manager.send(b.id, 'Change a.txt')
    await turnReady(b)
    writeFileSync(join(repo, 'a.txt'), 'changed by the agent\n')
    b.emit({ type: 'completed', status: 'completed' } as ThreadEvent)
    await until(() => b.read().thread.status !== 'running', 'the turn to end')
    const turnId = b.read().turns!.at(-1)!.id
    await checkpointed(b, turnId)
    const before = b.sent().length
    await editPrompt(b, turnId, 'Change a.txt to say b', { restoreFiles: true })
    expect(readFileSync(join(repo, 'a.txt'), 'utf8'), 'the turn\'s change was undone').toBe('a\n')
    await until(() => b.sent().length > before, 'the edited text')
    expect(b.sent().at(-1)).toContain('Change a.txt to say b')
  })

  test('without a usable checkpoint, restoreFiles refuses before sending; without restoreFiles the files stay as they are', async () => {
    const repo = repository()
    const b = backend(repo, { realWorkingState: true })
    await b.manager.send(b.id, 'Change a.txt')
    await turnReady(b)
    writeFileSync(join(repo, 'a.txt'), 'changed by the agent\n')
    b.emit({ type: 'completed', status: 'completed' } as ThreadEvent)
    await until(() => b.read().thread.status !== 'running', 'the turn to end')
    const turnId = b.read().turns!.at(-1)!.id
    await checkpointed(b, turnId)
    b.db.prepare('DELETE FROM conversation_checkpoints WHERE thread_id = ?').run(b.id)
    const sent = b.sent().length
    await expect(editPrompt(b, turnId, 'Change a.txt to say b', { restoreFiles: true })).rejects.toThrow()
    await settle()
    expect(b.sent().length, 'nothing was sent').toBe(sent)
    expect(editedInto(b, turnId)).toBeUndefined()
    await editPrompt(b, turnId, 'Change a.txt to say b')
    expect(readFileSync(join(repo, 'a.txt'), 'utf8'), 'no restore asked: the file is left as the agent wrote it').toBe('changed by the agent\n')
  })

  test('refuses and sends nothing: an older prompt, an already edited one, an empty or too long text, a running turn', async () => {
    const b = backend(repository())
    const first = await turn(b, 'Explain the refund flow', [answer('It posts to /refunds.')])
    const second = await turn(b, 'Add an idempotency key', [answer('Done.')])
    const sent = b.sent().length
    await expect(editPrompt(b, first, 'Explain it again'), 'an older prompt').rejects.toThrow()
    await expect(editPrompt(b, second, '   '), 'empty').rejects.toThrow()
    await expect(editPrompt(b, second, 'x'.repeat(THREAD_MESSAGE_MAX_CHARS + 1)), 'too long').rejects.toThrow()
    await settle()
    expect(b.sent().length, 'nothing was sent').toBe(sent)
    expect([editedInto(b, first), editedInto(b, second)]).toEqual([undefined, undefined])
    await editPrompt(b, second, 'Add an idempotency key, from the header')
    await until(() => b.read().turns!.at(-1)!.status === 'running', 'the edited turn to run')
    await expect(editPrompt(b, second, 'Once more'), 'already edited, and a turn runs').rejects.toThrow()
  })

  test('the channel is the person\'s window only: an IPC channel, and in the MCP coverage as excluded', () => {
    expect((IPC_CHANNELS.thread as Record<string, string>).editPrompt).toBe('thread:edit-prompt')
    const owners = Object.entries(MCP_COVERAGE).filter(([, capability]) => (capability as { ipc?: string[] }).ipc?.includes('thread.editPrompt'))
    expect(owners.map(([name]) => name), 'declared once').toHaveLength(1)
    expect((owners[0][1] as { excluded?: string }).excluded, 'person-only').toBeTruthy()
  })
})
