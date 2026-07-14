import path from 'node:path'

export type SemanticSearchMode = 'auto' | 'explore' | 'exhaustive'
export type ResolvedSemanticSearchMode = Exclude<SemanticSearchMode, 'auto'>
export type SemanticConfidence = 'high' | 'medium' | 'low'
export type SemanticMatchSource = 'semantic' | 'lexical'

export interface RankedSemanticCandidate {
  filePath: string
  score: number
  bestChunkIndex?: number
  bestChunkStart?: number
  bestChunkEnd?: number
  bestChunkLineStart?: number
  bestChunkLineEnd?: number
  bestChunkKind?: 'symbol' | 'section' | 'window'
  bestChunkName?: string
}

export interface RankedLexicalCandidate {
  filePath: string
  score: number
  matchedTerms: string[]
}

export interface FusedRetrievalCandidate {
  filePath: string
  score: number
  semanticScore: number | null
  lexicalScore: number | null
  bestChunkIndex: number | null
  bestChunkStart: number | null
  bestChunkEnd: number | null
  bestChunkLineStart: number | null
  bestChunkLineEnd: number | null
  bestChunkKind: 'symbol' | 'section' | 'window' | null
  bestChunkName: string | null
  matchedTerms: string[]
  sources: SemanticMatchSource[]
  reasons: string[]
}

const EXHAUSTIVE_INTENT = /\b(all|every|complete|completeness|exhaustive|exhaustively|refactor|rename|blast\s+radius|callers?|usages?|references?|todos?|todas?|cada|completo|completa|exaustiv[oa]|refator|renome|impacto|chamadores?|usos?|refer[eê]ncias?)\b/i

const STOP_WORDS = new Set([
  'a', 'ao', 'aos', 'as', 'como', 'da', 'das', 'de', 'do', 'dos', 'e', 'em', 'esta', 'este',
  'fica', 'foi', 'na', 'nas', 'no', 'nos', 'o', 'onde', 'os', 'para', 'pela', 'pelo', 'por',
  'que', 'the', 'a', 'an', 'and', 'are', 'for', 'from', 'how', 'in', 'is', 'of', 'on', 'to',
  'what', 'where', 'which', 'with'
])

export function resolveSemanticSearchMode(query: string, requested: SemanticSearchMode): ResolvedSemanticSearchMode {
  if (requested !== 'auto') return requested
  return EXHAUSTIVE_INTENT.test(query) ? 'exhaustive' : 'explore'
}

/**
 * Terms shared by FTS querying, exact-match explanations, and benchmark tests.
 * CamelCase and snake_case identifiers are expanded so natural-language queries
 * can meet source symbols without translating the whole document.
 */
export function tokenizeSemanticQuery(query: string): string[] {
  const expanded = query
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/[_.:/\\-]+/g, ' ')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  const unique = new Set<string>()
  for (const term of expanded.match(/[\p{L}\p{N}$@]+/gu) ?? []) {
    if (term.length < 2 || STOP_WORDS.has(term)) continue
    unique.add(term)
  }
  return [...unique].slice(0, 16)
}

/** Safe FTS5 expression: quoted prefixes joined with OR. */
export function buildFtsQuery(query: string): string | null {
  const terms = tokenizeSemanticQuery(query)
  if (terms.length === 0) return null
  return terms.map((term) => `"${term.replace(/"/g, '""')}"*`).join(' OR ')
}

/**
 * Adds path and identifier vocabulary to the original source. FTS keeps the
 * verbatim content searchable while the appended line makes camelCase,
 * snake_case and filenames discoverable through natural-language words.
 */
export function buildLexicalDocument(filePath: string, content: string): string {
  const rawIdentifiers = `${filePath}\n${content}`.match(/[A-Za-z_$][A-Za-z0-9_$]{2,}/g) ?? []
  const identifierParts = rawIdentifiers.flatMap((identifier) => identifier
      .replace(/([a-z\d])([A-Z])/g, '$1 $2')
      .replace(/[_$-]+/g, ' ')
      .toLowerCase()
      .split(/\s+/))
  const identifiers = [...new Set(identifierParts)].slice(0, 4_000)
  return `${content}\n\nOXESPACE_SEARCH_TERMS ${path.basename(filePath)} ${identifiers.join(' ')}`
}

/** Never embed or return .env values; key names remain searchable. */
export function sanitizeSemanticContent(filePath: string, content: string): string {
  const base = path.basename(filePath).toLowerCase()
  if (base === '.env' || base.startsWith('.env.')) {
    return content.replace(/^(\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=).*$/gm, '$1[REDACTED]')
  }
  return content
}

