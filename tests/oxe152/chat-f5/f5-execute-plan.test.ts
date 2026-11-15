// Frozen acceptance test for 1.5.2 OxeChat F5 · conversa AG-10/11, criterion A1 (task T1, backend first). Written by
// the planner; the executor must not edit it. Source: AG-11-CRITERIOS-F5.md row 5.1 (MARCA 15/11): "Executar plano só
// aparece quando a ação existe" and the data column "falta (ação de executar o plano no main)"; AG-11 §5.1 (the main
// action, `thread.executePlan` or equal; until it exists the card keeps "Mudar acesso"); AG-10 §2.5 (the plan card's one
// "Executar plano" button). Rule of the coordinator: backend first, as its own task, before the plan card (T9).
// Today (main 12b8e900b) nothing in main runs a plan the agent wrote in Plan mode: ThreadManager has no executePlan,
// IPC_CHANNELS.thread has no executePlan, and shared/threadPlanExecution.ts does not exist.
// Contract:
// - shared/threadPlanExecution.ts exports THREAD_EXECUTE_PLAN_PROMPT (a fixed English instruction main sends the agent,
//   never built from agent text) and planExecution(snapshot, turnId) → { available: true } | { available: false,
//   reason: 'not-latest' | 'running' | 'not-plan' | 'no-plan' | 'read-only' }: available only for the LATEST turn, once
//   it ended 'completed', while the conversation is idle and still in Plan (thread.mode === 'plan'), when that turn holds
//   a plan (a `plan` event or an assistant message) and the access is not Read only (Read only keeps "Mudar acesso").
//   The window shows the button from this same function (T9); main refuses with it.
// - ThreadManager (ThreadOrchestrator).executePlan(id, turnId): refuses (rejects) when planExecution is not available,
//   changing nothing and sending nothing; otherwise moves the conversation from Plan to Agent (mode 'default', through
//   the existing configure, access untouched) and then sends THREAD_EXECUTE_PLAN_PROMPT as the next turn.
// - IPC: IPC_CHANNELS.thread.executePlan = 'thread:execute-plan' (thread.ipc.ts handler, preload api.executePlan,
//   ThreadApi.executePlan?(id, turnId)), declared in shared/mcp-coverage.ts as the person's window only (a capability
//   with `excluded`, like thread.history_edit): an agent never runs a plan on the person's behalf.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../../electron/main/db'
import { ThreadHistory } from '../../../electron/main/services/conversation/thread-history'
import { ThreadManager } from '../../../electron/main/services/conversation/thread-manager'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { MCP_COVERAGE } from '../../../shared/mcp-coverage'
import type { AgentConversationAdapter, ThreadEvent } from '../../../shared/types/thread'
import { removeTempDir } from '../../helpers/removeTempDir'
import { existsSync as pbExists } from 'node:fs'
import { join as pbJoin } from 'node:path'
import { pathToFileURL as pbFileUrl } from 'node:url'
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
type PlanApi = { executePlan(id: string, turnId: string): Promise<void> }
const executePlan = (b: Backend, turnId: string): Promise<void> => (b.manager as unknown as PlanApi).executePlan(b.id, turnId)
type PlanModule = { planExecution(snapshot: unknown, turnId: string): { available: boolean; reason?: string }; THREAD_EXECUTE_PLAN_PROMPT: string }
let planModule: PlanModule
beforeEach(async () => { planModule = await load<PlanModule>('shared/threadPlanExecution') })
const planExecution = (snapshot: unknown, turnId: string) => planModule.planExecution(snapshot, turnId)
const PROMPT = (): string => planModule.THREAD_EXECUTE_PLAN_PROMPT
const PLAN_STEPS: ThreadEvent = { type: 'plan', id: 'plan:1', steps: [{ label: 'Read the refund flow', status: 'pending' }, { label: 'Add the idempotency key', status: 'pending' }, { label: 'Run the tests', status: 'pending' }] } as ThreadEvent
const PLAN_TEXT: ThreadEvent = { type: 'message', id: 'a-plan', role: 'assistant', text: '1. Read the refund flow\n2. Add the idempotency key\n3. Run the tests' } as ThreadEvent

async function inPlan(b: Backend, access: 'workspace-write' | 'read-only' = 'workspace-write'): Promise<void> {
  await b.manager.configure(b.id, { mode: 'plan', access }, b.read().thread.configurationRevision ?? 0)
  await until(() => b.read().thread.mode === 'plan', 'Plan mode')
}

