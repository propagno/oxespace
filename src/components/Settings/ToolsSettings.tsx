import { useEffect, useState, type ReactElement } from 'react'
import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { PolicyView } from '../../../shared/policy'
import {
  MCP_TOOL_GROUP_MODES, type ConfigurableMcpToolGroup, type McpToolCost, type McpToolDecision, type McpToolGroupInfo,
  type McpToolGroupMode, type McpToolGroupsReport, type McpToolRule
} from '../../../shared/types/mcp-tools'
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, LoadingState, Panel, SegmentedControl, Select, type Intent } from '../../ui'
import { formatNumber } from '../../utils/formatTime'
import { humanizeError } from '../../utils/humanizeError'
import { claudeFixedCost, decisionsFor, organizationToolRules, OXESPACE_SERVER, otherServerRules, ruleFor } from './toolsModel'
import styles from './ToolsSettings.module.css'

/** File, key and product names: the same in every language. */
const OXE_YAML = 'oxe.yaml', THREAD_TOOLS_KEY = 'thread.tools', CLAUDE = 'Claude', CODEX = 'Codex'
const MODE_INTENT: Record<McpToolGroupMode, Intent> = { always: 'success', 'on-demand': 'info', off: 'neutral' }

type T = TFunction<'settings'>
const groupName = (t: T, id: string): string => t(`tools.groups.${id}.name`, { defaultValue: id })
const modeName = (t: T, mode: McpToolGroupMode): string => t(`tools.modes.${mode}`)
const decisionName = (t: T, decision: McpToolDecision): string => t(`tools.rules.decisions.${decision}`)
const costText = (t: T, value: McpToolCost): string => t('tools.cost.value', { tokens: formatNumber(value.tokens), chars: formatNumber(value.chars) })

/** One tool's rule: allow, ask or block, with where it holds or why it cannot change. */
function RuleRow({ rule, busy, onChoose }: { rule: McpToolRule; busy: boolean; onChoose: (rule: McpToolRule, decision: McpToolDecision) => void }): ReactElement {
  const { t } = useTranslation('settings')
  const choices = decisionsFor(rule)
  const note = rule.source === 'user' || rule.source === 'managed' ? t(`tools.rules.source.${rule.source}`)
    : !choices.includes('allow') ? t('tools.rules.confirmLevel')
      : rule.scope ? t(`tools.rules.scope.${rule.scope}`) : ''
  return <li className={styles.rule}>
    <code className={styles.toolName}>{rule.server === OXESPACE_SERVER ? rule.tool : `${rule.server} · ${rule.tool}`}</code>
    <Select className={styles.ruleSelect} aria-label={t('tools.rules.label', { tool: rule.tool })} value={rule.decision} disabled={busy || !rule.editable}
      options={choices.map(decision => ({ value: decision, label: decisionName(t, decision) }))}
      onChange={event => onChoose(rule, event.target.value as McpToolDecision)} />
    {note && <span className={styles.ruleNote}>{note}</span>}
  </li>
}

/** One group: what it does, its mode and where the mode comes from, its cost per provider, and its tools' rules. */
function GroupPanel({ group, rules, busy, onMode, onRule }: {
  group: McpToolGroupInfo; rules: McpToolRule[] | null; busy: boolean
  onMode: (group: ConfigurableMcpToolGroup, mode: McpToolGroupMode) => void
  onRule: (rule: McpToolRule, decision: McpToolDecision) => void
}): ReactElement {
  const { t } = useTranslation('settings')
  const name = groupName(t, group.id)
  const fixed = claudeFixedCost(group)
  const groupRules = rules ? group.tools.map(tool => ruleFor(rules, OXESPACE_SERVER, tool)) : []
  const ruled = groupRules.filter(rule => rule.decision !== 'ask').length
  const off = group.mode === 'off'
  return <Panel className={styles.group} label={name} title={name} actions={<>
    <Badge intent={MODE_INTENT[group.mode]}>{modeName(t, group.mode)}</Badge>
    <Badge title={t(`tools.sourceHint.${group.source}`)}>{t(`tools.source.${group.source}`)}</Badge>
  </>}>
    <p className={styles.description}>{t(`tools.groups.${group.id}.description`, { defaultValue: '' })} {t('tools.toolCount', { count: group.tools.length })}</p>
    <dl className={styles.costs} aria-label={t('tools.cost.label', { group: name })}>
      <div><dt>{t('tools.cost.claudeFixed')}</dt><dd>{fixed ? costText(t, fixed) : t('tools.cost.notOffered')}</dd></div>
      <div><dt>{t('tools.cost.claudeLoaded')}</dt><dd>{off ? t('tools.cost.notOffered') : costText(t, group.cost.claude.loaded)}</dd></div>
      <div><dt>{t('tools.cost.codex')}</dt><dd>{off ? t('tools.cost.notOffered') : t('tools.cost.codexValue', { cost: costText(t, group.cost.codex.loaded) })}</dd></div>
    </dl>
    {group.configurable && <div className={styles.mode}>
      <SegmentedControl label={t('tools.modeLabel', { group: name })} value={group.mode}
        options={MCP_TOOL_GROUP_MODES.map(mode => ({ value: mode, label: modeName(t, mode) }))}
        onChange={mode => onMode(group.id as ConfigurableMcpToolGroup, mode)} disabled={busy} />
      <p className={styles.hint}>{t(`tools.modeHints.${group.mode}`)}</p>
    </div>}
    {rules && <details className={styles.rules}>
      <summary>{t('tools.rules.summary', { count: ruled })}</summary>
      <ul aria-label={t('tools.rules.listLabel', { group: name })}>{groupRules.map(rule => <RuleRow key={rule.tool} rule={rule} busy={busy} onChoose={onRule} />)}</ul>
    </details>}
  </Panel>
}

