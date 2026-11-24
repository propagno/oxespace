import { useEffect, useRef, useState, type ReactNode, type RefObject, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ArrowUp, AtSign, CornerDownLeft, Paperclip, Plug, Plus, Slash, Square, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { PreviewElementRef } from '../../../shared/types/design-mode'
import type { ThreadAttachment, ThreadSnapshot } from '../../../shared/types/thread'
import { useThreadStore } from '../../store/thread.store'
import { useUIStore } from '../../store/ui.store'
import { Button, ErrorState, IconButton, Menu } from '../../ui'
import { humanizeError } from '../../utils/humanizeError'
import { ComposerChips } from './ComposerChips'
import { PreviewElementChips } from './PreviewElementChips'
import { ThreadConfigurationBar } from './ThreadConfigurationBar'
import { ThreadUsageRing } from './ThreadUsageRing'
import { THREAD_MESSAGE_MAX_CHARS } from '../../../shared/threadLimits'
import './ThreadComposerChrome.css'
import { displayThreadTitle } from './threadTitle'
import { formatNumber } from '../../utils/formatTime'
import { composerHints } from './composerModel'
import { deriveComposerHintStatus } from './threadComposerState'
import { useThreadPrefs } from '../../store/thread-prefs.store'
import { isSendKey, sendKeyEvent, sendKeyLabel } from './sendKey'

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

export interface CompactComposerChipsConfig {
  mode: string
  model: string
  models: string[]
  nextModel: string | null
  effort?: string
  efforts?: string[]
  access: string
  onChange: (change: Record<string, unknown>) => void
}

/** The message box: text, attachments, commands, mentions, configuration and send/steer/stop. */
export function ThreadComposerForm({ snapshot, draft, attachments, previewElements = [], pending, running, active, composerState, textarea, fileInput, commands, mentions, openControl, compactChips, workingSet, onControlClosed, onError, onSend, onUpload, onRemoveAttachment, onRemovePreviewElement, onInsertMention, onInterrupt, onCaret }: {
  snapshot: ThreadSnapshot | null
  draft: string
  attachments: ThreadAttachment[]
  previewElements?: readonly PreviewElementRef[]
  pending: boolean
  running: boolean
  active: boolean
  composerState: string
  textarea: RefObject<HTMLTextAreaElement | null>
  fileInput: RefObject<HTMLInputElement | null>
  commands: CommandInput
  mentions: { popup: ReactNode; onKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => boolean }
  openControl: 'model' | 'effort' | 'permissions' | null
  compactChips?: CompactComposerChipsConfig
  workingSet?: ReactNode
  onControlClosed: () => void
  onError: (message: string) => void
  onSend: (mode?: 'queue' | 'steer') => void
  onUpload: (files: File[]) => void
  onRemoveAttachment: (attachmentId: string) => void
  onRemovePreviewElement?: (elementId: string) => void
  onInsertMention: () => void
  onInterrupt: () => void
  onCaret: (caret: number) => void
}) {
  const { t } = useTranslation('thread')
  const sendKey = useThreadPrefs(state => state.sendKey)
  const formRef = useRef<HTMLFormElement>(null)
  const [narrow, setNarrow] = useState(false)
  const [compactModel, setCompactModel] = useState(false)
  const [modeSaving, setModeSaving] = useState(false)
  const api = window.oxe?.thread
  useEffect(() => {
    const node = formRef.current
    if (!node) return
    const update = (width: number) => { if (width > 0) { setNarrow(width < 420); setCompactModel(width <= 560) } }
    update(node.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(entries => {
      const entry = entries[0]
      update(entry?.contentBoxSize?.[0]?.inlineSize ?? entry?.contentRect?.width ?? node.clientWidth)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  const blocked = !snapshot || pending || Boolean(snapshot.thread.cliActive)
  const tooLong = draft.length > THREAD_MESSAGE_MAX_CHARS
  const hasContent = Boolean(draft.trim() || attachments.length || previewElements.length)
  const canSteer = Boolean(snapshot?.thread.capabilities?.features.steering?.enabled)
  const hints = composerHints({
    status: deriveComposerHintStatus(snapshot?.thread, running, (snapshot?.pendingRequests?.length ?? 0) > 0),
    canSteer
  })
  const showSteer = hints.steer || (running && snapshot?.thread.capabilities?.features?.steering?.enabled !== false && Boolean(draft.trim() || attachments.length))
  const desired = snapshot ? (snapshot.thread.pendingConfiguration ?? snapshot.thread) : null
  const planning = desired?.mode === 'plan'
  const setMode = async (plan: boolean) => {
    if (!snapshot || modeSaving || plan === planning) return
    setModeSaving(true)
    try {
      if (!window.oxe.thread?.configure) throw Error(t('config.restart'))
      const next = await window.oxe.thread.configure(snapshot.thread.id, { mode: plan ? 'plan' : desired?.mode === 'acceptEdits' ? 'acceptEdits' : 'default' }, snapshot.thread.configurationRevision ?? 0)
      useThreadStore.getState().updateSnapshot(next)
    } catch (error) { onError(humanizeError(error, t('config.applyFailed'))) }
    finally { setModeSaving(false) }
  }
  const placeholder = !snapshot
    ? t('composer.placeholderNone')
    : snapshot.thread.connection?.suspendedAt
      ? t('composer.placeholderSuspended')
      : hints.placeholder
  return <form ref={formRef} className="thread-composer" data-ui="composer" data-state={composerState} aria-busy={pending} onSubmit={e => { e.preventDefault(); if (!tooLong) onSend() }} onDragOver={event => { if ([...event.dataTransfer.items].some(item => item.kind === 'file')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' } }} onDrop={event => { const files = [...event.dataTransfer.files].filter(file => file.type.startsWith('image/')); if (files.length) { event.preventDefault(); onUpload(files) } }}>
    {commands.popup}
    {mentions.popup}
    {workingSet}
    {previewElements.length > 0 && onRemovePreviewElement && <PreviewElementChips elements={previewElements} disabled={pending} onRemove={onRemovePreviewElement} />}
    {attachments.length > 0 && <div className="thread-attachments" aria-label={t('composer.attachments')}>{attachments.map(attachment => <div key={attachment.id}><span>{attachment.name}</span><small>{t('message.kilobytes', { size: formatNumber(Math.ceil(attachment.bytes / 1024)) })}</small><button type="button" aria-label={t('composer.remove', { name: attachment.name })} disabled={pending} onClick={() => onRemoveAttachment(attachment.id)}><X size={12} /></button></div>)}</div>}
    <input ref={fileInput} type="file" hidden multiple accept="image/png,image/jpeg,image/webp,image/gif" onChange={event => { onUpload(Array.from(event.target.files ?? [])); event.target.value = '' }} />
    <textarea ref={textarea} data-thread-composer="true" data-dialog-return aria-label={active ? t('composer.message') : t('composer.messageIn', { title: snapshot ? displayThreadTitle(snapshot.thread.title) : t('composer.conversation') })} {...commands.inputProps} placeholder={placeholder} value={draft} disabled={blocked}
      onChange={e => { onCaret(e.target.selectionStart); commands.onChange(e.target.value, e.target.selectionStart) }} onSelect={e => { onCaret(e.currentTarget.selectionStart); commands.onSelect(e.currentTarget.selectionStart) }} onFocus={commands.onFocus} onBlur={commands.onBlur}
      onPaste={event => { const files = [...event.clipboardData.files].filter(file => file.type.startsWith('image/')); if (files.length) { event.preventDefault(); onUpload(files) } }}
      onKeyDown={e => { if (mentions.onKeyDown(e)) return; if (commands.onKeyDown(e)) return; if (isSendKey(sendKeyEvent(e), sendKey)) { e.preventDefault(); onSend() } else if (e.key === 'Escape' && running) { e.preventDefault(); e.stopPropagation(); onInterrupt() } }} />
    <footer data-ui="composer-toolbar" data-width={narrow ? 'narrow' : 'full'}>
      {!compactChips && <div className="thread-mode-toggle" data-ui="mode-switch" role="group" aria-label={t('config.mode')} title={t('config.modeTitle')}>
        <button type="button" data-ui="segment" aria-pressed={!planning} disabled={!snapshot || modeSaving} onClick={() => void setMode(false)}>{t('config.agent')}</button>
        <button type="button" data-ui="segment" data-mode="plan" aria-pressed={planning} disabled={!snapshot || modeSaving} onClick={() => void setMode(true)}>{t('config.plan')}</button>
      </div>}
      <Menu label={t('composer.context')} side="top" items={[
        { label: t('composer.mention'), icon: <AtSign size={14} />, onSelect: onInsertMention },
        { label: t('composer.attach'), icon: <Paperclip size={14} />, disabled: attachments.length >= 8 || !api?.attach, onSelect: () => fileInput.current?.click() },
        { label: t('composer.commands'), icon: <Slash size={14} />, shortcut: 'Ctrl+/', disabled: blocked, onSelect: commands.show },
        { label: t('moreActions.mcp'), icon: <Plug size={14} />, onSelect: () => useUIStore.getState().openMcpPanel() }
      ]} trigger={<Button type="button" variant="ghost" size="sm" className="thread-context-trigger" aria-label={t('composer.context')} title={t('composer.addTitle')} disabled={!snapshot || pending} icon={<Plus size={14} aria-hidden="true" />}><span className="thread-context-label">{t('composer.context')}</span></Button>} />
      <div className="thread-composer-right">
        {compactChips
          ? <ComposerChips {...compactChips} />
          : snapshot && <ThreadConfigurationBar key={snapshot.thread.id} thread={snapshot.thread} narrow={narrow} compact={compactModel} openControl={openControl} onControlClosed={onControlClosed} onError={onError} onConfigured={value => useThreadStore.getState().updateSnapshot(value)} />}
        {!narrow && snapshot && <ThreadUsageRing provider={snapshot.thread.provider} idle={!running} threadId={snapshot.thread.id} context={snapshot.thread.contextReport} />}
        {showSteer && <IconButton size="sm" variant="ghost" className="thread-command-trigger" label={t('composer.steer')} title={t('composer.steerTitle')} disabled={pending || !hasContent} onClick={() => onSend('steer')} icon={<CornerDownLeft size={14} />} />}
        {/* T57: a labelled button in the danger color, never a second accent circle next to Send. */}
        {running && <Button size="sm" variant="danger" className="thread-stop" aria-label={t('composer.stop')} title={t('composer.stopTitle')} onClick={onInterrupt} icon={<Square size={12} fill="currentColor" aria-hidden="true" />}>{t('composer.stopShort')}</Button>}
        <IconButton type="submit" size="sm" variant="primary" className="thread-send oxe-press" label={running ? t('composer.queue') : t('composer.send')} title={running ? t('composer.queueTitle', { key: sendKeyLabel(sendKey) }) : t('composer.sendTitle', { key: sendKeyLabel(sendKey) })} disabled={blocked || tooLong || !hasContent} icon={<ArrowUp size={16} />} />
      </div>
    </footer>
    {tooLong && <ErrorState compact title={t('composer.tooLong', { length: formatNumber(draft.length), limit: formatNumber(THREAD_MESSAGE_MAX_CHARS) })} />}
  </form>
}
