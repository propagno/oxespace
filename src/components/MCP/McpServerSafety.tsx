import { ShieldAlert, TriangleAlert } from 'lucide-react'
import { useMemo, type ReactElement } from 'react'
import type { McpServer } from '../../../shared/types/mcp'
import { MCP_SCAN_KIND_LABEL, scanToolDescriptions } from '../../../shared/mcp-scan'

/**
 * What a person should know before trusting an MCP server (or trusting it again): the quarantine and why,
 * tool descriptions that carry instructions meant for the model, and a version that can change by itself.
 */
export function McpServerSafety({ server }: { server: McpServer }): ReactElement | null {
  const findings = useMemo(() => scanToolDescriptions(server.tools), [server.tools])
  const quarantine = server.guard?.quarantine ?? null
  const floating = server.trusted && server.guard?.floating === true
  if (!quarantine && findings.length === 0 && !floating) return null
  return (
    <div className="mcp-safety" data-testid="mcp-safety">
      {quarantine ? (
        <div className="mcp-safety-box is-danger" role="alert" data-testid="mcp-quarantine">
          <ShieldAlert size={14} aria-hidden="true" />
          <div>
            <strong>Quarantined: it changed after you trusted it</strong>
            {quarantine.reasons.map((reason) => <p key={reason}>{reason}</p>)}
            <p>It is not offered to agents and does not start. Read the tools below, then use Test to trust it again, or remove it.</p>
          </div>
        </div>
      ) : null}
      {findings.length > 0 ? (
        <div className="mcp-safety-box is-warning" role="alert" data-testid="mcp-description-warning">
          <TriangleAlert size={14} aria-hidden="true" />
          <div>
            <strong>Tool descriptions with instructions for the model</strong>
            <p>An agent reads these descriptions as part of its context. They may be harmless, but a description should say what a tool does, not tell the agent what to do.</p>
            <ul>
              {findings.map((finding) => (
                <li key={`${finding.tool}-${finding.kind}`}><code>{finding.tool}</code>: {MCP_SCAN_KIND_LABEL[finding.kind]} <q>{finding.excerpt}</q></li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
      {floating ? (
        <div className="mcp-safety-box is-warning" data-testid="mcp-floating-version">
          <TriangleAlert size={14} aria-hidden="true" />
          <div>
            <strong>No fixed version</strong>
            <p>{`It starts ${server.guard?.package ?? 'a package'} without an exact version, so a new release changes what runs. Add one (for example @1.2.3) to the arguments.`}</p>
          </div>
        </div>
      ) : null}
    </div>
  )
}
