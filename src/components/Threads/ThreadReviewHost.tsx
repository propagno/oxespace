import type { RefObject } from 'react'
import { Dialog as RadixDialog } from 'radix-ui'
import { useTranslation } from 'react-i18next'
import type { ThreadSnapshot } from '../../../shared/types/thread'
import type { Workspace } from '../../../shared/types/workspace'
import { useThreadWorkbenchStore, type ThreadPanel } from '../../store/thread-workbench.store'
import { ThreadChangesPanel } from './ThreadChangesPanel'
import { clampToolPanelWidth, ToolPanelSplitter } from './threadToolPanels'

/**
 * The side panel next to the conversation (changes, files, terminal…): a
 * resizable column on wide layouts, a modal drawer on narrow ones. Loaded on demand.
 */
export default function ThreadReviewHost({ snapshot, workspace, panel, drawer, availableWidth, workbench, onClose, onReturnFocus, onSendToConversation, onCompact }: {
  snapshot: ThreadSnapshot
  workspace?: Workspace
  panel: ThreadPanel
  drawer: boolean
  availableWidth: number
  workbench: RefObject<HTMLDivElement | null>
  onClose: () => void
  onReturnFocus: () => void
  onSendToConversation: (prompt: string) => void
  /** Runs /compact in the conversation, for the session panel. */
  onCompact?: () => void
}) {
  const { t } = useTranslation('thread')
  const reviewWidth = useThreadWorkbenchStore(state => state.width)
  const maximized = useThreadWorkbenchStore(state => state.maximizedId === snapshot.thread.id) && !drawer
  const content = <ThreadChangesPanel key={snapshot.thread.id} snapshot={snapshot} workspace={workspace} panel={panel} onClose={onClose} onSendToConversation={onSendToConversation} onCompact={onCompact}
    maximized={maximized} onToggleMaximized={drawer ? undefined : () => useThreadWorkbenchStore.getState().setMaximized(maximized ? null : snapshot.thread.id)} />
  // A drawer inside the workbench, not a U1 dialog: it keeps the column's width.
  if (drawer) return <RadixDialog.Root open onOpenChange={open => { if (!open) onClose() }}><RadixDialog.Portal container={workbench.current}>
    <RadixDialog.Overlay className="thread-review-scrim" />
    <RadixDialog.Content className="thread-review-host" aria-describedby={undefined} style={{ width: Math.min(reviewWidth, Math.max(280, availableWidth - 16)) }} onCloseAutoFocus={event => { event.preventDefault(); onReturnFocus() }}>
      <RadixDialog.Title className="thread-review-accessible-title">{t('reviewHost.title')}</RadixDialog.Title>
      {content}
    </RadixDialog.Content>
  </RadixDialog.Portal></RadixDialog.Root>
  if (maximized) return <div className="thread-review-host is-maximized">{content}</div>
  // As wide as it was dragged, up to leaving the conversation its minimum width.
  const width = clampToolPanelWidth(reviewWidth, availableWidth)
  return <>
    <ToolPanelSplitter width={width} available={availableWidth}
      onChange={value => useThreadWorkbenchStore.getState().setWidth(value)} />
    <div className="thread-review-host" style={{ width }}>
      {content}
    </div>
  </>
}
