import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge, Button, copyText, TextArea, TextField, toast } from '../../ui'
import { Skeleton } from '../../ui/Display'
import { Checkbox } from '../../ui/Field'
import type { PullRequestInfo, PullRequestState } from '../../../shared/types/pull-request'
import {
  appendOnce, checkStateKey, checkTally, INSTALL_URL, LOGIN_COMMAND, prNumberLabel, prStateKey, splitDuration, summaryLines, VOTE_KEY, workItemLabel,
  type AgentSummary, type PrProvider, type SummaryLine
} from './pullRequestModel'
import './PullRequestTab.css'

interface PullRequestBridge {
  pullRequest?: { state?: (input: { rootPath: string; branch: string }) => Promise<PullRequestState> }
  github?: { createPullRequest?: (input: Record<string, unknown>) => Promise<unknown> }
  thread?: { agentSummary?: (threadId: string) => Promise<AgentSummary | null | undefined> }
  app?: { openExternal?: (url: string) => Promise<unknown> }
}
const bridge = (): PullRequestBridge | undefined => (window as unknown as { oxe?: PullRequestBridge }).oxe

type Load<T> = { status: 'loading' } | { status: 'ready'; value: T } | { status: 'failed' }

function openExternal(url: string): void {
  void bridge()?.app?.openExternal?.(url)
}

/**
 * The conversation's Pull request tab (DESIGN U4.6): main's values, worded per provider. Without a pull request it
 * opens one from a form; with one it offers Address review comments. Merge and Complete stay on the provider's site.
 */
export function PullRequestTab(props: { threadId: string; rootPath: string; branch: string; onSendToConversation?: (text: string) => void }): ReactElement {
  const { threadId, rootPath, branch, onSendToConversation } = props
  const { t } = useTranslation('thread')
  const [pr, setPr] = useState<Load<PullRequestState>>({ status: 'loading' })
  const [summary, setSummary] = useState<Load<AgentSummary | null>>({ status: 'loading' })
  const [description, setDescription] = useState('')
  const [reload, setReload] = useState(0)
  useEffect(() => { void window.oxe?.featureUsage?.record?.('prSummary') }, [])

  useEffect(() => {
    let alive = true
    const api = bridge()
    setPr({ status: 'loading' })
    if (!api?.pullRequest?.state) setPr({ status: 'failed' })
    else void api.pullRequest.state({ rootPath, branch }).then(value => { if (alive) setPr({ status: 'ready', value }) }, () => { if (alive) setPr({ status: 'failed' }) })
    return () => { alive = false }
  }, [rootPath, branch, reload])

  useEffect(() => {
    let alive = true
    const api = bridge()
    setSummary({ status: 'loading' })
    if (!api?.thread?.agentSummary) setSummary({ status: 'failed' })
    else void api.thread.agentSummary(threadId).then(value => { if (alive) setSummary({ status: 'ready', value: value ?? null }) }, () => { if (alive) setSummary({ status: 'failed' }) })
    return () => { alive = false }
  }, [threadId])

  const lineText = (line: SummaryLine): string => t(`prTab.summary.${line.key}`, { count: line.count, production: line.production })
  const lines = summary.status === 'ready' ? summaryLines(summary.value) : []
  const unread = summary.status === 'failed' || (summary.status === 'ready' && (summary.value?.failedSources.length ?? 0) > 0)
  const block = lines.length ? [`### ${t('prTab.summary.title')}`, ...lines.map(line => `- ${lineText(line)}`)].join('\n') : ''

  const addToDescription = (): void => {
    const previous = description
    const next = appendOnce(previous, block)
    if (next === previous) return
    setDescription(next)
    toast({ title: t('prTab.summary.added'), intent: 'success', action: { label: t('prTab.summary.undo'), run: () => setDescription(current => current === next ? previous : current) } })
  }

  return (
    <div className="pr-tab">
      <PullRequestBody load={pr} rootPath={rootPath} branch={branch} description={description} onOpened={() => setReload(value => value + 1)} onSend={onSendToConversation} />
      <section className="pr-tab-section">
        <h3 className="pr-tab-heading">{t('prTab.summary.title')}</h3>
        {summary.status === 'loading' && <Skeleton lines={2} decorative />}
        {summary.status === 'ready' && !lines.length && !unread && <p className="pr-tab-muted">{t('prTab.summary.empty')}</p>}
        {lines.length > 0 && <ul className="pr-tab-list">{lines.map(line => <li key={line.key}>{lineText(line)}</li>)}</ul>}
        {unread && <p className="pr-tab-muted">{t('prTab.summary.failed')}</p>}
        {lines.length > 0 && <div className="pr-tab-actions"><Button size="sm" onClick={addToDescription}>{t('prTab.summary.add')}</Button></div>}
      </section>
      <section className="pr-tab-section">
        <TextArea label={t('prTab.description')} value={description} rows={6} onChange={event => setDescription(event.target.value)} />
      </section>
    </div>
  )
}

