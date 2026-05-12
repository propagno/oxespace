import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { NodeStatus, OxeExecutionGraph, OxeGraphEdge, OxeGraphNode } from '../../../shared/types/oxe-graph'

const GRAPH_ARTIFACTS = [
  { label: 'STATE', relativePath: '.oxe/STATE.md', kind: 'state' },
  { label: 'ACTIVE-RUN', relativePath: '.oxe/ACTIVE-RUN.json', kind: 'activeRun' },
  { label: 'PLAN', relativePath: '.oxe/PLAN.md', kind: 'plan' },
  { label: 'SPEC', relativePath: '.oxe/SPEC.md', kind: 'spec' },
  { label: 'IMPLEMENTATION-PACK', relativePath: '.oxe/IMPLEMENTATION-PACK.json', kind: 'other' },
  { label: 'REFERENCE-ANCHORS', relativePath: '.oxe/REFERENCE-ANCHORS.md', kind: 'other' },
  { label: 'FIXTURE-PACK', relativePath: '.oxe/FIXTURE-PACK.json', kind: 'other' },
  { label: 'VERIFY', relativePath: '.oxe/VERIFY.md', kind: 'verify' },
  { label: 'OXE-EVENTS', relativePath: '.oxe/OXE-EVENTS.ndjson', kind: 'events' },
  { label: 'EXECUTION-RUNTIME', relativePath: '.oxe/EXECUTION-RUNTIME.md', kind: 'other' },
] as const

export class OxeGraphParser {
  build(rootPath: string): OxeExecutionGraph {
    const oxeDir = join(rootPath, '.oxe')
    if (!existsSync(oxeDir)) {
      return { nodes: [], edges: [], meta: { compiledAt: new Date().toISOString(), planHash: '', specHash: '', waveCount: 0 } }
    }

    const specContent = this.tryRead(join(rootPath, '.oxe/SPEC.md'))
    const planContent = this.tryRead(join(rootPath, '.oxe/PLAN.md'))
    const stateContent = this.tryRead(join(rootPath, '.oxe/STATE.md'))
    const agentsContent = this.tryRead(join(rootPath, '.oxe/plan-agents.json'))

    const statusMap = this.parseState(stateContent)
    const specNodes = this.parseSpec(specContent)
    const { nodes: taskNodes, edges: planEdges } = this.parsePlan(planContent, statusMap)
    const { nodes: agentNodes, edges: agentEdges } = this.parsePlanAgents(agentsContent, taskNodes)
    const artifactNodes = this.parseArtifacts(rootPath)

    const waveCount = taskNodes.reduce((max, n) => Math.max(max, n.wave ?? 0), 0)

    return {
      nodes: [...specNodes, ...taskNodes, ...agentNodes, ...artifactNodes],
      edges: [...planEdges, ...agentEdges],
      meta: {
        compiledAt: new Date().toISOString(),
        planHash: this.hash(planContent),
        specHash: this.hash(specContent),
        waveCount,
      },
    }
  }

  parseSpec(content: string): OxeGraphNode[] {
    const nodes: OxeGraphNode[] = []
    const tableRowRe = /^\|\s*(A\w+)\s*\|\s*(.+?)\s*\|/gm
    let m: RegExpExecArray | null
    while ((m = tableRowRe.exec(content)) !== null) {
      const id = m[1]
      nodes.push({
        id: `spec-${id}`,
        type: 'spec_criterion',
        label: `${id} — ${m[2].trim()}`,
        status: 'unknown',
        data: {},
        filePath: '.oxe/SPEC.md',
      })
    }
    return nodes
  }

