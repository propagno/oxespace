import { useState, type KeyboardEvent } from 'react'
import { Check, Copy, FilePenLine, Pencil, RotateCcw, TerminalSquare, Wrench } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { extractCdPrefix, presentInlineScript } from '../../../shared/commandPresenters'
import { i18n } from '../../i18n'
import { ThreadMarkdown } from './ThreadMarkdown'
import { Button, IconButton } from '../../ui'
import { useMoreBelow } from '../../hooks/useMoreBelow'

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

export function ThreadApprovalDetails({
  command,
  cwd,
  reason,
  fileChanges = false,
  toolName,
  editable = false,
  editing = false,
  isModified = false,
  riskEscalated = false,
  commandEmpty = false,
  disabled = false,
  onToggleEdit,
  onChangeCommand,
  onResetCommand
}: {
  command: string
  cwd?: string
  reason?: string
  fileChanges?: boolean
  toolName?: string
  editable?: boolean
  editing?: boolean
  isModified?: boolean
  riskEscalated?: boolean
  commandEmpty?: boolean
  disabled?: boolean
  onToggleEdit?: () => void
  onChangeCommand?: (next: string) => void
  onResetCommand?: () => void
}) {
  const { t } = useTranslation('thread')
  const [copied, setCopied] = useState(false)
  // In the pending dock the card is capped and this part scrolls: a fade says the reason is still below (DESIGN, RC).
  const [scroller, moreBelow] = useMoreBelow<HTMLDivElement>()
  const display = approvalCommandPreview(command)
  const isPlan = toolName === 'ExitPlanMode'
  const isToolRequest = Boolean(toolName && toolName !== 'Bash' && toolName !== 'Write' && toolName !== 'Edit' && toolName !== 'MultiEdit')
  let plan: string | undefined
  if (isPlan) {
    // Main hands the plan over as its own text (claude-permission-request.ts); an older request carried the tool's
    // JSON. As text it fell through here and was shown raw, in the box for a command: Markdown marks and all.
    try { const input = JSON.parse(command) as { plan?: unknown }; if (typeof input.plan === 'string') plan = input.plan } catch { plan = command.trim() || undefined }
  }
  const summary = isPlan ? t('approvalDetails.reviewPlan')
    : isToolRequest ? t('approvalDetails.reviewTool', { tool: toolName })
    : fileChanges ? t('approvalDetails.reviewFiles')
    : display.writesFiles ? t('approvalDetails.mayModify', { target: display.target ?? t('approvalDetails.projectFiles') }) : t('approvalDetails.reviewCommand')
  const exact = command.trim()
  // The plan is what is approved: rendered once, as prose. The raw box only when it holds something else (the JSON).
  const planIsExact = plan !== undefined && plan.trim() === exact
  const copy = <Button size="sm" variant="ghost" icon={<Copy size={14} aria-hidden="true" />} onClick={() => void navigator.clipboard?.writeText(command).then(() => setCopied(true)).catch(() => setCopied(false))}>{copied ? t('approvalDetails.copied') : t('approvalDetails.copyExact')}</Button>
  const editButton = editable && onToggleEdit
    ? <IconButton size="sm" data-action="edit-command" aria-pressed={editing} disabled={disabled} label={editing ? t('request.doneEditingCommand') : t('request.editCommand')} title={editing ? t('request.doneEditingCommand') : t('request.editCommand')} icon={editing ? <Check size={13} aria-hidden="true" /> : <Pencil size={13} aria-hidden="true" />} onClick={onToggleEdit} />
    : null
  const onEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onToggleEdit?.()
    }
  }
  // The readable preview only when it says something the exact text does not (P1-8): never an empty or duplicate box.
  // A tool's JSON input reads better indented; that indented copy is the readable preview.
  let structured: string | undefined
  if (isToolRequest && !isPlan) { try { const parsed: unknown = JSON.parse(command); if (parsed && typeof parsed === 'object') structured = JSON.stringify(parsed, null, 2) } catch { /* Not JSON: the exact text stands alone. */ } }
  const preview = (structured ?? display.preview).trim()
  const showPreview = Boolean(plan) || (!editing && preview.length > 0 && preview !== exact)
  const where = cwd ?? display.directory
  return <div ref={scroller} className="thread-approval-content" data-more-below={moreBelow || undefined}>
    <div className="thread-approval-intent">{isToolRequest ? <Wrench size={16} /> : display.writesFiles || fileChanges ? <FilePenLine size={16} /> : <TerminalSquare size={16} />}<div><strong>{summary}</strong><span>{isToolRequest ? t('approvalDetails.toolRequest') : fileChanges ? t('approvalDetails.fileChanges') : display.runner}{where ? ` · ${where}` : ''}</span></div></div>
    {/* The exact text being approved, open from the start: what runs is never behind a click. */}
    {(exact || editing || isModified) && !planIsExact && <section className="thread-approval-exact" aria-label={t('approvalDetails.exact')} data-testid="approval-exact">
      {/* Copy sits in the heading, which stays in view while a long command scrolls in the dock (T67). */}
      <div className="thread-approval-preview-heading"><strong>{t('approvalDetails.exact')}</strong>{where && <small>{t('approvalDetails.directory', { path: where })}</small>}
        {editButton ? <span className="thread-approval-exact-actions">{editButton}{copy}</span> : copy}</div>
      {editing
        ? <textarea className="thread-approval-editor" data-testid="approval-command-editor" aria-label={t('request.editCommandInput')} value={command} disabled={disabled} spellCheck={false} onChange={event => onChangeCommand?.(event.target.value)} onKeyDown={onEditorKeyDown} />
        : <pre tabIndex={0}>{command}</pre>}
      {editable && (editing || isModified) && <div className="thread-approval-editor-bar">
        <span>
          {isModified && <span className="thread-approval-edited-badge" data-ui="command-edited">{t('request.commandEdited')}</span>}
          {commandEmpty && <span className="thread-approval-escalated" role="status">{t('request.commandEmpty')}</span>}
          {!commandEmpty && riskEscalated && <span className="thread-approval-escalated" role="status">{t('request.commandRiskEscalated')}</span>}
        </span>
        {onResetCommand && <Button size="sm" variant="ghost" icon={<RotateCcw size={12} aria-hidden="true" />} disabled={disabled || !isModified} onClick={onResetCommand}>{t('request.resetCommand')}</Button>}
      </div>}
    </section>}
    {showPreview && <div className="thread-approval-preview" data-testid="approval-readable"><div className="thread-approval-preview-heading"><strong>{isPlan ? t('approvalDetails.plan') : isToolRequest ? t('approvalDetails.toolInput') : fileChanges ? t('approvalDetails.proposedChange') : t('approvalDetails.readable')}</strong>{planIsExact ? copy : <small>{t('approvalDetails.readableHint')}</small>}</div>{plan ? <div className="thread-approval-plan" tabIndex={0}><ThreadMarkdown text={plan} /></div> : <pre className={isToolRequest ? 'is-structured' : undefined}>{structured ?? display.preview}</pre>}</div>}
    {/* The agent's own words, below the command and marked as such: a claim, not something OXESpace checked. */}
    {reason && reason !== command && <section className="thread-approval-agent" aria-label={t('approvalDetails.reason')} data-testid="approval-agent-reason">
      <div className="thread-approval-preview-heading"><strong>{t('approvalDetails.reason')}</strong><small>{t('approvalDetails.reasonHint')}</small></div>
      <pre>{reason}</pre>
    </section>}
  </div>
}
