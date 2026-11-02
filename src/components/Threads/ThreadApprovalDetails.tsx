import { useState } from 'react'
import { Copy, FilePenLine, TerminalSquare, Wrench } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { extractCdPrefix, presentInlineScript } from '../../../shared/commandPresenters'
import { i18n } from '../../i18n'
import { ThreadMarkdown } from './ThreadMarkdown'

/** A readable preview is deliberately separate from the exact command being approved. */
export function approvalCommandPreview(command: string): { runner: string; preview: string; target?: string; writesFiles: boolean; directory?: string } {
  const cd = extractCdPrefix(command)
  const inline = presentInlineScript(cd?.rest ?? command)
  if (inline) {
    return { runner: i18n.t('thread:approvalDetails.script', { language: inline.language }), preview: inline.script, directory: cd?.directory, writesFiles: /\b(?:writeFile(?:Sync)?|appendFile(?:Sync)?|unlink(?:Sync)?|rmSync|open\(|shutil\.|os\.(?:remove|system)|subprocess|child_process|exec(?:Sync)?\()/i.test(inline.script) }
  }
  const match = command.match(/^\s*(?:"([^"]+)"|'([^']+)'|(\S+))\s+-(?:Command|c)\s+([\s\S]+)$/i)
  const executable = match?.[1] ?? match?.[2] ?? match?.[3] ?? ''
  const runner = /(?:^|[\\/])pwsh(?:\.exe)?$/i.test(executable) ? 'PowerShell 7' : /(?:^|[\\/])powershell(?:\.exe)?$/i.test(executable) ? 'PowerShell' : executable ? executable.split(/[\\/]/).at(-1) ?? i18n.t('thread:approvalDetails.command') : i18n.t('thread:approvalDetails.command')
  let body = match?.[4]?.trim() ?? command.trim()
  if (body.length >= 2 && (body[0] === "'" && body.at(-1) === "'" || body[0] === '"' && body.at(-1) === '"')) body = body.slice(1, -1)
  const preview = body.replace(/\\r\\n|\\n/g, '\n').replace(/;\s*(?=\$[A-Za-z_][\w]*)/g, ';\n')
  const target = command.match(/\b((?:docs|src|tests|e2e|electron|shared)[\\/][\w.\\/-]+)/i)?.[1]?.replace(/\\/g, '/')
  return { runner, preview, target, writesFiles: /\b(?:Set-Content|Add-Content|Out-File|apply_patch|sed\s+-i|writeFile(?:Sync)?|Remove-Item)\b/i.test(command) }
}

export function ThreadApprovalDetails({ command, cwd, reason, fileChanges = false, toolName }: { command: string; cwd?: string; reason?: string; fileChanges?: boolean; toolName?: string }) {
  const { t } = useTranslation('thread')
  const [copied, setCopied] = useState(false)
  const display = approvalCommandPreview(command)
  const isPlan = toolName === 'ExitPlanMode'
  const isToolRequest = Boolean(toolName && toolName !== 'Bash' && toolName !== 'Write' && toolName !== 'Edit' && toolName !== 'MultiEdit')
  let plan: string | undefined
  if (isPlan) {
    try { const input = JSON.parse(command) as { plan?: unknown }; if (typeof input.plan === 'string') plan = input.plan } catch { /* Keep the exact request below. */ }
  }
  const summary = isPlan ? t('approvalDetails.reviewPlan')
    : isToolRequest ? t('approvalDetails.reviewTool', { tool: toolName })
    : fileChanges ? t('approvalDetails.reviewFiles')
    : display.writesFiles ? t('approvalDetails.mayModify', { target: display.target ?? t('approvalDetails.projectFiles') }) : t('approvalDetails.reviewCommand')
  const exact = command.trim()
  // The readable preview only when it says something the exact text does not (P1-8): never an empty or duplicate box.
  // A tool's JSON input reads better indented; that indented copy is the readable preview.
  let structured: string | undefined
  if (isToolRequest && !isPlan) { try { const parsed: unknown = JSON.parse(command); if (parsed && typeof parsed === 'object') structured = JSON.stringify(parsed, null, 2) } catch { /* Not JSON: the exact text stands alone. */ } }
  const preview = (structured ?? display.preview).trim()
  const showPreview = Boolean(plan) || (preview.length > 0 && preview !== exact)
  const where = cwd ?? display.directory
  return <div className="thread-approval-content">
    <div className="thread-approval-intent">{isToolRequest ? <Wrench size={16} /> : display.writesFiles || fileChanges ? <FilePenLine size={16} /> : <TerminalSquare size={16} />}<div><strong>{summary}</strong><span>{isToolRequest ? t('approvalDetails.toolRequest') : fileChanges ? t('approvalDetails.fileChanges') : display.runner}{where ? ` · ${where}` : ''}</span></div></div>
    {/* The exact text being approved, open from the start: what runs is never behind a click. */}
    {exact && <section className="thread-approval-exact" aria-label={t('approvalDetails.exact')} data-testid="approval-exact">
      <div className="thread-approval-preview-heading"><strong>{t('approvalDetails.exact')}</strong>{where && <small>{t('approvalDetails.directory', { path: where })}</small>}</div>
      <pre tabIndex={0}>{command}</pre>
      <button type="button" onClick={() => void navigator.clipboard?.writeText(command).then(() => setCopied(true)).catch(() => setCopied(false))}><Copy size={14} />{copied ? t('approvalDetails.copied') : t('approvalDetails.copyExact')}</button>
    </section>}
    {showPreview && <div className="thread-approval-preview" data-testid="approval-readable"><div className="thread-approval-preview-heading"><strong>{isPlan ? t('approvalDetails.plan') : isToolRequest ? t('approvalDetails.toolInput') : fileChanges ? t('approvalDetails.proposedChange') : t('approvalDetails.readable')}</strong><small>{t('approvalDetails.readableHint')}</small></div>{plan ? <div className="thread-approval-plan"><ThreadMarkdown text={plan} /></div> : <pre className={isToolRequest ? 'is-structured' : undefined}>{structured ?? display.preview}</pre>}</div>}
    {/* The agent's own words, below the command and marked as such: a claim, not something OXESpace checked. */}
    {reason && reason !== command && <section className="thread-approval-agent" aria-label={t('approvalDetails.reason')} data-testid="approval-agent-reason">
      <div className="thread-approval-preview-heading"><strong>{t('approvalDetails.reason')}</strong><small>{t('approvalDetails.reasonHint')}</small></div>
      <pre>{reason}</pre>
    </section>}
  </div>
}
