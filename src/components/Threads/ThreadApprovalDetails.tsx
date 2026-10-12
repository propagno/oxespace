import { useState } from 'react'
import { ChevronDown, Copy, FilePenLine, TerminalSquare, Wrench } from 'lucide-react'
import { ThreadMarkdown } from './ThreadMarkdown'

/** A readable preview is deliberately separate from the exact command being approved. */
export function approvalCommandPreview(command: string): { runner: string; preview: string; target?: string; writesFiles: boolean } {
  const match = command.match(/^\s*(?:"([^"]+)"|'([^']+)'|(\S+))\s+-(?:Command|c)\s+([\s\S]+)$/i)
  const executable = match?.[1] ?? match?.[2] ?? match?.[3] ?? ''
  const runner = /(?:^|[\\/])pwsh(?:\.exe)?$/i.test(executable) ? 'PowerShell 7' : /(?:^|[\\/])powershell(?:\.exe)?$/i.test(executable) ? 'PowerShell' : executable ? executable.split(/[\\/]/).at(-1) ?? 'Command' : 'Command'
  let body = match?.[4]?.trim() ?? command.trim()
  if (body.length >= 2 && (body[0] === "'" && body.at(-1) === "'" || body[0] === '"' && body.at(-1) === '"')) body = body.slice(1, -1)
  const preview = body.replace(/\\r\\n|\\n/g, '\n').replace(/;\s*(?=\$[A-Za-z_][\w]*)/g, ';\n')
  const target = command.match(/\b((?:docs|src|tests|e2e|electron|shared)[\\/][\w.\\/-]+)/i)?.[1]?.replace(/\\/g, '/')
  return { runner, preview, target, writesFiles: /\b(?:Set-Content|Add-Content|Out-File|apply_patch|sed\s+-i|writeFile(?:Sync)?|Remove-Item)\b/i.test(command) }
}

export function ThreadApprovalDetails({ command, cwd, reason, fileChanges = false, toolName }: { command: string; cwd?: string; reason?: string; fileChanges?: boolean; toolName?: string }) {
  const [copied, setCopied] = useState(false)
  const display = approvalCommandPreview(command)
  const isPlan = toolName === 'ExitPlanMode'
  const isToolRequest = Boolean(toolName && toolName !== 'Bash' && toolName !== 'Write' && toolName !== 'Edit' && toolName !== 'MultiEdit')
  let plan: string | undefined
  if (isPlan) {
    try { const input = JSON.parse(command) as { plan?: unknown }; if (typeof input.plan === 'string') plan = input.plan } catch { /* Keep the exact request below. */ }
  }
  const summary = isPlan ? 'Review the plan before the agent continues.'
    : isToolRequest ? `Review the ${toolName} request before allowing it.`
    : fileChanges ? 'Review the proposed file changes before allowing them.'
    : display.writesFiles ? `This command may modify ${display.target ?? 'project files'}.` : 'Review the command before allowing it to run.'
  return <div className="thread-approval-content">
    <div className="thread-approval-intent">{isToolRequest ? <Wrench size={16} /> : display.writesFiles || fileChanges ? <FilePenLine size={16} /> : <TerminalSquare size={16} />}<div><strong>{summary}</strong><span>{isToolRequest ? 'Provider tool request' : fileChanges ? 'File changes' : display.runner}{cwd ? ` · ${cwd}` : ''}</span></div></div>
    {reason && reason !== command && <p className="thread-approval-reason">Agent reason: {reason}</p>}
    <div className="thread-approval-preview"><div className="thread-approval-preview-heading"><strong>{isPlan ? 'Plan' : isToolRequest ? 'Tool input' : fileChanges ? 'Proposed change' : 'Readable preview'}</strong><small>The exact request is available below</small></div>{plan ? <div className="thread-approval-plan"><ThreadMarkdown text={plan} /></div> : <pre className={isToolRequest ? 'is-structured' : undefined}>{display.preview}</pre>}</div>
    <details className="thread-approval-raw"><summary>Exact command or request <ChevronDown size={13} /></summary><div><pre>{command}</pre><button type="button" onClick={() => void navigator.clipboard?.writeText(command).then(() => setCopied(true)).catch(() => setCopied(false))}><Copy size={13} />{copied ? 'Copied' : 'Copy exact text'}</button></div></details>
  </div>
}
