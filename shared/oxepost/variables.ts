import type { PostAuth, PostRequest } from './types'

const VARIABLE = /\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}/g

/** The names of the `{{variables}}` used in a text, in order of appearance, without repeats. */
export function findVariables(text: string): string[] {
  return [...new Set([...text.matchAll(VARIABLE)].map(match => match[1]!))]
}

/** Replaces `{{name}}` with its value in one pass (a value that holds `{{x}}` is not expanded again). Unknown names stay and are reported. */
export function interpolate(text: string, values: Readonly<Record<string, string>>): { text: string; missing: string[] } {
  const missing = new Set<string>()
  const result = text.replace(VARIABLE, (whole, name: string) => {
    if (Object.prototype.hasOwnProperty.call(values, name)) return values[name]!
    missing.add(name)
    return whole
  })
  return { text: result, missing: [...missing] }
}

/** A request with every variable replaced; `missing` lists the names with no value. */
export function resolveRequest(request: PostRequest, values: Readonly<Record<string, string>>): { request: PostRequest; missing: string[] } {
  const missing = new Set<string>()
  const apply = (text: string): string => { const done = interpolate(text, values); done.missing.forEach(name => missing.add(name)); return done.text }
  const auth: PostAuth = request.auth.type === 'bearer' ? { type: 'bearer', token: apply(request.auth.token) }
    : request.auth.type === 'basic' ? { type: 'basic', username: apply(request.auth.username), password: apply(request.auth.password) }
    : request.auth.type === 'apikey' ? { type: 'apikey', in: request.auth.in, name: apply(request.auth.name), value: apply(request.auth.value) }
    : request.auth
  return {
    request: {
      ...request, url: apply(request.url), body: apply(request.body), auth,
      headers: request.headers.map(header => ({ ...header, name: apply(header.name), value: apply(header.value) }))
    },
    missing: [...missing]
  }
}
