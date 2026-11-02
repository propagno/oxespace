import { closeSync, openSync, readSync } from 'node:fs'
import { join } from 'node:path'
import { BrowserWindow } from 'electron'
import { parseOneOf } from './ipc-guards'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { LAYER_ORDER, type PolicyChangeAnswerInput, type PolicyChangedEvent, type PolicyView } from '../../../shared/policy'
import type { AppDatabase } from '../db'
import { approvalCenter } from '../services/approvals'
import { acceptedConfig, policyStore, setAcceptedConfig } from '../services/policy'
import { AcceptedConfig, type Subject } from '../services/policy/accepted-config'
import { effectiveToolConfig, toolConfigSubject } from '../services/policy/tool-config'
import { OXE_YAML_FILE } from '../services/repo-config/parser'

/** The first `max` bytes of a file as text, without reading the rest (a policy file can be any size on disk). */
function readHead(path: string, max: number): string | null {
  let fd: number | undefined
  try {
    fd = openSync(path, 'r')
    const buffer = Buffer.alloc(max)
    const read = readSync(fd, buffer, 0, buffer.length, 0)
    return buffer.subarray(0, read).toString('utf8')
  } catch { return null } finally { if (fd !== undefined) try { closeSync(fd) } catch { /* closed */ } }
}

const HASH = /^[0-9a-f]{64}$/

function answerInput(value: unknown): PolicyChangeAnswerInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid policy change input')
  const input = value as Record<string, unknown>
  if (Object.keys(input).some(key => !['workspaceId', 'layer', 'file', 'baseHash', 'newHash'].includes(key))) throw new Error('Unknown policy change field')
  if (input.workspaceId != null && (typeof input.workspaceId !== 'string' || input.workspaceId.length > 200)) throw new Error('Invalid workspace')
  if (typeof input.baseHash !== 'string' || !HASH.test(input.baseHash) || typeof input.newHash !== 'string' || !HASH.test(input.newHash)) throw new Error('Invalid policy version')
  return {
    workspaceId: (input.workspaceId as string | null | undefined) ?? null,
    layer: parseOneOf(input.layer, LAYER_ORDER, 'layer'),
    file: parseOneOf(input.file, ['policy', 'oxe.yaml'] as const, 'file'),
    baseHash: input.baseHash,
    newHash: input.newHash
  }
}

export interface PolicyRuntime {
  get(workspaceId: unknown): PolicyView
  accept(value: unknown): PolicyView
  review(value: unknown): PolicyView
}

/**
 * B7.4 behind Settings › Policy, loaded by registerPolicyIpc and awaited before any window or agent starts: the
 * accepted versions (accepted-config.ts) wired to the database, the approval center and the window, and the person's
 * answers to a change made outside OXESpace. It lives in its own chunk, so the main entry carries only the handlers.
 */
export function createPolicyRuntime(rootOf: (workspaceId: string) => string | undefined, deps?: {
  db: AppDatabase
  executions?: { liveWithin(root: string): number }
}): PolicyRuntime {
  if (deps) {
    const gate = new AcceptedConfig({ db: deps.db })
    gate.connect({
      ask: (draft, signal, onAsked) => approvalCenter.ask(draft, signal, onAsked),
      reissue: (id, draft) => approvalCenter.reissue(id, draft),
      liveSessions: root => deps.executions?.liveWithin(root) ?? 0,
      readText: readHead,
      notify: (subject, message) => {
        const event: PolicyChangedEvent = { layer: subject.layer, file: subject.file, path: subject.path, message }
        for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.policy.onChanged, event)
      }
    })
    setAcceptedConfig(gate)
  }

  const view = (root: string | undefined): PolicyView => {
    const store = policyStore()
    if (!store) return { sources: [], problems: [], locations: [] }
    const loaded = store.load(root)
    const gate = acceptedConfig()
    const yaml = root ? toolConfigSubject(root) : null
    if (root) effectiveToolConfig(root)
    const subjects = [...store.subjects(root), ...(yaml ? [yaml] : [])]
    // Opening Settings is a review point: a change whose request ended unanswered is asked again.
    gate?.reviewPoint(subjects)
    return { ...loaded, locations: store.locations(root), ...(gate ? { changes: gate.status(subjects) } : {}) }
  }
  const rootFor = (workspaceId: string | null | undefined) => typeof workspaceId === 'string' && workspaceId ? rootOf(workspaceId) : undefined
  const subjectOf = (input: PolicyChangeAnswerInput): { root: string | undefined; subject: Subject } => {
    const gate = acceptedConfig()
    const store = policyStore()
    if (!gate || !store) throw new Error('Policy is not available')
    const root = rootFor(input.workspaceId)
    if (input.file === 'oxe.yaml') {
      if (input.layer !== 'project' || !root) throw new Error('oxe.yaml belongs to a project')
      return { root, subject: gate.subject('oxe.yaml', 'project', root, join(root, OXE_YAML_FILE)) }
    }
    const location = store.locations(root).find(item => item.layer === input.layer)
    if (!location) throw new Error('That policy layer does not apply here')
    return { root, subject: gate.subject('policy', input.layer, root ?? null, location.path) }
  }

  return {
    get: (workspaceId) => view(rootFor(typeof workspaceId === 'string' ? workspaceId : null)),
    accept: (value) => {
      const input = answerInput(value)
      const { root, subject } = subjectOf(input)
      view(root)
      acceptedConfig()!.accept(subject, input.baseHash, input.newHash)
      return view(root)
    },
    review: (value) => {
      const input = answerInput(value)
      const { root, subject } = subjectOf(input)
      view(root)
      acceptedConfig()!.review(subject, input.baseHash, input.newHash)
      return view(root)
    }
  }
}
