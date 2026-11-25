import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type RefObject } from 'react'
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
import { useThreadCommands } from './useThreadCommands'
import { useFileMentions } from './useFileMentions'

/** How long a first Escape keeps the stop armed for the second one (OXE-338). */
const STOP_ESCAPE_WINDOW_MS = 2000

// Stable empty references so Zustand selectors never return a fresh array on every read.
const NO_ATTACHMENTS: ThreadAttachment[] = []
const NO_PREVIEW_ELEMENTS: PreviewElementRef[] = []

/** Imperative bridge from ThreadView to the composer's slash-command state without lifting keystroke state up (OXE-348). */
export interface ThreadComposerCommandsHandle {
  isOpen: () => boolean
  show: () => void
  executeLocal: (text: string) => boolean
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
export function ThreadComposerForm({ snapshot, pending, running, active, composerState, textarea, fileInput, commandsRef, openControl, compactChips, workingSet, onControlClosed, onError, onSend, onUpload, onRemoveAttachment, onRemovePreviewElement, onInterrupt, onRunAction, onRunCommand, onNewThread, onAccounts }: {
  snapshot: ThreadSnapshot | null
  pending: boolean
  running: boolean
  active: boolean
  composerState: string
  textarea: RefObject<HTMLTextAreaElement | null>
  fileInput: RefObject<HTMLInputElement | null>
  commandsRef?: RefObject<ThreadComposerCommandsHandle | null>
  openControl: 'model' | 'effort' | 'permissions' | null
  compactChips?: CompactComposerChipsConfig
  workingSet?: ReactNode
  onControlClosed: () => void
  onError: (message: string) => void
  onSend: (mode?: 'queue' | 'steer') => void
  onUpload: (files: File[]) => void
  onRemoveAttachment: (attachmentId: string) => void
  onRemovePreviewElement?: (elementId: string) => void
  onInterrupt: () => void
  onRunAction: (run: () => Promise<unknown>) => Promise<void>
  onRunCommand: (text: string) => void
  onNewThread?: () => void
  onAccounts?: () => void
}) {
  const { t } = useTranslation('thread')
  const sendKey = useThreadPrefs(state => state.sendKey)
  const threadId = snapshot?.thread.id
  // Subscribing inside the composer isolates every keystroke, caret move, attachment and preview chip
  // from ThreadView so typing never re-renders the message timeline or header (OXE-348).
  const draft = useThreadStore(state => threadId ? state.drafts[threadId] ?? '' : '')
  const attachments = useThreadStore(state => threadId ? state.attachments[threadId] ?? NO_ATTACHMENTS : NO_ATTACHMENTS)
  const previewElements = useThreadStore(state => threadId ? state.previewElements[threadId] ?? NO_PREVIEW_ELEMENTS : NO_PREVIEW_ELEMENTS)
  const [caret, setCaret] = useState(0)
  const commands = useThreadCommands({ snapshot, draft, textarea, pending, run: onRunAction, onNewThread, onAccounts, onRunCommand, onError })
  useImperativeHandle(commandsRef, () => ({
    isOpen: () => commands.open,
    show: commands.show,
    executeLocal: commands.executeLocal
  }))
  const mentions = useFileMentions({
    workspaceId: snapshot?.thread.workspaceId,
    rootPath: snapshot?.thread.rootPath,
    draft,
    caret,
    enabled: Boolean(snapshot) && !pending,
    onApply: (text, position) => {
      if (!snapshot) return
      useThreadStore.getState().setDraft(snapshot.thread.id, text)
      requestAnimationFrame(() => { textarea.current?.focus(); textarea.current?.setSelectionRange(position, position); setCaret(position) })
    }
  })
  const insertMention = (): void => {
    if (!snapshot) return
    const field = textarea.current
    const currentDraft = useThreadStore.getState().drafts[snapshot.thread.id] ?? ''
    const position = field?.selectionStart ?? currentDraft.length
    const needsSpace = position > 0 && !/\s/.test(currentDraft[position - 1] ?? '')
    const text = currentDraft.slice(0, position) + (needsSpace ? ' @' : '@') + currentDraft.slice(position)
    const next = position + (needsSpace ? 2 : 1)
    useThreadStore.getState().setDraft(snapshot.thread.id, text)
    requestAnimationFrame(() => { field?.focus(); field?.setSelectionRange(next, next); setCaret(next) })
  }
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
  // OXE-338: one Escape while the agent works only arms the stop and says so; a second one within the window stops it.
  const [stopArmed, setStopArmed] = useState(false)
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => { const timer = stopTimer; return () => { if (timer.current) clearTimeout(timer.current) } }, [])
  const disarmStop = () => { if (stopTimer.current) clearTimeout(stopTimer.current); stopTimer.current = null; setStopArmed(false) }
  const escapeToStop = () => {
    if (stopArmed) { disarmStop(); onInterrupt(); return }
    setStopArmed(true)
    if (stopTimer.current) clearTimeout(stopTimer.current)
    stopTimer.current = setTimeout(() => { stopTimer.current = null; setStopArmed(false) }, STOP_ESCAPE_WINDOW_MS)
  }
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
    {attachments.length > 0 && <div className="thread-attachments" aria-label={t('composer.attachments')}>{attachments.map(attachment => <div key={attachment.id}><span>{attachment.name}</span><small>{t('message.kilobytes', { size: formatNumber(Math.ceil(attachment.bytes / 1024)) })}</small><IconButton size="sm" label={t('composer.remove', { name: attachment.name })} title={t('composer.remove', { name: attachment.name })} disabled={pending} icon={<X size={12} aria-hidden="true" />} onClick={() => onRemoveAttachment(attachment.id)} /></div>)}</div>}
    <input ref={fileInput} type="file" hidden multiple accept="image/png,image/jpeg,image/webp,image/gif" onChange={event => { onUpload(Array.from(event.target.files ?? [])); event.target.value = '' }} />
    <textarea ref={textarea} data-thread-composer="true" data-dialog-return aria-label={active ? t('composer.message') : t('composer.messageIn', { title: snapshot ? displayThreadTitle(snapshot.thread.title) : t('composer.conversation') })} {...commands.inputProps} placeholder={placeholder} value={draft} disabled={blocked}
      onChange={e => { setCaret(e.target.selectionStart); commands.onChange(e.target.value, e.target.selectionStart) }} onSelect={e => { setCaret(e.currentTarget.selectionStart); commands.onSelect(e.currentTarget.selectionStart) }} onFocus={commands.onFocus} onBlur={commands.onBlur}
      onPaste={event => { const files = [...event.clipboardData.files].filter(file => file.type.startsWith('image/')); if (files.length) { event.preventDefault(); onUpload(files) } }}
      onKeyDown={e => { if (mentions.onKeyDown(e)) return; if (commands.onKeyDown(e)) return; if (isSendKey(sendKeyEvent(e), sendKey)) { e.preventDefault(); if (!tooLong) onSend() } else if (e.key === 'Escape' && running) { e.preventDefault(); e.stopPropagation(); escapeToStop() } }} />
    <footer data-ui="composer-toolbar" data-width={narrow ? 'narrow' : 'full'}>
      {!compactChips && <div className="thread-mode-toggle" data-ui="mode-switch" role="group" aria-label={t('config.mode')} title={t('config.modeTitle')}>
        <Button variant="ghost" size="sm" data-ui="segment" aria-pressed={!planning} disabled={!snapshot || modeSaving} onClick={() => void setMode(false)}>{t('config.agent')}</Button>
        <Button variant="ghost" size="sm" data-ui="segment" data-mode="plan" aria-pressed={planning} disabled={!snapshot || modeSaving} onClick={() => void setMode(true)}>{t('config.plan')}</Button>
      </div>}
      <Menu label={t('composer.context')} side="top" items={[
        { label: t('composer.mention'), icon: <AtSign size={14} />, onSelect: insertMention },
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
    {running && stopArmed && <p className="thread-stop-hint" role="status">{t('composer.stopAgain')}</p>}
    {tooLong && <ErrorState compact title={t('composer.tooLong', { length: formatNumber(draft.length), limit: formatNumber(THREAD_MESSAGE_MAX_CHARS) })} />}
  </form>
}
