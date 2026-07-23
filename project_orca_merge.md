---
name: project-orca-merge
description: Transplante incremental das principais experiências do Orca para o OXESpace
metadata:
  type: project
  updated: 2026-07-23
---

# Orca → OXESpace · Progresso e roadmap

O OXESpace continua sendo a base. O objetivo é absorver as melhores experiências
do Orca sem perder RTK/Caveman, busca semântica e5-base, MCP interno, skills OXE,
integrações e o pipeline de release.

## Entrega atual (shell maduro + foundation)

| Superfície | Estado | Entrega real (não stub) |
| --- | --- | --- |
| Chrome OLED / hierarquia compacta | ✅ | tokens + `orca-shell.css` |
| Sidebar quick-nav honesta | ✅ | **Jobs** (background), **Scripts**, **Search** (Ctrl+J) |
| Tools CTA no footer | ✅ | botão primário accent (padrão IDE rail) |
| Status bar global | ✅ | projeto, branch, panes, pane ativa, local, versão |
| Repositório + editor | ✅ | Files/Editor Monaco, dirty/save |
| Source Control | ✅ | stage/unstage por ficheiro, Stage All, commit, generate msg, Fetch/Pull/Push |
| Split-tree (F2) | ✅ | default on; `WorkspaceSplitGrid` + `pane-tree` + persist localStorage; F2 toggle grid legado; **drag-to-split** (grip por pane → drop zones com preview → `moveLeaf`, sem @dnd-kit; terminal preservado) |
| Busca unificada | ✅ | `CommandMenu` (cmdk): actions + workspaces + panes + filename fuzzy + ripgrep + semantic e5 |
| Usage & rate limits | ✅ | modal Claude/Codex/Copilot |
| F1 design system | ✅ | Tailwind v4 + shadcn primitives (`button`, `command`, `dialog`, `card`, …) |
| F3 RPC / execution-host | ❌ | não iniciado (SSH/CLI/mobile Orca) |

### Atalhos

- `Ctrl+K` / `Ctrl+J`: busca e comandos unificados
- `Ctrl+E`: toggle editor (quando o terminal não tem o foco de shell)
- `Ctrl+Shift+\` / `Ctrl+Shift+-`: split vertical / horizontal
- `F2`: alterna split-tree ↔ grid legado

### Moat preservado

- RTK / Caveman
- Semantic e5-base + hybrid retrieval (consumido pelo CommandMenu)
- MCP `oxespace_*`
- Skills OXE + release pipeline
- Terminal maximize mounted + wheel TUI

## Próximas ondas (ainda fora)

1. ~~Drag-to-split com drop zones visuais~~ ✅ feito (2026-07-23)
2. Tabs de editor (pin/reorder/session restore)  
3. Annotate AI Diffs → agente  
4. Rich previews (md/image/pdf)  
5. Design Mode browser  
6. Linear + worktree-from-issue  
7. F3 RPC/execution-host (só se o produto virar multi-host)

## Verificação

- `pane-tree` unit tests (16, incl. `moveLeaf`)  
- `pane-layout.store` tests  
- `WorkspaceSplitGrid` render + drag-to-split drop test  
- `CommandMenu` action + file search tests  
- GitHub stage/unstage integration tests  
- e2e `orca-shell.spec.ts` (sidebar, status bar, editor, SC)

### Limitação local

Testes SQLite exigem `better-sqlite3` no ABI do Node (`npm run rebuild:native:node`).
