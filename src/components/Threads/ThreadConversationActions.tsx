import { Archive, Download, FolderOpen, GitFork, History, Info, MoreHorizontal, Pencil, Trash2, Upload } from 'lucide-react'
import type { ConversationThread } from '../../../shared/types/thread'
import { Menu, type MenuEntry } from '../../ui'
import './ThreadConversationActions.css'

export function ThreadConversationActions({ thread, disabled, onCommand, onExport, onImport }: {
  thread: ConversationThread; disabled: boolean; onCommand(command: string): void; onExport?: () => void; onImport?: () => void
}) {
  const command = (text: string, label: string, Icon: typeof Info, danger = false): MenuEntry => ({ label, icon: <Icon size={14} aria-hidden="true" />, danger, onSelect: () => onCommand(text) })
  const items: MenuEntry[] = [
    { type: 'label', label: 'Current conversation' },
    command('/rename', 'Rename conversation', Pencil),
    command('/resume', 'Find or resume session…', FolderOpen),
    command('/status', 'Conversation status', Info),
    command('/checkpoint', 'File checkpoints', History),
    { type: 'separator' },
    { label: 'Export portable copy', icon: <Download size={14} aria-hidden="true" />, disabled: !onExport, onSelect: () => onExport?.() },
    { label: 'Import conversation', icon: <Upload size={14} aria-hidden="true" />, disabled: !onImport, onSelect: () => onImport?.() },
    ...(thread.provider === 'codex' ? [command('/fork', 'Fork conversation', GitFork)] : []),
    { type: 'separator' },
    command('/archive', 'Archive conversation', Archive),
    command('/delete', 'Delete conversation', Trash2, true)
  ]
  return <Menu label="Conversation actions" items={items}
    trigger={<button type="button" className="thread-conversation-menu" aria-label="Conversation actions" title="Conversation actions" disabled={disabled}><MoreHorizontal size={16} aria-hidden="true" /></button>} />
}
