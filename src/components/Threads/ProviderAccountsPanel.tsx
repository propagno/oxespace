import { useEffect, useState } from 'react'
import { Check, ExternalLink, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AgentAccountContext } from '../../../shared/types/agentAuth'
import { useAccountStore, selectAccount } from '../../store/account.store'
import { useThreadStore } from '../../store/thread.store'
import { AgentProviderIcon } from '../Sidebar/AgentProviderIcon'
import { Button, Dialog, ErrorState, Spinner, TextField } from '../../ui'
import { accountContext, accountMessage } from './accountMessages'

function AccountCard({ context }: { context: AgentAccountContext }) {
  const { t } = useTranslation('thread')
  const status = useAccountStore(selectAccount(context))
  const [error, setError] = useState(''), [pending, setPending] = useState(false), [code, setCode] = useState('')
  const busy = Boolean(status?.attemptId)
  const connected = status?.state === 'connected' && status.method === 'subscription'
  const run = async (action: () => Promise<unknown>) => { setPending(true); setError(''); try { await action() } catch { setError(t('accounts.failed')) } finally { setPending(false) } }
  return <section className="thread-account-card"><div className="thread-account-heading"><AgentProviderIcon provider={context.provider} size={28} /><div><strong>{context.provider === 'claude' ? 'Claude Code' : 'Codex'}</strong><small>{context.provider === 'claude' ? t('accounts.claudePlan') : t('accounts.codexPlan')}</small></div>{connected ? <Check size={16} /> : busy ? <Spinner label={t('accounts.busy')} /> : null}</div>
    <p>{accountMessage(status)}</p>{status?.accountLabel && <small>{status.accountLabel}</small>}
    {status?.state === 'awaiting-code' && <form className="thread-auth-code" onSubmit={e => { e.preventDefault(); void run(async () => { await window.oxe!.agentAccount!.submitCode(status.attemptId!, code); setCode('') }) }}><label>{t('accounts.code')}<TextField autoComplete="off" type="password" value={code} onChange={e => setCode(e.target.value)} /></label><Button variant="primary" type="submit" disabled={!code || pending}>{t('accounts.continue')}</Button></form>}
    <div className="thread-account-actions">{busy ? <><Button size="sm" disabled={pending} onClick={() => void run(() => window.oxe!.agentAccount!.cancel(status!.attemptId!))}>{t('accounts.cancel')}</Button>{status?.canOpenBrowser && <Button size="sm" icon={<ExternalLink size={12} />} disabled={pending} onClick={() => void run(() => window.oxe!.agentAccount!.openBrowser(status.attemptId!))}>{t('accounts.openBrowser')}</Button>}</> : <><Button size="sm" variant={connected ? 'secondary' : 'primary'} disabled={pending || !window.oxe?.agentAccount} onClick={() => void run(() => useAccountStore.getState().login(context))}>{connected ? t('accounts.reconnect') : t('accounts.connect')}</Button>{connected && <Button size="sm" disabled={pending || !window.oxe?.agentAccount} onClick={() => void run(() => useAccountStore.getState().logout(context))}>{t('accounts.signOut')}</Button>}<Button size="sm" variant="ghost" icon={<RefreshCw size={12} />} disabled={pending || !window.oxe?.agentAccount} onClick={() => void run(() => useAccountStore.getState().read(context))}>{t('accounts.verify')}</Button></>}</div>
    {error && <ErrorState compact title={error} />}
  </section>
}
export function ProviderAccountsPanel({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const { t } = useTranslation('thread')
  const thread = useThreadStore(state => state.snapshot?.thread)
  const threadId = thread?.id, threadProvider = thread?.provider
  useEffect(() => {
    const refresh = () => {
      for (const provider of ['claude', 'codex'] as const) void useAccountStore.getState().read(accountContext(provider, workspaceId, threadId && threadProvider ? { id: threadId, provider: threadProvider } : undefined))
    }
    refresh()
    let lastFocus = Date.now()
    const focus = () => { if (Date.now() - lastFocus > 5000) { lastFocus = Date.now(); refresh() } }
    window.addEventListener('focus', focus)
    return () => { window.removeEventListener('focus', focus) }
  }, [workspaceId, threadId, threadProvider])
  return <Dialog closeLabel={t('common.close')} className="thread-accounts-dialog" title={t('accounts.title')} description={t('accounts.description')} onClose={onClose}>
    {(['claude', 'codex'] as const).map(provider => <AccountCard key={provider} context={accountContext(provider, workspaceId, thread)} />)}
    <p className="thread-account-note">{t('accounts.note')}</p>
  </Dialog>
}
