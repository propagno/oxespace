import type { ReactNode, RefObject, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ArrowUp, AtSign, AudioLines, CornerDownLeft, Paperclip, Plug, Plus, Slash, Square, X } from 'lucide-react'
import type { ThreadAttachment, ThreadSnapshot } from '../../../shared/types/thread'
import { useThreadStore } from '../../store/thread.store'
import { useUIStore } from '../../store/ui.store'
import { Menu } from '../../ui'
import { VoiceHud } from '../Voice/VoiceHud'
import { ThreadConfigurationBar } from './ThreadConfigurationBar'
import { ThreadMcpHealth } from './ThreadMcpHealth'
import { ThreadUsageRing } from './ThreadUsageRing'
import type { useOxeVoice } from '../../hooks/useOxeVoice'
import { THREAD_MESSAGE_MAX_CHARS } from '../../../shared/threadLimits'
import './ThreadComposerChrome.css'

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
  const api = window.oxe?.thread
  const blocked = !snapshot || pending || Boolean(snapshot.thread.cliActive)
  const tooLong = draft.length > THREAD_MESSAGE_MAX_CHARS
  return <form className="thread-composer" data-state={composerState} aria-busy={pending} onSubmit={e => { e.preventDefault(); if (!tooLong) onSend() }} onDragOver={event => { if ([...event.dataTransfer.items].some(item => item.kind === 'file')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' } }} onDrop={event => { const files = [...event.dataTransfer.files].filter(file => file.type.startsWith('image/')); if (files.length) { event.preventDefault(); onUpload(files) } }}>
    <VoiceHud status={voice.status} error={voice.error} level={voice.level} modelProgress={voice.modelProgress} onDismiss={voice.dismiss} containerSelector=".thread-view" focusSelector="textarea[data-thread-composer='true']" />
    {commands.popup}
    {mentions.popup}
    {attachments.length > 0 && <div className="thread-attachments" aria-label="Attachments">{attachments.map(attachment => <div key={attachment.id}><span>{attachment.name}</span><small>{Math.ceil(attachment.bytes / 1024)} KB</small><button type="button" aria-label={`Remove ${attachment.name}`} disabled={pending} onClick={() => onRemoveAttachment(attachment.id)}><X size={12} /></button></div>)}</div>}
    <input ref={fileInput} type="file" hidden multiple accept="image/png,image/jpeg,image/webp,image/gif" onChange={event => { onUpload(Array.from(event.target.files ?? [])); event.target.value = '' }} />
    <textarea ref={textarea} data-thread-composer="true" data-dialog-return aria-label={active ? 'Message' : `Message in ${snapshot?.thread.title ?? 'conversation'}`} {...commands.inputProps} placeholder={!snapshot ? 'Create a thread to get started…' : snapshot.thread.connection?.suspendedAt ? 'Closed while idle to free memory. Your next message resumes the session…' : 'Ask about your project, or / for commands…'} value={draft} disabled={blocked}
      onChange={e => { onCaret(e.target.selectionStart); commands.onChange(e.target.value, e.target.selectionStart) }} onSelect={e => { onCaret(e.currentTarget.selectionStart); commands.onSelect(e.currentTarget.selectionStart) }} onFocus={commands.onFocus} onBlur={commands.onBlur}
      onPaste={event => { const files = [...event.clipboardData.files].filter(file => file.type.startsWith('image/')); if (files.length) { event.preventDefault(); onUpload(files) } }}
      onKeyDown={e => { if (mentions.onKeyDown(e)) return; if (commands.onKeyDown(e)) return; if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); onSend() } else if (e.key === 'Escape' && running && !pending) { e.preventDefault(); e.stopPropagation(); onInterrupt() } }} />
    <footer><div className="thread-composer-group"><button type="button" className="thread-command-trigger" aria-label="Show thread commands" title="Commands & skills · Ctrl+/" aria-haspopup="listbox" aria-expanded={commands.open} disabled={blocked} onMouseDown={e => e.preventDefault()} onClick={commands.show}><Slash size={14} /></button>
      <Menu label="Add to prompt" side="top" items={[
        { label: 'Attach image', icon: <Paperclip size={14} />, disabled: attachments.length >= 8 || !api?.attach, onSelect: () => fileInput.current?.click() },
        { label: 'Mention a file', icon: <AtSign size={14} />, onSelect: onInsertMention },
        { label: 'MCP connections', icon: <Plug size={14} />, onSelect: () => useUIStore.getState().openMcpPanel() }
      ]} trigger={<button type="button" className="thread-command-trigger" aria-label="Add to prompt" title="Attach, mention a file or connect tools" disabled={!snapshot || pending}><Plus size={14} /></button>} /></div>
      {snapshot && <ThreadConfigurationBar key={snapshot.thread.id} thread={snapshot.thread} openControl={openControl} onControlClosed={onControlClosed} onError={onError} onConfigured={value => useThreadStore.getState().updateSnapshot(value)} />}
      {running && snapshot?.thread.capabilities?.features.steering?.enabled && <button type="button" className="thread-command-trigger" aria-label="Steer active turn" title="Send guidance to the active turn" disabled={pending || (!draft.trim() && !attachments.length)} onClick={() => onSend('steer')}><CornerDownLeft size={14} /></button>}
      {snapshot && <div className="thread-composer-group thread-composer-status">
      <ThreadMcpHealth thread={snapshot.thread} />
      <ThreadUsageRing provider={snapshot.thread.provider} idle={!running} threadId={snapshot.thread.id} context={snapshot.thread.contextReport} /></div>}
      <button type="button" className="thread-voice" aria-label="Voice input" title="Voice input · Ctrl+Shift+V" disabled={!snapshot || pending || !voice.isSupported} onClick={voice.toggle}><AudioLines size={15} /></button>
      {running && <button type="button" className="thread-stop" aria-label="Stop turn" title="Stop turn · Esc" disabled={pending} onClick={onInterrupt}><Square size={14} /></button>}
      <button type="submit" className="thread-send" aria-label={running ? 'Queue follow-up' : 'Send'} title={running ? 'Queue follow-up · Enter' : 'Send · Enter'} disabled={blocked || tooLong || (!draft.trim() && !attachments.length)}><ArrowUp size={16} /></button></footer>
    {tooLong && <p className="thread-composer-limit" role="alert">This message has {draft.length.toLocaleString('en-US')} characters; the limit is {THREAD_MESSAGE_MAX_CHARS.toLocaleString('en-US')}. Attach long text as a file instead.</p>}
  </form>
}
