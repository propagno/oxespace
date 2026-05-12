import { describe, expect, test } from 'vitest'
import { OxeGraphParser } from '../../electron/main/services/oxe-graph.parser'

const parser = new OxeGraphParser()

// Fixtures from FIXTURE-PACK.json T2
const SPEC_SAMPLE = `# SPEC — Test

## Critérios de aceite

| ID | Critério |
|----|----------|
| A1 | Sistema inicia sem erros |
| A2 | Estado persiste entre sessões |
| A3 | Interface renderiza corretamente |
`

const PLAN_SAMPLE = `# PLAN

### T1 — Criar tipos
- **Depende de:** —
- **Onda:** 1
- **Aceite vinculado:** A1

### T2 — Criar serviço
- **Depende de:** T1
- **Onda:** 2
- **Aceite vinculado:** A1, A2
`

const PLAN_MULTI_WAVE = `### T1 — A
- **Onda:** 1
- **Depende de:** —
- **Aceite vinculado:** A1

### T2 — B
- **Onda:** 1
- **Depende de:** —
- **Aceite vinculado:** A1

### T3 — C
- **Onda:** 2
- **Depende de:** T1, T2
- **Aceite vinculado:** A1, A2
`

const PLAN_AGENTS_SAMPLE = `{"version":"2","agents":[{"id":"agent-executor","role":"executor","persona":"Implementador","taskIds":["T1","T2"],"dependencies":[]},{"id":"agent-verifier","role":"verifier","persona":"Validador","taskIds":["T2"],"dependencies":["agent-executor"]}]}`

const STATE_SAMPLE = `# OXE — Estado

## Progresso

- **Concluidos:** T1, T2
- **Falhos:** T3
- **Bloqueados:** nenhum
`

describe('OxeGraphParser.parseSpec', () => {
  test('extracts 3 spec_criterion nodes from SPEC_SAMPLE', () => {
    const nodes = parser.parseSpec(SPEC_SAMPLE)
    expect(nodes).toHaveLength(3)
    expect(nodes.map(n => n.id)).toEqual(['spec-A1', 'spec-A2', 'spec-A3'])
    expect(nodes.every(n => n.type === 'spec_criterion')).toBe(true)
  })

  test('EMPTY_SPEC — returns empty array without throwing', () => {
    const nodes = parser.parseSpec('# SPEC vazia\nNenhum critério definido.\n')
    expect(nodes).toHaveLength(0)
  })

  test('nodes have correct label format', () => {
    const nodes = parser.parseSpec(SPEC_SAMPLE)
    expect(nodes[0].label).toBe('A1 — Sistema inicia sem erros')
  })

  test('nodes have filePath set', () => {
    const nodes = parser.parseSpec(SPEC_SAMPLE)
    expect(nodes[0].filePath).toBe('.oxe/SPEC.md')
  })
})

describe('OxeGraphParser.parsePlan', () => {
  test('extracts 2 task nodes from PLAN_SAMPLE', () => {
    const { nodes } = parser.parsePlan(PLAN_SAMPLE, new Map())
    expect(nodes).toHaveLength(2)
    expect(nodes.map(n => n.id)).toEqual(['task-T1', 'task-T2'])
    expect(nodes.every(n => n.type === 'plan_task')).toBe(true)
  })

  test('extracts depends_on edge T2 → T1', () => {
    const { edges } = parser.parsePlan(PLAN_SAMPLE, new Map())
    const depEdge = edges.find(e => e.type === 'depends_on')
    expect(depEdge).toBeDefined()
    expect(depEdge?.source).toBe('task-T2')
    expect(depEdge?.target).toBe('task-T1')
  })

  test('extracts 3 verifies edges from PLAN_SAMPLE', () => {
    const { edges } = parser.parsePlan(PLAN_SAMPLE, new Map())
    const verifiesEdges = edges.filter(e => e.type === 'verifies')
    expect(verifiesEdges).toHaveLength(3)
  })

  test('assigns wave from PLAN_SAMPLE', () => {
    const { nodes } = parser.parsePlan(PLAN_SAMPLE, new Map())
    expect(nodes[0].wave).toBe(1)
    expect(nodes[1].wave).toBe(2)
  })

  test('MALFORMED_PLAN — returns empty result without throwing', () => {
    const result = parser.parsePlan('# Plano customizado\n\n## Feature A\n\nImplementar coisas sem IDs padrão OXE.\n', new Map())
    expect(result.nodes).toHaveLength(0)
    expect(result.edges).toHaveLength(0)
  })

  test('applies statusMap from STATE', () => {
    const statusMap = new Map([['task-T1', 'done' as const], ['task-T2', 'failed' as const]])
    const { nodes } = parser.parsePlan(PLAN_SAMPLE, statusMap)
    expect(nodes.find(n => n.id === 'task-T1')?.status).toBe('done')
    expect(nodes.find(n => n.id === 'task-T2')?.status).toBe('failed')
  })

  test('PLAN_MULTI_WAVE — 2 tasks in wave 1, 1 in wave 2', () => {
    const { nodes } = parser.parsePlan(PLAN_MULTI_WAVE, new Map())
    expect(nodes).toHaveLength(3)
    expect(nodes.filter(n => n.wave === 1)).toHaveLength(2)
    expect(nodes.filter(n => n.wave === 2)).toHaveLength(1)
  })

  test('PLAN_MULTI_WAVE — T3 has 2 depends_on edges', () => {
    const { edges } = parser.parsePlan(PLAN_MULTI_WAVE, new Map())
    const t3Deps = edges.filter(e => e.type === 'depends_on' && e.source === 'task-T3')
    expect(t3Deps).toHaveLength(2)
  })
})

describe('OxeGraphParser.parseState', () => {
  test('maps T1/T2 as done and T3 as failed', () => {
    const map = parser.parseState(STATE_SAMPLE)
    expect(map.get('task-T1')).toBe('done')
    expect(map.get('task-T2')).toBe('done')
    expect(map.get('task-T3')).toBe('failed')
  })

  test('empty content returns empty map', () => {
    expect(parser.parseState('')).toEqual(new Map())
  })
})

describe('OxeGraphParser.parsePlanAgents', () => {
  test('extracts 2 agent nodes from PLAN_AGENTS_SAMPLE', () => {
    const taskNodes = [
      { id: 'task-T1' } as never,
      { id: 'task-T2' } as never,
    ]
    const { nodes } = parser.parsePlanAgents(PLAN_AGENTS_SAMPLE, taskNodes)
    expect(nodes).toHaveLength(2)
    expect(nodes.map(n => n.id)).toEqual(['agent-agent-executor', 'agent-agent-verifier'])
  })

  test('extracts 3 assigns edges', () => {
    const taskNodes = [{ id: 'task-T1' } as never, { id: 'task-T2' } as never]
    const { edges } = parser.parsePlanAgents(PLAN_AGENTS_SAMPLE, taskNodes)
    expect(edges.filter(e => e.type === 'assigns')).toHaveLength(3)
  })

  test('invalid JSON returns empty result without throwing', () => {
    const result = parser.parsePlanAgents('{invalid}', [])
    expect(result.nodes).toHaveLength(0)
    expect(result.edges).toHaveLength(0)
  })
})
