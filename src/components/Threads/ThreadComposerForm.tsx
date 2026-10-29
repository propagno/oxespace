import type { ReactNode, RefObject, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ArrowUp, AtSign, AudioLines, CornerDownLeft, Paperclip, Plug, Plus, Slash, Square, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ThreadAttachment, ThreadSnapshot } from '../../../shared/types/thread'
import { useThreadStore } from '../../store/thread.store'
import { useUIStore } from '../../store/ui.store'
import { ErrorState, Menu } from '../../ui'
import { VoiceHud } from '../Voice/VoiceHud'
import { ThreadConfigurationBar } from './ThreadConfigurationBar'
import { ThreadMcpHealth } from './ThreadMcpHealth'
import { ThreadUsageRing } from './ThreadUsageRing'
import type { useOxeVoice } from '../../hooks/useOxeVoice'
import { THREAD_MESSAGE_MAX_CHARS } from '../../../shared/threadLimits'
import { withShortcut } from '../../keyboard/keybindings'
import './ThreadComposerChrome.css'
import { formatNumber } from '../../utils/formatTime'

type Voice = ReturnType<typeof useOxeVoice>
/** The parts of useThreadCommands / useFileMentions the composer wires into its textarea. */
interface CommandInput {
  popup: ReactNode
  open: boolean
  show: () => void
  inputProps: object
  onChange: (value: string, caret: number) => void
  onSelect: (caret: number) => void
  onFocus: () => void
  onBlur: () => void
  onKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => boolean
}

