import { Archive, Download, FolderOpen, GitFork, History, Info, MoreHorizontal, Pencil, Trash2, Upload } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ConversationThread } from '../../../shared/types/thread'
import { Menu, type MenuEntry } from '../../ui'
import './ThreadConversationActions.css'

export function ThreadConversationActions({ thread, disabled, onCommand, onExport, onImport }: {
  thread: ConversationThread; disabled: boolean; onCommand(command: string): void; onExport?: () => void; onImport?: () => void
}) {
  const { t } = useTranslation('thread')
  const command = (text: string, label: string, Icon: typeof Info, danger = false): MenuEntry => ({ label, icon: <Icon size={14} aria-hidden="true" />, danger, onSelect: () => onCommand(text) })
  const items: MenuEntry[] = [
    { type: 'label', label: t('conversationActions.current') },
    command('/rename', t('conversationActions.rename'), Pencil),
    command('/resume', t('conversationActions.resume'), FolderOpen),
    command('/status', t('conversationActions.status'), Info),
    command('/checkpoint', t('conversationActions.checkpoints'), History),
    { type: 'separator' },
    { label: t('conversationActions.export'), icon: <Download size={14} aria-hidden="true" />, disabled: !onExport, onSelect: () => onExport?.() },
    { label: t('conversationActions.import'), icon: <Upload size={14} aria-hidden="true" />, disabled: !onImport, onSelect: () => onImport?.() },
    ...(thread.provider === 'codex' ? [command('/fork', t('conversationActions.fork'), GitFork)] : []),
    { type: 'separator' },
    command('/archive', t('conversationActions.archive'), Archive),
    command('/delete', t('conversationActions.delete'), Trash2, true)
  ]
  return <Menu label={t('conversationActions.menu')} items={items}
    trigger={<button type="button" className="thread-conversation-menu" aria-label={t('conversationActions.menu')} title={t('conversationActions.menu')} disabled={disabled}><MoreHorizontal size={16} aria-hidden="true" /></button>} />
}
