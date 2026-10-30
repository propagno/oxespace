import { randomUUID } from 'node:crypto'
import { coerceEnvironment, coerceRequest } from '../../../../shared/oxepost/coerce'
import { isSensitiveName, maskValues, redactHeaders, redactUrl } from '../../../../shared/oxepost/redact'
import { resolveRequest } from '../../../../shared/oxepost/variables'
import { LIMITS, type PostApiResult, type PostEnvironmentView, type PostHistoryEntry, type PostOp, type PostResponse } from '../../../../shared/oxepost/types'
import { SecretStore, type SecretVault } from './secrets'
import { sendRequest, SendError, type SendOptions } from './send'
import { RequestStore } from './store'

export interface OxePostDeps {
  /** The folder of a workspace, or undefined when the id is unknown. */
  rootOf(workspaceId: string): string | undefined
  vault: SecretVault
  secretsFile: string
  send?: SendOptions
}

class Refusal extends Error { constructor(readonly code: string, message: string) { super(message) } }
const record = (value: unknown): Record<string, unknown> => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Refusal('invalid', 'The request is malformed'); return value as Record<string, unknown> }
const string = (value: unknown, label: string, max = 600): string => { if (typeof value !== 'string' || !value || value.length > max || value.includes('\0')) throw new Refusal('invalid', `${label} is not valid`); return value }

/** Collections, environments, secrets and sending for the OxePost view. One instance serves every workspace. */
export class OxePostService {
  private readonly secrets: SecretStore
  private readonly stores = new Map<string, RequestStore>()
  private readonly history = new Map<string, PostHistoryEntry[]>()
  constructor(private readonly deps: OxePostDeps) { this.secrets = new SecretStore(deps.secretsFile, deps.vault) }

  private store(input: Record<string, unknown>): RequestStore {
    const root = this.deps.rootOf(string(input.workspaceId, 'The workspace', 200))
    if (!root) throw new Refusal('invalid', 'The workspace was not found')
    let store = this.stores.get(root)
    if (!store) this.stores.set(root, store = new RequestStore(root))
    return store
  }

  async call(op: PostOp, rawInput: unknown): Promise<PostApiResult<unknown>> {
    try { return { ok: true, value: await this.run(op, record(rawInput)) } } catch (error) {
      if (error instanceof Refusal) return { ok: false, error: { code: error.code, message: error.message } }
      if (error instanceof SendError) return { ok: false, error: { code: error.code, message: error.message } }
      const code = (error as NodeJS.ErrnoException).code
      const message = code === 'ENOENT' ? 'That file no longer exists' : error instanceof Error ? error.message : 'Something went wrong'
      return { ok: false, error: { code: code === 'ENOENT' ? 'missing' : 'failed', message } }
    }
  }

  private async view(store: RequestStore): Promise<PostEnvironmentView[]> {
    const environments = await store.listEnvironments()
    return Promise.all(environments.map(async environment => {
      const set = new Set(await this.secrets.names(store.root, environment.id))
      return { ...environment, secretState: Object.fromEntries(environment.secrets.map(name => [name, set.has(name) ? 'set' as const : 'not set' as const])) }
    }))
  }

