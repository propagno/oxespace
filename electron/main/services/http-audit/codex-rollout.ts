import { readFile, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { HttpAuditLog } from './store'

export interface CodexRolloutIngestInput {
  file: string
  paneId: string
  workspaceId: string
  sessionId: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function commandFromArgv(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (!Array.isArray(raw)) return ''
  const argv = raw.filter((item): item is string => typeof item === 'string')
  if (argv.length === 0) return ''
  if (
    argv.length >= 3 &&
    /^(?:.*[/\\])?(?:bash|sh|zsh)(?:\.exe)?$/i.test(argv[0]) &&
    /^-[a-z]*c[a-z]*$/i.test(argv[1])
  ) {
    return argv[2]
  }
  return argv
    .map(word => (/^[A-Za-z0-9_./:@%+=,-]+$/.test(word) ? word : `'${word.replace(/'/g, "'\\''")}'`))
    .join(' ')
}

export async function findCodexRolloutFile(sessionId: string, codexHome?: string): Promise<string | null> {
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(sessionId)) return null
  const root = join(codexHome ?? process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'sessions')
  const entries = async (dir: string): Promise<string[]> => {
    try {
      return (await readdir(dir, { withFileTypes: true }))
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .sort()
        .reverse()
    } catch {
      return []
    }
  }
  const suffix = `${sessionId.toLowerCase()}.jsonl`
  for (const year of await entries(root)) {
    for (const month of await entries(join(root, year))) {
      for (const day of await entries(join(root, year, month))) {
        const folder = join(root, year, month, day)
        try {
          const file = (await readdir(folder)).find(
            name => name.startsWith('rollout-') && name.toLowerCase().endsWith(suffix)
          )
          if (file) return join(folder, file)
        } catch {
          /* unavailable day */
        }
      }
    }
  }
  return null
}

export async function ingestCodexRollout(
  log: HttpAuditLog,
  input: CodexRolloutIngestInput
): Promise<number> {
  try {
    if (!input || typeof input.file !== 'string' || !input.file.trim()) return 0
    const raw = await readFile(input.file, 'utf8')
    const lines = raw.split(/\r?\n/)

    const calls: Array<{ callId: string; command: string; at?: number }> = []
    const outputs = new Map<string, { stdoutHead: string; durationMs: number | null }>()

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let parsed: Record<string, unknown> | null = null
      try {
        parsed = asRecord(JSON.parse(trimmed))
      } catch {
        continue
      }
      if (!parsed || parsed.type !== 'response_item') continue
      const payload = asRecord(parsed.payload)
      if (!payload) continue

      const ts = typeof parsed.timestamp === 'string' ? Date.parse(parsed.timestamp) : Number.NaN
      const at = Number.isFinite(ts) ? ts : undefined
      const itemType = payload.type

      if (itemType === 'function_call' && payload.name === 'shell' && typeof payload.call_id === 'string') {
        let args: Record<string, unknown> | null = null
        if (typeof payload.arguments === 'string') {
          try {
            args = asRecord(JSON.parse(payload.arguments))
          } catch {
            args = null
          }
        } else {
          args = asRecord(payload.arguments)
        }
        const command = commandFromArgv(args?.command)
        if (command) calls.push({ callId: payload.call_id, command, at })
      } else if (itemType === 'local_shell_call' && typeof payload.call_id === 'string') {
        const action = asRecord(payload.action)
        const command = commandFromArgv(action?.command)
        if (command) calls.push({ callId: payload.call_id, command, at })
      } else if (itemType === 'function_call_output' && typeof payload.call_id === 'string') {
        let stdoutHead = ''
        let durationMs: number | null = null
        if (typeof payload.output === 'string') {
          try {
            const outObj = asRecord(JSON.parse(payload.output))
            if (outObj) {
              if (typeof outObj.output === 'string') stdoutHead = outObj.output.slice(0, 4096)
              const meta = asRecord(outObj.metadata)
              if (typeof meta?.duration_seconds === 'number' && Number.isFinite(meta.duration_seconds)) {
                durationMs = Math.max(0, Math.round(meta.duration_seconds * 1000))
              }
            } else {
              stdoutHead = payload.output.slice(0, 4096)
            }
          } catch {
            stdoutHead = payload.output.slice(0, 4096)
          }
        }
        outputs.set(payload.call_id, { stdoutHead, durationMs })
      }
    }

    let added = 0
    for (const call of calls) {
      const out = outputs.get(call.callId)
      added += log.ingest({
        paneId: input.paneId,
        workspaceId: input.workspaceId,
        agent: 'codex',
        sessionId: input.sessionId,
        at: call.at,
        source: 'rollout',
        durationMs: out?.durationMs ?? null,
        record: {
          hook_event_name: 'PostToolUse',
          tool_name: 'shell',
          tool_use_id: call.callId,
          session_id: input.sessionId,
          tool_input: { command: call.command },
          tool_response: {
            stdoutHead: out?.stdoutHead ?? '',
            stderrHead: '',
            interrupted: false
          }
        }
      })
    }
    return added
  } catch {
    return 0
  }
}
