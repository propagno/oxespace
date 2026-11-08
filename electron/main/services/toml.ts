/**
 * Just enough TOML to write one table block (`[mcp_servers.name]`) whose values are strings or string arrays.
 * Not a general serializer. Strings use double quotes and escape `\` and `"`.
 */
function quoteString(s: string): string {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
}

function serializeTomlTableBody(values: Record<string, string | string[]>): string {
  const lines: string[] = []
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'string') lines.push(`${key} = ${quoteString(value)}`)
    else if (Array.isArray(value) && value.every(v => typeof v === 'string')) lines.push(`${key} = [${value.map(quoteString).join(', ')}]`)
    else throw new Error(`Unsupported TOML value type for key "${key}"`)
  }
  return lines.join('\n')
}

/** A full table block: the header line and its body, ready to insert into a TOML file. */
export function buildTomlTable(header: string, values: Record<string, string | string[]>): string {
  return `[${header}]\n${serializeTomlTableBody(values)}`
}