/** The message box: text, attachments, commands, mentions, voice, configuration and send/steer/stop. */
export function ThreadComposerForm({ snapshot, draft, attachments, pending, running, active, composerState, textarea, fileInput, commands, mentions, voice, openControl, onControlClosed, onError, onSend, onUpload, onRemoveAttachment, onInsertMention, onInterrupt, onCaret }: {
  snapshot: ThreadSnapshot | null
  draft: string
  attachments: ThreadAttachment[]
  pending: boolean
  running: boolean
  active: boolean
  composerState: string
  textarea: RefObject<HTMLTextAreaElement | null>
  fileInput: RefObject<HTMLInputElement | null>
  commands: CommandInput
  mentions: { popup: ReactNode; onKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => boolean }
  voice: Voice
  openControl: 'model' | 'effort' | 'permissions' | null
  onControlClosed: () => void
  onError: (message: string) => void
  onSend: (mode?: 'queue' | 'steer') => void
  onUpload: (files: File[]) => void
  onRemoveAttachment: (attachmentId: string) => void
  onInsertMention: () => void
  onInterrupt: () => void
  onCaret: (caret: number) => void
}) {
  const { t } = useTranslation('thread')
  const api = window.oxe?.thread
  const blocked = !snapshot || pending || Boolean(snapshot.thread.cliActive)
  const tooLong = draft.length > THREAD_MESSAGE_MAX_CHARS
  return <form className="thread-composer" data-state={composerState} aria-busy={pending} onSubmit={e => { e.preventDefault(); if (!tooLong) onSend() }} onDragOver={event => { if ([...event.dataTransfer.items].some(item => item.kind === 'file')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' } }} onDrop={event => { const files = [...event.dataTransfer.files].filter(file => file.type.startsWith('image/')); if (files.length) { event.preventDefault(); onUpload(files) } }}>
    <VoiceHud status={voice.status} error={voice.error} level={voice.level} modelProgress={voice.modelProgress} onDismiss={voice.dismiss} containerSelector=".thread-view" focusSelector="textarea[data-thread-composer='true']" />
    {commands.popup}
    {mentions.popup}
    {attachments.length > 0 && <div className="thread-attachments" aria-label={t('composer.attachments')}>{attachments.map(attachment => <div key={attachment.id}><span>{attachment.name}</span><small>{t('message.kilobytes', { size: formatNumber(Math.ceil(attachment.bytes / 1024)) })}</small><button type="button" aria-label={t('composer.remove', { name: attachment.name })} disabled={pending} onClick={() => onRemoveAttachment(attachment.id)}><X size={12} /></button></div>)}</div>}
    <input ref={fileInput} type="file" hidden multiple accept="image/png,image/jpeg,image/webp,image/gif" onChange={event => { onUpload(Array.from(event.target.files ?? [])); event.target.value = '' }} />
    <textarea ref={textarea} data-thread-composer="true" data-dialog-return aria-label={active ? t('composer.message') : t('composer.messageIn', { title: snapshot?.thread.title ?? t('composer.conversation') })} {...commands.inputProps} placeholder={!snapshot ? t('composer.placeholderNone') : snapshot.thread.connection?.suspendedAt ? t('composer.placeholderSuspended') : t('composer.placeholder')} value={draft} disabled={blocked}
      onChange={e => { onCaret(e.target.selectionStart); commands.onChange(e.target.value, e.target.selectionStart) }} onSelect={e => { onCaret(e.currentTarget.selectionStart); commands.onSelect(e.currentTarget.selectionStart) }} onFocus={commands.onFocus} onBlur={commands.onBlur}
      onPaste={event => { const files = [...event.clipboardData.files].filter(file => file.type.startsWith('image/')); if (files.length) { event.preventDefault(); onUpload(files) } }}
      onKeyDown={e => { if (mentions.onKeyDown(e)) return; if (commands.onKeyDown(e)) return; if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); onSend() } else if (e.key === 'Escape' && running && !pending) { e.preventDefault(); e.stopPropagation(); onInterrupt() } }} />
    <footer><div className="thread-composer-group"><button type="button" className="thread-command-trigger" aria-label={t('composer.commands')} title={t('composer.commandsTitle')} aria-haspopup="listbox" aria-expanded={commands.open} disabled={blocked} onMouseDown={e => e.preventDefault()} onClick={commands.show}><Slash size={14} /></button>
      <Menu label={t('composer.add')} side="top" items={[
        { label: t('composer.attach'), icon: <Paperclip size={14} />, disabled: attachments.length >= 8 || !api?.attach, onSelect: () => fileInput.current?.click() },
        { label: t('composer.mention'), icon: <AtSign size={14} />, onSelect: onInsertMention },
        { label: t('header.mcp'), icon: <Plug size={14} />, onSelect: () => useUIStore.getState().openMcpPanel() }
      ]} trigger={<button type="button" className="thread-command-trigger" aria-label={t('composer.add')} title={t('composer.addTitle')} disabled={!snapshot || pending}><Plus size={14} /></button>} /></div>
      {snapshot && <ThreadConfigurationBar key={snapshot.thread.id} thread={snapshot.thread} openControl={openControl} onControlClosed={onControlClosed} onError={onError} onConfigured={value => useThreadStore.getState().updateSnapshot(value)} />}
      {running && snapshot?.thread.capabilities?.features.steering?.enabled && <button type="button" className="thread-command-trigger" aria-label={t('composer.steer')} title={t('composer.steerTitle')} disabled={pending || (!draft.trim() && !attachments.length)} onClick={() => onSend('steer')}><CornerDownLeft size={14} /></button>}
      {snapshot && <div className="thread-composer-group thread-composer-status">
      <ThreadMcpHealth thread={snapshot.thread} />
      <ThreadUsageRing provider={snapshot.thread.provider} idle={!running} threadId={snapshot.thread.id} context={snapshot.thread.contextReport} /></div>}
      <button type="button" className="thread-voice" aria-label={t('composer.voice')} title={withShortcut(t('composer.voice'), 'voice.toggle')} disabled={!snapshot || pending || !voice.isSupported} onClick={voice.toggle}><AudioLines size={15} /></button>
      {running && <button type="button" className="thread-stop" aria-label={t('composer.stop')} title={t('composer.stopTitle')} disabled={pending} onClick={onInterrupt}><Square size={14} /></button>}
      <button type="submit" className="thread-send" aria-label={running ? t('composer.queue') : t('composer.send')} title={running ? t('composer.queueTitle') : t('composer.sendTitle')} disabled={blocked || tooLong || (!draft.trim() && !attachments.length)}><ArrowUp size={16} /></button></footer>
    {tooLong && <ErrorState compact title={t('composer.tooLong', { length: formatNumber(draft.length), limit: formatNumber(THREAD_MESSAGE_MAX_CHARS) })} />}
  </form>
}
