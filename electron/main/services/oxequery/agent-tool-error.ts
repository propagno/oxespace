/**
 * What the model is told when a call is refused; never carries a stack or a server message that was not redacted.
 *
 * Its own module: the MCP tool table (loaded with the main entry) only needs this class to recognise a refusal,
 * while the gateway that throws it loads with OxeQuery, on demand.
 */
export class AgentToolError extends Error {
  constructor(message: string, readonly code: string = 'refused') { super(message) }
}
