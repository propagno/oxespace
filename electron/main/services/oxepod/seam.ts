import type { ContainerRuntime } from './container-runtime'

/**
 * What OxeQuery may call on OxePod, in process: the seam between the two products. OxeQuery reads the database a
 * container runs (with its password, which never leaves the main process), makes a database container for a new
 * connection, and serves the agents' container tools behind its own opt-in, approval and audit.
 */
export type OxePodSeam = Pick<ContainerRuntime, 'list' | 'logsTail' | 'action' | 'suggestConnection' | 'createDatabase'>
