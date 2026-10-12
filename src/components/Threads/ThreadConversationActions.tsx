import { Archive, Download, FolderOpen, GitFork, History, Info, MoreHorizontal, Pencil, Trash2, Upload } from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import type { ConversationThread } from '../../../shared/types/thread'
import './ThreadConversationActions.css'

export function ThreadConversationActions({ thread, disabled, onCommand, onExport, onImport }: {
  thread: ConversationThread; disabled: boolean; onCommand(command: string): void; onExport?: () => void; onImport?: () => void
}) {
  const item = (command: string, label: string, Icon: typeof Info, destructive = false) => <DropdownMenu.Item
    className={`thread-action-item${destructive ? ' is-destructive' : ''}`}
    onSelect={() => onCommand(command)}>
    <Icon size={15} aria-hidden="true" /><span>{label}</span>
  </DropdownMenu.Item>

  return <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild><button type="button" className="thread-conversation-menu" aria-label="Conversation actions" title="Conversation actions" disabled={disabled}><MoreHorizontal size={17} aria-hidden="true" /></button></DropdownMenu.Trigger>
    <DropdownMenu.Portal><DropdownMenu.Content className="thread-actions-dropdown" align="start" sideOffset={7} collisionPadding={12} aria-label="Conversation actions">
      <DropdownMenu.Label className="thread-actions-label">Current conversation<span title={thread.title}>{thread.title}</span></DropdownMenu.Label>
      <DropdownMenu.Group>
        {item('/rename', 'Rename conversation', Pencil)}
        {item('/resume', 'Find or resume session…', FolderOpen)}
        {item('/status', 'Conversation status', Info)}
        {item('/checkpoint', 'File checkpoints', History)}
      </DropdownMenu.Group>
      <DropdownMenu.Separator className="thread-actions-separator" />
      <DropdownMenu.Group>
        <DropdownMenu.Item className="thread-action-item" disabled={!onExport} onSelect={onExport}><Download size={15} aria-hidden="true" /><span>Export portable copy</span></DropdownMenu.Item>
        <DropdownMenu.Item className="thread-action-item" disabled={!onImport} onSelect={onImport}><Upload size={15} aria-hidden="true" /><span>Import conversation</span></DropdownMenu.Item>
        {thread.provider === 'codex' && item('/fork', 'Fork conversation', GitFork)}
      </DropdownMenu.Group>
      <DropdownMenu.Separator className="thread-actions-separator" />
      <DropdownMenu.Group>
        {item('/archive', 'Archive conversation', Archive)}
        {item('/delete', 'Delete conversation', Trash2, true)}
      </DropdownMenu.Group>
    </DropdownMenu.Content></DropdownMenu.Portal>
  </DropdownMenu.Root>
}