/**
 * Settings › Tools (F10, B7.3) for one project: the groups of OXESpace MCP tools, each group's mode in the project's
 * oxe.yaml, what each costs per provider, and per-tool rules. Modes and rules are the person's choices, made only
 * here (never by an MCP tool); the organization's policy is shown read only.
 */
export function ToolsSettings({ rootPath, workspaceId }: { rootPath: string; workspaceId?: string }): ReactElement {
  const { t } = useTranslation('settings')
  const [report, setReport] = useState<McpToolGroupsReport | null>(null)
  const [groupsError, setGroupsError] = useState('')
  const [rules, setRules] = useState<McpToolRule[] | null>(null)
  const [rulesError, setRulesError] = useState('')
  const [policy, setPolicy] = useState<PolicyView | null>(null)
  const [policyError, setPolicyError] = useState('')
  const [reloads, setReloads] = useState(0)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [actionError, setActionError] = useState<{ title: string; message: string } | null>(null)
  const [confirmAllow, setConfirmAllow] = useState<McpToolRule | null>(null)

  // The page mounts per workspace (WorkspaceSettingsModal is keyed by it); Reload clears what was read, then reads again.
  useEffect(() => {
    let live = true
    const api = window.oxe?.mcpInternal
    api?.toolGroups?.({ rootPath }).then(next => { if (live) setReport(next) }, (cause: unknown) => { if (live) setGroupsError(humanizeError(cause)) })
    api?.toolRules?.({ rootPath }).then(next => { if (live) setRules(next) }, (cause: unknown) => { if (live) setRulesError(humanizeError(cause)) })
    window.oxe?.policy?.get(workspaceId).then(next => { if (live) setPolicy(next) }, (cause: unknown) => { if (live) setPolicyError(humanizeError(cause)) })
    return () => { live = false }
  }, [rootPath, workspaceId, reloads])
  const reload = (): void => {
    setReport(null); setGroupsError(''); setRules(null); setRulesError(''); setPolicy(null); setPolicyError(''); setStatus(''); setActionError(null)
    setReloads(count => count + 1)
  }
  const missing = t('tools.unavailable')
  const groupsProblem = window.oxe?.mcpInternal?.toolGroups ? groupsError : missing
  const rulesProblem = window.oxe?.mcpInternal?.toolRules ? rulesError : missing

  const setMode = async (group: ConfigurableMcpToolGroup, mode: McpToolGroupMode): Promise<void> => {
    const api = window.oxe.mcpInternal
    if (busy || !api.setToolGroupMode || report?.groups.find(item => item.id === group)?.mode === mode) return
    setBusy(true); setActionError(null); setStatus('')
    try {
      setReport(await api.setToolGroupMode({ rootPath, group, mode }))
      setStatus(t('tools.modeSaved', { group: groupName(t, group), mode: modeName(t, mode) }))
    } catch (cause) { setActionError({ title: t('tools.modeFailed'), message: humanizeError(cause) }) }
    finally { setBusy(false) }
  }

  const applyRule = async (rule: McpToolRule, decision: McpToolDecision): Promise<void> => {
    const api = window.oxe.mcpInternal
    if (busy || !api.setToolRule || rule.decision === decision) return
    setBusy(true); setActionError(null); setStatus('')
    try {
      setRules(await api.setToolRule({ rootPath, server: rule.server, tool: rule.tool, decision }))
      setStatus(t('tools.rules.saved', { tool: rule.tool, decision: decisionName(t, decision) }))
    } catch (cause) { setActionError({ title: t('tools.rules.failed'), message: humanizeError(cause) }) }
    finally { setBusy(false) }
  }
  // Running without asking widens what agents do unattended, so it is confirmed first; asking and blocking are not.
  const chooseRule = (rule: McpToolRule, decision: McpToolDecision): void => {
    if (decision === 'allow') setConfirmAllow(rule)
    else void applyRule(rule, decision)
  }
  const onMode = (group: ConfigurableMcpToolGroup, mode: McpToolGroupMode): void => { void setMode(group, mode) }

  const chosen = report?.groups.filter(group => group.configurable || group.id === 'core') ?? []
  const byRole = report?.groups.filter(group => !group.configurable && group.id !== 'core') ?? []
  const others = rules ? otherServerRules(rules) : []
  const organization = organizationToolRules(policy)

  // The page heading ("Tools") comes from the workspace settings around it.
  return <section className={styles.page} data-testid="tools-settings" aria-label={t('tools.title')}>
    <div className={styles.header}>
      <p className={styles.intro}>{t('tools.intro')} <code title={rootPath}>{OXE_YAML}</code> · <code>{THREAD_TOOLS_KEY}</code></p>
      <Button variant="ghost" size="sm" disabled={busy} onClick={reload}><RefreshCw size={14} aria-hidden="true" /> {t('tools.reload')}</Button>
    </div>
    <div className={styles.providers} role="note" aria-label={t('tools.providers.title')}>
      <p><strong>{CLAUDE}</strong> {t('tools.providers.claude')}</p>
      <p data-testid="tools-codex-note"><strong>{CODEX}</strong> {t('tools.providers.codex')}</p>
    </div>
    {status && <p className={styles.status} role="status">{status}</p>}
    {actionError && <ErrorState compact title={actionError.title} message={actionError.message} />}
    {groupsProblem ? <ErrorState title={t('tools.loadFailed')} message={groupsProblem} onRetry={reload} />
      : !report ? <LoadingState label={t('tools.loading')} />
        : <>
          <dl className={styles.totals} aria-label={t('tools.totals.title')}>
            <div><dt>{t('tools.totals.plain')}</dt><dd>{costText(t, report.totals.plainConversation)}</dd></div>
            <div><dt>{t('tools.totals.everything')}</dt><dd>{costText(t, report.totals.everythingOnDemand)}</dd></div>
          </dl>
          <p className={styles.hint}>{t('tools.totals.estimate')}</p>
          {rulesProblem && <ErrorState compact title={t('tools.rules.loadFailed')} message={rulesProblem} />}
          <h4 className={styles.sectionTitle}>{t('tools.sections.project')}</h4>
          <p className={styles.hint}>{t('tools.rules.intro')}</p>
          <div className={styles.groups}>{chosen.map(group => <GroupPanel key={group.id} group={group} rules={rules} busy={busy} onMode={onMode} onRule={chooseRule} />)}</div>
          <h4 className={styles.sectionTitle}>{t('tools.sections.role')}</h4>
          <p className={styles.hint}>{t('tools.sections.roleIntro')}</p>
          <div className={styles.groups}>{byRole.map(group => <GroupPanel key={group.id} group={group} rules={rules} busy={busy} onMode={onMode} onRule={chooseRule} />)}</div>
        </>}
    {rules && <Panel className={styles.group} label={t('tools.rules.otherTitle')} title={t('tools.rules.otherTitle')}>
      {others.length ? <ul aria-label={t('tools.rules.otherTitle')} className={styles.list}>{others.map(rule => <RuleRow key={`${rule.server}/${rule.tool}`} rule={rule} busy={busy} onChoose={chooseRule} />)}</ul>
        : <EmptyState compact title={t('tools.rules.otherEmpty')} />}
    </Panel>}
    <Panel className={styles.group} label={t('tools.policy.title')} title={t('tools.policy.title')}>
      <p className={styles.hint}>{t('tools.policy.intro')}</p>
      {policyError ? <ErrorState compact title={t('tools.policy.loadFailed')} message={policyError} />
        : organization.length ? <ul className={styles.list} aria-label={t('tools.policy.title')}>
          {organization.map(({ source, rule }, index) => <li key={`${source.path}-${index}`} className={styles.policyRule}>
            <Badge intent={rule.effect === 'deny' ? 'warning' : 'success'}>{t(`tools.policy.effect.${rule.effect}`)}</Badge>
            <code className={styles.toolName}>{rule.resource}</code>
            <span className={styles.ruleNote} title={source.path}>{t(`tools.policy.layer.${source.layer}`)}{source.organization ? ` · ${source.organization}` : ''}</span>
          </li>)}
        </ul>
          : policy ? <EmptyState compact title={t('tools.policy.empty')} /> : null}
    </Panel>
    {confirmAllow && <ConfirmDialog danger title={t('tools.rules.confirmAllow.title', { tool: confirmAllow.tool })}
      description={t('tools.rules.confirmAllow.description', { tool: confirmAllow.tool })} confirmLabel={t('tools.rules.confirmAllow.confirm')}
      onCancel={() => setConfirmAllow(null)} onConfirm={() => { const rule = confirmAllow; setConfirmAllow(null); void applyRule(rule, 'allow') }} />}
  </section>
}
