import { Search } from 'lucide-react'
import { THREAD_PROVIDERS, threadAgentName } from '../../../shared/threadProviders'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import {
  COMMAND_CATALOG,
  commandRequest,
  parseCommandLine,
  type CommandContext,
  type ParsedCommandLine
} from '../../../shared/command-bar'
import type { MainMessage } from '../../../shared/messages'
import type { Workspace } from '../../../shared/types/workspace'
import { goToWorkspace } from '../../commands/goTo'
import { formatChord } from '../../keyboard/chords'
import { KEYBINDINGS, chordsFor, type KeybindingId } from '../../keyboard/keybindings'
import { useCommandHistoryStore } from '../../store/command-history.store'
import { useSkillStore } from '../../store/skill.store'
import { useThreadStore } from '../../store/thread.store'
import { useWorkspaceStore } from '../../store/workspace.store'
import { Button } from '../../ui/Button'
import { Notice } from '../../ui/Display'
import { Kbd } from '../../ui/Field'
import { useModalSurface } from '../../ui/useModalSurface'
import type { CommandPaletteAction } from '../../utils/commandRegistry'
import { rankBy, rankText } from '../../utils/fuzzy'
import { KeyChord } from '../Keyboard/KeyChord'
import styles from './CommandBar.module.css'

/** Something the bar finds by its words with no prefix (a pane, a file); `group` is the heading it is listed under. */
export interface CommandBarPlace {
  key: string
  group: string
  primary: string
  secondary?: string
  /** The tooltip, such as a full path. */
  title?: string
  /** More words it is found by. */
  words?: string
  run: () => void
}

export interface CommandBarProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  context: CommandContext
  onRun: (parsed: ParsedCommandLine) => void
  /** The palette's commands (the registry): listed after ">" with the bar's own (BRD-11, one palette). */
  actions?: readonly CommandPaletteAction[]
  /** Panes, files and the like, found with no prefix. */
  places?: readonly CommandBarPlace[]
  /** The workspaces it finds and opens; the workspace store's when not given. */
  workspaces?: readonly Workspace[]
  placeholder?: string
  /** What the field holds when the bar opens (">" from the palette shortcut: commands first). */
  initialQuery?: string
}

interface BarOption {
  key: string
  domId: string
  primary: string
  secondary: string
  alsoText: string
  shortcutText: string | null
  /** A registry shortcut, shown as key caps. */
  chord?: string
  title?: string
  fill?: string
  parsed?: ParsedCommandLine
  run?: () => void
}

interface BarGroup {
  key: string
  groupLabel: string
  items: BarOption[]
}

interface ActiveRefusal {
  code: MainMessage['code']
  params: Readonly<Record<string, unknown>>
  parsed: ParsedCommandLine
}

const DISALLOWED_RE = /^\/(approve|allow|accept)(?:\s|$)/i
const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/
const GO_TO_COMMAND_IDS = new Set<string>(['pending'])
/** Commands the window runs with its own actions, the ones their buttons use. */
const WINDOW_COMMANDS = new Set<string>(['terminal', 'new', 'theme'])
/** The sentence of an error from main, without the channel in front of it. */
const errorReason = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '').split('\u0000')[0].slice(0, 200)
/** The examples "?" shows above every command (BRD-11: the empty bar is one line of hints). */
const EXAMPLE_KINDS = ['agent', 'skill', 'open'] as const
const MAX_PER_PLACE_GROUP = 15

const KEYBINDING_IDS = new Set<string>(KEYBINDINGS.map(binding => binding.id))
/** A command's shortcut: a registry id (with the user's override) or a literal chord. */
function commandChord(shortcut: string | undefined): string | undefined {
  if (!shortcut) return undefined
  return KEYBINDING_IDS.has(shortcut) ? chordsFor(shortcut as KeybindingId)[0] : shortcut
}

const actionScore = (action: CommandPaletteAction, q: string): number =>
  rankText(action.title, `${action.subtitle ?? ''} ${(action.keywords ?? []).join(' ')} ${action.category ?? ''}`, q)

function workspaceTier(name: string, q: string): number {
  const lower = name.toLowerCase()
  if (!q) return 0
  if (lower === q) return 0
  if (lower.startsWith(q)) return 1
  return 2
}

