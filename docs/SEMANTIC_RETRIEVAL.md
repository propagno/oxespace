# Semantic retrieval

OXESpace indexes the active workspace on-device and exposes retrieval to agents
through the internal MCP server. Nothing leaves the machine for search.

## What is indexed

| Signal | Source | Purpose |
|--------|--------|---------|
| **Vector** | `transformers.js` (`multilingual-e5-small`) | Meaning similarity across natural language |
| **Lexical (FTS5)** | SQLite FTS5 over chunk text | Exact symbols, tests, config, identifiers |
| **Structural** | CodeGraph / tree-sitter | Callers, imports, related symbols |

Ignored, generated and binary paths stay out of the index (see semantic ignore rules).

## Agent tools

### `oxespace_semantic_search`

Token-budgeted hybrid search (vector + FTS). Returns line-addressed source
windows with confidence, coverage and truncation warnings.

| Arg | Notes |
|-----|--------|
| `query` | Required natural-language or symbol query |
| `mode` | `auto` · `explore` · `exhaustive` |
| `limit` | Max files (mode-dependent default) |
| `maxTokens` | Hard budget for source context (~400–20000) |

### `oxespace_hybrid_explore`

Fuses semantic + lexical + structural traversal for development questions.
Use **explore** for navigation; **exhaustive** when completeness matters
(refactor, rename, “all callers”).

### `oxespace_quality_check`

Post-diff quality controller: maps changes to consumers, checks
test/migration/contract coverage, and links acceptance criteria to evidence.

## Modes

- **explore** — ranked, token-first, best-effort navigation
- **exhaustive** — completeness-sensitive; searches the full lexical index
- **auto** — picks exhaustive when the query implies completeness (refactor,
  rename, all/every/callers, etc.)

## Local scripts

```powershell
npm run bench:semantic       # retrieval evaluation harness
npm run bench:semantic:gate  # quality gate over the same harness
```

## UI

**Tools → Semantic** (activity panel) shows index status, counts and reindex.
Workspace status chips surface semantic readiness when available.
