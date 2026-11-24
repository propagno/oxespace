import { basename } from 'node:path'
import { mainMessage } from '../../../shared/messages'
import type { InternalMcpToolCallResult } from '../../../shared/types/mcp-internal'
import type { AppDatabase } from '../db'
import { AndroidLifecycle, type LifecycleAction, type LifecycleAuditEntry, type LifecycleResult } from '../services/android/android-lifecycle'
import type { ToolContext } from './tool-registry'
import { errorResult, textResult } from './tool-registry'

/** Asks the person in the approval center before an agent changes an Android device (OXE-111). */
export async function promptAndroidLifecycle(
  approvalCenter: { ask(draft: unknown): Promise<{ intent: string }> },
  input: { action: 'avd_start' | 'apk_install' | 'app_launch'; device: string; target: string; owner: { kind: 'pane' | 'thread'; id: string } }
): Promise<boolean> {
  const [{ brokerDraft }, { requesterFor }] = await Promise.all([import('../services/approvals/drafts'), import('../services/approvals/requester')])
  const outcome = await approvalCenter.ask(brokerDraft({
    kind: 'mcp-confirm',
    requester: requesterFor(input.owner),
    level: 'medium',
    risk: 'write',
    title: mainMessage('approvals.title.agent', {}),
    summary: mainMessage('approvals.summary.mcpConfirm', { tool: `oxespace_android_${input.action}`, action: input.action, target: `${input.device} (${input.target})` }),
    target: `${input.device}: ${input.target}`,
    notes: [],
    text: `${input.action} on ${input.device}: ${input.target}`
  }))
  return outcome.intent === 'allow'
}

const AUDIT_ACTION: Record<LifecycleAction, string> = {
  avd_start: 'android-avd-start',
  apk_install: 'android-apk-install',
  app_launch: 'android-app-launch',
  logcat_tail: 'android-logcat-tail'
}

const AUDIT_OUTCOME: Record<LifecycleAuditEntry['outcome'], 'ok' | 'refused' | 'error'> = {
  ok: 'ok',
  denied: 'refused',
  failed: 'error'
}

/** Writes one append-only row to `person_action_audit` for an Android lifecycle action. Never throws. */
export function recordLifecycleAudit(db: AppDatabase, entry: LifecycleAuditEntry): void {
  try {
    const code = entry.action === 'apk_install'
      ? basename(entry.target).slice(0, 120)
      : entry.action === 'avd_start'
        ? null
        : entry.target.slice(0, 120)
    db.prepare("INSERT INTO person_action_audit (ts, actor, action, target, outcome, code) VALUES (?, 'person', ?, ?, ?, ?)")
      .run(Date.now(), AUDIT_ACTION[entry.action], entry.device.slice(0, 4096), AUDIT_OUTCOME[entry.outcome], code)
  } catch { /* best-effort audit */ }
}

function asObject(args: unknown, allowedKeys: readonly string[]): Record<string, unknown> | null {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return null
  const input = args as Record<string, unknown>
  if (Object.keys(input).some(key => !allowedKeys.includes(key))) return null
  return input
}

function formatFailure(result: Exclude<LifecycleResult, { ok: true }>, serial: string | undefined, workspaceId: string, ctx: ToolContext): InternalMcpToolCallResult {
  if (result.code === 'android.lifecycle.invalid') return errorResult(`Invalid argument "${result.field}".`)
  if (result.code === 'android.lifecycle.denied') return errorResult('The person declined the Android lifecycle request.')
  if (result.code === 'android.agents.notAllowed') {
    if (serial) ctx.openAndroidPanel?.({ workspaceId, serial })
    return errorResult(
      ctx.openAndroidPanel
        ? 'Agents can see is off for this device. OXESpace opened the Android device panel for the person; ask them to turn on Agents can see there, then try again.'
        : 'Agents can see is off for this device. Ask the person to enable Agents can see in the Android device panel.'
    )
  }
  if (result.code === 'android.lifecycle.failed') return errorResult(result.reason)
  return errorResult('The Android lifecycle request failed.')
}

export async function runAndroidLifecycleTool(action: LifecycleAction, args: unknown, ctx: ToolContext): Promise<InternalMcpToolCallResult> {
  let execution: ReturnType<NonNullable<ToolContext['executions']>['authenticate']> | undefined
  try { execution = ctx.executions?.authenticate(ctx.executionId, ctx.executionToken, ctx.workspaceId) } catch { /* handled below */ }
  if (!execution) return errorResult('An authenticated OXESpace execution is required to use Android lifecycle tools.')

  const devices = ctx.androidDevices?.()
  const access = ctx.androidAccess?.()
  if (!devices || !access) return errorResult('Android device service is unavailable.')

  const owner = execution.owner
  const lifecycle = new AndroidLifecycle({
    devices,
    run: devices.runner,
    approve: prompt => ctx.askAndroidLifecycle
      ? ctx.askAndroidLifecycle({ ...prompt, owner })
      : Promise.resolve(false),
    agentsCanSee: serial => access.agentsCanSee(serial),
    audit: ctx.db ? { record: entry => recordLifecycleAudit(ctx.db!, entry) } : undefined
  })

  if (action === 'avd_start') {
    const input = asObject(args, ['avdName'])
    if (!input) return errorResult('Pass { "avdName": "<installed-avd>" }.')
    const res = await lifecycle.avdStart({ avdName: input.avdName })
    if (!res.ok) return formatFailure(res, undefined, execution.workspaceId, ctx)
    return textResult({ ok: true, avdName: input.avdName, ...(res.serial ? { serial: res.serial } : {}) })
  }

  if (action === 'apk_install') {
    const input = asObject(args, ['serial', 'apkPath'])
    if (!input) return errorResult('Pass { "serial": "<serial>", "apkPath": "<path-in-workspace>" }.')
    const workspaceRoot = execution.owner.kind === 'thread'
      ? (execution.canonicalRoot || execution.cwd)
      : (ctx.workspaceServ.get(execution.workspaceId)?.rootPath ?? execution.canonicalRoot ?? execution.cwd)
    if (!workspaceRoot) return errorResult('A workspace root is required to install an APK.')
    const res = await lifecycle.apkInstall({ serial: input.serial, apkPath: input.apkPath, workspaceRoot })
    if (!res.ok) return formatFailure(res, typeof input.serial === 'string' ? input.serial : undefined, execution.workspaceId, ctx)
    return textResult({ ok: true, serial: input.serial, apkPath: input.apkPath })
  }

  if (action === 'app_launch') {
    const input = asObject(args, ['serial', 'packageName'])
    if (!input) return errorResult('Pass { "serial": "<serial>", "packageName": "<package>" }.')
    const res = await lifecycle.appLaunch({ serial: input.serial, packageName: input.packageName })
    if (!res.ok) return formatFailure(res, typeof input.serial === 'string' ? input.serial : undefined, execution.workspaceId, ctx)
    return textResult({ ok: true, serial: input.serial, packageName: input.packageName })
  }

  const input = asObject(args, ['serial', 'maxLines', 'packageName', 'tag'])
  if (!input) return errorResult('Pass { "serial": "<serial>", "maxLines"?: 1-500, "packageName"?: "<pkg>", "tag"?: "<tag>" }.')
  const res = await lifecycle.logcatTail({ serial: input.serial, maxLines: input.maxLines, packageName: input.packageName, tag: input.tag })
  if (!res.ok) return formatFailure(res, typeof input.serial === 'string' ? input.serial : undefined, execution.workspaceId, ctx)
  return textResult({ ok: true, serial: input.serial, output: res.output ?? '', truncated: res.truncated ?? false })
}