export function CommandBar({ open, onOpenChange, context, onRun, actions, places, workspaces: givenWorkspaces, placeholder, initialQuery = '' }: CommandBarProps): ReactElement | null {
  const { t } = useTranslation()
  const baseId = useId()
  const listboxId = `${baseId}-listbox`
  const inputRef = useRef<HTMLInputElement | null>(null)
  const skills = useSkillStore(state => state.skills)
  const storeWorkspaces = useWorkspaceStore(state => state.workspaces)
  const workspaces: readonly Workspace[] = givenWorkspaces ?? storeWorkspaces
  const threads = useThreadStore(state => state.threads)
  const recentIds = useCommandHistoryStore(state => state.recent)

  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [refusal, setRefusal] = useState<ActiveRefusal | null>(null)
  const [confirmingStop, setConfirmingStop] = useState(false)
  /** Why a command did nothing, when no refusal of the plan says it: the bar stays open with the sentence. */
  const [hint, setHint] = useState<string | null>(null)
  const [announced, setAnnounced] = useState('')

  const modal = useModalSurface<HTMLDivElement>(() => onOpenChange(false), open)

  useLayoutEffect(() => {
    if (!open) return
    setQuery(initialQuery)
    setActiveIndex(0)
    setRefusal(null)
    setConfirmingStop(false)
    setAnnounced('')
    inputRef.current?.focus({ preventScroll: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (open) inputRef.current?.focus({ preventScroll: true })
  }, [open])

  // The local usage count's "Command bar" is this bar, counted once each time it opens.
  useEffect(() => { if (open) void window.oxe?.featureUsage?.record?.('commandBar') }, [open])

  const startTrimmed = query.replace(/^[ \t]+/, '')
  const trimmed = startTrimmed.trim()
  const disallowedMatch = DISALLOWED_RE.exec(startTrimmed)
  const disallowedCommand = disallowedMatch ? `/${disallowedMatch[1].toLowerCase()}` : null

  const groups = useMemo<BarGroup[]>(() => {
    if (!open || !trimmed || disallowedCommand) return []
    let seq = 0
    const nextDomId = () => `${baseId}-opt-${seq++}`

    const actionsLabel = t('commandBar.sections.actions')
    const goToLabel = t('commandBar.sections.goTo')
    const openBesideLabel = t('commandBar.sections.openBeside')

    const modeDestinations = [
      {
        id: 'oxecode',
        label: 'OxeCode',
        match: 'oxecode',
        secondary: t('commandBar.destinations.oxecode'),
        also: 'OxeCode',
        shortcut: formatChord('Mod+1')
      },
      {
        id: 'oxechat',
        label: 'OxeChat',
        match: 'oxechat',
        secondary: t('commandBar.destinations.oxechat'),
        also: 'OxeChat',
        shortcut: formatChord('Mod+2')
      },
      {
        id: 'oxequery',
        label: 'OxeQuery',
        match: 'oxequery',
        secondary: t('commandBar.destinations.oxequery'),
        also: 'OxeQuery',
        shortcut: formatChord('Mod+3')
      },
      {
        id: 'settings',
        label: t('commandBar.destinations.settings'),
        match: `settings ${t('commandBar.destinations.settings').toLowerCase()}`,
        secondary: t('commandBar.destinations.settingsHint'),
        also: t('commandBar.destinations.settings'),
        shortcut: formatChord('Mod+,')
      },
      {
        id: 'approvals',
        label: t('commandBar.destinations.approvals'),
        match: `approvals ${t('commandBar.destinations.approvals').toLowerCase()}`,
        secondary: t('commandBar.destinations.approvalsHint'),
        also: t('commandBar.fallback.pending'),
        shortcut: formatChord('Mod+Shift+A')
      }
    ]

    const catalogOption = (entry: (typeof COMMAND_CATALOG)[number], args = ''): BarOption => ({
      key: `cmd-${entry.id}`,
      domId: nextDomId(),
      primary: `/${entry.id}`,
      secondary: t(`commandBar.catalog.${entry.id}`),
      alsoText: t('commandBar.also', { button: t(`commandBar.fallback.${entry.id}`) }),
      shortcutText: entry.shortcut ? formatChord(entry.shortcut) : null,
      fill: entry.id === 'skill' ? '/skill ' : undefined,
      parsed: entry.id === 'skill' ? undefined : { kind: 'command', id: entry.id, args }
    })

    // Plain words find a command by what it does and by the button it stands for (new conversation), not only by its id.
    const commandWords = (entry: (typeof COMMAND_CATALOG)[number]): string => `${entry.id} ${t(`commandBar.catalog.${entry.id}`)} ${t(`commandBar.fallback.${entry.id}`)}`.toLowerCase()

    const modeOption = (dest: (typeof modeDestinations)[number]): BarOption => ({
      key: `dest-${dest.id}`,
      domId: nextDomId(),
      primary: dest.label,
      secondary: dest.secondary,
      alsoText: t('commandBar.also', { button: dest.also }),
      shortcutText: dest.shortcut,
      parsed: { kind: 'open', query: dest.id }
    })

    const besideThreads = (needle: string): BarOption[] => {
      const candidates = threads
        .filter(th => !th.archived && th.id !== context.threadId && (!needle || th.title.toLowerCase().includes(needle)))
        .slice(0, 4)
      return candidates.map(th => ({
        key: `beside-${th.id}`,
        domId: nextDomId(),
        primary: th.title,
        secondary: t('commandBar.destinations.conversation'),
        alsoText: t('commandBar.also', { button: 'OxeChat' }),
        shortcutText: formatChord('Mod+Enter'),
        parsed: { kind: 'open', query: `beside:${th.id}` }
      }))
    }

    // ">" lists commands only, in one group: the palette's (registry) and the bar's own (BRD-11, CA-3).
    if (startTrimmed.startsWith('>')) {
      const rest = startTrimmed.slice(1).trim().toLowerCase()
      const enabled = (actions ?? []).filter(action => !action.disabled)
      const recentRank = (id: string): number => { const at = recentIds.indexOf(id); return at < 0 ? recentIds.length : at }
      const ranked: CommandPaletteAction[] = rest
        ? rankBy(enabled, rest, action => actionScore(action, rest))
        : enabled.map((action, index) => ({ action, index }))
          .sort((a, b) => recentRank(a.action.id) - recentRank(b.action.id) || a.index - b.index)
          .map(entry => entry.action)
      const items: BarOption[] = [
        ...ranked.map(action => ({
          key: `action-${action.id}`,
          domId: nextDomId(),
          primary: action.title,
          secondary: action.subtitle ?? '',
          alsoText: '',
          shortcutText: null,
          chord: commandChord(action.shortcut),
          run: () => { useCommandHistoryStore.getState().record(action.id); action.run() }
        })),
        ...COMMAND_CATALOG.filter(entry => !rest || commandWords(entry).includes(rest)).map(entry => catalogOption(entry))
      ]
      return items.length > 0 ? [{ key: 'commands', groupLabel: t('commandBar.groups.commands'), items }] : []
    }

    if (trimmed === '?') {
      const actionItems = COMMAND_CATALOG.filter(entry => !GO_TO_COMMAND_IDS.has(entry.id)).map(entry => catalogOption(entry))
      const goToItems = COMMAND_CATALOG.filter(entry => GO_TO_COMMAND_IDS.has(entry.id)).map(entry => catalogOption(entry))
      const out: BarGroup[] = []
      if (actionItems.length > 0) out.push({ key: 'actions', groupLabel: actionsLabel, items: actionItems })
      if (goToItems.length > 0) out.push({ key: 'goto', groupLabel: goToLabel, items: goToItems })
      return out
    }

    if (startTrimmed.startsWith('@')) {
      const match = /^@([^\s]*)(?:[ \t]+([\s\S]*))?$/.exec(startTrimmed)
      const prefix = (match?.[1] ?? '').toLowerCase()
      const promptText = (match?.[2] ?? '').replace(/[ \t]+$/, '')
      const providers = THREAD_PROVIDERS.filter(p => !prefix || p.startsWith(prefix))
      if (!providers.length) return []
      return [{
        key: 'agents',
        groupLabel: t('commandBar.groups.agents'),
        items: providers.map(provider => {
          const agentName = threadAgentName(provider)
          return {
            key: `agent-${provider}`,
            domId: nextDomId(),
            primary: `@${agentName}`,
            secondary: promptText || t('commandBar.agentPrompt', { agent: agentName }),
            alsoText: t('commandBar.also', { button: 'OxeChat' }),
            shortcutText: null,
            parsed: { kind: 'agent', provider, text: promptText }
          }
        })
      }]
    }

    if (/^\/skill(?:\s|$)/i.test(startTrimmed)) {
      const rest = startTrimmed.replace(/^\/skill[ \t]*/i, '')
      const token = rest.split(/\s+/)[0]?.toLowerCase() ?? ''
      const extraArgs = rest.slice(token.length).replace(/^[ \t]+/, '')
      const matched = skills.filter(s => !token || s.name.toLowerCase().includes(token) || s.description.toLowerCase().includes(token))
      if (!matched.length) return []
      return [{
        key: 'skills',
        groupLabel: t('commandBar.groups.skills'),
        items: matched.map(s => ({
          key: `skill-${s.name}`,
          domId: nextDomId(),
          primary: `/skill ${s.name}`,
          secondary: s.description,
          alsoText: t('commandBar.also', { button: t('commandBar.fallback.skill') }),
          shortcutText: null,
          parsed: { kind: 'skill', name: s.name, args: extraArgs }
        }))
      }]
    }

    if (startTrimmed.startsWith('/')) {
      const parts = /^\/([^\s]*)(?:[ \t]+([\s\S]*))?$/.exec(startTrimmed)
      const headLower = (parts?.[1] ?? '').toLowerCase()
      const restArgs = parts?.[2] ?? ''
      const out: BarGroup[] = []
      const cmdMatches = COMMAND_CATALOG.filter(entry => !headLower || entry.id.startsWith(headLower))
      const actionItems = cmdMatches.filter(entry => !GO_TO_COMMAND_IDS.has(entry.id)).map(entry => catalogOption(entry, restArgs))
      const goToItems = [
        ...cmdMatches.filter(entry => GO_TO_COMMAND_IDS.has(entry.id)).map(entry => catalogOption(entry, restArgs)),
        ...(!headLower ? modeDestinations.map(dest => modeOption(dest)) : [])
      ]
      if (actionItems.length > 0) {
        out.push({ key: 'actions', groupLabel: actionsLabel, items: actionItems })
      }
      if (goToItems.length > 0) {
        out.push({ key: 'goto', groupLabel: goToLabel, items: goToItems })
      }
      const skillMatches = skills.filter(s => !headLower || 'skill'.startsWith(headLower) || s.name.toLowerCase().includes(headLower))
      if (skillMatches.length > 0) {
        out.push({
          key: 'skills',
          groupLabel: t('commandBar.groups.skills'),
          items: skillMatches.map(s => ({
            key: `skill-${s.name}`,
            domId: nextDomId(),
            primary: `/skill ${s.name}`,
            secondary: s.description,
            alsoText: t('commandBar.also', { button: t('commandBar.fallback.skill') }),
            shortcutText: null,
            parsed: { kind: 'skill', name: s.name, args: restArgs }
          }))
        })
      }
      if (!headLower) {
        const beside = besideThreads('')
        if (beside.length > 0) {
          out.push({ key: 'open-beside', groupLabel: openBesideLabel, items: beside })
        }
      }
      return out
    }

    if (/^open(?:\s|$)/i.test(startTrimmed)) {
      const q = startTrimmed.replace(/^open[ \t]*/i, '').trim().toLowerCase()
      const out: BarGroup[] = []
      const matchedWorkspaces = workspaces
        .filter(ws => !q || ws.name.toLowerCase().includes(q))
        .slice()
        .sort((a, b) => workspaceTier(a.name, q) - workspaceTier(b.name, q))
      if (matchedWorkspaces.length > 0) {
        out.push({
          key: 'workspaces',
          groupLabel: t('commandBar.groups.workspaces'),
          items: matchedWorkspaces.map(ws => ({
            key: `ws-${ws.id}`,
            domId: nextDomId(),
            primary: ws.name,
            secondary: ws.rootPath,
            alsoText: t('commandBar.also', { button: 'OxeCode' }),
            shortcutText: null,
            title: ws.rootPath,
            parsed: { kind: 'open', query: ws.name }
          }))
        })
      }
      const matchedModes = modeDestinations
        .filter(dest => !q || dest.match.includes(q) || dest.label.toLowerCase().includes(q))
        .slice()
        .sort((a, b) => workspaceTier(a.label, q) - workspaceTier(b.label, q))
      if (matchedModes.length > 0) {
        out.push({
          key: 'goto',
          groupLabel: goToLabel,
          items: matchedModes.map(dest => modeOption(dest))
        })
      }
      if (!q) {
        const beside = besideThreads('')
        if (beside.length > 0) {
          out.push({ key: 'open-beside', groupLabel: openBesideLabel, items: beside })
        }
      }
      return out
    }

    const q = trimmed.toLowerCase()
    const out: BarGroup[] = []
    const cmdMatches = COMMAND_CATALOG.filter(entry => commandWords(entry).includes(q))
    const actionItems = cmdMatches.filter(entry => !GO_TO_COMMAND_IDS.has(entry.id)).map(entry => catalogOption(entry))
    const matchedModes = modeDestinations
      .filter(dest => dest.match.includes(q) || dest.label.toLowerCase().includes(q))
      .sort((a, b) => workspaceTier(a.label, q) - workspaceTier(b.label, q))
    const goToItems = [
      ...cmdMatches.filter(entry => GO_TO_COMMAND_IDS.has(entry.id)).map(entry => catalogOption(entry)),
      ...matchedModes.map(dest => modeOption(dest))
    ]
    if (actionItems.length > 0) {
      out.push({
        key: 'actions',
        groupLabel: actionsLabel,
        items: actionItems
      })
    }
    if (goToItems.length > 0) {
      out.push({
        key: 'goto',
        groupLabel: goToLabel,
        items: goToItems
      })
    }
    // A workspace is found by its name and by its folder; the full path is its tooltip.
    const wsMatches = workspaces
      .filter(ws => ws.name.toLowerCase().includes(q) || ws.rootPath.toLowerCase().includes(q))
      .slice()
      .sort((a, b) => workspaceTier(a.name, q) - workspaceTier(b.name, q))
    if (wsMatches.length > 0) {
      out.push({
        key: 'workspaces',
        groupLabel: t('commandBar.groups.workspaces'),
        items: wsMatches.map(ws => ({
          key: `ws-${ws.id}`,
          domId: nextDomId(),
          primary: goToWorkspace(ws).name,
          secondary: ws.rootPath,
          alsoText: t('commandBar.also', { button: 'OxeCode' }),
          shortcutText: null,
          title: ws.rootPath,
          parsed: { kind: 'open', query: ws.name }
        }))
      })
    }
    const skillMatches = skills.filter(s => s.name.toLowerCase().includes(q))
    if (skillMatches.length > 0) {
      out.push({
        key: 'skills',
        groupLabel: t('commandBar.groups.skills'),
        items: skillMatches.map(s => ({
          key: `skill-${s.name}`,
          domId: nextDomId(),
          primary: `/skill ${s.name}`,
          secondary: s.description,
          alsoText: t('commandBar.also', { button: t('commandBar.fallback.skill') }),
          shortcutText: null,
          parsed: { kind: 'skill', name: s.name, args: '' }
        }))
      })
    }
    const beside = besideThreads(q)
    if (beside.length > 0) {
      out.push({
        key: 'open-beside',
        groupLabel: openBesideLabel,
        items: beside
      })
    }
    // Panes and files the host offers, under their own headings.
    const placeGroups = new Map<string, BarOption[]>()
    for (const place of rankBy(places ?? [], q, item => rankText(item.primary, `${item.secondary ?? ''} ${item.words ?? ''}`, q))) {
      const list = placeGroups.get(place.group) ?? []
      if (list.length >= MAX_PER_PLACE_GROUP) continue
      list.push({
        key: `place-${place.key}`,
        domId: nextDomId(),
        primary: place.primary,
        secondary: place.secondary ?? '',
        alsoText: '',
        shortcutText: null,
        title: place.title,
        run: place.run
      })
      placeGroups.set(place.group, list)
    }
    for (const [group, items] of placeGroups) out.push({ key: `places-${group}`, groupLabel: group, items })
    return out
  }, [actions, baseId, context.threadId, disallowedCommand, open, places, recentIds, skills, startTrimmed, t, threads, trimmed, workspaces])

  const flatOptions = useMemo(() => groups.flatMap(g => g.items), [groups])
  const hasOptions = flatOptions.length > 0
  const clampedIndex = hasOptions ? Math.min(activeIndex, flatOptions.length - 1) : -1
  const activeOption = clampedIndex >= 0 ? flatOptions[clampedIndex] : undefined

  useEffect(() => {
    if (!open || !trimmed || disallowedCommand) {
      setAnnounced('')
      return
    }
    const timer = window.setTimeout(() => {
      setAnnounced(
        flatOptions.length > 0
          ? t('commandBar.resultCount', { count: flatOptions.length })
          : t('commandBar.noMatch', { query: trimmed })
      )
    }, 300)
    return () => window.clearTimeout(timer)
  }, [disallowedCommand, flatOptions.length, open, t, trimmed])

  const invokeIpc = async (ipc: string, args: unknown[]): Promise<void> => {
    const [ns, method] = ipc.split('.')
    const oxe = (window as unknown as { oxe?: Record<string, Record<string, (...a: unknown[]) => unknown>> }).oxe
    const fn = oxe?.[ns]?.[method]
    if (typeof fn === 'function') {
      await fn(...args)
    }
  }

  const executeParsed = async (parsed: ParsedCommandLine, skipStopConfirm = false): Promise<void> => {
    if (parsed.kind === 'agent' || parsed.kind === 'open') {
      const payload = parsed.kind === 'agent' ? parsed.text : parsed.query
      if (CONTROL_CHAR_RE.test(payload)) {
        const plan = commandRequest(parsed, context)
        if (!plan.ok) setRefusal({ code: plan.refusal.code, params: plan.refusal.params, parsed })
        return
      }
      onRun(parsed)
      onOpenChange(false)
      return
    }

    if (parsed.kind === 'skill' || parsed.kind === 'command') {
      setHint(null)
      const plan = commandRequest(parsed, context)
      if (!plan.ok) {
        setRefusal({ code: plan.refusal.code, params: plan.refusal.params, parsed })
        setConfirmingStop(false)
        return
      }
      if (parsed.kind === 'command') {
        // What these do is the window's (a pane in the layout, the conversation dialog, the theme): the request to
        // main alone left nothing on screen, or failed for want of what the window knows (BAR-1, BAR-2, BAR-3).
        if (WINDOW_COMMANDS.has(parsed.id)) { onRun(parsed); onOpenChange(false); return }
        if (parsed.id === 'pending') {
          // Nothing waiting is said, as /deny says it; something waiting opens the queue (BAR-5).
          if (!context.requests.some(request => request.workspaceId === context.workspaceId)) { setRefusal({ code: 'commandBar.request.none', params: {}, parsed }); return }
          onRun(parsed); onOpenChange(false); return
        }
        if (parsed.id === 'steer' && !parsed.args.trim()) { setHint(t('commandBar.hint.steerEmpty')); return }
        if (parsed.id === 'stop') {
          const status = useThreadStore.getState().snapshot?.thread.status
          if (status !== 'running' && status !== 'approval') { setConfirmingStop(false); setHint(t('commandBar.hint.noTurn')); return }
          if (!skipStopConfirm) { setConfirmingStop(true); return }
        }
      }
      try {
        await invokeIpc(plan.ipc, plan.args)
      } catch (cause) {
        // A request main refused left the bar open and silent (BAR-3, BAR-4).
        setConfirmingStop(false)
        setHint(t('commandBar.hint.failed', { reason: errorReason(cause) }))
        return
      }
      onOpenChange(false)
      return
    }

    if (parsed.kind === 'unknown' && CONTROL_CHAR_RE.test(parsed.text)) {
      const plan = commandRequest(parsed, context)
      if (!plan.ok) setRefusal({ code: plan.refusal.code, params: plan.refusal.params, parsed })
    }
  }

  /** A palette command, a pane or a file: it runs, and the bar closes. */
  const runOption = (option: BarOption & { run: () => void }): void => {
    option.run()
    onOpenChange(false)
  }

  const submitCurrent = (optionOverride?: BarOption): void => {
    if (disallowedCommand) return
    const chosen = optionOverride ?? activeOption

    if (optionOverride) {
      if (optionOverride.run) {
        runOption(optionOverride as BarOption & { run: () => void })
        return
      }
      if (optionOverride.fill) {
        setQuery(optionOverride.fill)
        setActiveIndex(0)
        setRefusal(null)
        setAnnounced('')
        inputRef.current?.focus({ preventScroll: true })
        return
      }
      if (optionOverride.parsed) {
        void executeParsed(optionOverride.parsed)
        return
      }
    }

    const rawParsed = parseCommandLine(query, skills.map(s => s.name))
    if ((rawParsed.kind === 'help' || (rawParsed.kind === 'unknown' && !CONTROL_CHAR_RE.test(query))) && chosen) {
      if (chosen.run) {
        runOption(chosen as BarOption & { run: () => void })
        return
      }
      if (chosen.fill) {
        setQuery(chosen.fill)
        setActiveIndex(0)
        setRefusal(null)
        setAnnounced('')
        return
      }
      if (chosen.parsed) {
        void executeParsed(chosen.parsed)
        return
      }
    }

    if (rawParsed.kind === 'open' && chosen?.parsed?.kind === 'open' && (!rawParsed.query || activeIndex > 0)) {
      void executeParsed(chosen.parsed)
      return
    }

    void executeParsed(rawParsed)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' && hasOptions) {
      event.preventDefault()
      setActiveIndex(index => (index + 1) % flatOptions.length)
      return
    }
    if (event.key === 'ArrowUp' && hasOptions) {
      event.preventDefault()
      setActiveIndex(index => (index - 1 + flatOptions.length) % flatOptions.length)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      submitCurrent()
    }
  }

  const renderRefusal = (): ReactElement | null => {
    if (hint) return <div className={styles.refusal} data-testid="command-bar-hint"><Notice intent="warning">{hint}</Notice></div>
    if (!refusal) return null
    if (refusal.code === 'commandBar.skill.notEnabled') {
      return (
        <div className={styles.noticeWrap}>
          <Notice intent="warning">{t('commandBar.refusal.skillNotEnabled', { name: String(refusal.params.name ?? '') })}</Notice>
        </div>
      )
    }
    if (refusal.code === 'commandBar.skill.noAgent') {
      return (
        <div className={styles.noticeWrap}>
          <Notice intent="warning">{t('commandBar.refusal.noAgent')}</Notice>
        </div>
      )
    }
    if (refusal.code === 'commandBar.args.control') {
      return (
        <div className={styles.noticeWrap}>
          <Notice intent="warning">{t('commandBar.refusal.controlChars')}</Notice>
        </div>
      )
    }
    if (refusal.code === 'commandBar.request.otherWorkspace') {
      const wantedId = refusal.parsed.kind === 'command' ? refusal.parsed.args.trim() : ''
      const foundReq = context.requests.find(r => r.requestId === wantedId)
      const ownerWs = workspaces.find(ws => ws.id === foundReq?.workspaceId)
      const workspaceName = ownerWs?.name ?? foundReq?.workspaceId ?? ''
      return (
        <div className={styles.noticeWrap}>
          <Notice
            intent="warning"
            actions={(
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setRefusal(null)
                  onRun({ kind: 'open', query: workspaceName })
                  onOpenChange(false)
                }}
              >
                {t('commandBar.refusal.openWorkspace', { workspace: workspaceName })}
              </Button>
            )}
          >
            {t('commandBar.refusal.otherWorkspace', { workspace: workspaceName })}
          </Notice>
        </div>
      )
    }
    return (
      <div className={styles.noticeWrap}>
        <Notice intent="warning">{t('commandBar.refusal.requestNone')}</Notice>
      </div>
    )
  }

  if (!open) return null

  const showListbox = hasOptions || refusal !== null || hint !== null || confirmingStop
  let runningIndex = -1

  return createPortal(
    <div
      className={styles.scrim}
      onMouseDown={event => {
        if (event.target === event.currentTarget) onOpenChange(false)
      }}
    >
      <div
        ref={modal.ref}
        tabIndex={modal.tabIndex}
        role="dialog"
        aria-modal="true"
        aria-label={t('commandBar.dialogLabel')}
        className={styles.surface}
        data-ui="command-bar"
      >
        <div className={styles.inputRow}>
          <Search size={15} aria-hidden="true" className={styles.inputIcon} />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label={t('commandBar.inputLabel')}
            aria-autocomplete="list"
            aria-expanded={hasOptions ? 'true' : 'false'}
            aria-controls={showListbox ? listboxId : undefined}
            {...(activeOption ? { 'aria-activedescendant': activeOption.domId } : {})}
            className={styles.combobox}
            placeholder={placeholder ?? t('commandBar.trigger')}
            value={query}
            onChange={event => {
              setQuery(event.target.value)
              setActiveIndex(0)
              setRefusal(null)
              setConfirmingStop(false)
              setAnnounced('')
            }}
            onKeyDown={handleKeyDown}
          />
          <span className={styles.inputEsc} aria-hidden="true">
            <Kbd>{t('commandBar.keys.escape')}</Kbd>
          </span>
        </div>

        {!trimmed && !refusal && (
          <p className={styles.hintsLine} data-ui="command-hints">{t('commandBar.hintsLine')}</p>
        )}

        {trimmed === '?' && (
          <div className={styles.examples} data-ui="command-examples">
            {EXAMPLE_KINDS.map(kind => (
              <span key={kind} className={styles.example}>
                <code className={styles.hintExample}>{t(`commandBar.examples.${kind}`)}</code>
                <span className={styles.hintText}>{t(`commandBar.hints.${kind}`)}</span>
              </span>
            ))}
          </div>
        )}

        {disallowedCommand && (
          <p className={styles.emptyRow}>{t('commandBar.noCommand', { command: disallowedCommand })}</p>
        )}

        {showListbox && (
          <div id={listboxId} role="listbox" aria-label={t('commandBar.dialogLabel')} className={styles.listbox}>
            {renderRefusal()}
            {confirmingStop && (
              <div className={styles.noticeWrap}>
                <Notice
                  intent="warning"
                  actions={(
                    <>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmingStop(false)}>
                        {t('commandBar.confirmStop.cancel')}
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => void executeParsed({ kind: 'command', id: 'stop', args: '' }, true)}
                      >
                        {t('commandBar.confirmStop.stop')}
                      </Button>
                    </>
                  )}
                >
                  {t('commandBar.confirmStop.message')}
                </Notice>
              </div>
            )}
            {groups.map(group => (
              <div key={group.key} role="group" aria-label={group.groupLabel} className={styles.group}>
                <div className={styles.groupHeading} aria-hidden="true">{group.groupLabel}</div>
                {group.items.map(item => {
                  runningIndex += 1
                  const index = runningIndex
                  const selected = index === clampedIndex
                  return (
                    <div
                      key={item.key}
                      id={item.domId}
                      role="option"
                      tabIndex={-1}
                      aria-selected={selected}
                      data-ui="command-row"
                      title={item.title}
                      className={styles.option}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => submitCurrent(item)}
                    >
                      <div className={styles.optionMain}>
                        <span className={styles.optionPrimary} data-part="title">{item.primary}</span>
                        {item.secondary ? <span className={styles.optionSecondary}>{item.secondary}</span> : null}
                      </div>
                      <div className={styles.optionMeta}>
                        {item.alsoText ? <span className={styles.also}>{item.alsoText}</span> : null}
                        {item.chord ? <KeyChord chord={item.chord} /> : item.shortcutText ? <Kbd>{item.shortcutText}</Kbd> : null}
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        )}

        <div className={styles.footer}>
          <div className={styles.footerHints} aria-hidden="true">
            <span className={styles.footerHint}><Kbd>↑↓</Kbd> {t('commandBar.footer.navigate')}</span>
            <span className={styles.footerHint}><Kbd>↵</Kbd> {t('commandBar.footer.run')}</span>
            <span className={styles.footerHint}><Kbd>{t('commandBar.keys.escape')}</Kbd> {t('commandBar.footer.close')}</span>
          </div>
          <div className={styles.footerStatus} aria-live="polite">
            {announced && <span>{announced}</span>}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
