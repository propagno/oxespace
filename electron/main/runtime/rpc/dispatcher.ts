/**
 * F3 · RPC dispatcher — a JSON-RPC 2.0 subset over a local stream transport.
 *
 * Deliberately separate from IPC: IPC serves the renderer, this serves
 * out-of-process callers (the CLI today, an orchestration coordinator next).
 * Methods are registered in one place so the surface is auditable.
 */

export interface RpcRequest {
  jsonrpc?: string
  id?: string | number | null
  method: string
  params?: unknown
}

export interface RpcSuccess {
  jsonrpc: '2.0'
  id: string | number | null
  result: unknown
}

export interface RpcFailure {
  jsonrpc: '2.0'
  id: string | number | null
  error: { code: number; message: string }
}

export type RpcResponse = RpcSuccess | RpcFailure

export const RPC_ERRORS = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603
} as const

export type RpcMethod = (params: unknown) => Promise<unknown> | unknown

export class RpcDispatcher {
  private readonly methods = new Map<string, RpcMethod>()

  register(name: string, method: RpcMethod): this {
    if (this.methods.has(name)) throw new Error(`RPC method already registered: ${name}`)
    this.methods.set(name, method)
    return this
  }

  registerAll(methods: Record<string, RpcMethod>): this {
    for (const [name, method] of Object.entries(methods)) this.register(name, method)
    return this
  }

  /** Names of every registered method, for `rpc.methods` and diagnostics. */
  list(): string[] {
    return [...this.methods.keys()].sort()
  }

  async dispatch(request: RpcRequest): Promise<RpcResponse> {
    const id = request?.id ?? null

    if (!request || typeof request.method !== 'string' || !request.method) {
      return failure(id, RPC_ERRORS.invalidRequest, 'Request must include a method name')
    }

    const method = this.methods.get(request.method)
    if (!method) {
      return failure(id, RPC_ERRORS.methodNotFound, `Unknown method: ${request.method}`)
    }

    try {
      const result = await method(request.params ?? {})
      return { jsonrpc: '2.0', id, result: result ?? null }
    } catch (error) {
      // Params validation throws RpcInvalidParams; everything else is internal.
      const code = error instanceof RpcInvalidParams ? RPC_ERRORS.invalidParams : RPC_ERRORS.internalError
      return failure(id, code, error instanceof Error ? error.message : 'Unexpected RPC error')
    }
  }
}

/** Thrown by method param parsers so the dispatcher can map it to -32602. */
export class RpcInvalidParams extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RpcInvalidParams'
  }
}

export function expectParamsRecord(params: unknown, method: string): Record<string, unknown> {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    throw new RpcInvalidParams(`${method} expects an object of params`)
  }
  return params as Record<string, unknown>
}

export function expectParamString(params: Record<string, unknown>, key: string): string {
  const value = params[key]
  if (typeof value !== 'string' || !value.trim()) throw new RpcInvalidParams(`${key} must be a non-empty string`)
  return value
}

export function optionalParamString(params: Record<string, unknown>, key: string): string | null {
  const value = params[key]
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || !value.trim()) throw new RpcInvalidParams(`${key} must be a non-empty string`)
  return value
}

function failure(id: string | number | null, code: number, message: string): RpcFailure {
  return { jsonrpc: '2.0', id, error: { code, message } }
}
