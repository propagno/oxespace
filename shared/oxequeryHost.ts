/**
 * A host as people paste it: "https://db.example.com:5432/app", "user@db:5432",
 * "db.example.com/" or a bare name. Returns the host name alone and the port
 * when one was written after it. IPv6 literals keep their brackets off.
 */
export function splitHostInput(value: string): { host: string; port?: number } {
  let text = value.trim()
  text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
  const at = text.lastIndexOf('@')
  if (at >= 0 && !text.slice(0, at).includes('/')) text = text.slice(at + 1)
  text = text.replace(/[/?#].*$/, '')
  const bracketed = /^\[([^\]]+)\](?::(\d{1,5}))?$/.exec(text)
  if (bracketed) return { host: bracketed[1], ...(bracketed[2] ? { port: Number(bracketed[2]) } : {}) }
  const withPort = /^([^:]+):(\d{1,5})$/.exec(text)
  if (withPort) return { host: withPort[1], port: Number(withPort[2]) }
  return { host: text }
}
