import { load as loadYaml } from 'js-yaml'
import { slugify } from './format'
import type { HttpMethod, PostAuth, PostHeader, PostRequest } from './types'

type Json = Record<string, unknown>
export interface OpenApiImport {
  title: string
  /** The first server of the document, to put in an environment as `baseUrl`. */
  baseUrl: string
  requests: Array<{ folder: string; request: PostRequest }>
  warnings: string[]
}

const METHODS: HttpMethod[] = ['GET', 'PUT', 'POST', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']
const MAX_OPERATIONS = 500
const MAX_DEPTH = 6

const isObject = (value: unknown): value is Json => !!value && typeof value === 'object' && !Array.isArray(value)

/** Reads an OpenAPI 3 document (JSON or YAML) into requests, one per operation, grouped by tag. */
export function parseOpenApi(text: string): OpenApiImport {
  let document: unknown
  try { document = text.trimStart().startsWith('{') ? JSON.parse(text) : loadYaml(text) } catch (error) { throw new Error(`The document is neither valid JSON nor YAML: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`) }
  if (!isObject(document)) throw new Error('The document is not an OpenAPI description')
  const version = typeof document.openapi === 'string' ? document.openapi : ''
  if (!version.startsWith('3.')) throw new Error(document.swagger ? 'Swagger 2 is not supported; convert it to OpenAPI 3 first' : 'This is not an OpenAPI 3 document (the "openapi" field is missing)')
  const warnings: string[] = []
  const root = document

  const resolve = (value: unknown, seen: string[] = []): unknown => {
    if (!isObject(value) || typeof value.$ref !== 'string') return value
    const ref = value.$ref
    if (!ref.startsWith('#/') || seen.includes(ref) || seen.length > MAX_DEPTH) return undefined
    let node: unknown = root
    for (const part of ref.slice(2).split('/')) node = isObject(node) ? node[part.replace(/~1/g, '/').replace(/~0/g, '~')] : undefined
    return resolve(node, [...seen, ref])
  }

  const example = (schema: unknown, depth = 0): unknown => {
    const node = resolve(schema)
    if (!isObject(node) || depth > MAX_DEPTH) return null
    if (node.example !== undefined) return node.example
    if (node.default !== undefined) return node.default
    if (Array.isArray(node.enum) && node.enum.length) return node.enum[0]
    const variant = [node.oneOf, node.anyOf].find(Array.isArray) as unknown[] | undefined
    if (variant?.length) return example(variant[0], depth + 1)
    if (Array.isArray(node.allOf)) return Object.assign({}, ...node.allOf.map(part => { const sample = example(part, depth + 1); return isObject(sample) ? sample : {} }))
    const type = node.type ?? (isObject(node.properties) ? 'object' : undefined)
    if (type === 'object') return Object.fromEntries(Object.entries(isObject(node.properties) ? node.properties : {}).map(([key, child]) => [key, example(child, depth + 1)]))
    if (type === 'array') return [example(node.items, depth + 1)]
    if (type === 'integer' || type === 'number') return 0
    if (type === 'boolean') return false
    if (type === 'string') return node.format === 'date-time' ? '2024-01-01T00:00:00Z' : node.format === 'date' ? '2024-01-01' : 'string'
    return null
  }

  const servers = Array.isArray(root.servers) ? root.servers : []
  const first = isObject(servers[0]) ? servers[0] : undefined
  const baseUrl = typeof first?.url === 'string' ? first.url.replace(/\{([^}]+)\}/g, (_whole, name: string) => {
    const variable = isObject(first.variables) && isObject(first.variables[name]) ? first.variables[name] : undefined
    return typeof variable?.default === 'string' ? variable.default : `{{${name}}}`
  }).replace(/\/+$/, '') : ''
  const components = isObject(root.components) ? root.components : {}
  const schemes = isObject(components.securitySchemes) ? components.securitySchemes : {}

  const authFor = (operation: Json): PostAuth => {
    const requirement = (Array.isArray(operation.security) ? operation.security : Array.isArray(root.security) ? root.security : [])[0]
    const name = isObject(requirement) ? Object.keys(requirement)[0] : undefined
    const scheme = name ? resolve(schemes[name]) : undefined
    if (!isObject(scheme)) return { type: 'none' }
    if (scheme.type === 'http' && String(scheme.scheme).toLowerCase() === 'bearer') return { type: 'bearer', token: '{{token}}' }
    if (scheme.type === 'http' && String(scheme.scheme).toLowerCase() === 'basic') return { type: 'basic', username: '{{username}}', password: '{{password}}' }
    if (scheme.type === 'apiKey' && (scheme.in === 'header' || scheme.in === 'query') && typeof scheme.name === 'string') return { type: 'apikey', in: scheme.in, name: scheme.name, value: '{{apiKey}}' }
    if (scheme.type === 'oauth2' || scheme.type === 'openIdConnect') return { type: 'bearer', token: '{{token}}' }
    return { type: 'none' }
  }

  const requests: OpenApiImport['requests'] = []
  const paths = isObject(root.paths) ? root.paths : {}
  outer: for (const [path, rawItem] of Object.entries(paths)) {
    const item = resolve(rawItem)
    if (!isObject(item)) continue
    for (const method of METHODS) {
      const operation = resolve(item[method.toLowerCase()])
      if (!isObject(operation)) continue
      if (requests.length >= MAX_OPERATIONS) { warnings.push(`Only the first ${MAX_OPERATIONS} operations were imported`); break outer }
      const parameters = [...(Array.isArray(item.parameters) ? item.parameters : []), ...(Array.isArray(operation.parameters) ? operation.parameters : [])].map(parameter => resolve(parameter)).filter(isObject)
      const query: string[] = []
      const headers: PostHeader[] = []
      for (const parameter of parameters) {
        const name = typeof parameter.name === 'string' ? parameter.name : ''
        if (!name) continue
        if (parameter.in === 'query' && parameter.required === true) query.push(`${encodeURIComponent(name)}={{${name}}}`)
        else if (parameter.in === 'header' && parameter.required === true && !/^(authorization|content-type|accept)$/i.test(name)) headers.push({ name, value: `{{${name}}}`, enabled: true })
      }
      let body = ''
      const content = isObject(operation.requestBody) || isObject(resolve(operation.requestBody)) ? (resolve(operation.requestBody) as Json).content : undefined
      if (isObject(content)) {
        const json = Object.entries(content).find(([type]) => /json/i.test(type))
        if (json && isObject(json[1])) {
          const media = json[1]
          const examples = isObject(media.examples) ? Object.values(media.examples).map(entry => resolve(entry)).find(isObject) : undefined
          const sample = media.example ?? examples?.value ?? example(media.schema)
          body = JSON.stringify(sample, null, 2)
          headers.push({ name: 'Content-Type', value: json[0], enabled: true })
        } else if (Object.keys(content).length) warnings.push(`${method} ${path}: the body type ${Object.keys(content)[0]} was left empty`)
      }
      const tag = Array.isArray(operation.tags) && typeof operation.tags[0] === 'string' ? operation.tags[0] : path.split('/').filter(part => part && !part.startsWith('{'))[0] ?? 'api'
      const title = typeof operation.summary === 'string' && operation.summary.trim() ? operation.summary.trim() : typeof operation.operationId === 'string' ? operation.operationId : `${method} ${path}`
      const url = `{{baseUrl}}${path.replace(/\{([^}]+)\}/g, '{{$1}}')}${query.length ? `?${query.join('&')}` : ''}`
      const description = typeof operation.description === 'string' ? operation.description.split(/\r?\n/).find(line => line.trim())?.trim().slice(0, 200) : undefined
      requests.push({ folder: slugify(tag), request: { name: title.slice(0, 80), method, url, headers, auth: authFor(operation), body, ...(description ? { description } : {}) } })
    }
  }
  if (requests.length === 0) throw new Error('The document has no operations under "paths"')
  const info = isObject(root.info) ? root.info : {}
  return { title: typeof info.title === 'string' ? info.title : 'API', baseUrl, requests, warnings }
}
