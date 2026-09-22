import { ThreadOrchestrator } from './thread-orchestrator'

/**
 * Stable public boundary for Thread IPC/runtime consumers. Runtime coordination
 * lives in ThreadOrchestrator; persistence, requests, sessions, exports,
 * portable packages and checkpoints are separate services behind it.
 */
export class ThreadManager extends ThreadOrchestrator {}
