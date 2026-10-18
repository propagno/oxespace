/** The readable part of an error from an IPC call, without Electron's "Error invoking remote method" prefix. */
export function threadError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '') || 'Could not complete the action.'
}