/** Reciprocal-rank fusion with a small semantic-similarity tie-breaker. */
export function fuseRetrievalCandidates(
  semantic: RankedSemanticCandidate[],
  lexical: RankedLexicalCandidate[]
): FusedRetrievalCandidate[] {
  const byPath = new Map<string, FusedRetrievalCandidate>()
  const ensure = (filePath: string): FusedRetrievalCandidate => {
    let item = byPath.get(filePath)
    if (!item) {
      item = {
        filePath,
        score: 0,
        semanticScore: null,
        lexicalScore: null,
        bestChunkIndex: null,
        bestChunkStart: null,
        bestChunkEnd: null,
        bestChunkLineStart: null,
        bestChunkLineEnd: null,
        bestChunkKind: null,
        bestChunkName: null,
        matchedTerms: [],
        sources: [],
        reasons: []
      }
      byPath.set(filePath, item)
    }
    return item
  }

  semantic.forEach((candidate, index) => {
    const item = ensure(candidate.filePath)
    item.semanticScore = candidate.score
    item.bestChunkIndex = candidate.bestChunkIndex ?? null
    item.bestChunkStart = candidate.bestChunkStart ?? null
    item.bestChunkEnd = candidate.bestChunkEnd ?? null
    item.bestChunkLineStart = candidate.bestChunkLineStart ?? null
    item.bestChunkLineEnd = candidate.bestChunkLineEnd ?? null
    item.bestChunkKind = candidate.bestChunkKind ?? null
    item.bestChunkName = candidate.bestChunkName ?? null
    item.sources.push('semantic')
    item.score += 1 / (60 + index + 1) + Math.max(0, candidate.score) * 0.002
  })
  lexical.forEach((candidate, index) => {
    const item = ensure(candidate.filePath)
    item.lexicalScore = candidate.score
    item.matchedTerms = candidate.matchedTerms
    item.sources.push('lexical')
    // Natural-language vector ranking remains the primary signal. Lexical FTS
    // confirms/tie-breaks it and introduces exact-only files without allowing
    // common query words to reorder the semantic top set wholesale.
    item.score += 0.15 / (60 + index + 1)
  })

  // Quality floor: lexical evidence may promote missed exact files into the
  // top set, but must not displace the semantic leader by itself. This keeps
  // natural-language answer quality stable while still improving Recall@5.
  const semanticLeader = semantic[0] ? byPath.get(semantic[0].filePath) : undefined
  if (semanticLeader) {
    for (const item of byPath.values()) {
      if (item !== semanticLeader && item.score >= semanticLeader.score) item.score = semanticLeader.score - Number.EPSILON
    }
  }

  for (const item of byPath.values()) {
    if (item.sources.length === 2) item.reasons.push('semantic meaning and exact repository terms agree')
    else if (item.sources[0] === 'semantic') item.reasons.push('conceptually similar to the request')
    else item.reasons.push('contains exact query terms or matching identifiers')
    if (item.matchedTerms.length > 0) item.reasons.push(`matched: ${item.matchedTerms.join(', ')}`)
    if (item.bestChunkKind && item.bestChunkKind !== 'window') {
      item.reasons.push(`matched ${item.bestChunkKind}${item.bestChunkName ? `: ${item.bestChunkName}` : ''}`)
    }
  }
  return [...byPath.values()].sort((a, b) => b.score - a.score || a.filePath.localeCompare(b.filePath))
}

export function shouldExpandAutomaticRetrieval(
  requestedMode: SemanticSearchMode,
  resolvedMode: ResolvedSemanticSearchMode,
  confidence: SemanticConfidence
): boolean {
  return requestedMode === 'auto' && resolvedMode === 'explore' && confidence === 'low'
}

export function estimateRetrievalConfidence(results: FusedRetrievalCandidate[]): SemanticConfidence {
  if (results.length === 0) return 'low'
  const first = results[0]
  const margin = first.score - (results[1]?.score ?? 0)
  if (first.sources.length === 2 && (first.semanticScore ?? 0) >= 0.84 && margin >= 0.002) return 'high'
  if (first.sources.length === 2 || (first.semanticScore ?? 0) >= 0.80 || margin >= 0.004) return 'medium'
  return 'low'
}

export function classifySemanticFile(filePath: string): 'source' | 'test' | 'config' | 'docs' | 'other' {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase()
  const base = path.basename(normalized)
  if (/(^|\/)(test|tests|__tests__|spec|specs|e2e)(\/|$)/.test(normalized) || /\.(test|spec)\.[^.]+$/.test(base)) return 'test'
  if (/\.(json|jsonc|ya?ml|toml|ini|env|properties|config)$/.test(base) || /(^|\/)(dockerfile|makefile|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(normalized) || base.startsWith('.env')) return 'config'
  if (/\.(md|mdx|rst|txt)$/.test(base) || /(^|\/)docs?\//.test(normalized)) return 'docs'
  if (/\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|c|h|cc|cpp|hpp|cs|php|swift|scala|sh|bash|ps1|sql|html|css|scss|sass|less|vue|svelte)$/.test(base)) return 'source'
  return 'other'
}
