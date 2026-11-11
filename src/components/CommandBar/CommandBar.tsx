import { Search } from 'lucide-react'
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
import { formatChord } from '../../keyboard/chords'
import { useSkillStore } from '../../store/skill.store'
import { useThreadStore } from '../../store/thread.store'
import { useWorkspaceStore } from '../../store/workspace.store'
import { Button } from '../../ui/Button'
import { Notice } from '../../ui/Display'
import { Kbd } from '../../ui/Field'
import { useModalSurface } from '../../ui/useModalSurface'
import styles from './CommandBar.module.css'

export interface CommandBarProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  context: CommandContext
  onRun: (parsed: ParsedCommandLine) => void
}

interface BarOption {
  key: string
  domId: string
  primary: string
  secondary: string
  alsoText: string
  shortcutText: string | null
  fill?: string
  parsed?: ParsedCommandLine
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
const GO_TO_COMMAND_IDS = new Set<string>(['pending', 'history'])
const HINT_FILL: Record<'agent' | 'skill' | 'open' | 'help', string> = {
  agent: '@Codex ',
  skill: '/skill ',
  open: 'open ',
  help: '?'
}

function workspaceTier(name: string, q: string): number {
  const lower = name.toLowerCase()
  if (!q) return 0
  if (lower === q) return 0
  if (lower.startsWith(q)) return 1
  return 2
}

export function CommandBar({ open, onOpenChange, context, onRun }: CommandBarProps): ReactElement | null {
  const { t, i18n } = useTranslation()
  const isPt = Boolean(i18n.language?.toLowerCase().startsWith('pt'))
  const baseId = useId()
  const listboxId = `${baseId}-listbox`
  const inputRef = useRef<HTMLInputElement | null>(null)
  const skills = useSkillStore(state => state.skills)
  const workspaces = useWorkspaceStore(state => state.workspaces)
  const threads = useThreadStore(state => state.threads)

  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [refusal, setRefusal] = useState<ActiveRefusal | null>(null)
  const [confirmingStop, setConfirmingStop] = useState(false)
  const [announced, setAnnounced] = useState('')

  const modal = useModalSurface<HTMLDivElement>(() => onOpenChange(false), open)

  useLayoutEffect(() => {
    if (!open) return
    setQuery('')
    setActiveIndex(0)
    setRefusal(null)
    setConfirmingStop(false)
    setAnnounced('')
    inputRef.current?.focus({ preventScroll: true })
  }, [open])

  useEffect(() => {
    if (open) inputRef.current?.focus({ preventScroll: true })
  }, [open])

  const startTrimmed = query.replace(/^[ \t]+/, '')
  const trimmed = startTrimmed.trim()
  const disallowedMatch = DISALLOWED_RE.exec(startTrimmed)
  const disallowedCommand = disallowedMatch ? `/${disallowedMatch[1].toLowerCase()}` : null

  const groups = useMemo<BarGroup[]>(() => {
    if (!open || !trimmed || disallowedCommand) return []
    let seq = 0
    const nextDomId = () => `${baseId}-opt-${seq++}`

    const actionsLabel = isPt ? 'Ações' : 'Actions'
    const goToLabel = t('commands.category.goTo', { defaultValue: isPt ? 'Ir para' : 'Go to' })
    const openBesideLabel = isPt ? 'Abrir ao lado' : 'Open beside'

    const modeDestinations = [
      {
        id: 'oxecode',
        label: 'OxeCode',
        match: 'oxecode',
        secondary: isPt ? 'Workspaces, terminais e alterações' : 'Workspaces, terminals and changes',
        also: 'OxeCode',
        shortcut: formatChord('Mod+1')
      },
      {
        id: 'oxechat',
        label: 'OxeChat',
        match: 'oxechat',
        secondary: isPt ? 'Conversas e tarefas delegadas' : 'Conversations and delegated work',
        also: 'OxeChat',
        shortcut: formatChord('Mod+2')
      },
      {
        id: 'oxequery',
        label: 'OxeQuery',
        match: 'oxequery',
        secondary: isPt ? 'Bancos de dados, SQL e MongoDB' : 'Databases, SQL and MongoDB',
        also: 'OxeQuery',
        shortcut: formatChord('Mod+3')
      },
      {
        id: 'settings',
        label: isPt ? 'Configurações' : 'Settings',
        match: isPt ? 'settings configurações' : 'settings',
        secondary: isPt ? 'Preferências do aplicativo e do workspace' : 'Application and workspace preferences',
        also: isPt ? 'Configurações' : 'Settings',
        shortcut: formatChord('Mod+,')
      },
      {
        id: 'approvals',
        label: isPt ? 'Aprovações' : 'Approvals',
        match: isPt ? 'approvals aprovações' : 'approvals',
        secondary: isPt ? 'Pedidos aguardando sua decisão' : 'Requests waiting for your decision',
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
        secondary: isPt ? 'Conversa no OxeChat' : 'OxeChat conversation',
        alsoText: t('commandBar.also', { button: 'OxeChat' }),
        shortcutText: formatChord('Mod+Enter'),
        parsed: { kind: 'open', query: `beside:${th.id}` }
      }))
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
      const providers = (['claude', 'codex'] as const).filter(p => !prefix || p.startsWith(prefix))
      if (!providers.length) return []
      return [{
        key: 'agents',
        groupLabel: t('commandBar.groups.agents'),
        items: providers.map(provider => {
          const agentName = provider === 'claude' ? 'Claude' : 'Codex'
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
    const cmdMatches = COMMAND_CATALOG.filter(entry => entry.id.includes(q))
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
    const wsMatches = workspaces
      .filter(ws => ws.name.toLowerCase().includes(q))
      .slice()
      .sort((a, b) => workspaceTier(a.name, q) - workspaceTier(b.name, q))
    if (wsMatches.length > 0) {
      out.push({
        key: 'workspaces',
        groupLabel: t('commandBar.groups.workspaces'),
        items: wsMatches.map(ws => ({
          key: `ws-${ws.id}`,
          domId: nextDomId(),
          primary: ws.name,
          secondary: ws.rootPath,
          alsoText: t('commandBar.also', { button: 'OxeCode' }),
          shortcutText: null,
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
    return out
  }, [baseId, context.threadId, disallowedCommand, isPt, open, skills, startTrimmed, t, threads, trimmed, workspaces])

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
      const plan = commandRequest(parsed, context)
      if (!plan.ok) {
        setRefusal({ code: plan.refusal.code, params: plan.refusal.params, parsed })
        setConfirmingStop(false)
        return
      }
      if (parsed.kind === 'command' && parsed.id === 'stop' && !skipStopConfirm) {
        setConfirmingStop(true)
        return
      }
      await invokeIpc(plan.ipc, plan.args)
      onOpenChange(false)
      return
    }

    if (parsed.kind === 'unknown' && CONTROL_CHAR_RE.test(parsed.text)) {
      const plan = commandRequest(parsed, context)
      if (!plan.ok) setRefusal({ code: plan.refusal.code, params: plan.refusal.params, parsed })
    }
  }

  const submitCurrent = (optionOverride?: BarOption): void => {
    if (disallowedCommand) return
    const chosen = optionOverride ?? activeOption

    if (optionOverride) {
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

  const showListbox = hasOptions || refusal !== null || confirmingStop
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
            placeholder={t('commandBar.trigger')}
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
            <Kbd>Esc</Kbd>
          </span>
        </div>

        {!trimmed && !refusal && (
          <div className={styles.emptyBody}>
            <div className={styles.hints}>
              {(['agent', 'skill', 'open', 'help'] as const).map(kind => (
                <div
                  key={kind}
                  className={styles.hintCard}
                  onClick={() => {
                    setQuery(HINT_FILL[kind])
                    setActiveIndex(0)
                    setRefusal(null)
                    setAnnounced('')
                    inputRef.current?.focus({ preventScroll: true })
                  }}
                >
                  <code className={styles.hintExample}>{t(`commandBar.examples.${kind}`)}</code>
                  <span className={styles.hintText}>{t(`commandBar.hints.${kind}`)}</span>
                </div>
              ))}
            </div>
            <div className={styles.defaultSections}>
              <div className={styles.group}>
                <div className={styles.groupHeading}>{isPt ? 'Ações' : 'Actions'}</div>
                {COMMAND_CATALOG.filter((entry): entry is typeof entry & { id: Exclude<typeof entry.id, 'skill'> } => !GO_TO_COMMAND_IDS.has(entry.id) && entry.id !== 'skill').slice(0, 4).map(entry => (
                  <Button
                    key={entry.id}
                    variant="ghost"
                    className={styles.defaultRow}
                    onClick={() => void executeParsed({ kind: 'command', id: entry.id, args: '' })}
                  >
                    <span className={styles.optionMain}>
                      <span className={styles.optionPrimary}>/{entry.id}</span>
                      <span className={styles.optionSecondary}>{t(`commandBar.catalog.${entry.id}`)}</span>
                    </span>
                    <span className={styles.optionMeta}>
                      {entry.shortcut ? <Kbd>{formatChord(entry.shortcut)}</Kbd> : null}
                    </span>
                  </Button>
                ))}
              </div>
              <div className={styles.group}>
                <div className={styles.groupHeading}>{t('commands.category.goTo', { defaultValue: isPt ? 'Ir para' : 'Go to' })}</div>
                {[
                  { id: 'oxecode', label: 'OxeCode', desc: isPt ? 'Workspaces, terminais e alterações' : 'Workspaces, terminals and changes', chord: 'Mod+1' },
                  { id: 'oxechat', label: 'OxeChat', desc: isPt ? 'Conversas e tarefas delegadas' : 'Conversations and delegated work', chord: 'Mod+2' },
                  { id: 'oxequery', label: 'OxeQuery', desc: isPt ? 'Bancos de dados, SQL e MongoDB' : 'Databases, SQL and MongoDB', chord: 'Mod+3' },
                  { id: 'settings', label: isPt ? 'Configurações' : 'Settings', desc: isPt ? 'Preferências do aplicativo e do workspace' : 'Application and workspace preferences', chord: 'Mod+,' }
                ].map(dest => (
                  <Button
                    key={dest.id}
                    variant="ghost"
                    className={styles.defaultRow}
                    onClick={() => void executeParsed({ kind: 'open', query: dest.id })}
                  >
                    <span className={styles.optionMain}>
                      <span className={styles.optionPrimary}>{dest.label}</span>
                      <span className={styles.optionSecondary}>{dest.desc}</span>
                    </span>
                    <span className={styles.optionMeta}>
                      <Kbd>{formatChord(dest.chord)}</Kbd>
                    </span>
                  </Button>
                ))}
              </div>
            </div>
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
                      className={styles.option}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => submitCurrent(item)}
                    >
                      <div className={styles.optionMain}>
                        <span className={styles.optionPrimary}>{item.primary}</span>
                        <span className={styles.optionSecondary}>{item.secondary}</span>
                      </div>
                      <div className={styles.optionMeta}>
                        <span className={styles.also}>{item.alsoText}</span>
                        {item.shortcutText && <Kbd>{item.shortcutText}</Kbd>}
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
            <span className={styles.footerHint}><Kbd>↑↓</Kbd> {isPt ? 'navegar' : 'navigate'}</span>
            <span className={styles.footerHint}><Kbd>↵</Kbd> {isPt ? 'executar' : 'run'}</span>
            <span className={styles.footerHint}><Kbd>Esc</Kbd> {isPt ? 'fechar' : 'close'}</span>
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
