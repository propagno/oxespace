/**
 * Kept as a re-export so the ~10 existing `services/github.service` imports —
 * IPC, the internal MCP, the RPC server, linear, oxe-context and the benches —
 * did not all have to change in the same commit that split the class.
 *
 * The implementation lives in ./github/. New code should import from there.
 */
export {
  GhExec,
  GitHubService,
  GitHubActionsService,
  GitHubCheckpointService,
  GitHubRepositoryService,
  GitHubReviewService
} from './github/index'
export type { SpawnAsyncFn, SpawnAsyncOptions, SpawnResult } from './github/index'