  private async run(op: PostOp, input: Record<string, unknown>): Promise<unknown> {
    switch (op) {
      case 'list': {
        const store = this.store(input)
        const { requests } = await store.list()
        return { requests, environments: await this.view(store), secretsProblem: this.deps.vault.problem() }
      }
      case 'read': return this.store(input).read(input.path)
      case 'save': return { path: await this.store(input).save(input.path, coerceRequest(input.request), input.folder) }
      case 'rename': return { path: await this.store(input).rename(input.path, string(input.name, 'The name', 200)) }
      case 'delete': await this.store(input).delete(input.path); return {}
      case 'envSave': {
        const store = this.store(input)
        const id = typeof input.id === 'string' && input.id ? input.id : undefined
        const environment = coerceEnvironment(input.environment)
        if (!id && (await store.listEnvironments()).some(item => item.name.toLowerCase() === environment.name.toLowerCase())) throw new Refusal('exists', 'An environment with this name already exists')
        const saved = await store.saveEnvironment(environment, id)
        // A secret no longer listed has no reason to stay in the vault.
        for (const name of await this.secrets.names(store.root, saved.id)) if (!saved.secrets.includes(name)) await this.secrets.clear(store.root, saved.id, name)
        return { id: saved.id, environments: await this.view(store) }
      }
      case 'envDelete': {
        const store = this.store(input)
        const id = string(input.id, 'The environment', 60)
        await store.deleteEnvironment(id)
        await this.secrets.clear(store.root, id)
        return { environments: await this.view(store) }
      }
      case 'secretSet': case 'secretClear': {
        const store = this.store(input)
        const id = string(input.environment, 'The environment', 60), name = string(input.name, 'The secret', 64)
        const environment = await store.readEnvironment(id)
        if (!environment.secrets.includes(name)) throw new Refusal('invalid', `"${name}" is not a secret of this environment`)
        if (op === 'secretSet') await this.secrets.set(store.root, id, name, typeof input.value === 'string' ? input.value : '')
        else await this.secrets.clear(store.root, id, name)
        return { environments: await this.view(store) }
      }
      case 'history': return this.history.get(this.store(input).root) ?? []
      case 'send': return this.send(input)
      default: throw new Refusal('invalid', 'Unknown operation')
    }
  }

  private async send(input: Record<string, unknown>): Promise<PostResponse> {
    const store = this.store(input)
    const request = coerceRequest(input.request)
    const values: Record<string, string> = {}
    const secretList: Array<{ name: string; value: string }> = []
    let environmentName: string | undefined
    if (typeof input.environment === 'string' && input.environment) {
      const environment = await store.readEnvironment(input.environment)
      environmentName = environment.name
      if (environment.production && input.confirmed !== true) throw new Refusal('confirm', `${environment.name} is a production environment: confirm before sending`)
      Object.assign(values, environment.variables)
      const stored = await this.secrets.values(store.root, environment.id)
      for (const name of environment.secrets) { const value = stored[name]; if (value !== undefined) { values[name] = value; secretList.push({ name, value }) } }
    }
    const { request: resolved, missing } = resolveRequest(request, values)
    if (missing.length) throw new Refusal('missing', `No value for ${missing.map(name => `{{${name}}}`).join(', ')}. Add ${missing.length === 1 ? 'it' : 'them'} to the environment or choose another one.`)
    const requestHeaders = redactHeaders(maskedHeaders(resolved, secretList))
    const entry: PostHistoryEntry = { id: randomUUID(), at: Date.now(), method: resolved.method, url: redactUrl(maskValues(resolved.url, secretList)), ...(environmentName ? { environment: environmentName } : {}), requestHeaders }
    const timeoutMs = typeof input.timeoutMs === 'number' ? input.timeoutMs : undefined
    try {
      const response = await sendRequest(resolved, { ...this.deps.send, ...(timeoutMs ? { timeoutMs } : {}) })
      entry.status = response.status; entry.ms = response.ms; entry.size = response.size
      this.remember(store.root, entry)
      // What the response echoes of a secret is hidden from the page as well.
      return { ...response, url: maskValues(response.url, secretList), body: maskValues(response.body, secretList), headers: response.headers.map(header => ({ name: header.name, value: maskValues(header.value, secretList) })) }
    } catch (error) {
      entry.error = maskValues(error instanceof Error ? error.message : 'The request failed', secretList)
      this.remember(store.root, entry)
      throw error
    }
  }

  private remember(root: string, entry: PostHistoryEntry): void {
    const list = this.history.get(root) ?? []
    list.unshift(entry)
    this.history.set(root, list.slice(0, LIMITS.history))
  }
}

/** Every header that would be sent, auth included, with secret values masked (names that look like credentials are then redacted). */
function maskedHeaders(request: ReturnType<typeof resolveRequest>['request'], secrets: Array<{ name: string; value: string }>): Array<{ name: string; value: string }> {
  const list = request.headers.filter(header => header.enabled && header.name.trim()).map(header => ({ name: header.name, value: maskValues(header.value, secrets) }))
  const auth = request.auth
  if (auth.type === 'bearer' || auth.type === 'basic') list.push({ name: 'Authorization', value: '[auth]' })
  else if (auth.type === 'apikey' && auth.in === 'header') list.push({ name: auth.name, value: isSensitiveName(auth.name) ? '[redacted]' : '[auth]' })
  return list
}
