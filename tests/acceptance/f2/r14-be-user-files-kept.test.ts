// Frozen acceptance test for the 1.5.0 cockpit item R14 backend side (OXE program, phase F2), HML-678-1: removing the
// OxePost backend never deletes or rewrites the user's files. Written by the planner; the executor must not edit it.
// Static checks only; tests/acceptance/f2/r0b-removed-features-export.native.test.ts proves the bytes stay the same.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const ROOT = process.cwd()
const EXPORTER = 'electron/main/services/data-export/removed-features-export.ts'
function sources(dir: string): string[] {
  if (!existsSync(join(ROOT, dir))) return []
  return readdirSync(join(ROOT, dir)).flatMap(name => {
    if (name === 'node_modules' || name === 'vendor') return []
    const rel = `${dir}/${name}`
    return statSync(join(ROOT, rel)).isDirectory() ? sources(rel) : /\.(ts|js|cjs|mjs)$/.test(name) ? [rel] : []
  })
}
const MAIN = sources('electron')
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')

describe('R14 (backend) · the user\'s OxePost files are never removed', () => {
  test('R14: nothing in electron/ touches the secrets file once the OxePost backend is gone', () => {
    expect(MAIN.filter(file => read(file).includes('oxepost-secrets'))).toEqual([])
  })

  test('R14: only the exporter reads the request folders, and it never deletes, renames or writes there', () => {
    const touching = MAIN.filter(file => /\.oxespace\/requests|\.oxespace['"],\s*['"]requests|REQUESTS_DIR/.test(read(file)))
    expect(touching.filter(file => file !== EXPORTER)).toEqual([])
    if (existsSync(join(ROOT, EXPORTER))) expect(read(EXPORTER)).not.toMatch(/\b(rm|rmSync|unlink|unlinkSync|rmdir|rename|renameSync)\s*\(/)
  })
})
