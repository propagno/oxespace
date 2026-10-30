import { ShieldAlert, TriangleAlert } from 'lucide-react'
import { useMemo, type ReactElement } from 'react'
import type { McpServer } from '../../../shared/types/mcp'
import { launcherPackage } from '../../../shared/mcp-launcher'
import { scanToolDescriptions } from '../../../shared/mcp-scan'
import { useTranslation } from 'react-i18next'

/**
 * What a person should know before trusting an MCP server (or trusting it again): the quarantine and why,
 * tool descriptions that carry instructions meant for the model, and a version that can change by itself.
 */
export function McpServerSafety({ server }: { server: McpServer }): ReactElement | null {
  const { t } = useTranslation('code')
  const findings = useMemo(() => scanToolDescriptions(server.tools), [server.tools])
  const quarantine = server.guard?.quarantine ?? null
  const launcher = launcherPackage(server.config)
  const floating = server.trusted && launcher !== null && launcher.version === null
  if (!quarantine && findings.length === 0 && !floating) return null
  return (
    <div className="mcp-safety" data-testid="mcp-safety">
      {quarantine ? (
        <div className="mcp-safety-box is-danger" role="status" data-testid="mcp-quarantine">
          <ShieldAlert size={14} aria-hidden="true" />
          <div>
            <strong>{t('mcp.safety.quarantineTitle')}</strong>
            {quarantine.reasons.map((reason) => <p key={reason}>{reason}</p>)}
            <p>{t('mcp.safety.quarantineBody')}</p>
          </div>
        </div>
      ) : null}
      {findings.length > 0 ? (
        <div className="mcp-safety-box is-warning" role="status" data-testid="mcp-description-warning">
          <TriangleAlert size={14} aria-hidden="true" />
          <div>
            <strong>{t('mcp.safety.descTitle')}</strong>
            <p>{t('mcp.safety.descBody')}</p>
            <ul>
              {findings.map((finding) => (
                <li key={`${finding.tool}-${finding.kind}`}><code>{finding.tool}</code>: {t(`mcp.safety.kind.${finding.kind}`)} <q>{finding.excerpt}</q></li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
      {floating ? (
        <div className="mcp-safety-box is-warning" data-testid="mcp-floating-version">
          <TriangleAlert size={14} aria-hidden="true" />
          <div>
            <strong>{t('mcp.safety.floatingTitle')}</strong>
            <p>{t('mcp.safety.floatingBody', { package: launcher?.package ?? t('mcp.safety.aPackage') })}</p>
          </div>
        </div>
      ) : null}
    </div>
  )
}
