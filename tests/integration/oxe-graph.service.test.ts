import { describe, expect, test, vi } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { OxeGraphService } from '../../electron/main/services/oxe-graph.service'
import { OxeGraphParser } from '../../electron/main/services/oxe-graph.parser'

function makeTempRoot(files: Record<string, string>): string {
  const root = join(tmpdir(), `oxe-test-${randomUUID()}`)
  mkdirSync(join(root, '.oxe'), { recursive: true })
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, content, 'utf8')
  }
  return root
}

// OXE_DIR_MOCK fixture
const OXE_DIR_FILES = {
  '.oxe/SPEC.md': '# SPEC\n\n| ID | Critério |\n|----|----------|\n| A1 | Funciona |\n',
  '.oxe/PLAN.md': '# PLAN\n\n### T1 — Tarefa\n- **Depende de:** —\n- **Onda:** 1\n- **Aceite vinculado:** A1\n',
  '.oxe/STATE.md': '# Estado\n\n- **Status da run:** verify_complete\n'
}

describe('OxeGraphService.buildGraph', () => {
  test('OXE_DIR_MOCK — returns graph with at least 2 nodes and meta.compiledAt', () => {
    const root = makeTempRoot(OXE_DIR_FILES)
    try {
      const service = new OxeGraphService()
      const graph = service.buildGraph(root)
      expect(graph.nodes.length).toBeGreaterThanOrEqual(2)
      expect(graph.meta.compiledAt).toBeTruthy()
      expect(typeof graph.meta.compiledAt).toBe('string')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('EMPTY_ROOT — rootPath without .oxe/ returns empty graph without throwing', () => {
    const root = join(tmpdir(), `oxe-empty-${randomUUID()}`)
    mkdirSync(root, { recursive: true })
    try {
      const service = new OxeGraphService()
      const graph = service.buildGraph(root)
      expect(graph.nodes).toHaveLength(0)
      expect(graph.edges).toHaveLength(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('CACHE_HIT — second call with same mtimes does not re-parse', () => {
    const root = makeTempRoot(OXE_DIR_FILES)
    try {
      const parser = new OxeGraphParser()
      const buildSpy = vi.spyOn(parser, 'build')
      const service = new OxeGraphService(parser)

      service.buildGraph(root)
      service.buildGraph(root)

      expect(buildSpy).toHaveBeenCalledTimes(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('cache invalidates when file mtime changes', () => {
    const root = makeTempRoot(OXE_DIR_FILES)
    try {
      const parser = new OxeGraphParser()
      const buildSpy = vi.spyOn(parser, 'build')
      const service = new OxeGraphService(parser)

      service.buildGraph(root)
      // Force cache invalidation by writing the file again
      writeFileSync(join(root, '.oxe/PLAN.md'), OXE_DIR_FILES['.oxe/PLAN.md'] + '\n', 'utf8')
      service.buildGraph(root)

      expect(buildSpy).toHaveBeenCalledTimes(2)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('OxeGraphService.watchGraph', () => {
  test('does not throw when .oxe/ does not exist', () => {
    const root = join(tmpdir(), `oxe-nowatch-${randomUUID()}`)
    mkdirSync(root, { recursive: true })
    try {
      const service = new OxeGraphService()
      expect(() => service.watchGraph(root, () => {})).not.toThrow()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('stopWatching is idempotent when no watcher exists', () => {
    const service = new OxeGraphService()
    expect(() => service.stopWatching('/nonexistent/path')).not.toThrow()
  })
})
