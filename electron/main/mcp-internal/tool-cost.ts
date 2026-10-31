import type { ToolEntry } from './tool-registry'

/**
 * What a provider receives for tools on every request, in characters: the name, description and input schema of each
 * definition. The same measure drives Settings › Tools and the CI budget test (T8), so both show the same numbers.
 */
export function toolDefinitionChars(registry: readonly ToolEntry[], names: readonly string[]): number {
  return JSON.stringify(registry.map(entry => entry.descriptor).filter(descriptor => names.includes(descriptor.name))
    .map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))).length
}

/** The fixed cost on demand: with tool search, a client sees only the names until it loads a definition. */
export function toolNameChars(names: readonly string[]): number {
  return names.length ? JSON.stringify(names).length : 0
}