function PullRequestBody({ load, rootPath, branch, description, onOpened, onSend }: {
  load: Load<PullRequestState>; rootPath: string; branch: string; description: string; onOpened: () => void; onSend?: (text: string) => void
}): ReactElement {
  const { t } = useTranslation('thread')
  if (load.status === 'loading') return <section className="pr-tab-section"><Skeleton lines={3} label={t('prTab.loading')} /></section>
  if (load.status === 'failed') return <p className="pr-tab-muted">{t('prTab.failed')}</p>
  const { provider, cli, pr } = load.value
  if (provider === 'none') return <p className="pr-tab-note">{t('prTab.unsupported')}</p>
  if (cli === 'missing') return <div className="pr-tab-section"><p className="pr-tab-note">{t(`prTab.missing.${provider}`)}</p>
    <div className="pr-tab-actions"><Button size="sm" onClick={() => openExternal(INSTALL_URL[provider])}>{t('prTab.howToInstall')}</Button></div></div>
  if (cli === 'signed-out') return <div className="pr-tab-section"><p className="pr-tab-note">{t(`prTab.signedOut.${provider}`)}</p>
    <div className="pr-tab-actions"><code className="pr-tab-command">{LOGIN_COMMAND[provider]}</code>
      <Button size="sm" onClick={() => void copyText(LOGIN_COMMAND[provider], t('prTab.command'))}>{t('prTab.copyCommand')}</Button></div></div>
  if (!pr) return <section className="pr-tab-section"><p className="pr-tab-note">{t('prTab.none')}</p>
    <PullRequestForm rootPath={rootPath} branch={branch} description={description} onOpened={onOpened} /></section>
  return <PullRequestCard provider={provider} pr={pr} onSend={onSend} />
}

/** CR-F4-D7: opens a pull request from this branch; From is the branch, read only; the description comes from below. */
function PullRequestForm({ rootPath, branch, description, onOpened }: { rootPath: string; branch: string; description: string; onOpened: () => void }): ReactElement {
  const { t } = useTranslation('thread')
  const [title, setTitle] = useState('')
  const [base, setBase] = useState('main')
  const [draft, setDraft] = useState(false)
  const [busy, setBusy] = useState(false)
  const ready = Boolean(title.trim() && base.trim())
  const submit = async (): Promise<void> => {
    const create = bridge()?.github?.createPullRequest
    if (!create || !ready) return
    setBusy(true)
    try {
      await create({ rootPath, title: title.trim(), body: description, base: base.trim(), head: branch, draft })
      toast({ title: t('prTab.form.opened'), intent: 'success' })
      onOpened()
    } catch {
      toast({ title: t('prTab.form.failed'), intent: 'danger' })
    } finally {
      setBusy(false)
    }
  }
  return <form className="pr-tab-form" onSubmit={event => { event.preventDefault(); void submit() }}>
    <TextField label={t('prTab.form.title')} value={title} onChange={event => setTitle(event.target.value)} />
    <div className="pr-tab-branches">
      <TextField label={t('prTab.form.from')} value={branch} readOnly mono />
      <TextField label={t('prTab.form.into')} value={base} mono onChange={event => setBase(event.target.value)} />
    </div>
    <Checkbox label={t('prTab.form.draft')} checked={draft} onChange={event => setDraft(event.currentTarget.checked)} />
    <div className="pr-tab-actions">
      <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!ready}>{t('prTab.form.submit')}</Button>
    </div>
  </form>
}

