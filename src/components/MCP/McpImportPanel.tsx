import { useEffect, useState, type ReactElement } from 'react'
import type { McpDiscoverySource } from '../../../shared/types/mcp'
import { Checkbox, EmptyState, ErrorState, LoadingState } from '../../ui'
import { useTranslation } from 'react-i18next'
import { i18n } from '../../i18n'
import { humanizeError } from '../../utils/humanizeError'

/** Servers Claude Desktop, Cursor and Windsurf already have. Their secrets are never shown or sent here. */
export function McpImportPanel({ workspaceId, onImported, onChanged, onClose }: { workspaceId: string | null; onImported: () => void; onChanged?: () => void; onClose: () => void }): ReactElement {
  const { t } = useTranslation('code')
  const api = window.oxe?.mcp
  const [sources, setSources] = useState<McpDiscoverySource[] | null>(null)
  const [picked, setPicked] = useState<Record<string, Set<string>>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    api?.discover?.(workspaceId).then(found => { if (live) setSources(found) }, cause => { if (live) { setSources([]); setError(humanizeError(cause, i18n.t('mcp.import.lookFailed', { ns: 'code' }))) } })
    return () => { live = false }
  }, [api, workspaceId])

  const toggle = (source: string, name: string) => setPicked(current => {
    const next = new Set(current[source] ?? [])
    if (next.has(name)) next.delete(name); else next.add(name)
    return { ...current, [source]: next }
  })
  const total = Object.values(picked).reduce((sum, names) => sum + names.size, 0)

  const run = async () => {
    if (!api?.importDiscovered) return
    setBusy(true); setError('')
    try {
      const failed: Array<{ name: string; reason: string }> = []
      const added = new Set<string>()
      for (const [source, names] of Object.entries(picked)) {
        if (!names.size) continue
        const result = await api.importDiscovered({ workspaceId, source: source as McpDiscoverySource['id'], names: [...names] })
        for (const server of result.created) added.add(server.name)
        failed.push(...result.failed)
      }
      if (failed.length === 0) { onImported(); return }
      // What did import is saved already; the rest stays on screen with the reason it was refused.
      if (added.size) onChanged?.()
      setSources(current => current && current.map(source => ({ ...source, servers: source.servers.map(server => added.has(server.name) ? { ...server, exists: true } : server) })))
      setPicked({})
      setError(t('mcp.import.notImported', { list: failed.map(item => `${item.name} (${item.reason})`).join('; ') }))
    } catch (cause) {
      setError(humanizeError(cause, t('mcp.import.failed')))
    } finally { setBusy(false) }
  }

  return <section className="mcp-import" aria-label={t('mcp.import.label')}>
    <p>{t('mcp.import.intro')}</p>
    {error && <ErrorState compact title={t('mcp.import.failed')} message={error} />}
    {sources === null ? <LoadingState label={t('mcp.import.looking')} /> : sources.length === 0 ? <EmptyState compact title={t('mcp.import.none')} /> : sources.map(source => <fieldset key={source.id}>
      <legend>{source.label}</legend>
      {source.servers.map(server => <div key={server.name} className="mcp-import-row">
        <Checkbox checked={picked[source.id]?.has(server.name) ?? false} disabled={server.exists || busy} onChange={() => toggle(source.id, server.name)} label={server.name} />
        <code>{server.transport} · {server.target}</code>
        {server.secretNames.length > 0 && <small>{t('mcp.import.copies', { names: server.secretNames.join(', ') })}</small>}
        {server.exists && <small>{t('mcp.import.exists')}</small>}
      </div>)}
    </fieldset>)}
    <div className="mcp-import-actions">
      <button type="button" onClick={onClose} disabled={busy}>{t('github.cancel')}</button>
      <button type="button" onClick={() => void run()} disabled={busy || total === 0}>{total ? t('mcp.import.importCount', { count: total }) : t('mcp.import.import')}</button>
    </div>
  </section>
}
