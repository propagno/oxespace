import type { PostEnvironmentView, PostOp, PostRequest, PostRequestEntry, PostResponse, PostHistoryEntry } from '../../../shared/oxepost/types'

export class PostError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'PostError' }
}

/** Results of each operation, as the main process returns them. */
export interface PostResults {
  list: { requests: PostRequestEntry[]; environments: PostEnvironmentView[]; secretsProblem: string | null }
  read: PostRequest
  save: { path: string }
  rename: { path: string }
  delete: Record<string, never>
  envSave: { id: string; environments: PostEnvironmentView[] }
  envDelete: { environments: PostEnvironmentView[] }
  secretSet: { environments: PostEnvironmentView[] }
  secretClear: { environments: PostEnvironmentView[] }
  send: PostResponse
  history: PostHistoryEntry[]
}

/** One call to the main process; a refusal becomes a `PostError` carrying the code. */
export async function post<Op extends PostOp>(op: Op, input: Record<string, unknown>): Promise<PostResults[Op]> {
  const api = window.oxe?.oxePost
  if (!api) throw new PostError('failed', 'OxePost is not available in this window')
  const result = await api.call(op, input)
  if (!result.ok) throw new PostError(result.error.code, result.error.message)
  return result.value as PostResults[Op]
}

export const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error)
