/*
 * Screen-detection manifests for coding agents.
 *
 * The manifest format, the region names and the matching semantics are ported
 * from herdr (https://github.com/herdrdev/herdr, src/detect/manifest.rs),
 * Copyright the herdr authors, licensed under the Apache License 2.0. The
 * bundled manifests in resources/agent-detection are herdr's, unmodified.
 * Changes: TypeScript port; Rust regex syntax is translated to JavaScript;
 * no remote manifest updates.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'smol-toml'

export type DetectedState = 'idle' | 'working' | 'blocked' | 'unknown'

interface Gate {
  all?: Gate[]
  any?: Gate[]
  not?: Gate[]
  contains?: string[]
  regex?: string[]
  line_regex?: string[]
}

interface Rule extends Gate {
  id: string
  state?: DetectedState
  priority?: number
  region?: string
  visible_idle?: boolean
  visible_blocker?: boolean
  visible_working?: boolean
  skip_state_update?: boolean
}

interface CompiledGate {
  all: CompiledGate[]
  any: CompiledGate[]
  not: CompiledGate[]
  contains: string[]
  regex: RegExp[]
  lineRegex: RegExp[]
}

export interface AgentManifest {
  id: string
  version?: string
  aliases: string[]
  source: 'bundled' | 'override'
  rules: Array<Rule & { compiled: CompiledGate }>
  /** Rules dropped because their pattern has no JavaScript equivalent. */
  skipped: string[]
}

export interface ScreenInput {
  /** The visible screen, one line per row, trailing spaces removed. */
  screen: string
  /** The last OSC 0/2 window title. */
  oscTitle: string
  /** The last OSC 9;4 progress payload, e.g. "4;0". */
  oscProgress: string
}

export interface Detection {
  agent: string
  state: DetectedState
  matchedRule: { id: string; priority: number; region: string } | null
  visibleIdle: boolean
  visibleBlocker: boolean
  visibleWorking: boolean
  /** The screen is a viewer (a transcript), not the agent's live state: keep the previous state. */
  skipStateUpdate: boolean
  /** Set when no rule matched and a known agent is taken to be idle. */
  fallbackReason: string | null
  manifestVersion: string | null
  source: AgentManifest['source']
}

/** Rust regex → JavaScript: leading inline flags, `\x{HHHH}`, Unicode mode. */
export function translateRegex(pattern: string): RegExp {
  let body = pattern
  let flags = 'u'
  const inline = /^\(\?([imsx]+)\)/.exec(body)
  if (inline) {
    for (const flag of inline[1]) if (flag !== 'x' && !flags.includes(flag)) flags += flag
    body = body.slice(inline[0].length)
  }
  // Escape-aware: `\\z` is a literal backslash and z, not an anchor.
  body = body.replace(/\\(x\{[0-9a-fA-F]{1,6}\}|.)/gsu, (whole, escape: string) => {
    if (escape.startsWith('x{')) return `\\u{${escape.slice(2, -1)}}`
    if (escape === 'A') return '(?<![\\s\\S])'
    if (escape === 'z') return '(?![\\s\\S])'
    if (escape === 'Z') return '(?=\\n?(?![\\s\\S]))'
    return whole
  })
  return new RegExp(body, flags)
}

function compile(gate: Gate): CompiledGate {
  return {
    all: (gate.all ?? []).map(compile),
    any: (gate.any ?? []).map(compile),
    not: (gate.not ?? []).map(compile),
    contains: (gate.contains ?? []).map(needle => needle.toLowerCase()),
    regex: (gate.regex ?? []).map(translateRegex),
    lineRegex: (gate.line_regex ?? []).map(translateRegex)
  }
}

function matches(gate: CompiledGate, text: string, lower: string, lines: string[]): boolean {
  if (!gate.contains.every(needle => lower.includes(needle))) return false
  if (!gate.regex.every(regex => regex.test(text))) return false
  if (!gate.lineRegex.every(regex => lines.some(line => regex.test(line)))) return false
  if (!gate.all.every(nested => matches(nested, text, lower, lines))) return false
  if (gate.any.length && !gate.any.some(nested => matches(nested, text, lower, lines))) return false
  if (gate.not.some(nested => matches(nested, text, lower, lines))) return false
  return true
}

