import { FitAddon } from '@xterm/addon-fit'
import { TERMINAL_SELECT_ALL_EVENT } from '../Navigation/editTarget'
import { useColorMode, useColorScheme, useSurfaceStyle } from '../../design/useColorMode'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { createTerminalLinksAddon } from './terminalLinks'
import { attachTerminalPaths } from './terminalPaths'
import { attachTerminalContextMenu } from './terminalContextMenu'
import { sendTerminalSelectionToChat } from './terminalToChat'
import { fitTerminalGrid, useHeldGrid, type HeldGrid } from './heldGrid'
import { createPtyResizeDebouncer, isValidPtyGrid, syncNotifiedGrid } from './resizeDebounce'
import { createResizeRedrawGuard } from './resizeRedrawGuard'
import { createTerminalWebglController, type WarmWebglPool } from './webglPool'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { ArrowDown, ArrowUp, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { WorkspaceThemeId } from '../../../shared/types/workspace'
import type { TerminalAttachResult, TerminalApi } from '../../../shared/types/ipc'
import { terminalLevers } from '../../../shared/terminal-levers'
import type { TerminalPrefs } from '../../store/terminal-prefs.store'
import { useTerminalStore } from '../../store/terminal.store'
import { wheelToTuiScrollKeys } from '../../utils/terminalWheel'
import { personActedElsewhereSince, runWithTerminalAutoFocus, terminalKeyRoute, watchPersonInput } from '../../keyboard/terminalFocus'
import { TabFocusBadge } from './TabFocusBadge'
import { createTerminalWriteScheduler } from './terminalWriteScheduler'
import { createRevealScheduler, isTerminalHostHidden, observeTerminalVisibility } from './terminalVisibility'
import { buildTerminalTheme, decodeOsc52ClipboardWrite, resolveInactiveCursorStyle, searchDecorations } from './terminalViewHelpers'
import { resolveWindowsPty } from '../../../shared/windows-pty'
import { UI_SCALE_EVENT } from '../../../shared/uiScale'

// Claude Code uses ⏺ (U+23FA) on Mac and ● (U+25CF) on Windows
const AGENT_MARKERS = ['⏺', '●']

// readAgentPreview only needs the most recent agent line. Cap how far back it
// scans so it stays O(1) regardless of scrollback depth — without this it walks
// the entire buffer (up to 100k lines) on every output burst when no marker is
// found, janking the renderer and making selection/copy unreliable over time.
const AGENT_PREVIEW_SCAN_LINES = 300

// How long a just-cleared selection is still considered copyable. xterm wipes
// the selection when the scrollback trims, the buffer toggles (TUI alt-screen),
// or the user types — so a selection can vanish in the moment between the user
// selecting text and pressing Ctrl/Cmd+C. We remember the last non-empty
// selection briefly so the copy still lands instead of silently turning into a
// SIGINT. Reset whenever the user actually types into the PTY.
const RECENT_SELECTION_MS = 2000

function readAgentPreview(terminal: Terminal): string {
  const buf = terminal.buffer.active
  const top = buf.baseY + buf.cursorY
  const stop = Math.max(0, top - AGENT_PREVIEW_SCAN_LINES)
  for (let y = top; y >= stop; y--) {
    const line = buf.getLine(y)
    if (!line) continue
    let text = ''
    for (let x = 0; x < line.length; x++) {
      text += line.getCell(x)?.getChars() ?? ' '
    }
    text = text.trimEnd()
    const trimmed = text.trimStart()
    if (!trimmed) continue
    const marker = AGENT_MARKERS.find(m => trimmed.startsWith(m))
    if (!marker) continue
    const content = trimmed.slice(marker.length).trim()
    if (content) return content
  }
  return ''
}

interface TerminalViewProps {
  /** Thread's native CLI uses its own transport and never subscribes to Code panes. */
  transport?: Pick<TerminalApi, 'onData' | 'onExit' | 'attach' | 'detach'>
  paneId: string
  workspaceId?: string
  isRunning: boolean
  onInput: (data: string) => void
  onResize: (cols: number, rows: number) => void
  /** 1.5.0 · A phone holds this pane's size: the view takes that grid; `onResize` keeps reporting the pane's own. */
  fixedSize?: HeldGrid | null
  onExit?: (exitCode: number | null) => void
  /** Workspace theme — re-applies terminal colors live when it changes. */
  themeId: WorkspaceThemeId
  /** Resolved terminal prefs (global ← per-workspace override). */
  prefs: TerminalPrefs
  /** OXE-451 · Optional warm WebGL2 LRU pool; keeps hidden panes warm until LRU/idle eviction. */
  warmPool?: WarmWebglPool
}

export function TerminalView({ isRunning, onExit, onInput, onResize, fixedSize = null, paneId, workspaceId, themeId, prefs, transport, warmPool }: TerminalViewProps): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const pasteRef = useRef<((text: string) => void) | null>(null)
  const refitRef = useRef<(() => void) | null>(null)
  // Last non-empty selection + when it was seen, so a copy can still fire if
  // xterm cleared the live selection (scrollback trim / buffer toggle) just
  // before the keypress. See RECENT_SELECTION_MS.
  const lastSelectionRef = useRef<{ text: string; at: number } | null>(null)
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs
  const onExitRef = useRef(onExit)
  const onInputRef = useRef(onInput)
  const onResizeRef = useRef(onResize)
  const fitFrameRef = useRef<number | null>(null)
  const settleFitTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([])
  const [isDragOver, setIsDragOver] = useState(false)
  // Ctrl+F search overlay (powered by @xterm/addon-search).
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<{ resultIndex: number; resultCount: number } | null>(null)

  onExitRef.current = onExit
  onInputRef.current = onInput
  onResizeRef.current = onResize
  const fixedSizeRef = useHeldGrid(fixedSize, hostRef, refitRef)

  useEffect(() => {
    if (!hostRef.current) return

    const initial = prefsRef.current
    const initialTranslucent = initial.backgroundOpacity < 1
    const windowsPty = resolveWindowsPty(window.oxe?.app)
    const terminal = new Terminal({
      allowProposedApi: true,
      allowTransparency: initialTranslucent,
      cursorBlink: initial.cursorBlink,
      cursorStyle: initial.cursorStyle,
      cursorInactiveStyle: resolveInactiveCursorStyle(initial.cursorStyle),
      fontFamily: initial.fontFamily,
      fontSize: initial.fontSize,
      lineHeight: initial.lineHeight,
      letterSpacing: initial.letterSpacing,
      minimumContrastRatio: 4.5,
      rescaleOverlappingGlyphs: true,
      scrollback: initial.scrollback,
      scrollOnUserInput: false,
      theme: buildTerminalTheme(initialTranslucent),
      ...(windowsPty ? { windowsPty } : {})
    })
    const fitAddon = new FitAddon()
    const unicodeAddon = new Unicode11Addon()
    const searchAddon = new SearchAddon()

    terminal.loadAddon(fitAddon)
    terminal.loadAddon(unicodeAddon)
    terminal.loadAddon(createTerminalLinksAddon())
    const pathLinksDisposable = attachTerminalPaths(terminal, hostRef.current, workspaceId) // F33: project paths
    const contextMenuDisposable = attachTerminalContextMenu(hostRef.current, terminal, {
      onSendToChat: (selection) => {
        void sendTerminalSelectionToChat({ selection, workspaceId, paneId })
      }
    }) // CODE-8 + AG-08 (OXE-190): Copy, Paste, Select all, Clear, optional Send selection to OxeChat
    terminal.loadAddon(searchAddon)
    searchAddonRef.current = searchAddon
    const searchResultsDisposable = searchAddon.onDidChangeResults((results) => setSearchResults(results))
    terminal.open(hostRef.current)
    const isHidden = (): boolean => isTerminalHostHidden(hostRef.current)
    let previewTimer: ReturnType<typeof setTimeout> | null = null
    let disposed = false
    const levers = terminalLevers(window.oxe?.app?.termLevers)
    const writeToTerminal = (
      chunk: string,
      done: () => void,
      meta: { truncated: boolean },
      followBottom = false
    ): void => {
      if (disposed) {
        done()
        return
      }
      // Smart scrollback (normal buffer only): when scrolled up or selecting text,
      // pin viewportY so streaming output never yanks rows out from under the user.
      const preBuf = terminal.buffer.active
      const isAltScreen = preBuf.type === 'alternate'
      const preViewportY = preBuf.viewportY
      const recentSelection = lastSelectionRef.current
      const hasActiveOrRecentSelection =
        !!terminal.getSelection() ||
        (recentSelection !== null && Date.now() - recentSelection.at <= RECENT_SELECTION_MS)
      const wasAtBottom =
        isAltScreen ||
        (!hasActiveOrRecentSelection && preViewportY >= preBuf.baseY)
      const payload = meta.truncated ? `\x1b[2J\x1b[H\x1b[?2026l${chunk}` : chunk
      terminal.write(payload, () => {
        if (!disposed && terminal.buffer.active.type === 'normal') {
          if (!wasAtBottom) {
            const postBuf = terminal.buffer.active
            terminal.scrollToLine(Math.min(preViewportY, postBuf.baseY))
          } else if (followBottom) {
            terminal.scrollToBottom()
          }
        }
        done()
      })
      if (transport) return
      useTerminalStore.getState().updateActivity(paneId, chunk)
      if (previewTimer) clearTimeout(previewTimer)
      previewTimer = setTimeout(() => {
        previewTimer = null
        const preview = readAgentPreview(terminal)
        if (preview) useTerminalStore.getState().updatePreview(paneId, preview)
      }, 300)
    }
    const writeScheduler = createTerminalWriteScheduler({
      paused: isHidden(),
      queue: levers.has('Q'),
      activeMaxBufferedBytes: 2 * 1024 * 1024,
      write: (chunk, done, meta) => writeToTerminal(chunk, done, meta)
    })
    const resizeRedrawGuard = createResizeRedrawGuard({
      onFlush: (atomicPayload, meta) => {
        if (disposed) return
        if (writeScheduler.isPaused()) {
          writeScheduler.enqueue(atomicPayload)
          return
        }
        const pre = writeScheduler.takePending()
        if (pre.data) terminal.write(pre.truncated ? `\x1b[2J\x1b[H\x1b[?2026l${pre.data}` : pre.data)
        writeToTerminal(atomicPayload, () => undefined, { truncated: meta.truncated }, true)
      }
    })
    // Unicode 11 width tables live behind xterm's "proposed API" gate. In some
    // Vite-bundled dev builds the proposed-API check throws even with
    // allowProposedApi: true (xterm exports get duplicated across module
    // resolutions, breaking the option lookup on Terminal.unicode). The error
    // cascades through React's error boundary, unmounts the pane, and the PTY
    // never gets the input it needed — so the agent CLI exits with code 1.
    // Falling back to the default width tables keeps the terminal usable.
    try {
      terminal.unicode.activeVersion = '11'
    } catch (err) {
      console.warn('[OXESpace] Unicode 11 activation failed, using default widths', err)
    }
    // 'Idle' is NOT written here any more. This view may be re-mounting onto a
    // session that has been running all along (a workspace coming back from the
    // MRU), and stamping "Idle" above its restored output would be a lie. The
    // attach handshake below decides what the first line should be.

    const dataDisposable = terminal.onData((data) => {
      resizeRedrawGuard.preemptOnInput()
      // The user typed into the PTY — any earlier selection is no longer a copy
      // candidate, so a later Ctrl+C correctly falls through to SIGINT.
      lastSelectionRef.current = null
      // A command entered while reading old scrollback must reveal its result.
      // xterm's automatic user-input scrolling is disabled for TUI selection.
      if (terminal.buffer.active.type === 'normal') terminal.scrollToBottom()
      onInputRef.current(data)
    })
    // Remember the last non-empty selection. onSelectionChange also fires with
    // an empty selection when xterm clears it (trim / buffer toggle); we keep
    // the previous value so a copy issued right after still has something.
    const selectionDisposable = terminal.onSelectionChange(() => {
      const sel = terminal.getSelection()
      if (sel) lastSelectionRef.current = { text: sel, at: Date.now() }
    })
    terminalRef.current = terminal

    const copyText = async (text: string): Promise<void> => {
      if (!text) return
      // Write via main (Electron clipboard, no renderer permission) first; fall
      // back to the web API. Keeps copy working even if clipboard-write is denied.
      const ok = await window.oxe.clipboard.writeText(text).catch(() => false)
      if (!ok) await navigator.clipboard.writeText(text).catch(() => undefined)
    }

    // TUIs such as Claude/GSD own selection while mouse tracking is enabled and
    // copy through OSC 52 instead of a DOM copy event. xterm deliberately leaves
    // OSC 52 to the host, so bridge write requests to Electron's clipboard.
    // Clipboard read queries (`c;?`) are consumed but never answered.
    const osc52Disposable = terminal.parser.registerOscHandler(52, async (data) => {
      const text = decodeOsc52ClipboardWrite(data)
      if (text) await copyText(text)
      return true
    })

    const pasteText = (text: string): void => {
      const CHUNK = 4096
      if (text.length <= CHUNK) {
        terminal.paste(text)
        return
      }
      // terminal.paste() wraps EVERY call in the shell's bracketed-paste
      // markers (\x1b[200~ … \x1b[201~) when bracketed paste mode is on
      // (true for PowerShell/PSReadLine, bash/zsh, and agent CLIs like
      // Claude Code). Calling paste() once per chunk sends N separate paste
      // "envelopes" instead of one continuous block — readline-based
      // consumers treat each \x1b[201~ as "end of paste, process now", so an
      // embedded newline that lands right after a chunk boundary gets read
      // as a literal Enter and the shell submits early, corrupting/truncating
      // large pastes. Fix: wrap the whole payload in a single marker pair and
      // feed the raw chunks through terminal.input(), which injects data the
      // same way paste() does internally but without re-wrapping each call.
      const bracketed = terminal.modes.bracketedPasteMode && !terminal.options.ignoreBracketedPasteMode
      const normalized = text.replace(/\r?\n/g, '\r') // same normalization terminal.paste() applies
      if (bracketed) terminal.input('\x1b[200~', false)
      let offset = 0
      const send = (): void => {
        terminal.input(normalized.slice(offset, offset + CHUNK), true)
        offset += CHUNK
        if (offset < normalized.length) {
          setTimeout(send, 10)
          return
        }
        if (bracketed) terminal.input('\x1b[201~', false)
      }
      send()
    }
    pasteRef.current = pasteText

    const pasteClipboardContents = async (): Promise<void> => {
      // Always check for image first: agent CLIs (Claude Code, Copilot) prefer file-path
      // references and readText() can return stale/unrelated text even when clipboard has an image.
      const imagePath = await window.oxe.clipboard.saveImageToTemp().catch(() => null)
      if (imagePath) {
        pasteText(`${imagePath} `)
        return
      }
      // Read via main (Electron clipboard, no renderer permission) first; fall
      // back to the web API. The main path is what keeps Ctrl+V working even if
      // navigator.clipboard's clipboard-read permission is denied.
      let text = await window.oxe.clipboard.readText().catch(() => '')
      if (!text) text = await navigator.clipboard.readText().catch(() => '')
      if (text) pasteText(text)
    }

    // Resolve what to copy: the live selection, or — if xterm just cleared it
    // (scrollback trim / TUI buffer toggle) — the last selection seen within
    // RECENT_SELECTION_MS. Without the fallback, copy silently fails while an
    // agent streams output, which is the "copy stops working after a while" bug.
    const effectiveSelection = (): string => {
      const live = terminal.getSelection()
      if (live) return live
      const recent = lastSelectionRef.current
      if (recent && Date.now() - recent.at <= RECENT_SELECTION_MS) return recent.text
      return ''
    }

    // Electron does not always route Ctrl+C through xterm's custom key handler
    // after a long canvas selection. Capture the native copy event as a second
    // path so keyboard shortcuts and context-menu copy both preserve the full
    // selected command/output.
    const handleCopy = (event: ClipboardEvent): void => {
      const selection = effectiveSelection()
      if (!selection) return
      event.preventDefault()
      event.clipboardData?.setData('text/plain', selection)
      void copyText(selection)
      terminal.clearSelection()
      lastSelectionRef.current = null
    }

    // Full-screen TUIs (Grok Build, Claude Code, …) use the alternate screen,
    // which has no xterm scrollback. Without mouse tracking, the wheel does
    // nothing — translate it into PageUp/PageDown (or arrows) so the TUI can
    // scroll its own viewport. When the app enables mouse tracking, leave the
    // event to xterm so it is forwarded as mouse sequences.
    const handleTuiWheel = (event: WheelEvent): boolean => {
      const keys = wheelToTuiScrollKeys({
        bufferType: terminal.buffer.active.type,
        mouseTrackingMode: terminal.modes.mouseTrackingMode,
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        metaKey: event.metaKey
      })
      if (keys === null) return true
      event.preventDefault()
      onInputRef.current(keys)
      return false
    }
    // Proposed API in xterm 5.5+; tests/mocks may omit it — fall back to host.
    const hostWheelFallback = (event: WheelEvent): void => {
      handleTuiWheel(event)
    }
    let usesHostWheelFallback = false
    if (typeof terminal.attachCustomWheelEventHandler === 'function') {
      terminal.attachCustomWheelEventHandler(handleTuiWheel)
    } else {
      usesHostWheelFallback = true
      hostRef.current.addEventListener('wheel', hostWheelFallback, { passive: false })
    }

    terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      const key = event.key.toLowerCase()

      // xterm cancels every key it understands, so app shortcuts would reach the
      // shell. Only the reserved ones (palette, settings, sidebar, F6, the Tab
      // focus toggle) leave the terminal, and Tab itself when this pane's Tab
      // moves focus; Ctrl+R, Ctrl+J and the rest still go to the PTY. The Thread
      // native CLI owns its keymap except the ways out (src/keyboard/terminalFocus.ts).
      if (terminalKeyRoute(event, paneId, Boolean(hostRef.current?.closest('.thread-native-cli'))) !== 'shell') return false

      // Ctrl/Cmd+F opens the in-terminal search overlay instead of reaching
      // the PTY. (Shift/Alt variants pass through for TUIs that bind them.)
      if ((event.ctrlKey || event.metaKey) && key === 'f' && event.type === 'keydown' && !event.altKey && !event.shiftKey) {
        event.preventDefault()
        setSearchOpen(true)
        return false
      }

      // Copy selected text. Ctrl+Shift+C always copies (no PTY conflict).
      // Ctrl+C copies only when there's a selection — otherwise it must fall
      // through to the PTY as SIGINT (interrupt), the expected terminal behavior.
      if ((event.ctrlKey || event.metaKey) && key === 'c' && event.type === 'keydown' && !event.altKey) {
        const selection = effectiveSelection()
        if (event.shiftKey) {
          if (selection) { void copyText(selection); terminal.clearSelection(); lastSelectionRef.current = null }
          return false
        }
        if (selection) {
          void copyText(selection)
          terminal.clearSelection()
          lastSelectionRef.current = null
          return false // we copied — don't also send SIGINT
        }
        return true // no selection → let Ctrl+C reach the PTY (interrupt)
      }

      // Explicit Ctrl/Cmd+V interception. Relying on the browser-native
      // `paste` event alone is unreliable in Electron — xterm's hidden
      // textarea sometimes swallows it before it bubbles to our listener,
      // depending on focus state. This path reads the clipboard via
      // navigator.clipboard.readText() and writes via terminal.paste(),
      // guaranteeing Ctrl+V works no matter who's holding focus inside the
      // terminal pane.
      // `preventDefault()` is essential: returning false alone doesn't stop
      // the browser from emitting a `paste` event next, which would cause
      // a second paste via our hostRef listener (double-input bug).
      if ((event.ctrlKey || event.metaKey) && key === 'v' && event.type === 'keydown' && !event.altKey && !event.shiftKey) {
        event.preventDefault()
        void pasteClipboardContents()
        return false
      }

      if (event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && event.key === 'Enter') {
        // Block both keydown AND keypress — Enter fires both in browsers, and the keypress
        // would otherwise reach xterm and send \r (submit) even if keydown was intercepted.
        if (event.type === 'keydown') {
          // Send Kitty Keyboard Protocol Shift+Enter (\x1b[13;2u).
          // Claude Code and GitHub Copilot recognize this as "insert newline without submitting".
          onInputRef.current('\x1b[13;2u')
        }
        return false
      }

      return true
    })

    const handlePaste = (event: ClipboardEvent): void => {
      const text = event.clipboardData?.getData('text/plain')
      if (text) {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        pasteText(text)
        return
      }
      const hasImage = Array.from(event.clipboardData?.items ?? []).some((item) => item.type.startsWith('image/'))
      if (hasImage) {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        void window.oxe.clipboard.saveImageToTemp().then((imagePath) => {
          if (imagePath) pasteText(`${imagePath} `)
        }).catch(() => undefined)
      }
    }
    hostRef.current.addEventListener('paste', handlePaste, { capture: true })
    hostRef.current.addEventListener('copy', handleCopy, { capture: true })
    // Edit > Select all, with the cursor in this terminal.
    const handleSelectAll = (): void => terminal.selectAll()
    hostRef.current.addEventListener(TERMINAL_SELECT_ALL_EVENT, handleSelectAll)

    const handleProgrammaticInsert = (event: Event): void => {
      const detail = (event as CustomEvent<{ paneId?: string; text?: string }>).detail
      if (detail?.paneId !== paneId || !detail.text) return
      terminal.focus()
      pasteText(detail.text)
    }
    window.addEventListener('oxe:terminal-insert-text', handleProgrammaticInsert)

    // Topbar actions (TerminalPane) arrive as pane-scoped window events, the
    // same pattern as insert-text/focus-pane.
    const handleClearRequest = (event: Event): void => {
      const detail = (event as CustomEvent<{ paneId?: string }>).detail
      if (detail?.paneId !== paneId) return
      terminal.clear()
      terminal.focus()
    }
    window.addEventListener('oxe:terminal-clear', handleClearRequest)

    const handleOpenSearchRequest = (event: Event): void => {
      const detail = (event as CustomEvent<{ paneId?: string }>).detail
      if (detail?.paneId !== paneId) return
      setSearchOpen(true)
    }
    window.addEventListener('oxe:terminal-open-search', handleOpenSearchRequest)

    const syncViewportScrollArea = (): void => {
      // Public API has no syncScrollArea; after maximize the private viewport can
      // keep a stale scrollHeight so the wheel appears dead. Best-effort only.
      try {
        const core = (terminal as unknown as {
          _core?: { viewport?: { syncScrollArea?: (immediate?: boolean) => void } }
        })._core
        core?.viewport?.syncScrollArea?.(true)
      } catch {
        /* private xterm surface — ignore if shape changes */
      }
    }

    const notified: HeldGrid = { cols: 0, rows: 0 }
    const resizeDebouncer = createPtyResizeDebouncer({ onEmit: (cols, rows) => { notified.cols = cols; notified.rows = rows; resizeRedrawGuard.notifyPtyResize(cols, rows); onResizeRef.current(cols, rows) } })
    const reportResize = (cols: number, rows: number): void => { if (resizeDebouncer.report(cols, rows) === 'ignored') syncNotifiedGrid(notified, resizeDebouncer) }
    const fitTerminal = (forceRefresh = false): void => {
      if (isHidden()) return
      try {
        // Preserve absolute scroll position across reflows (e.g. wide tables).
        const buf = terminal.buffer.active
        const viewportY = buf.viewportY
        const wasAtBottom = viewportY >= buf.baseY

        const dimensionsChanged = fitTerminalGrid(terminal, fitAddon, fixedSizeRef.current, notified, reportResize)

        // Force full-screen repaint and scrollArea re-measure on resize or post-hidden reveal.
        if (dimensionsChanged || forceRefresh) terminal.refresh(0, Math.max(0, terminal.rows - 1))
        syncViewportScrollArea()

        if (buf.type === 'alternate') return
        if (wasAtBottom) terminal.scrollToBottom()
        else terminal.scrollToLine(Math.min(viewportY, terminal.buffer.active.baseY))
      } catch {
        // xterm may not have measurable dimensions during first layout.
      }
    }
    refitRef.current = () => fitTerminal()

    const scheduleFit = (): void => {
      if (isHidden() || fitFrameRef.current !== null) return
      fitFrameRef.current = window.requestAnimationFrame(() => {
        fitFrameRef.current = null
        if (!isHidden()) fitTerminal()
      })
    }

    const resizeObserver = new ResizeObserver(scheduleFit)
    resizeObserver.observe(hostRef.current)
    const handleWorkspaceActivated = (event: Event): void => {
      const detail = (event as CustomEvent<{ workspaceId?: string }>).detail
      if (workspaceId && detail?.workspaceId === workspaceId) scheduleFit()
    }
    window.addEventListener('oxe:workspace-activated', handleWorkspaceActivated)
    // A new interface scale changes the device pixel ratio; refit once now and once after xterm re-measures its cells.
    const handleUiScale = (): void => { scheduleFit(); settleFitTimersRef.current.push(setTimeout(scheduleFit, 150)) }
    window.addEventListener(UI_SCALE_EVENT, handleUiScale)
    scheduleFit()
    void document.fonts?.ready.then(scheduleFit).catch(() => undefined)
    // Belt-and-suspenders re-fits shortly after mount. The pane's own layout
    // (topbar + status bar) can still be settling — sibling CSS transitions,
    // late font metric changes, etc. — after ResizeObserver's first callback,
    // and if that first measurement is even slightly stale xterm computes the
    // wrong cols. One post-transition pass is enough; ResizeObserver handles
    // intermediate sizes and `scheduleFit` coalesces them into one frame.
    settleFitTimersRef.current = [
      setTimeout(scheduleFit, 250)
    ]

    // Attach handshake. The session may already be running in main, so we must
    // subscribe BEFORE asking for the backlog and hold anything that arrives
    // in between — otherwise output produced during the round trip is either
    // lost (written before the replay) or duplicated (present in both).
    let attachPending = true
    const queuedWhileAttaching: string[] = []
    const bridge = transport ?? window.oxe.terminal
    // OXE-411 lever H (on by default; OXESPACE_TERM_LEVERS=none turns it off): a pane in a hidden workspace parks.
    const detachHidden = !transport && levers.has('H')
    let parked = false
    let parking = false
    let parkedSeq: number | null = null

    const attachView = async (sinceSeq: number | null = null): Promise<void> => {
      const reattach = sinceSeq !== null
      let attached: TerminalAttachResult | null = null
      try {
        attached = (await bridge.attach?.(reattach ? { paneId, sinceSeq } : { paneId })) ?? null
      } catch { /* main could not answer — fall through and render as a fresh view */ }
      if (disposed) return

      const delta = reattach && attached?.running === true && !attached.truncated
      if (delta) {
        const prePark = writeScheduler.takePending()
        const preBuf = terminal.buffer.active, pinY = preBuf.type === 'normal' && preBuf.viewportY < preBuf.baseY ? preBuf.viewportY : null
        const restorePin = pinY !== null ? (): void => { if (!disposed && terminal.buffer.active.type === 'normal') terminal.scrollToLine(Math.min(pinY, terminal.buffer.active.baseY)) } : undefined
        if (prePark.truncated) terminal.write('\x1b[2J\x1b[H\x1b[?2026l')
        if (prePark.data) terminal.write(prePark.data)
        if (attached?.replay) { if (restorePin) terminal.write(attached.replay, restorePin); else terminal.write(attached.replay) }
        else if (restorePin && prePark.data) terminal.write('', restorePin)
      } else if (reattach && !attached?.running && !attached?.exit) {
        // Main could not answer the reattach: keep what the view shows and go on live.
      } else if (attached?.running || attached?.exit) {
        if (reattach) { writeScheduler.takePending(); terminal.reset() }
        if (attached.truncated) terminal.write('\x1b[2J\x1b[H\x1b[?2026l')
        if (attached.prologue) terminal.write(attached.prologue)
        if (attached.replay) terminal.write(attached.replay)
        if (attached.exit) terminal.write(`\r\n[process exited ${attached.exit.exitCode ?? ''}]\r\n`)
      } else {
        terminal.write('Idle\r\n')
      }

      if (isHidden()) {
        for (const chunk of queuedWhileAttaching) writeScheduler.enqueue(chunk)
      } else {
        for (const chunk of queuedWhileAttaching) terminal.write(chunk)
      }
      queuedWhileAttaching.length = 0
      attachPending = false
      if (isHidden()) { writeScheduler.setPaused(true); void park() }
      else writeScheduler.setPaused(false)
      if (attached?.running && !delta && (attached.altScreen || attached.truncated)) {
        terminal.write('', () => {
          if (!disposed && attached.replay) terminal.scrollToBottom()
          window.requestAnimationFrame(() => { if (!disposed && !isHidden() && resizeDebouncer.lastEmitted() !== null && isValidPtyGrid(terminal.cols, terminal.rows)) onResizeRef.current(terminal.cols, terminal.rows) })
        })
      } else if (attached?.replay && !delta) {
        terminal.write('', () => { if (!disposed) terminal.scrollToBottom() })
      }
    }
    const unpark = (): void => {
      if (!parked) return
      parked = false
      attachPending = true
      writeScheduler.setPaused(true)
      void attachView(parkedSeq)
    }
    const park = async (): Promise<void> => {
      if (!detachHidden || parked || parking || attachPending || disposed) return
      parking = true
      let result: { seq: number } | void | undefined
      try { result = await bridge.detach?.({ paneId, parked: true }) } catch { result = undefined }
      parking = false
      if (disposed) return
      if (!result || typeof result.seq !== 'number') { if (!isHidden() && !attachPending) writeScheduler.setPaused(false); return }
      parkedSeq = result.seq
      parked = true
      if (previewTimer) { clearTimeout(previewTimer); previewTimer = null }
      if (!isHidden()) unpark()
    }

    // OXE-349 + OXE-411 + OXE-443 + OXE-451: warm WebGL2 LRU pool keeps recent hidden panes warm
    // with paused writes and 1-frame reveal; LRU/idle eviction (or standalone views) releases WebGL & parks.
    const webgl = createTerminalWebglController({
      terminal,
      isDisposed: () => disposed,
      isHidden,
      warmPool,
      onContextLost: () => warmPool?.remove(paneId)
    })
    const evictFromWarmPool = (): void => {
      if (disposed || !isHidden()) return
      webgl.release()
      void park()
    }
    if (!isHidden()) {
      warmPool?.touchVisible(paneId, evictFromWarmPool)
      webgl.load()
    }
    let warmRevealFrame: number | null = null
    const cancelWarmReveal = (): void => {
      if (warmRevealFrame !== null) {
        window.cancelAnimationFrame(warmRevealFrame)
        warmRevealFrame = null
      }
    }
    const revealScheduler = createRevealScheduler(() => { if (!disposed && !isHidden()) { if (!webgl.hasAddon()) webgl.load(); fitTerminal(true) } })
    const stopObservingVisibility = observeTerminalVisibility(hostRef.current, (hidden) => {
      if (disposed) return
      if (hidden) {
        revealScheduler.cancel()
        cancelWarmReveal()
        writeScheduler.setPaused(true)
        resizeRedrawGuard.flush()
        if (previewTimer) { clearTimeout(previewTimer); previewTimer = null }
        if (fitFrameRef.current !== null) { window.cancelAnimationFrame(fitFrameRef.current); fitFrameRef.current = null }
        resizeDebouncer.cancel(); syncNotifiedGrid(notified, resizeDebouncer)
        const keptWarm = warmPool ? warmPool.markHidden(paneId, evictFromWarmPool) : false
        if (!keptWarm) {
          webgl.release()
          void park()
        }
        return
      }
      warmPool?.touchVisible(paneId, evictFromWarmPool)
      if (parked) unpark()
      else if (!attachPending && !parking) writeScheduler.setPaused(false)
      if (warmPool && webgl.hasAddon()) {
        cancelWarmReveal()
        warmRevealFrame = window.requestAnimationFrame(() => {
          warmRevealFrame = null
          if (!disposed && !isHidden()) fitTerminal(true)
        })
      } else {
        revealScheduler.schedule()
      }
    })
    const unsubscribeData = bridge.onData(paneId, (event) => {
      if (parked) return
      if (attachPending) {
        queuedWhileAttaching.push(event.data)
        return
      }
      if (!writeScheduler.isPaused() && resizeRedrawGuard.ingest(event.data)) {
        if (!transport) useTerminalStore.getState().updateActivity(paneId, event.data)
        return
      }
      if (writeScheduler.isPaused() && !transport) {
        useTerminalStore.getState().updateActivity(paneId, event.data)
      }
      writeScheduler.enqueue(event.data)
    })
    const unsubscribeExit = bridge.onExit(paneId, (event) => {
      resizeRedrawGuard.flush()
      terminal.write(`\r\n[process exited ${event.exitCode ?? ''}]\r\n`)
      onExitRef.current?.(event.exitCode)
    })

    void attachView()

    return () => {
      disposed = true
      warmPool?.remove(paneId)
      // Release the session without killing it: the shell keeps running and
      // main keeps its output, so coming back costs a replay instead of a
      // respawn. This is the whole point of the attach model.
      void bridge.detach?.({ paneId })
      revealScheduler.cancel(); cancelWarmReveal(); resizeDebouncer.dispose(); resizeRedrawGuard.dispose()
      if (fitFrameRef.current !== null) {
        window.cancelAnimationFrame(fitFrameRef.current)
        fitFrameRef.current = null
      }
      for (const t of settleFitTimersRef.current) clearTimeout(t)
      settleFitTimersRef.current = []
      if (previewTimer) clearTimeout(previewTimer)
      unsubscribeData()
      writeScheduler.dispose()
      unsubscribeExit()
      resizeObserver.disconnect()
      stopObservingVisibility()
      dataDisposable.dispose()
      selectionDisposable.dispose()
      osc52Disposable.dispose()
      searchResultsDisposable.dispose()
      searchAddonRef.current = null
      window.removeEventListener('oxe:terminal-clear', handleClearRequest)
      window.removeEventListener('oxe:terminal-open-search', handleOpenSearchRequest)
      window.removeEventListener('oxe:workspace-activated', handleWorkspaceActivated)
      window.removeEventListener(UI_SCALE_EVENT, handleUiScale)
      webgl.release()
      hostRef.current?.removeEventListener('paste', handlePaste, { capture: true })
      hostRef.current?.removeEventListener('copy', handleCopy, { capture: true })
      hostRef.current?.removeEventListener(TERMINAL_SELECT_ALL_EVENT, handleSelectAll)
      if (usesHostWheelFallback) {
        hostRef.current?.removeEventListener('wheel', hostWheelFallback)
      }
      window.removeEventListener('oxe:terminal-insert-text', handleProgrammaticInsert)
      pasteRef.current = null
      refitRef.current = null
      lastSelectionRef.current = null
      pathLinksDisposable.dispose()
      contextMenuDisposable.dispose()
      terminal.dispose()
      terminalRef.current = null
    }
  }, [paneId, workspaceId, transport, warmPool])

  const colorMode = useColorMode()
  const surfaceStyle = useSurfaceStyle()
  const colorScheme = useColorScheme()
  // Apply prefs + theme to the live terminal without recreating it. Font/cursor
  // changes are immediate; the theme is re-read on the next frame so the
  // workspace's `data-theme` (set by ThemeProvider) has already settled.
  useEffect(() => {
    const term = terminalRef.current
    if (!term) return
    const fontChanged =
      term.options.fontFamily !== prefs.fontFamily ||
      term.options.fontSize !== prefs.fontSize ||
      term.options.lineHeight !== prefs.lineHeight ||
      term.options.letterSpacing !== prefs.letterSpacing
    term.options.fontFamily = prefs.fontFamily
    term.options.fontSize = prefs.fontSize
    term.options.lineHeight = prefs.lineHeight
    term.options.letterSpacing = prefs.letterSpacing
    term.options.cursorStyle = prefs.cursorStyle
    term.options.cursorInactiveStyle = resolveInactiveCursorStyle(prefs.cursorStyle)
    term.options.cursorBlink = prefs.cursorBlink
    term.options.scrollback = prefs.scrollback

    const raf = window.requestAnimationFrame(() => {
      const t = terminalRef.current
      if (!t) return
      const translucent = prefsRef.current.backgroundOpacity < 1
      // allowTransparency toggles the renderer's alpha path — settable live in
      // xterm 5, but guarded in case a renderer swap races the update.
      try {
        if (t.options.allowTransparency !== translucent) t.options.allowTransparency = translucent
      } catch { /* applies on next terminal creation */ }
      t.options.theme = buildTerminalTheme(translucent)
      // Font metrics changed → re-fit (recomputes cols/rows + notifies the PTY)
      // and repaint so glyphs render at the new size.
      if (fontChanged) refitRef.current?.()
      t.refresh(0, t.rows - 1)
    })
    return () => window.cancelAnimationFrame(raf)
  }, [
    themeId,
    colorMode,
    surfaceStyle,
    colorScheme,
    prefs.fontFamily,
    prefs.fontSize,
    prefs.lineHeight,
    prefs.letterSpacing,
    prefs.cursorStyle,
    prefs.cursorBlink,
    prefs.scrollback,
    prefs.backgroundOpacity
  ])

  // OXE-395: a launch starts when the view mounts or the shell stops; the terminal takes focus when it starts running only
  // if the person has not pressed a key or clicked elsewhere since, so a late shell never takes focus they moved.
  const launchedAt = useRef(performance.now())
  useEffect(() => {
    watchPersonInput()
    if (!isRunning) { launchedAt.current = performance.now(); return }
    if (personActedElsewhereSince(launchedAt.current, hostRef.current)) return
    runWithTerminalAutoFocus(() => terminalRef.current?.focus())
  }, [isRunning])

  useEffect(() => {
    const handler = (e: Event): void => {
      if ((e as CustomEvent<{ paneId: string }>).detail.paneId === paneId) {
        terminalRef.current?.focus()
      }
    }
    window.addEventListener('oxe:focus-pane', handler)
    return () => window.removeEventListener('oxe:focus-pane', handler)
  }, [paneId])

  // Focus the search input as soon as the overlay opens (Ctrl+F / topbar).
  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus()
  }, [searchOpen])

  const runSearch = useCallback((query: string, direction: 'next' | 'prev', incremental = false): void => {
    const addon = searchAddonRef.current
    if (!addon) return
    if (!query) {
      addon.clearDecorations()
      setSearchResults(null)
      return
    }
    const options = { decorations: searchDecorations(), incremental }
    if (direction === 'next') addon.findNext(query, options)
    else addon.findPrevious(query, options)
  }, [])

  const closeSearch = useCallback((): void => {
    setSearchOpen(false)
    setSearchQuery('')
    setSearchResults(null)
    searchAddonRef.current?.clearDecorations()
    terminalRef.current?.focus()
  }, [])

  const { t } = useTranslation('code')
  // The addon caps highlight decorations at 1000 and reports -1 beyond that.
  const searchCountLabel = !searchQuery
    ? ''
    : !searchResults || searchResults.resultCount === 0
      ? '0'
      : searchResults.resultCount === -1
        ? `${searchResults.resultIndex + 1}/999+`
        : `${searchResults.resultIndex + 1}/${searchResults.resultCount}`

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>): void => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setIsDragOver(false)
    }
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    setIsDragOver(false)
    const path = e.dataTransfer.getData('application/oxe-file-path')
    if (path) {
      terminalRef.current?.focus()
      pasteRef.current?.(path + ' ')
    }
  }

  const translucent = prefs.backgroundOpacity < 1

  return (
    <>
      <div
        ref={hostRef}
        className={`terminal-view${isDragOver ? ' terminal-drop-active' : ''}`}
        data-testid="terminal-view"
        data-terminal-pane={paneId}
        data-held={fixedSize ? 'true' : undefined}
        data-translucent={translucent ? 'true' : undefined}
        style={translucent ? { ['--term-bg-mix' as never]: `${Math.round(prefs.backgroundOpacity * 100)}%` } : undefined}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      />
      <TabFocusBadge paneId={paneId} />
      {searchOpen ? (
        <div className="terminal-search" role="search" data-testid="terminal-search">
          <input
            ref={searchInputRef}
            type="text"
            className="terminal-search-input"
            placeholder={t('terminal.search.placeholder')}
            aria-label={t('terminal.search.label')}
            value={searchQuery}
            onChange={(e) => {
              const value = e.currentTarget.value
              setSearchQuery(value)
              runSearch(value, 'next', true)
            }}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') {
                e.preventDefault()
                runSearch(searchQuery, e.shiftKey ? 'prev' : 'next')
              } else if (e.key === 'Escape') {
                e.preventDefault()
                closeSearch()
              }
            }}
          />
          <span className="terminal-search-count" aria-live="polite">{searchCountLabel}</span>
          <button type="button" className="terminal-search-btn" aria-label={t('terminal.search.previous')} title={t('terminal.search.previousTitle')} onClick={() => runSearch(searchQuery, 'prev')}>
            <ArrowUp size={12} aria-hidden="true" />
          </button>
          <button type="button" className="terminal-search-btn" aria-label={t('terminal.search.next')} title={t('terminal.search.nextTitle')} onClick={() => runSearch(searchQuery, 'next')}>
            <ArrowDown size={12} aria-hidden="true" />
          </button>
          <button type="button" className="terminal-search-btn" aria-label={t('terminal.search.close')} title={t('terminal.search.closeTitle')} onClick={closeSearch}>
            <X size={12} aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </>
  )
}