describe('A1 · OxeChat F5 backend: run the plan the agent wrote in Plan mode (row 5.1)', { timeout: 30_000 }, () => {
  test('the run instruction is a fixed English text of main, never empty', () => {
    expect(typeof PROMPT()).toBe('string')
    expect(PROMPT().trim().length).toBeGreaterThan(10)
    expect(PROMPT(), 'no file mention: it is sent as written').not.toMatch(/@/)
  })

  test('executes the plan of the latest Plan turn: the conversation leaves Plan for Agent, keeps its access, and the agent receives the run instruction', async () => {
    const b = backend(repository())
    await inPlan(b)
    const turnId = await turn(b, 'Plan the Pix refund endpoint', [PLAN_STEPS, PLAN_TEXT])
    expect(planExecution(b.read(), turnId)).toEqual({ available: true })
    const before = b.sent().length
    await executePlan(b, turnId)
    await until(() => b.sent().length > before, 'the run instruction')
    expect(b.sent().at(-1)).toContain(PROMPT())
    const thread = b.read().thread
    expect(thread.mode ?? 'default', 'Plan → Agent').toBe('default')
    expect(thread.access, 'the access is the person\'s, untouched').toBe('workspace-write')
    expect(b.read().turns!.at(-1)!.id, 'the plan runs as the next turn').not.toBe(turnId)
  })

  test('a plan the agent wrote as prose (no plan event) runs too', async () => {
    const b = backend(repository())
    await inPlan(b)
    const turnId = await turn(b, 'Plan the migration', [PLAN_TEXT])
    expect(planExecution(b.read(), turnId)).toEqual({ available: true })
    await executePlan(b, turnId)
    await until(() => b.sent().some(text => text.includes(PROMPT())), 'the run instruction')
  })

  test('refuses and changes nothing for a turn that is not the latest, a turn not in Plan, or a turn with no plan', async () => {
    const b = backend(repository())
    const notPlan = await turn(b, 'Explain the refund flow', [{ type: 'message', id: 'a0', role: 'assistant', text: 'It posts to /refunds.' } as ThreadEvent])
    expect(planExecution(b.read(), notPlan)).toEqual({ available: false, reason: 'not-plan' })
    await inPlan(b)
    const first = await turn(b, 'Plan the endpoint', [PLAN_STEPS, PLAN_TEXT])
    const empty = await turn(b, 'Think about it', [])
    expect(planExecution(b.read(), first)).toEqual({ available: false, reason: 'not-latest' })
    expect(planExecution(b.read(), empty)).toEqual({ available: false, reason: 'no-plan' })
    const sent = b.sent().length, turns = b.read().turns!.length
    for (const turnId of [first, empty]) await expect(executePlan(b, turnId), turnId).rejects.toThrow()
    await settle()
    expect(b.sent().length, 'nothing was sent').toBe(sent)
    expect(b.read().turns!.length, 'no turn started').toBe(turns)
    expect(b.read().thread.mode, 'still in Plan').toBe('plan')
  })

  test('in Read only it is not available (the card keeps "Mudar acesso") and main refuses; the access is never raised', async () => {
    const b = backend(repository())
    await inPlan(b, 'read-only')
    const turnId = await turn(b, 'Plan the endpoint', [PLAN_STEPS, PLAN_TEXT])
    expect(planExecution(b.read(), turnId)).toEqual({ available: false, reason: 'read-only' })
    const sent = b.sent().length
    await expect(executePlan(b, turnId)).rejects.toThrow()
    await settle()
    expect(b.sent().length).toBe(sent)
    expect(b.read().thread.access ?? 'read-only').toBe('read-only')
    expect(b.read().thread.mode).toBe('plan')
  })

  test('while a turn runs it is not available and main refuses', async () => {
    const b = backend(repository())
    await inPlan(b)
    const turnId = await turn(b, 'Plan the endpoint', [PLAN_STEPS, PLAN_TEXT])
    await b.manager.send(b.id, 'One more thing')
    await until(() => b.read().turns!.at(-1)!.status === 'running', 'the next turn to run')
    expect(planExecution(b.read(), turnId).available).toBe(false)
    await expect(executePlan(b, turnId)).rejects.toThrow()
  })

  test('the channel is the person\'s window only: an IPC channel, and in the MCP coverage as excluded', () => {
    expect((IPC_CHANNELS.thread as Record<string, string>).executePlan).toBe('thread:execute-plan')
    const owners = Object.entries(MCP_COVERAGE).filter(([, capability]) => (capability as { ipc?: string[] }).ipc?.includes('thread.executePlan'))
    expect(owners.map(([name]) => name), 'declared once').toHaveLength(1)
    expect((owners[0][1] as { excluded?: string }).excluded, 'person-only: an agent never runs a plan for the person').toBeTruthy()
  })
})
