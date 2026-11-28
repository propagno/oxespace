import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { isSendKeyMode, type SendKeyMode } from '../components/Threads/sendKey'
import { normalizeUtilityModel } from '../../shared/utility-model'

export const THREAD_FONT_DEFAULT = 14
export const THREAD_FONT_MIN = 12
export const THREAD_FONT_MAX = 20
export const SEND_KEY_DEFAULT: SendKeyMode = 'enter'
export const UTILITY_MODEL_DEFAULT = ''
/** Default character threshold above which pasted text collapses into a removable chip (0 disables). */
export const PASTE_AS_ATTACHMENT_DEFAULT = 10_000
export const PASTE_AS_ATTACHMENT_MAX = 1_000_000
export const PASTE_AS_ATTACHMENT_PRESETS = [10_000, 25_000, 0] as const

/** How OxeChat displays agent reasoning blocks (OXE-475): bounded streaming preview, collapsed, or expanded. */
export type ThinkingStyle = 'preview' | 'collapsed' | 'expanded'
export const THINKING_STYLES: readonly ThinkingStyle[] = ['preview', 'collapsed', 'expanded']
export const THINKING_STYLE_DEFAULT: ThinkingStyle = 'preview'

/** Default action when submitting a message while an OxeChat turn is running (OXE-479). */
export type ActiveTurnSendAction = 'queue' | 'steer'
export const ACTIVE_TURN_SEND_ACTIONS: readonly ActiveTurnSendAction[] = ['queue', 'steer']
export const ACTIVE_TURN_SEND_ACTION_DEFAULT: ActiveTurnSendAction = 'queue'

export const FOLD_COMPLETED_TURNS_DEFAULT = true
export const AUTO_EXPAND_FAILURES_DEFAULT = true

export function isThinkingStyle(value: unknown): value is ThinkingStyle {
  return value === 'preview' || value === 'collapsed' || value === 'expanded'
}

export function isActiveTurnSendAction(value: unknown): value is ActiveTurnSendAction {
  return value === 'queue' || value === 'steer'
}

export function clampThreadFontSize(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(THREAD_FONT_MIN, Math.min(THREAD_FONT_MAX, Math.round(value)))
    : THREAD_FONT_DEFAULT
}

export function clampPasteAsAttachmentThreshold(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return PASTE_AS_ATTACHMENT_DEFAULT
  if (value <= 0) return 0
  return Math.min(PASTE_AS_ATTACHMENT_MAX, Math.round(value))
}

interface ThreadPrefs {
  fontSize: number
  setFontSize: (size: number) => void
  /** Which key sends a message and answers a question (OXE-131); kept across restarts. */
  sendKey: SendKeyMode
  setSendKey: (mode: SendKeyMode) => void
  /** Display mode for reasoning blocks (OXE-475); kept across restarts. */
  thinkingStyle: ThinkingStyle
  setThinkingStyle: (style: ThinkingStyle) => void
  /** Collapse completed turns' intermediate tool rows behind one fold line (OXE-479). */
  foldCompletedTurns: boolean
  setFoldCompletedTurns: (fold: boolean) => void
  /** Automatically open failed shell command steps so errors are visible immediately (OXE-479). */
  autoExpandFailures: boolean
  setAutoExpandFailures: (expand: boolean) => void
  /** Default action when pressing the send key during a running turn; Alt+Enter runs the opposite (OXE-479). */
  activeTurnSendAction: ActiveTurnSendAction
  setActiveTurnSendAction: (action: ActiveTurnSendAction) => void
  /** Auto-convert pasted text longer than this many chars into a removable attachment chip (0 = off, OXE-478). */
  pasteAsAttachmentThreshold: number
  setPasteAsAttachmentThreshold: (threshold: number) => void
  /** Optional lightweight utility model for auxiliary tasks ('' = Auto, 'primary' = keep primary, or model id; OXE-487). */
  utilityModel: string
  setUtilityModel: (model: string) => void
}

export const useThreadPrefs = create<ThreadPrefs>()(persist(
  set => ({
    fontSize: THREAD_FONT_DEFAULT, setFontSize: size => set({ fontSize: clampThreadFontSize(size) }),
    sendKey: SEND_KEY_DEFAULT, setSendKey: mode => set({ sendKey: isSendKeyMode(mode) ? mode : SEND_KEY_DEFAULT }),
    thinkingStyle: THINKING_STYLE_DEFAULT, setThinkingStyle: style => set({ thinkingStyle: isThinkingStyle(style) ? style : THINKING_STYLE_DEFAULT }),
    foldCompletedTurns: FOLD_COMPLETED_TURNS_DEFAULT,
    setFoldCompletedTurns: fold => set({ foldCompletedTurns: fold !== false }),
    autoExpandFailures: AUTO_EXPAND_FAILURES_DEFAULT,
    setAutoExpandFailures: expand => set({ autoExpandFailures: expand !== false }),
    activeTurnSendAction: ACTIVE_TURN_SEND_ACTION_DEFAULT,
    setActiveTurnSendAction: action => set({ activeTurnSendAction: isActiveTurnSendAction(action) ? action : ACTIVE_TURN_SEND_ACTION_DEFAULT }),
    pasteAsAttachmentThreshold: PASTE_AS_ATTACHMENT_DEFAULT,
    setPasteAsAttachmentThreshold: threshold => set({ pasteAsAttachmentThreshold: clampPasteAsAttachmentThreshold(threshold) }),
    utilityModel: UTILITY_MODEL_DEFAULT,
    setUtilityModel: model => set({ utilityModel: normalizeUtilityModel(model) })
  }),
  {
    name: 'oxe.thread-appearance',
    partialize: state => ({
      fontSize: state.fontSize,
      sendKey: state.sendKey,
      thinkingStyle: state.thinkingStyle,
      foldCompletedTurns: state.foldCompletedTurns,
      autoExpandFailures: state.autoExpandFailures,
      activeTurnSendAction: state.activeTurnSendAction,
      pasteAsAttachmentThreshold: state.pasteAsAttachmentThreshold,
      utilityModel: state.utilityModel
    }),
    merge: (saved, current) => {
      const value = saved as {
        fontSize?: unknown
        sendKey?: unknown
        thinkingStyle?: unknown
        foldCompletedTurns?: unknown
        autoExpandFailures?: unknown
        activeTurnSendAction?: unknown
        pasteAsAttachmentThreshold?: unknown
        utilityModel?: unknown
      } | null
      return {
        ...current,
        fontSize: clampThreadFontSize(value?.fontSize),
        sendKey: isSendKeyMode(value?.sendKey) ? value.sendKey : SEND_KEY_DEFAULT,
        thinkingStyle: isThinkingStyle(value?.thinkingStyle) ? value.thinkingStyle : THINKING_STYLE_DEFAULT,
        foldCompletedTurns: typeof value?.foldCompletedTurns === 'boolean' ? value.foldCompletedTurns : FOLD_COMPLETED_TURNS_DEFAULT,
        autoExpandFailures: typeof value?.autoExpandFailures === 'boolean' ? value.autoExpandFailures : AUTO_EXPAND_FAILURES_DEFAULT,
        activeTurnSendAction: isActiveTurnSendAction(value?.activeTurnSendAction) ? value.activeTurnSendAction : ACTIVE_TURN_SEND_ACTION_DEFAULT,
        pasteAsAttachmentThreshold: clampPasteAsAttachmentThreshold(value?.pasteAsAttachmentThreshold),
        utilityModel: normalizeUtilityModel(value?.utilityModel)
      }
    }
  }
))
