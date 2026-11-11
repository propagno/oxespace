import type { ReactElement } from 'react'
import { Folder, GitBranch } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { workspaceColorAttrs } from '../../../shared/workspace-color'
import { AgentProviderIcon } from '../Sidebar/AgentProviderIcon'
import { CollisionChips } from './CollisionChips'

export interface ThreadSublineWorkspace {
  id: string
  name: string
  color?: number | null
  rootPath?: string
}

export function ThreadSubline(props: {
  provider?: string
  model?: string | null
  workspace?: ThreadSublineWorkspace
  branch?: string | null
  moved?: string | null
  ownedWorktree?: { branch: string; projectRoot: string } | null
  access?: string | null
  startedAt?: number | null
  threadId?: string
}): ReactElement {
  const { provider, model, workspace, branch, moved, ownedWorktree, access, startedAt, threadId } = props
  const { t } = useTranslation('thread')

  const effectiveBranch = branch ?? ownedWorktree?.branch ?? null
  const accessText = access === 'read' || access === 'read-only' || access === 'readonly'
    ? t('subline.accessRead')
    : access === 'full' || access === 'full-access' || access === 'danger-full-access'
      ? t('subline.accessFull')
      : access
        ? t('subline.accessEdit')
        : null
  const providerLabel = provider === 'codex' ? 'Codex' : provider === 'claude' ? 'Claude' : provider
  const knownProvider = provider === 'codex' || provider === 'claude' ? provider : null

  return (
    <div className="thread-subline">
      {(providerLabel || model) && (
        <span className="thread-subline-model">
          {knownProvider && <AgentProviderIcon provider={knownProvider} size={14} />}
          {providerLabel && <span className="thread-subline-provider">{providerLabel}</span>}
          {providerLabel && model && <span aria-hidden="true">{' · '}</span>}
          {model && <span className="thread-subline-model-name">{model}</span>}
        </span>
      )}
      <span
        className="thread-heading-context"
        {...(workspace ? workspaceColorAttrs(workspace as never) : {})}
        title={workspace?.rootPath}
      >
        <Folder size={12} aria-hidden="true" />
        <strong>{workspace?.name ?? t('header.yourProjects')}</strong>
      </span>
      {effectiveBranch && (
        <span className="thread-heading-branch">
          <GitBranch size={11} aria-hidden="true" />
          <code>{effectiveBranch}</code>
          {ownedWorktree && (
            <span
              className="thread-heading-worktree"
              title={t('header.ownedTitle', { branch: ownedWorktree.branch, root: ownedWorktree.projectRoot })}
            >
              {t('header.worktree')}
            </span>
          )}
          {moved && (
            <span className="thread-subline-moved" data-tone="warning">
              {t('subline.movedTo', { branch: moved })}
            </span>
          )}
        </span>
      )}
      {accessText && <span className="thread-subline-access">{accessText}</span>}
      {typeof startedAt === 'number' && Number.isFinite(startedAt) && (() => {
        const minutes = Math.max(1, Math.round((Date.now() - startedAt) / 60_000))
        return (
          <span className="thread-subline-elapsed">
            {minutes >= 120 ? t('subline.elapsedHours', { hours: Math.round(minutes / 60) }) : t('subline.elapsedMin', { minutes })}
          </span>
        )
      })()}
      {threadId && <CollisionChips threadId={threadId} />}
    </div>
  )
}
