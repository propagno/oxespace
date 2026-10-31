import { CircleDollarSign, FolderInput, FolderPlus, History, ListChecks, MessageSquarePlus, PencilLine, ScrollText, Undo2, UserRound } from 'lucide-react'
import type { ThreadProjectSummary, ThreadSnapshot } from '../../shared/types/thread'
import { i18n } from '../i18n'
import { useThreadStore } from '../store/thread.store'
import { toast } from '../ui'
import type { ContributedCommand } from '../utils/commandRegistry'
import { humanizeError } from '../utils/humanizeError'
import { navigableThreads } from '../utils/threadNavigation'
import { commandText, tCommand } from './commandText'
import { useCommandSource } from './useCommandSource'

/** Agent accounts are checked inside a project; without one there is nothing to show yet. */
export function sayAddProjectFirst(): void {
  toast({ title: i18n.t('thread:accounts.needProject'), description: i18n.t('thread:accounts.needProjectText') })
}

/** ThreadView runs `{ text }` as if it was typed in the composer of the active conversation. */
export const THREAD_RUN_COMMAND_EVENT = 'oxe:thread-run-command'

export interface ThreadCommandContext {
  snapshot: ThreadSnapshot | null
  projects: ThreadProjectSummary[]
  /** Brings Thread to the front before a command acts on it. */
  showThread: () => void
  newThread: () => void
  newThreadIn: (projectId: string) => void
  addProject: () => void
  openAccounts: () => void
}

const CATEGORY = 'OxeChat' as const

/** Opens the project's latest conversation, or a new one when it has none. */
function switchProject(ctx: ThreadCommandContext, projectId: string): void {
  const { threads, hiddenProjects, select } = useThreadStore.getState()
  const latest = navigableThreads([...threads], hiddenProjects).find(thread => thread.projectId === projectId)
  if (latest) void select(latest.id)
  else ctx.newThreadIn(projectId)
}

/** Restores every file the last finished turn changed, as "Undo all" above the composer does. */
export async function undoLastTurn(snapshot: ThreadSnapshot): Promise<void> {
  const api = window.oxe?.thread
  const turn = [...(snapshot.turns ?? [])].reverse().find(item => item.status !== 'running')
  if (!api?.turnFiles || !api.undoTurnFile) return
  // Said, not silent: the palette only offers this after a finished turn, but the conversation may change under it.
  if (!turn) { toast({ title: i18n.t('thread:undoTurn.nothing'), description: i18n.t('thread:undoTurn.noTurn') }); return }
  const threadId = snapshot.thread.id
  try {
    const files = (await api.turnFiles(threadId, turn.id)).filter(file => file.state === 'pending')
    if (!files.length) { toast({ title: i18n.t('thread:undoTurn.nothing'), description: i18n.t('thread:undoTurn.noFiles') }); return }
    for (const file of files) await api.undoTurnFile(threadId, turn.id, file.path)
    toast({ title: i18n.t('thread:undoTurn.restored', { count: files.length }), intent: 'success' })
  } catch (cause) {
    toast({ title: i18n.t('thread:undoTurn.failed'), description: humanizeError(cause, i18n.t('thread:undoTurn.changedSince')), intent: 'danger' })
  } finally {
    await useThreadStore.getState().refresh(threadId)
  }
}

/** Thread conversations, projects and the conversation commands of the composer, in the palette. */
export function buildThreadCommands(ctx: ThreadCommandContext): ContributedCommand[] {
  const { snapshot } = ctx
  const running = Boolean(snapshot?.turns?.some(turn => turn.status === 'running'))
  const finished = Boolean(snapshot?.turns?.some(turn => turn.status !== 'running'))
  const inThread = (run: () => void) => () => { ctx.showThread(); run() }
  const slash = (id: string, text: string, icon: ContributedCommand['icon'], keywords: string[] = []): ContributedCommand => ({
    id: `thread.${id}`, ...commandText(CATEGORY, `thread.${id}`, { keywords: [text, ...keywords] }), icon, detail: text, disabled: !snapshot,
    // After the view switch, so the active conversation is mounted and listening.
    run: inThread(() => requestAnimationFrame(() => window.dispatchEvent(new CustomEvent(THREAD_RUN_COMMAND_EVENT, { detail: { text } }))))
  })
  return [
    { id: 'thread.new', ...commandText(CATEGORY, 'thread.new', { keywords: ['thread', 'chat', 'oxechat', 'start'] }), icon: MessageSquarePlus, shortcut: 'thread.new', run: inThread(ctx.newThread) },
    { id: 'thread.add-project', ...commandText(CATEGORY, 'thread.add-project', { keywords: ['folder', 'repository'] }), icon: FolderPlus, run: inThread(ctx.addProject) },
    ...ctx.projects.filter(project => !project.hidden).map(project => ({
      id: `thread.project.${project.projectId}`, ...commandText(CATEGORY, 'thread.project', { values: { project: project.displayName }, keywords: ['project', 'change', project.displayName] }),
      detail: project.identityLabel, icon: FolderInput, run: inThread(() => switchProject(ctx, project.projectId))
    })),
    slash('resume', '/resume', History, ['sessions', 'continue', 'history']),
    slash('rename', '/rename', PencilLine, ['title', 'name']),
    slash('spending', '/spending', CircleDollarSign, ['cost', 'usage', 'tokens', 'money']),
    slash('events', '/events', ScrollText, ['log', 'debug']),
    slash('rules', '/rules', ListChecks, ['permissions', 'allow', 'deny']),
    { id: 'thread.undo-last-turn', ...commandText(CATEGORY, 'thread.undo-last-turn', { keywords: ['revert', 'restore', 'checkpoint', 'rewind'] }), icon: Undo2,
      disabled: !snapshot || running || !finished, run: inThread(() => { if (snapshot) void undoLastTurn(snapshot) }) },
    { id: 'thread.accounts', ...commandText(CATEGORY, 'thread.accounts', { keywords: ['login', 'logout', 'claude', 'codex', 'account'] }), icon: UserRound,
      // Accounts are checked inside a project.
      disabled: ctx.projects.length === 0, run: inThread(ctx.openAccounts) }
  ]
}

export function useThreadCommands(ctx: ThreadCommandContext): void {
  useCommandSource('thread', buildThreadCommands(ctx))
}
