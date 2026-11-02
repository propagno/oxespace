/** OxePost: the request model shared by the main process (files, sending) and the page. */

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const
export type HttpMethod = (typeof HTTP_METHODS)[number]

export interface PostHeader { name: string; value: string; enabled: boolean }

export type PostAuth =
  | { type: 'none' }
  | { type: 'bearer'; token: string }
  | { type: 'basic'; username: string; password: string }
  | { type: 'apikey'; in: 'header' | 'query'; name: string; value: string }

/** One request, as it lives in a file of `.oxespace/requests/`. Values may hold `{{variables}}`. */
export interface PostRequest {
  name: string
  method: HttpMethod
  url: string
  headers: PostHeader[]
  auth: PostAuth
  body: string
  description?: string
}

/** A request in the tree: where it is and enough to draw its row. */
export interface PostRequestEntry { path: string; name: string; method: HttpMethod | null; folder: string; problem?: string }

/** An environment file: `.oxespace/requests/environments/<id>.json`. Secret values are never in it, only their names. */
export interface PostEnvironment {
  id: string
  name: string
  /** Production asks for a confirmation before every send and is drawn in the danger color. */
  production: boolean
  variables: Record<string, string>
  /** Names of the secrets this environment uses; the values live in the system's secure storage. */
  secrets: string[]
}

/** What the page sees of an environment: secrets only as "set" or "not set". */
export interface PostEnvironmentView extends PostEnvironment { secretState: Record<string, 'set' | 'not set'> }

export interface PostSendInput {
  workspaceId: string
  request: PostRequest
  environment?: string
  timeoutMs?: number
  /** The person confirmed sending to a production environment. */
  confirmed?: boolean
}

export interface PostResponse {
  status: number
  statusText: string
  ms: number
  /** Bytes received in the body (all of it, even past the cap). */
  size: number
  headers: Array<{ name: string; value: string }>
  /** The body as text, cut at the cap; empty for binary content. */
  body: string
  truncated: boolean
  binary: boolean
  contentType: string
  /** The URL after variables and redirects, with secrets masked. */
  url: string
}

export interface PostHistoryEntry {
  id: string
  at: number
  method: HttpMethod
  url: string
  environment?: string
  status?: number
  ms?: number
  size?: number
  error?: string
  /** Request headers with secrets redacted. */
  requestHeaders: Array<{ name: string; value: string }>
}

export type PostOp =
  | 'list' | 'read' | 'save' | 'rename' | 'delete'
  | 'envSave' | 'envDelete' | 'secretSet' | 'secretClear'
  | 'send' | 'history'

export type PostApiResult<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string; /** The message as a code the window translates (C3). */ messageCode?: import('../messages').MainMessage } }

export interface OxePostApi {
  call(op: PostOp, input: unknown): Promise<PostApiResult<unknown>>
}

export class PostFormatError extends Error {
  constructor(message: string, readonly line?: number) { super(line ? `Line ${line}: ${message}` : message); this.name = 'PostFormatError' }
}

export const REQUESTS_DIR = '.oxespace/requests'
export const ENVIRONMENTS_DIR = 'environments'
export const REQUEST_EXTENSION = '.http'
/** Limits shared by the files and the sender. */
export const LIMITS = { requestFileBytes: 256 * 1024, entries: 500, depth: 4, requestBodyBytes: 5 * 1024 * 1024, responseBodyBytes: 2 * 1024 * 1024, defaultTimeoutMs: 30_000, maxTimeoutMs: 120_000, history: 50 } as const
