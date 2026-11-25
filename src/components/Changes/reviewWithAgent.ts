import { THREAD_PROVIDERS } from '../../../shared/threadProviders'
import type { GitDiffSummaryFile } from '../../../shared/types/git'
import type { ThreadProvider, ThreadSnapshot } from '../../../shared/types/thread'
import { i18n } from '../../i18n'
import { useThreadStore } from '../../store/thread.store'

export type ReviewScopeKind = 'branch' | 'uncommitted' | 'staged' | 'last-turn'

const MAX_PROMPT_FILES = 60

const normalizePath = (value: string): string =>
  value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

export function scopeTranslationKey(scope: ReviewScopeKind): 'branch' | 'uncommitted' | 'staged' | 'lastTurn' {
  return scope === 'last-turn' ? 'lastTurn' : scope
}

/**
 * Picks a default reviewer agent that differs from the current thread's agent when known.
 */
export function pickDefaultReviewerProvider(currentProvider?: ThreadProvider | null): ThreadProvider {
  if (!currentProvider) return THREAD_PROVIDERS[0]
  return THREAD_PROVIDERS.find(provider => provider !== currentProvider) ?? THREAD_PROVIDERS[0]
}

/**
 * Builds the read-only review prompt describing the selected diff scope and changed files.
 */
export function buildReadOnlyReviewPrompt(input: {
  scope: ReviewScopeKind
  base?: string | null
  head?: string | null
  files: GitDiffSummaryFile[]
}): string {
  const scopeLabel = i18n.t(`changes.scope.${scopeTranslationKey(input.scope)}`, { ns: 'code' })
  const lines: string[] = [
    i18n.t('changes.reviewAgent.promptIntro', { ns: 'code' }),
    '',
    i18n.t('changes.reviewAgent.promptScope', { ns: 'code', scope: scopeLabel })
  ]
  if (input.scope === 'branch' && input.base && input.head) {
    lines.push(i18n.t('changes.reviewAgent.promptCompare', { ns: 'code', base: input.base, head: input.head }))
  }
  lines.push('', i18n.t('changes.reviewAgent.promptFiles', { ns: 'code', count: input.files.length }))
  for (const file of input.files.slice(0, MAX_PROMPT_FILES)) {
    lines.push(`- [${file.status}] ${file.path} (+${file.additions}/-${file.deletions})`)
  }
  if (input.files.length > MAX_PROMPT_FILES) {
    lines.push(i18n.t('changes.reviewAgent.promptMoreFiles', { ns: 'code', count: input.files.length - MAX_PROMPT_FILES }))
  }
  return lines.join('\n')
}

async function resolveProjectId(workspaceId: string, rootPath: string): Promise<string> {
  const normalized = normalizePath(rootPath)
  const projects = useThreadStore.getState().projects
  const existing = projects.find(project =>
    project.contexts.some(context => normalizePath(context.rootPath) === normalized)
  )
  if (existing) return existing.projectId
  if (window.oxe?.thread?.addProject) {
    const added = await window.oxe.thread.addProject(rootPath)
    if (added?.projectId) return added.projectId
  }
  return workspaceId
}

/**
 * Creates a separate conversation with the chosen reviewer provider, enforces read-only
 * access before sending any message, and sends the review prompt.
 */
export async function launchReadOnlyAgentReview(input: {
  workspaceId: string
  rootPath: string
  provider: ThreadProvider
  scope: ReviewScopeKind
  base?: string | null
  head?: string | null
  files: GitDiffSummaryFile[]
}): Promise<ThreadSnapshot> {
  const api = window.oxe?.thread
  if (!api?.create || !api?.send) {
    throw new Error(i18n.t('changes.reviewAgent.unavailable', { ns: 'code' }))
  }
  if (!api.configure) {
    throw new Error(i18n.t('changes.reviewAgent.readOnlyUnavailable', { ns: 'code' }))
  }

  const projectId = await resolveProjectId(input.workspaceId, input.rootPath)
  const created = await api.create({ projectId, rootPath: input.rootPath, provider: input.provider })
  const configured = await api.configure(
    created.thread.id,
    { access: 'read-only', networkAccess: false, hooksEnabled: false },
    created.thread.configurationRevision ?? 0
  )

  useThreadStore.getState().adopt(configured)
  const prompt = buildReadOnlyReviewPrompt({
    scope: input.scope,
    base: input.base,
    head: input.head,
    files: input.files
  })
  await api.send(configured.thread.id, prompt)
  return configured
}
