import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ThreadRichText } from './ThreadRichText'
import type { McpServer, McpStdioConfig } from '../../../shared/types/mcp'
import { mcpFailureHints } from '../../../shared/mcpFailureHints'
import { humanizeError } from '../../utils/humanizeError'

/** The key a provider session knows a saved server by: its name as a slug, numbered when two collide. */
export const mcpSessionKey = (name: string): string => name.trim().toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '') || 'mcp-server'

export function savedServerFor(sessionName: string, servers: McpServer[]): McpServer | undefined {
  const key = sessionName.toLowerCase()
  return servers.find(server => mcpSessionKey(server.name) === key) ?? servers.find(server => mcpSessionKey(server.name) === key.replace(/-\d+$/, ''))
}

/** The catalog entry a saved server was added from, matched by its package arguments. */
async function requiredEnvFor(server: McpServer): Promise<string[]> {
  if (server.transport !== 'stdio') return []
  const args = (server.config as McpStdioConfig).args
  // Loaded on demand: the catalog brings brand icons the conversation view does not otherwise need.
  const { MCP_CATALOG } = await import('../MCP/connectorCatalog')
  const entry = MCP_CATALOG.find(item => 'args' in item && Array.isArray(item.args) && item.args.filter(arg => !arg.startsWith('-')).every(arg => args.includes(arg)))
  return entry && 'requiredEnv' in entry ? entry.requiredEnv ?? [] : []
}

type Result = { state: 'idle' } | { state: 'running' } | { state: 'done'; ok: boolean; message: string; hints: string[] } | { state: 'unknown' }

/**
 * Tests a failed server the way Connections does and explains the error: the provider only says
 * "failed". Servers OXESpace does not manage (claude.ai connectors, ones added in the CLI) are not tested.
 */
export function ThreadMcpDiagnose({ name, workspaceId }: { name: string; workspaceId: string }): ReactElement | null {
  const { t } = useTranslation('thread')
  const [result, setResult] = useState<Result>({ state: 'idle' })
  const api = window.oxe?.mcp
  if (!api?.diagnose) return null
  const run = async (): Promise<void> => {
    setResult({ state: 'running' })
    try {
      const server = savedServerFor(name, await api.list(workspaceId))
      if (!server) { setResult({ state: 'unknown' }); return }
      const [{ server: tested, node }, requiredEnv] = await Promise.all([api.diagnose!(server.id), requiredEnvFor(server)])
      const config = tested.transport === 'stdio' ? tested.config as McpStdioConfig : undefined
      const ok = tested.health === 'healthy'
      const hints = mcpFailureHints({ message: tested.healthMessage, command: config?.command, env: config?.env, requiredEnv, node })
      setResult({ state: 'done', ok, message: tested.healthMessage ?? (ok ? t('mcpDiagnose.startsNow') : t('mcpDiagnose.didNotStart')), hints: node && !hints.length && !ok ? [t('mcpDiagnose.node', { version: node })] : hints })
    } catch (cause) {
      setResult({ state: 'done', ok: false, message: humanizeError(cause, t('mcpDiagnose.testFailed')), hints: [] })
    }
  }
  return <div className="thread-mcp-diagnose">
    {result.state !== 'done' && result.state !== 'unknown' && <button type="button" disabled={result.state === 'running'} onClick={() => void run()} aria-label={t('mcpDiagnose.label', { name })}>{result.state === 'running' ? t('mcpDiagnose.testing') : t('mcpDiagnose.diagnose')}</button>}
    {result.state === 'unknown' && <p><ThreadRichText text={t('mcpDiagnose.unmanaged')} /></p>}
    {result.state === 'done' && <div role="status">
      <p className={result.ok ? 'is-ok' : 'is-error'}>{result.ok ? t('mcpDiagnose.ok', { message: result.message }) : result.message}</p>
      {result.hints.length > 0 && <ul>{result.hints.map(hint => <li key={hint}>{hint}</li>)}</ul>}
      <button type="button" onClick={() => void run()}>{t('mcpDiagnose.again')}</button>
    </div>}
  </div>
}
