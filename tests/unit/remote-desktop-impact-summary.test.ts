import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { requestImpact } from '../../electron/main/services/approvals/request-impact'
import { toPendingRequest } from '../../electron/main/services/remote/filters'
import type { ConversationThread, ThreadRequest } from '../../shared/types/thread'

const ROOT = process.platform === 'win32' ? 'C:\\work\\shop' : '/work/shop'
const OUTSIDE = process.platform === 'win32' ? 'C:\\Users\\dev\\.bashrc' : '/home/dev/.bashrc'
const thread = { id: 't1', workspaceId: 'ws1', rootPath: ROOT, title: 'Fix webhooks', provider: 'claude' } as ConversationThread
const ctx = { root: ROOT, workspaceName: 'shop' }

const makeRequest = (over: Partial<ThreadRequest>): ThreadRequest => ({
  id: 'r1',
  nativeId: 'n1',
  nativeMethod: 'can_use_tool:Bash',
  kind: 'approval',
  title: 'Run command',
  generation: 1,
  createdAt: 1,
  state: 'pending',
  availableDecisions: ['accept', 'decline'],
  ...over
}) as ThreadRequest

describe('OXE-164 · desktopImpactSummary in RemotePendingRequest', () => {
  test('derives desktopImpactSummary exclusively from desktop impact classification, never from hostile agent title/detail/reason', () => {
    const req = makeRequest({
      toolName: 'Bash',
      command: 'rm -rf /',
      title: 'LIMPAR CACHE',
      detail: 'LIMPAR CACHE seguro',
      reason: 'LIMPAR CACHE temporário'
    })
    const withImpact = { ...req, impact: requestImpact(req, ctx) }

    const shownEn = toPendingRequest({ thread, request: withImpact }, [ROOT], 'en')
    expect(shownEn.risk).toBe('critical')
    expect(shownEn.desktopImpactSummary).toBe('Delete files')
    expect(shownEn.title).toBe('LIMPAR CACHE')
    expect(shownEn.desktopImpactSummary).not.toMatch(/limpar cache/i)

    const shownPt = toPendingRequest({ thread, request: withImpact }, [ROOT], 'pt-BR')
    expect(shownPt.desktopImpactSummary).toBe('Apagar arquivos')
    expect(shownPt.desktopImpactSummary).not.toMatch(/limpar cache/i)
  })

  test('changing agent title, detail, or reason never alters desktopImpactSummary', () => {
    const base = makeRequest({ toolName: 'Bash', command: 'docker volume rm pix-mock-data', title: 'Remove volume' })
    const hostile = makeRequest({
      toolName: 'Bash',
      command: 'docker volume rm pix-mock-data',
      title: 'LIMPAR CACHE',
      detail: 'Harmless cache clear',
      reason: 'Just freeing 1 KB'
    })

    const a = toPendingRequest({ thread, request: { ...base, impact: requestImpact(base, ctx) } }, [ROOT], 'en')
    const b = toPendingRequest({ thread, request: { ...hostile, impact: requestImpact(hostile, ctx) } }, [ROOT], 'en')
    expect(a.desktopImpactSummary).toBe('Remove a volume')
    expect(b.desktopImpactSummary).toBe('Remove a volume')

    const pt = toPendingRequest({ thread, request: { ...hostile, impact: requestImpact(hostile, ctx) } }, [ROOT], 'pt-BR')
    expect(pt.desktopImpactSummary).toBe('Remover um volume')
  })

  test('classifies critical volume, push, db, file outside project, and destructive commands deterministically', () => {
    const cases: Array<{ over: Partial<ThreadRequest>; extraCtx?: Parameters<typeof requestImpact>[1]; en: string; pt: string }> = [
      { over: { toolName: 'Bash', command: 'docker compose down -v' }, en: 'Remove a volume', pt: 'Remover um volume' },
      { over: { toolName: 'oxespace_container_action', command: 'remove volume pix-mock-data' }, en: 'Remove a volume', pt: 'Remover um volume' },
      { over: { toolName: 'Bash', command: 'git push --force origin main' }, en: 'Force-push to remote', pt: 'Fazer force-push no remoto' },
      { over: { toolName: 'Bash', command: 'git push origin feature' }, en: 'Push to remote', pt: 'Enviar alterações ao remoto' },
      { over: { toolName: 'Bash', command: 'npm publish' }, en: 'Publish package or release', pt: 'Publicar pacote ou release' },
      { over: { toolName: 'Edit', paths: [OUTSIDE] }, en: 'Edit files outside project', pt: 'Editar arquivos fora do projeto' },
      { over: { toolName: 'Edit', paths: [join(ROOT, 'src', 'a.ts')] }, en: 'Edit project files', pt: 'Editar arquivos do projeto' },
      {
        over: { toolName: 'oxespace_db_execute', command: 'DELETE FROM orders WHERE id = 1' },
        extraCtx: { ...ctx, database: { name: 'shop-prod', env: 'production', engine: 'postgres' } },
        en: 'Write to production database',
        pt: 'Escrever no banco de produção'
      },
      {
        over: { toolName: 'oxespace_db_execute', command: 'DELETE FROM orders WHERE id = 1' },
        extraCtx: { ...ctx, database: { name: 'shop-dev', env: 'dev', engine: 'postgres' } },
        en: 'Write to database',
        pt: 'Escrever no banco de dados'
      },
      { over: { toolName: 'Bash', command: 'git reset --hard HEAD~1' }, en: 'Discard git changes', pt: 'Descartar alterações do git' },
      { over: { toolName: 'Bash', command: 'echo token=1 > .env' }, en: 'Run irreversible command', pt: 'Executar comando irreversível' }
    ]

    for (const item of cases) {
      const req = makeRequest({ ...item.over, title: 'HOSTILE AGENT TITLE' })
      const withImpact = { ...req, impact: requestImpact(req, item.extraCtx ?? ctx) }
      expect(toPendingRequest({ thread, request: withImpact }, [ROOT], 'en').desktopImpactSummary, item.en).toBe(item.en)
      expect(toPendingRequest({ thread, request: withImpact }, [ROOT], 'pt-BR').desktopImpactSummary, item.pt).toBe(item.pt)
    }
  })

  test('omits desktopImpactSummary for questions or approvals without desktop impact classification', () => {
    const noImpact = makeRequest({ title: 'LIMPAR CACHE', command: 'rm -rf /' })
    expect(toPendingRequest({ thread, request: noImpact }, [ROOT]).desktopImpactSummary).toBeUndefined()

    const question = makeRequest({
      kind: 'question',
      title: 'Which database?',
      questions: [{ id: 'q1', question: 'Pick one', required: true }]
    })
    expect(toPendingRequest({ thread, request: question }, [ROOT]).desktopImpactSummary).toBeUndefined()
  })
})