export function parseManifest(text: string, source: AgentManifest['source']): AgentManifest {
  const raw = parse(text) as unknown as { id: string; version?: string; aliases?: string[]; rules?: Rule[] }
  if (!raw.id || !Array.isArray(raw.rules)) throw new Error('A manifest needs an id and rules.')
  const rules: AgentManifest['rules'] = []
  const skipped: string[] = []
  for (const rule of raw.rules) {
    if (rule.region && !validRegion(rule.region)) { skipped.push(`${rule.id}: region ${rule.region}`); continue }
    try { rules.push({ ...rule, compiled: compile(rule) }) } catch (error) { skipped.push(`${rule.id}: ${error instanceof Error ? error.message : String(error)}`) }
  }
  return { id: raw.id, version: raw.version, aliases: raw.aliases ?? [], source, rules, skipped }
}

// ---- regions (herdr src/detect/manifest.rs) --------------------------------

const NAMED_REGIONS = new Set(['whole_recent', 'after_last_prompt_marker', 'before_current_prompt_marker', 'whole_recent_without_current_prompt_marker',
  'current_prompt_block_marker', 'after_current_prompt_block_marker', 'prompt_box_body', 'above_prompt_box', 'last_non_empty_above_prompt_box',
  'after_last_horizontal_rule', 'osc_title', 'osc_progress'])

function counted(spec: string, name: string): number | null {
  const match = new RegExp(`^${name}\\((\\d+)\\)$`).exec(spec)
  return match ? Number(match[1]) : null
}

function validRegion(spec: string): boolean {
  const trimmed = spec.trim()
  return NAMED_REGIONS.has(trimmed) || counted(trimmed, 'bottom_lines') !== null || counted(trimmed, 'bottom_non_empty_lines') !== null || (counted(trimmed, 'top_non_empty_lines') ?? 0) > 0
}

const join_ = (lines: string[]) => lines.join('\n')
const isBlank = (line: string) => line.trim() === ''
const codexPromptLine = (line: string) => line === '›' || line.startsWith('› ')
const codexBlockMarkerLine = (line: string) => /^[•■✗✓]/u.test(line)

function isHorizontalRule(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) return false
  let count = 0
  for (const char of trimmed) { if (char !== '─') break; count += 1 }
  if (count === 0) return false
  const suffix = [...trimmed].slice(count).join('').trimStart()
  return suffix === '' || count >= 3
}

function lastIndex<T>(items: T[], test: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) if (test(items[index])) return index
  return -1
}

function currentCodexPromptIndex(lines: string[]): number {
  const prompt = lastIndex(lines, codexPromptLine)
  if (prompt < 0) return -1
  return lines.slice(prompt + 1).some(codexBlockMarkerLine) ? -1 : prompt
}

function promptBoxTop(lines: string[]): number {
  let borders = 0
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (isHorizontalRule(lines[index])) { borders += 1; if (borders === 2) return index }
  }
  return -1
}

export function region(input: ScreenInput, spec: string): string {
  const name = spec.trim()
  if (name === 'osc_title') return input.oscTitle
  if (name === 'osc_progress') return input.oscProgress
  const content = input.screen
  const lines = content.split('\n')
  switch (name) {
    case 'whole_recent': return content
    case 'after_last_prompt_marker': { const index = lastIndex(lines, codexPromptLine); return index < 0 ? content : join_(lines.slice(index + 1)) }
    case 'before_current_prompt_marker': { const index = currentCodexPromptIndex(lines); return index < 0 ? content : join_(lines.slice(0, index)) + (index ? '\n' : '') }
    case 'whole_recent_without_current_prompt_marker': return currentCodexPromptIndex(lines) >= 0 ? '' : content
    case 'current_prompt_block_marker': {
      const prompt = currentCodexPromptIndex(lines)
      if (prompt < 0) return ''
      const block = lastIndex(lines.slice(0, prompt), codexBlockMarkerLine)
      return block < 0 ? '' : lines[block]
    }
    case 'after_current_prompt_block_marker': {
      const prompt = currentCodexPromptIndex(lines)
      if (prompt < 0) return ''
      const block = lastIndex(lines.slice(0, prompt), codexBlockMarkerLine)
      return block < 0 ? '' : join_(lines.slice(block))
    }
    case 'prompt_box_body': {
      const top = promptBoxTop(lines)
      if (top < 0) return ''
      const rest = lines.slice(top + 1)
      const end = rest.findIndex(isHorizontalRule)
      const body = end < 0 ? rest : rest.slice(0, end)
      return body.length ? join_(body) + '\n' : ''
    }
    case 'above_prompt_box': { const top = promptBoxTop(lines); return top < 0 ? content : join_(lines.slice(0, top)) + (top ? '\n' : '') }
    case 'last_non_empty_above_prompt_box': {
      const top = promptBoxTop(lines)
      const above = top < 0 ? lines : lines.slice(0, top)
      const index = lastIndex(above, line => !isBlank(line))
      return index < 0 ? '' : above[index]
    }
    case 'after_last_horizontal_rule': { const index = lastIndex(lines, isHorizontalRule); return index < 0 ? content : join_(lines.slice(index + 1)) }
  }
  const bottom = counted(name, 'bottom_lines')
  if (bottom !== null) return join_(lines.slice(Math.max(0, lines.length - bottom)))
  const nonEmpty = counted(name, 'bottom_non_empty_lines')
  if (nonEmpty !== null) {
    let start = -1, seen = 0
    for (let index = lines.length - 1; index >= 0 && seen < nonEmpty; index -= 1) if (!isBlank(lines[index])) { start = index; seen += 1 }
    return start < 0 ? '' : join_(lines.slice(start))
  }
  const top = counted(name, 'top_non_empty_lines')
  if (top) {
    let end = -1, seen = 0
    for (let index = 0; index < lines.length && seen < top; index += 1) if (!isBlank(lines[index])) { end = index; seen += 1 }
    return end < 0 ? '' : join_(lines.slice(0, end + 1)) + '\n'
  }
  return ''
}

