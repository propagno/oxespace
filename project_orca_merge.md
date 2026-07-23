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
| Rich previews (#10) | ✅ | Markdown renderizado (GFM, toggle código/preview), viewer de imagem (data: URI, zoom fit/1:1) e PDF (viewer nativo do Chromium via blob:) — IPC `fs:read-binary` |
| F1 design system | ✅ | Tailwind v4 + shadcn primitives (`button`, `command`, `dialog`, `card`, …) |
| Tabs de editor | ✅ | store keyed workspace→path; pin (duplo-clique), reorder por drag, close-others (botão direito), meio-clique fecha; sessão restaurada do localStorage (só os paths, conteúdo relido do disco) |
| Design Mode (#3) | ✅ | `<webview>` + preload guest isolado; picker com highlight, grab (selector/box/texto/markup/estilos computados) + screenshot do elemento (`capturePage`), sheet de confirmação → bracketed paste no agente |
| Linear (#4) | ✅ | GraphQL via `fetch` (sem `@linear/sdk`), key cifrada em `safeStorage` (migração 045 `secure_credentials`), issues por scope/team/estado, **worktree a partir da issue** usando o `branchName` do Linear |
| F3 RPC / execution-host | 🟡 | bus local (named pipe/unix socket, NDJSON, token constant-time) + `ExecutionHost` local; métodos `ping`, `rpc.methods`, `workspace.list`, `worktree.list/create`, `host.exec`. Falta o coordinator/DAG da orquestração (#1) |

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
2. ~~Tabs de editor (pin/reorder/session restore)~~ ✅ feito (2026-07-23)  
3. ~~Annotate AI Diffs → agente~~ ✅ feito (2026-07-23): comentar linhas no Review
   (unified + side-by-side), lote persistido, "Enviar N ao agente" cola o bloco
   formatado (bracketed paste) no terminal ativo — Enter submete  
4. ~~Rich previews (md/image/pdf)~~ ✅ feito (2026-07-23): `previewKind` roteia o
   ficheiro no `EditorPane`; binários passam por `fs:read-binary` (base64, allowlist
   de MIME, cap 12 MB) em vez do `readFile` utf-8; pipeline markdown isolado num chunk
   lazy de 361 kB (vendor voltou a 990 kB)  
5. ~~Design Mode browser~~ ✅ feito (2026-07-23)  
6. ~~Linear + worktree-from-issue~~ ✅ feito (2026-07-23)  
7. ~~F3 RPC/execution-host~~ 🟡 substrato feito (2026-07-23) — falta **#1 orquestração**
   (coordinator, DAG em SQLite, drift probe, gates) por cima do bus; e o host remoto
   (SSH) que a interface `ExecutionHost` já prevê

## Verificação

- `pane-tree` unit tests (16, incl. `moveLeaf`)  
- `pane-layout.store` tests  
- `WorkspaceSplitGrid` render + drag-to-split drop test  
- `CommandMenu` action + file search tests  
- `diff-comments` contract + store + DiffCard inline-editor tests  
- GitHub stage/unstage integration tests  
- `previewKind` + `previewMimeType` unit tests (allowlist barra `.env`, `id_rsa`, …)  
- e2e `orca-shell.spec.ts` (sidebar, status bar, editor, SC)  
- e2e `preview.spec.ts` (markdown + toggle, imagem com `naturalWidth > 0`, PDF, tabs) — o
  mock e2e agora serve o `FileSystemService` real, então o file browser/editor/preview
  são testáveis sem ABI nativo
- `editor-tabs.store` tests (7: activate sem reler, pin/close-others, reorder, restore)
- `linear.service` tests (8: valida antes de guardar, recusa key inválida, filtros,
  worktree-from-issue com/sem branch existente, `sanitizeDirectoryName`)
- `rpc-bus` tests (12: códigos JSON-RPC, round-trip real sobre named pipe, auth
  rejeitada, JSON inválido, `LocalExecutionHost` incl. timeout)
- e2e `linear.spec.ts` (painel abre pela palette, pede API key)
- e2e `design-mode.spec.ts` (serve uma página local, carrega no `<webview>`, ativa o
  picker e clica via `sendInputEvent` no guest → sheet com o selector correto)

### Correr a suite localmente

`npm test` falha ~49 testes de DB por incompatibilidade de ABI (`better-sqlite3` é
compilado para o Electron, ABI 125; o Node do sistema é 127). Use **`npm run test:electron`**,
que corre o vitest através do binário do Electron — 528/528 passam localmente.
Tratar essas falhas como ruído ambiental escondeu um bug real (a migração 045 subiu o
`user_version` para 45 e o teste ainda esperava 44), que só apareceu no CI do v0.5.0.