  parsePlan(content: string, statusMap: Map<string, NodeStatus>): { nodes: OxeGraphNode[]; edges: OxeGraphEdge[] } {
    const nodes: OxeGraphNode[] = []
    const edges: OxeGraphEdge[] = []
    if (!content) return { nodes, edges }

    const headerRe = /^###\s+(T\w+)\s*(?:—|-)\s*(.+)/gm
    const headers: Array<{ id: string; label: string; index: number }> = []
    let m: RegExpExecArray | null
    while ((m = headerRe.exec(content)) !== null) {
      headers.push({ id: m[1], label: m[2].trim(), index: m.index })
    }

    for (let i = 0; i < headers.length; i++) {
      const { id, label, index } = headers[i]
      const end = i + 1 < headers.length ? headers[i + 1].index : content.length
      const block = content.slice(index, end)

      const waveMatch = /\*\*Onda:\*\*\s*(\d+)/.exec(block)
      const wave = waveMatch ? parseInt(waveMatch[1], 10) : undefined

      const depsMatch = /\*\*Depende de:\*\*\s*([^\n]+)/.exec(block)
      if (depsMatch) {
        const depsStr = depsMatch[1].trim()
        if (depsStr !== '—' && depsStr !== '-') {
          for (const dep of depsStr.split(/[,\s]+/).filter(d => /^T\w+$/.test(d))) {
            edges.push({ id: `e-${id}-dep-${dep}`, source: `task-${id}`, target: `task-${dep}`, type: 'depends_on' })
          }
        }
      }

      const verifiesMatch = /\*\*Aceite vinculado:\*\*\s*([^\n]+)/.exec(block)
      if (verifiesMatch) {
        for (const criterion of verifiesMatch[1].split(/[,\s]+/).filter(c => /^A\w+$/.test(c))) {
          edges.push({ id: `e-${id}-verifies-${criterion}`, source: `task-${id}`, target: `spec-${criterion}`, type: 'verifies' })
        }
      }

      nodes.push({
        id: `task-${id}`,
        type: 'plan_task',
        label: `${id} — ${label}`,
        status: statusMap.get(`task-${id}`) ?? 'pending',
        wave,
        data: {},
        filePath: '.oxe/PLAN.md',
      })
    }

    return { nodes, edges }
  }

  parsePlanAgents(content: string, taskNodes: OxeGraphNode[]): { nodes: OxeGraphNode[]; edges: OxeGraphEdge[] } {
    const nodes: OxeGraphNode[] = []
    const edges: OxeGraphEdge[] = []
    if (!content) return { nodes, edges }

    let parsed: { agents?: Array<{ id: string; role?: string; persona?: string; taskIds?: string[] }> }
    try {
      parsed = JSON.parse(content) as typeof parsed
    } catch {
      return { nodes, edges }
    }

    if (!Array.isArray(parsed.agents)) return { nodes, edges }

    const taskIdSet = new Set(taskNodes.map(n => n.id.replace('task-', '')))

    for (const agent of parsed.agents) {
      nodes.push({
        id: `agent-${agent.id}`,
        type: 'agent',
        label: agent.persona ?? agent.id,
        status: 'unknown',
        data: { role: agent.role ?? '', persona: agent.persona ?? '' },
      })
      for (const taskId of agent.taskIds ?? []) {
        if (!taskIdSet.has(taskId)) continue
        edges.push({ id: `e-${agent.id}-assigns-${taskId}`, source: `agent-${agent.id}`, target: `task-${taskId}`, type: 'assigns' })
      }
    }

    return { nodes, edges }
  }

  parseArtifacts(rootPath: string): OxeGraphNode[] {
    return GRAPH_ARTIFACTS
      .filter(a => existsSync(join(rootPath, a.relativePath)))
      .map(a => ({
        id: `artifact-${a.label}`,
        type: 'artifact' as const,
        label: a.label,
        status: 'unknown' as const,
        data: { kind: a.kind },
        filePath: a.relativePath,
      }))
  }

  parseState(content: string): Map<string, NodeStatus> {
    const map = new Map<string, NodeStatus>()
    if (!content) return map

    const applyStatus = (re: RegExp, status: NodeStatus) => {
      const match = re.exec(content)
      if (!match) return
      const val = match[1].trim()
      if (val === 'nenhum' || val === '-' || val === '—') return
      for (const id of val.split(/[,\s]+/).filter(v => /^T\w+$/.test(v))) {
        map.set(`task-${id}`, status)
      }
    }

    applyStatus(/\*\*Concluidos:\*\*\s*([^\n]+)/, 'done')
    applyStatus(/\*\*Falhos:\*\*\s*([^\n]+)/, 'failed')
    applyStatus(/\*\*Bloqueados:\*\*\s*([^\n]+)/, 'skipped')

    return map
  }

  private tryRead(filePath: string): string {
    try {
      return readFileSync(filePath, 'utf8')
    } catch {
      return ''
    }
  }

  private hash(content: string): string {
    if (!content) return ''
    return createHash('sha256').update(content).digest('hex').slice(0, 12)
  }
}