/** The highest-priority matching rule decides; a known agent with no match is idle (herdr's fallback). */
export function detect(manifest: AgentManifest, input: ScreenInput): Detection {
  let best: AgentManifest['rules'][number] | null = null
  for (const rule of manifest.rules) {
    const text = region(input, rule.region ?? 'whole_recent')
    if (!matches(rule.compiled, text, text.toLowerCase(), text.split('\n'))) continue
    if (!best || (rule.priority ?? 0) > (best.priority ?? 0)) best = rule
  }
  const base = { agent: manifest.id, manifestVersion: manifest.version ?? null, source: manifest.source }
  if (!best) return { ...base, state: 'idle', matchedRule: null, visibleIdle: false, visibleBlocker: false, visibleWorking: false, skipStateUpdate: false, fallbackReason: 'default_known_agent_idle_fallback' }
  const state = best.state ?? 'unknown'
  return {
    ...base, state, matchedRule: { id: best.id, priority: best.priority ?? 0, region: best.region ?? 'whole_recent' },
    visibleIdle: Boolean(best.visible_idle) && state === 'idle', visibleBlocker: Boolean(best.visible_blocker) && state === 'blocked',
    visibleWorking: Boolean(best.visible_working) && state === 'working', skipStateUpdate: Boolean(best.skip_state_update), fallbackReason: null
  }
}

/** Bundled manifests, replaced per agent by `<overrideDir>/<agent>.toml`. An invalid override is ignored. */
export function loadManifests(bundled: string | Array<{ file: string; text: string }>, overrideDir?: string): { manifests: Map<string, AgentManifest>; warnings: string[] } {
  const manifests = new Map<string, AgentManifest>()
  const warnings: string[] = []
  const add = (file: string, text: string, source: AgentManifest['source']) => {
    try {
      const manifest = parseManifest(text, source)
      for (const rule of manifest.skipped) warnings.push(`${file}: rule skipped (${rule})`)
      manifests.set(manifest.id, manifest)
    } catch (error) { warnings.push(`${file}: ${error instanceof Error ? error.message : String(error)}`) }
  }
  const files = (dir: string) => existsSync(dir) ? readdirSync(dir).filter(name => name.endsWith('.toml')).map(file => ({ file, text: readFileSync(join(dir, file), 'utf8') })) : []
  for (const { file, text } of typeof bundled === 'string' ? files(bundled) : bundled) add(file, text, 'bundled')
  if (overrideDir) for (const { file, text } of files(overrideDir)) add(file, text, 'override')
  return { manifests, warnings }
}

/** The manifest for an agent name or alias (claude, claude-code, copilot...). */
export function manifestFor(manifests: Map<string, AgentManifest>, agent: string): AgentManifest | undefined {
  const name = agent.toLowerCase()
  return manifests.get(name) ?? [...manifests.values()].find(manifest => manifest.aliases.includes(name))
}