function PullRequestCard({ provider, pr, onSend }: { provider: PrProvider; pr: PullRequestInfo; onSend?: (text: string) => void }): ReactElement {
  const { t } = useTranslation('thread')
  const tally = checkTally(pr.checks)
  const duration = (seconds: number): string => {
    const parts = splitDuration(seconds)
    return parts.minutes ? t('prTab.duration.minutes', parts) : t('prTab.duration.seconds', parts)
  }
  const number = prNumberLabel(provider, pr.number)
  return (
    <>
      <section className="pr-tab-section">
        <div className="pr-tab-head">
          <Badge>{t(`prTab.provider.${provider}`)}</Badge>
          <span className="pr-tab-number">{number}</span>
          <Badge>{t(`prTab.state.${prStateKey(provider, pr)}`)}</Badge>
        </div>
        <p className="pr-tab-title">{pr.title}</p>
        <p className="pr-tab-muted">{t('prTab.branches', { head: pr.head, base: pr.base })}</p>
        {pr.workItems.length > 0 && <ul className="pr-tab-inline" aria-label={t('prTab.workItems')}>
          {pr.workItems.map(item => <li key={item.id}><a href={item.url} onClick={event => { event.preventDefault(); openExternal(item.url) }}>{workItemLabel(item.id)}</a></li>)}
        </ul>}
        <div className="pr-tab-actions">
          <Button size="sm" onClick={() => openExternal(pr.url)}>{t(`prTab.open.${provider}`)}</Button>
          <Button size="sm" disabled={!onSend} onClick={() => onSend?.(t('prTab.addressPrompt', { number }))}>{t('prTab.address')}</Button>
          <span className="pr-tab-merge" title={t(`prTab.mergeTooltip.${provider}`)}>
            <Button size="sm" variant="primary" disabled>{t(`prTab.merge.${provider}`)}</Button>
          </span>
        </div>
      </section>
      <section className="pr-tab-section">
        <h3 className="pr-tab-heading">{t(`prTab.checks.${provider}`)}</h3>
        {tally.total > 0 && <p className="pr-tab-muted">{t('prTab.checks.tally', tally)}</p>}
        {pr.checks.length === 0 ? <p className="pr-tab-muted">{t('prTab.checks.none')}</p> : <ul className="pr-tab-list">
          {pr.checks.map((check, index) => <li data-state={check.state} key={`${check.name}:${index}`} className={check.state === 'skipped' ? 'pr-tab-row pr-tab-muted' : 'pr-tab-row'}>
            <span className="pr-tab-grow" title={check.name}>{check.name}</span>
            <span>{t(`prTab.checks.${checkStateKey(provider, check.state)}`)}</span>
            {check.duration !== null && <span className="pr-tab-muted">{duration(check.duration)}</span>}
          </li>)}
        </ul>}
      </section>
      <section className="pr-tab-section">
        <h3 className="pr-tab-heading">{t('prTab.reviewers.title')}</h3>
        {pr.reviewers.length === 0 ? <p className="pr-tab-muted">{t('prTab.reviewers.none')}</p> : <ul className="pr-tab-list">
          {pr.reviewers.map((reviewer, index) => <li key={`${reviewer.name}:${index}`} className="pr-tab-row">
            <span className="pr-tab-grow">{reviewer.name}</span>
            <span>{t(`prTab.vote.${VOTE_KEY[reviewer.vote]}`)}</span>
          </li>)}
        </ul>}
      </section>
    </>
  )
}
