import type { McpServer } from '../../../shared/types/mcp'

/** A server that changed after the person trusted it: untrusted, refused at start, until the person trusts it again. */
export const isQuarantined = (server: McpServer): boolean => Boolean(server.guard?.quarantine)

export const quarantinedCount = (servers: readonly McpServer[]): number => servers.reduce((total, server) => total + (isQuarantined(server) ? 1 : 0), 0)
