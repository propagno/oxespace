// Frozen acceptance test for 1.5.0 A59 (OXE program, phase F3, item H1), TECH LEAD's SECURITY condition on #695: the app
// really builds the hook server through hookServerOptionsFor, and nothing else writes hook events to the database.
// Written by the planner; the executor must not edit it. Static checks only.
// rigor: source-assertion — the criterion is structural (which modules construct the server and write the table), which no runtime call can show.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const ROOT = process.cwd()
function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap(name => {
    if (name === 'node_modules' || name === 'vendor') return []
    const rel = `${dir}/${name}`
    return statSync(join(ROOT, rel)).isDirectory() ? sources(rel) : /\.(ts|js|cjs|mjs)$/.test(name) ? [rel] : []
  })
}
// Walking electron/main takes seconds on Windows, so each check gets 30 s (the FL-25 lesson).
const LIMIT = 30_000
let cache: Map<string, string> | null = null
function texts(): Map<string, string> {
  cache ??= new Map(sources('electron/main').map(file => [file, readFileSync(join(ROOT, file), 'utf8')]))
  return cache
}

describe('H1 · the hook pipeline is the only way in', () => {
  test('H1: every new AgentHookServer( in electron/main takes hookServerOptionsFor( as its argument, and there is at least one', () => {
    const uses = [...texts()].flatMap(([file, text]) => [...text.matchAll(/new\s+AgentHookServer\s*\(([^)]*\)?)/g)].map(match => ({ file, argument: match[1].trim() })))
    expect(uses.length).toBeGreaterThan(0)
    expect(uses.filter(use => !/^hookServerOptionsFor\s*\(/.test(use.argument))).toEqual([])
  }, LIMIT)

  test('H1: only the HTTP audit store inserts into agent_http_audit, and only the pipeline and the rollout reader ingest', () => {
    const files = [...texts()]
    expect(files.filter(([, text]) => /INSERT\s+(OR\s+\w+\s+)?INTO\s+agent_http_audit/i.test(text)).map(([file]) => file)).toEqual(['electron/main/services/http-audit/store.ts'])
    const ingesting = files
      .filter(([file, text]) => file !== 'electron/main/services/http-audit/store.ts' && /\.ingest\s*\(/.test(text) && /http-audit\/store|HttpAuditLog/.test(text))
      .map(([file]) => file)
    expect(ingesting.sort()).toEqual(['electron/main/services/agent-hooks/hook-pipeline.ts', 'electron/main/services/http-audit/codex-rollout.ts'])
  }, LIMIT)
})
