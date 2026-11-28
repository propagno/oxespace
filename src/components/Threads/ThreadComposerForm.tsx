import { lazy, Suspense, useEffect, useImperativeHandle, useRef, useState, type ReactNode, type RefObject } from 'react'
import { ArrowUp, AtSign, ChevronDown, CornerDownLeft, Database, Folder, GitCompareArrows, MessageSquarePlus, MessageSquareText, Paperclip, Plug, Plus, Slash, Square, TerminalSquare, Wrench, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { PreviewElementRef } from '../../../shared/types/design-mode'
import {
  composerContentLength,
  createChangesContextItem,
  createPastedTextItem,
  createTerminalContextItem,
  type ComposerContextItem
} from '../../../shared/types/composer-context'
import type { McpResourceAttachment } from '../../../shared/types/mcp'
import type { ThreadAttachment, ThreadSnapshot } from '../../../shared/types/thread'
import type { McpPickerTab } from '../MCP/McpToolPickerPopover'

const LazyMcpToolPickerPopover = lazy(() => import('../MCP/McpToolPickerPopover').then(m => ({ default: m.McpToolPickerPopover })))
const LazyMcpResourceChips = lazy(() => import('../MCP/McpResourceChips').then(m => ({ default: m.McpResourceChips })))
import { useThreadStore } from '../../store/thread.store'
import { useMcpPickerStore } from '../../store/mcp-picker.store'
import { useUIStore } from '../../store/ui.store'
import { Button, ErrorState, IconButton, Menu, type MenuEntry } from '../../ui'
import { humanizeError } from '../../utils/humanizeError'
import { ComposerChips } from './ComposerChips'
import { ComposerContextChips } from './ComposerContextChips'
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
import { altSendKeyLabel, isAltSendKey, isSendKey, sendKeyEvent, sendKeyLabel } from './sendKey'
import { useThreadCommands } from './useThreadCommands'

const CONTEXT_SOURCE_HINT = {
  changes: '@changes',
  terminal: '@terminal',
  folder: '@folder',
  thread: '@thread'
} as const
import { resolveActiveTerminalPaneId, useFileMentions } from './useFileMentions'
import { extractDroppedPayload, hasDroppablePayload } from './composerDrop'
import { threadWorkingRoot } from './threadChanges'

/** How long a first Escape keeps the stop armed for the second one (OXE-338). */
const STOP_ESCAPE_WINDOW_MS = 2000

// Stable empty references so Zustand selectors never return a fresh array on every read.
const NO_ATTACHMENTS: ThreadAttachment[] = []
const NO_PREVIEW_ELEMENTS: PreviewElementRef[] = []
const NO_CONTEXT_ITEMS: ComposerContextItem[] = []
const NO_MCP_RESOURCES: McpResourceAttachment[] = []

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

/** The message box: text, attachments, context chips, commands, mentions, configuration and send/steer/stop. */
export function ThreadComposerForm({ snapshot, pending, running, active, composerState, textarea, fileInput, commandsRef, openControl, compactChips, workingSet, onControlClosed, onError, onSend, onUpload, onRemoveAttachment, onRemovePreviewElement, onInterrupt, onRunAction, onRunCommand, onSideChat, onAskInSideChat, onNewThread, onAccounts }: {
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
  onSideChat?: (question?: string) => void
  onAskInSideChat?: (question?: string) => void
  onNewThread?: () => void
  onAccounts?: () => void
}) {
  const { t } = useTranslation('thread')
  const sendKey = useThreadPrefs(state => state.sendKey)
  const activeTurnSendAction = useThreadPrefs(state => state.activeTurnSendAction)
  const pasteThreshold = useThreadPrefs(state => state.pasteAsAttachmentThreshold)
  const threadId = snapshot?.thread.id
  const workingRoot = snapshot ? threadWorkingRoot(snapshot.thread) : undefined
  // Subscribing inside the composer isolates every keystroke, caret move, attachment and preview chip
  // from ThreadView so typing never re-renders the message timeline or header (OXE-348).
  const draft = useThreadStore(state => threadId ? state.drafts[threadId] ?? '' : '')
  const attachments = useThreadStore(state => threadId ? state.attachments[threadId] ?? NO_ATTACHMENTS : NO_ATTACHMENTS)
  const previewElements = useThreadStore(state => threadId ? state.previewElements[threadId] ?? NO_PREVIEW_ELEMENTS : NO_PREVIEW_ELEMENTS)
  const contextItems = useThreadStore(state => threadId ? state.contextItems[threadId] ?? NO_CONTEXT_ITEMS : NO_CONTEXT_ITEMS)
  const mcpResources = useMcpPickerStore(state => threadId ? state.mcpResourcesByThread[threadId] ?? NO_MCP_RESOURCES : NO_MCP_RESOURCES)
  const [mcpPickerTab, setMcpPickerTab] = useState<McpPickerTab | null>(null)
  const [caret, setCaret] = useState(0)
  const [dropActive, setDropActive] = useState(false)
  const commands = useThreadCommands({ snapshot, draft, textarea, pending, run: onRunAction, onNewThread, onAccounts, onRunCommand, onSideChat, onError })
  useImperativeHandle(commandsRef, () => ({
    isOpen: () => commands.open,
    show: commands.show,
    executeLocal: commands.executeLocal
  }))

  const attachContext = (item: ComposerContextItem): void => {
    if (!snapshot) return
    useThreadStore.getState().addContextItem(snapshot.thread.id, item)
  }

  const removeContext = (itemId: string): void => {
    if (!snapshot) return
    useThreadStore.getState().removeContextItem(snapshot.thread.id, itemId)
  }

  const inlinePastedItem = (item: Extract<ComposerContextItem, { kind: 'pasted-text' }>): void => {
    if (!snapshot) return
    const current = useThreadStore.getState().drafts[snapshot.thread.id] ?? ''
    const next = current ? `${current}\n${item.content}` : item.content
    useThreadStore.getState().setDraft(snapshot.thread.id, next)
    useThreadStore.getState().removeContextItem(snapshot.thread.id, item.id)
    requestAnimationFrame(() => {
      textarea.current?.focus()
      textarea.current?.setSelectionRange(next.length, next.length)
      setCaret(next.length)
    })
  }

  const insertToken = (token: string): void => {
    if (!snapshot) return
    const field = textarea.current
    const currentDraft = useThreadStore.getState().drafts[snapshot.thread.id] ?? ''
    const position = field?.selectionStart ?? currentDraft.length
    const needsSpace = position > 0 && !/\s/.test(currentDraft[position - 1] ?? '')
    const inserted = (needsSpace ? ' ' : '') + token
    const text = currentDraft.slice(0, position) + inserted + currentDraft.slice(position)
    const next = position + inserted.length
    useThreadStore.getState().setDraft(snapshot.thread.id, text)
    requestAnimationFrame(() => { field?.focus(); field?.setSelectionRange(next, next); setCaret(next) })
  }

  const mentions = useFileMentions({
    workspaceId: snapshot?.thread.workspaceId,
    rootPath: workingRoot,
    threadId,
    projectId: snapshot?.thread.projectId,
    draft,
    caret,
    enabled: Boolean(snapshot) && !pending,
    onApply: (text, position) => {
      if (!snapshot) return
      useThreadStore.getState().setDraft(snapshot.thread.id, text)
      requestAnimationFrame(() => { textarea.current?.focus(); textarea.current?.setSelectionRange(position, position); setCaret(position) })
    },
    onAttachContext: attachContext
  })
  const insertMention = (): void => insertToken('@')

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
  const totalLength = composerContentLength(draft, contextItems)
  const tooLong = totalLength > THREAD_MESSAGE_MAX_CHARS
  const hasContent = Boolean(draft.trim() || attachments.length || previewElements.length || contextItems.length || mcpResources.length)
  const canSteer = Boolean(snapshot?.thread.capabilities?.features.steering?.enabled)
  const steerSupported = snapshot?.thread.capabilities?.features?.steering?.enabled !== false
  const primaryActiveAction: 'queue' | 'steer' = activeTurnSendAction === 'steer' && steerSupported ? 'steer' : 'queue'
  const oppositeActiveAction: 'queue' | 'steer' = primaryActiveAction === 'steer' ? 'queue' : (steerSupported ? 'steer' : 'queue')
  const hints = composerHints({
    status: deriveComposerHintStatus(snapshot?.thread, running, (snapshot?.pendingRequests?.length ?? 0) > 0),
    canSteer
  })
  const showSteer = (hints.steer && steerSupported) || (running && steerSupported && Boolean(draft.trim() || attachments.length || contextItems.length))
  const handleAskInSideChat = (): void => {
    if (!snapshot || !onAskInSideChat) return
    const currentDraft = (useThreadStore.getState().drafts[snapshot.thread.id] ?? '').trim()
    const selected = typeof window !== 'undefined' ? (window.getSelection?.()?.toString() ?? '').trim() : ''
    const question = currentDraft || selected
    if (currentDraft) useThreadStore.getState().setDraft(snapshot.thread.id, '')
    onAskInSideChat(question || undefined)
  }
  const activeSendMenuItems: MenuEntry[] = running
    ? [
        primaryActiveAction === 'steer'
          ? { label: t('composer.steer'), icon: <CornerDownLeft size={14} />, shortcut: sendKeyLabel(sendKey), disabled: blocked || tooLong || !hasContent, onSelect: () => { if (!tooLong) onSend('steer') } }
          : { label: t('composer.queue'), icon: <ArrowUp size={14} />, shortcut: sendKeyLabel(sendKey), disabled: blocked || tooLong || !hasContent, onSelect: () => { if (!tooLong) onSend('queue') } },
        ...(steerSupported
          ? [
              oppositeActiveAction === 'steer'
                ? { label: t('composer.steer'), icon: <CornerDownLeft size={14} />, shortcut: altSendKeyLabel(), disabled: blocked || tooLong || !hasContent, onSelect: () => { if (!tooLong) onSend('steer') } }
                : { label: t('composer.queue'), icon: <ArrowUp size={14} />, shortcut: altSendKeyLabel(), disabled: blocked || tooLong || !hasContent, onSelect: () => { if (!tooLong) onSend('queue') } }
            ]
          : []),
        { type: 'separator' },
        { label: t('composer.askInSideChat'), hint: t('composer.askInSideChatHint'), icon: <MessageSquarePlus size={14} />, disabled: blocked || !onAskInSideChat, onSelect: handleAskInSideChat }
      ]
    : []
  const primarySubmitLabel = running
    ? (primaryActiveAction === 'steer' ? t('composer.steer') : t('composer.queue'))
    : t('composer.send')
  const primarySubmitTitle = running
    ? (primaryActiveAction === 'steer'
      ? t('composer.steerActiveTitle', { key: sendKeyLabel(sendKey) })
      : t('composer.queueTitle', { key: sendKeyLabel(sendKey) }))
    : t('composer.sendTitle', { key: sendKeyLabel(sendKey) })
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

  const handleDragEnter = (event: React.DragEvent<HTMLFormElement>): void => {
    if (blocked || !hasDroppablePayload(event.dataTransfer)) return
    event.preventDefault()
    setDropActive(true)
  }

  const handleDragOver = (event: React.DragEvent<HTMLFormElement>): void => {
    if (blocked || !hasDroppablePayload(event.dataTransfer)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    if (!dropActive) setDropActive(true)
  }

  const handleDragLeave = (event: React.DragEvent<HTMLFormElement>): void => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setDropActive(false)
    }
  }

  const handleDrop = (event: React.DragEvent<HTMLFormElement>): void => {
    setDropActive(false)
    if (blocked || !snapshot) return
    const { images, contextItems: dropped } = extractDroppedPayload(
      event.dataTransfer,
      workingRoot,
      window.oxe?.app?.getPathForFile
    )
    if (!images.length && !dropped.length) return
    event.preventDefault()
    if (images.length) onUpload(images)
    for (const item of dropped) attachContext(item)
  }

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    const files = [...(event.clipboardData?.files ?? [])].filter(file => file.type.startsWith('image/'))
    if (files.length) {
      event.preventDefault()
      onUpload(files)
      return
    }
    if (!snapshot || pasteThreshold <= 0) return
    const pastedText = event.clipboardData?.getData('text/plain') ?? ''
    if (pastedText.length > pasteThreshold) {
      event.preventDefault()
      attachContext(createPastedTextItem(pastedText))
    }
  }

  return <form ref={formRef} className="thread-composer" data-ui="composer" data-state={composerState} data-drop-active={dropActive ? 'true' : undefined} aria-busy={pending}
    onSubmit={e => { e.preventDefault(); if (!tooLong) onSend(running ? primaryActiveAction : 'queue') }}
    onDragEnter={handleDragEnter}
    onDragOver={handleDragOver}
    onDragLeave={handleDragLeave}
    onDrop={handleDrop}>
    {commands.popup}
    {mentions.popup}
    {workingSet}
    {previewElements.length > 0 && onRemovePreviewElement && <PreviewElementChips elements={previewElements} disabled={pending} onRemove={onRemovePreviewElement} />}
    {contextItems.length > 0 && <ComposerContextChips items={contextItems} disabled={pending} onRemove={removeContext} onInlinePaste={inlinePastedItem} />}
    {mcpResources.length > 0 && threadId && <Suspense fallback={null}><LazyMcpResourceChips resources={mcpResources} disabled={pending} onRemove={resourceId => useMcpPickerStore.getState().removeMcpResource(threadId, resourceId)} /></Suspense>}
    {attachments.length > 0 && <div className="thread-attachments" aria-label={t('composer.attachments')}>{attachments.map(attachment => <div key={attachment.id}><span>{attachment.name}</span><small>{t('message.kilobytes', { size: formatNumber(Math.ceil(attachment.bytes / 1024)) })}</small><IconButton size="sm" label={t('composer.remove', { name: attachment.name })} title={t('composer.remove', { name: attachment.name })} disabled={pending} icon={<X size={12} aria-hidden="true" />} onClick={() => onRemoveAttachment(attachment.id)} /></div>)}</div>}
    <input ref={fileInput} type="file" hidden multiple accept="image/png,image/jpeg,image/webp,image/gif" onChange={event => { onUpload(Array.from(event.target.files ?? [])); event.target.value = '' }} />
    <textarea ref={textarea} data-thread-composer="true" data-dialog-return aria-label={active ? t('composer.message') : t('composer.messageIn', { title: snapshot ? displayThreadTitle(snapshot.thread.title) : t('composer.conversation') })} {...commands.inputProps} placeholder={placeholder} value={draft} disabled={blocked}
      onChange={e => { setCaret(e.target.selectionStart); commands.onChange(e.target.value, e.target.selectionStart) }} onSelect={e => { setCaret(e.currentTarget.selectionStart); commands.onSelect(e.currentTarget.selectionStart) }} onFocus={commands.onFocus} onBlur={commands.onBlur}
      onPaste={handlePaste}
      onKeyDown={e => {
        if (mentions.onKeyDown(e)) return
        if (commands.onKeyDown(e)) return
        const keyEvent = sendKeyEvent(e)
        if (running && isAltSendKey(keyEvent)) {
          e.preventDefault()
          if (!tooLong) onSend(oppositeActiveAction)
        } else if (isSendKey(keyEvent, sendKey)) {
          e.preventDefault()
          if (!tooLong) onSend(running ? primaryActiveAction : 'queue')
        } else if (e.key === 'Escape' && running) {
          e.preventDefault()
          e.stopPropagation()
          escapeToStop()
        }
      }} />
    <footer data-ui="composer-toolbar" data-width={narrow ? 'narrow' : 'full'}>
      {!compactChips && <div className="thread-mode-toggle" data-ui="mode-switch" role="group" aria-label={t('config.mode')} title={t('config.modeTitle')}>
        <Button variant="ghost" size="sm" data-ui="segment" aria-pressed={!planning} disabled={!snapshot || modeSaving} onClick={() => void setMode(false)}>{t('config.agent')}</Button>
        <Button variant="ghost" size="sm" data-ui="segment" data-mode="plan" aria-pressed={planning} disabled={!snapshot || modeSaving} onClick={() => void setMode(true)}>{t('config.plan')}</Button>
      </div>}
      <Menu label={t('composer.context')} side="top" items={[
        { label: t('composer.mention'), icon: <AtSign size={14} />, onSelect: insertMention },
        { label: t('composer.attach'), icon: <Paperclip size={14} />, disabled: attachments.length >= 8 || !api?.attach, onSelect: () => fileInput.current?.click() },
        { type: 'separator' },
        { label: t('composer.contextSources.changes'), hint: CONTEXT_SOURCE_HINT.changes, icon: <GitCompareArrows size={14} />, onSelect: () => attachContext(createChangesContextItem()) },
        { label: t('composer.contextSources.terminal'), hint: CONTEXT_SOURCE_HINT.terminal, icon: <TerminalSquare size={14} />, onSelect: () => attachContext(createTerminalContextItem(resolveActiveTerminalPaneId(threadId))) },
        { label: t('composer.contextSources.folder'), hint: CONTEXT_SOURCE_HINT.folder, icon: <Folder size={14} />, onSelect: () => insertToken('@folder:') },
        { label: t('composer.contextSources.thread'), hint: CONTEXT_SOURCE_HINT.thread, icon: <MessageSquareText size={14} />, onSelect: () => insertToken('@thread:') },
        { type: 'separator' },
        { label: t('composer.commands'), icon: <Slash size={14} />, shortcut: 'Ctrl+/', disabled: blocked, onSelect: commands.show },
        { label: t('mcpPicker.menuTools'), icon: <Wrench size={14} />, disabled: !snapshot, onSelect: () => setMcpPickerTab('tools') },
        { label: t('mcpPicker.menuResources'), icon: <Database size={14} />, disabled: !snapshot, onSelect: () => setMcpPickerTab('resources') },
        { label: t('moreActions.mcp'), icon: <Plug size={14} />, onSelect: () => useUIStore.getState().openMcpPanel() }
      ]} trigger={<Button type="button" variant="ghost" size="sm" className="thread-context-trigger" aria-label={t('composer.context')} title={t('composer.addTitle')} disabled={!snapshot || pending} icon={<Plus size={14} aria-hidden="true" />}><span className="thread-context-label">{t('composer.context')}</span></Button>} />
      {snapshot && mcpPickerTab !== null && <Suspense fallback={null}><LazyMcpToolPickerPopover workspaceId={snapshot.thread.workspaceId} threadId={snapshot.thread.id} snapshot={snapshot} open initialTab={mcpPickerTab} onOpenChange={open => { if (!open) setMcpPickerTab(null) }} onError={onError} trigger={<span aria-hidden="true" />} /></Suspense>}
      <div className="thread-composer-right">
        {compactChips
          ? <ComposerChips {...compactChips} />
          : snapshot && <ThreadConfigurationBar key={snapshot.thread.id} thread={snapshot.thread} narrow={narrow} compact={compactModel} openControl={openControl} onControlClosed={onControlClosed} onError={onError} onConfigured={value => useThreadStore.getState().updateSnapshot(value)} />}
        {!narrow && snapshot && <ThreadUsageRing provider={snapshot.thread.provider} idle={!running} threadId={snapshot.thread.id} context={snapshot.thread.contextReport} />}
        {showSteer && (
          <IconButton
            size="sm"
            variant="ghost"
            className="thread-command-trigger"
            label={oppositeActiveAction === 'steer' ? t('composer.steer') : t('composer.queue')}
            title={oppositeActiveAction === 'steer' ? t('composer.steerAltTitle', { key: altSendKeyLabel() }) : t('composer.queueTitle', { key: altSendKeyLabel() })}
            disabled={pending || !hasContent}
            onClick={() => onSend(oppositeActiveAction)}
            icon={oppositeActiveAction === 'steer' ? <CornerDownLeft size={14} /> : <ArrowUp size={14} />}
          />
        )}
        {running && (
          <Menu
            label={t('composer.sendOptions')}
            align="end"
            side="top"
            items={activeSendMenuItems}
            trigger={
              <IconButton
                type="button"
                size="sm"
                variant="ghost"
                className="thread-send-menu-trigger"
                label={t('composer.sendOptions')}
                title={t('composer.sendOptions')}
                disabled={blocked}
                icon={<ChevronDown size={13} aria-hidden="true" />}
                data-testid="composer-send-options"
              />
            }
          />
        )}
        {/* T57: a labelled button in the danger color, never a second accent circle next to Send. */}
        {running && <Button size="sm" variant="danger" className="thread-stop" aria-label={t('composer.stop')} title={t('composer.stopTitle')} onClick={onInterrupt} icon={<Square size={12} fill="currentColor" aria-hidden="true" />}>{t('composer.stopShort')}</Button>}
        <IconButton type="submit" size="sm" variant="primary" className="thread-send oxe-press" label={primarySubmitLabel} title={primarySubmitTitle} disabled={blocked || tooLong || !hasContent} icon={running && primaryActiveAction === 'steer' ? <CornerDownLeft size={15} /> : <ArrowUp size={16} />} />
      </div>
    </footer>
    {running && stopArmed && <p className="thread-stop-hint" role="status">{t('composer.stopAgain')}</p>}
    {tooLong && <ErrorState compact title={t('composer.tooLong', { length: formatNumber(totalLength), limit: formatNumber(THREAD_MESSAGE_MAX_CHARS) })} />}
  </form>
}
