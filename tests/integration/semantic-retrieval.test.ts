import { describe, expect, test } from 'vitest'
import {
  buildFtsQuery,
  buildLexicalDocument,
  classifySemanticFile,
  estimateRetrievalConfidence,
  fuseRetrievalCandidates,
  resolveSemanticSearchMode,
  sanitizeSemanticContent,
  shouldExpandAutomaticRetrieval,
  tokenizeSemanticQuery
} from '../../electron/main/services/semantic-retrieval'

describe('semantic retrieval policy', () => {
  test('auto selects exhaustive mode for completeness-sensitive work', () => {
    expect(resolveSemanticSearchMode('refatore e encontre todos os callers', 'auto')).toBe('exhaustive')
    expect(resolveSemanticSearchMode('como funciona o terminal?', 'auto')).toBe('explore')
    expect(resolveSemanticSearchMode('all usages of WorkspaceService', 'auto')).toBe('exhaustive')
  })

  test('auto expands a token-first pass only when confidence is low', () => {
    expect(shouldExpandAutomaticRetrieval('auto', 'explore', 'low')).toBe(true)
    expect(shouldExpandAutomaticRetrieval('auto', 'explore', 'medium')).toBe(false)
    expect(shouldExpandAutomaticRetrieval('explore', 'explore', 'low')).toBe(false)
    expect(shouldExpandAutomaticRetrieval('auto', 'exhaustive', 'low')).toBe(false)
  })

  test('expands source identifiers into useful lexical terms', () => {
    expect(tokenizeSemanticQuery('Onde semanticSearchEnabled é definido?')).toEqual(['semantic', 'search', 'enabled', 'definido'])
    expect(buildFtsQuery('SemanticService query')).toBe('"semantic"* OR "service"* OR "query"*')
    const document = buildLexicalDocument('src/semantic-worker.ts', 'const semanticSearchEnabled = true')
    expect(document).toContain('search enabled')
    expect(document).toContain('semantic')
    expect(document).toContain('semantic-worker.ts')
  })

  test('fuses independent rankings and explains agreement', () => {
    const fused = fuseRetrievalCandidates(
      [{ filePath: 'semantic.ts', score: 0.9, bestChunkIndex: 2 }, { filePath: 'other.ts', score: 0.8 }],
      [{ filePath: 'semantic.ts', score: 3, matchedTerms: ['semantic'] }, { filePath: 'config.yml', score: 2, matchedTerms: ['semantic'] }]
    )
    expect(fused[0]).toMatchObject({ filePath: 'semantic.ts', sources: ['semantic', 'lexical'], bestChunkIndex: 2 })
    expect(fused[0].reasons[0]).toContain('agree')
    expect(estimateRetrievalConfidence(fused)).toBe('high')
  })

  test('reports indexed file categories', () => {
    expect(classifySemanticFile('tests/foo.test.ts')).toBe('test')
    expect(classifySemanticFile('.github/workflows/ci.yml')).toBe('config')
    expect(classifySemanticFile('docs/guide.md')).toBe('docs')
    expect(classifySemanticFile('src/App.tsx')).toBe('source')
  })

  test('keeps env keys searchable without indexing secret values', () => {
    const safe = sanitizeSemanticContent('.env.local', 'API_TOKEN=super-secret\nPORT=3000')
    expect(safe).toContain('API_TOKEN=[REDACTED]')
    expect(safe).not.toContain('super-secret')
  })
})
