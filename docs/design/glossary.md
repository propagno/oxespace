# OXESpace glossary (en ↔ pt-BR)

Status: source of truth for interface terms, approved as a 1.4 gate (2026-10-31). Owner: DESIGN/PRODUCT.
Every screen PR uses these words; a design review flags any other. When a term is missing, the PR adds it here
(DESIGN reviews the line). Later, `tests/ui-copy.test.ts` can check the catalogs against the "Never" column.

Usage counts below are from `shared/locales/pt-BR` on origin/main 21fc9fab. Where the app already agrees with itself,
the glossary writes down what it does; where it disagrees, the glossary picks one.

## 1. Voice

- Verb first, short, plain. Say what happened and what to do next: "Não foi possível salvar src/app.ts. Tentar de novo".
- Errors start with **"Não foi possível …"** (en "Couldn't …"). Not "Não deu para …", "Falha ao …", "Erro ao …".
- Words first, codes later: rule ids, message codes, session ids and paths from main go under **"Detalhes técnicos"**
  / "Technical details", never in the sentence (#305 pattern).
- Agent text is quoted as the agent's, never as OXESpace's ("Conteúdo do agente", #243).
- pt-BR uses "você" and the infinitive for actions ("Abrir", "Salvar"); sentence case everywhere ("Equipe do projeto",
  not "Equipe do Projeto").
- Numbers and units: `1.234`, `US$ 0,42`, `3 min`, `há 5 min` in pt-BR; `1,234`, `US$ 0.42`, `3 min`, `5 min ago` in en.

## 2. Names that never translate

Product and mode names: **OXESpace**, **OxeCode**, **OxeChat**, **OxeQuery**, **OxePod**, **OxePost**, Mandacaru
(design system). Other products as they name themselves: Claude, Claude Code, Codex, GitHub, Linear, MCP, Git.
External UI paths keep their own language ("Settings › Connectors" on claude.ai).

No longer a product term in 1.4: OXEVoice (removed, F34).

## 3. Developer terms kept in English in pt-BR

The audience is developers; these read as jargon, not as foreign words. Gender in pt-BR is fixed here so sentences
agree.

| Term | pt-BR gender | Example |
|---|---|---|
| workspace | o workspace | "Abra um workspace para usar os painéis dele" |
| worktree | a worktree | "Worktree isolada na branch {{branch}}" |
| branch | a branch | "Criar a branch" |
| commit | o commit | "Gerar mensagem de commit" |
| diff | o diff | — |
| hook | o hook | "Hooks de status dos agentes" |
| skill | a skill | "As skills do usuário" |
| prompt | o prompt | — |
| servidor MCP | o servidor | — |
| job (CI only) | o job | "Rodar de novo os jobs com falha" (GitHub Actions' own term) |

## 4. Concepts (translated)

| Concept | en | pt-BR | Never (pt-BR) | Notes |
|---|---|---|---|---|
| Pane | pane | **painel** (pl. painéis) | pane | 90 uses |
| Conversation (OxeChat) | conversation | **conversa** | thread | "thread" stays only in code, config keys (`thread.tools`) and branch names |
| Project | project | **projeto** | — | the Team's and sections' scope in OxeChat |
| Repository | repository | **repositório** | repo | |
| Agent | agent | **agente** | — | |
| Team | team | **equipe**; "Equipe do projeto" | time, Team | F35; #197 |
| Team role | role | **papel** | função, role | "Coordenadora", "Frontend" are role names |
| Delegation | delegation | **delegação** | — | "conversa delegada" for its conversation |
| Agent Work (feature) | Agent Work | **Trabalho dos agentes** | Agent Work | #197 finding; it describes the feature rather than naming a product |
| Work run (one execution) | run | **execução** | run, worker | the S7 row's mode label: en "Work", pt-BR "Trabalho" |
| Worker (internal process) | — | — | worker | never user-facing; say what stopped ("A conexão do OxeQuery parou de responder") |
| Background task | background task | **tarefa em segundo plano** | job (outside CI) | |
| Session (an agent CLI's) | session | **sessão** | — | "Sessão retomada" (F32) |
| Resume a session | resume | **retomar** | restaurar, continuar | |
| Crash | crash | **travamento** (noun); "travou" | crash | F32 copy |
| Approval request | request | **pedido** | solicitação, request | "Pedido 1 de 3" |
| Approve / Deny | Allow / Deny | **Permitir** / **Negar** | Aprovar, Recusar (in the approval modal) | the OxeChat approval card keeps "Aprovar" (14 uses) where the provider frames it as approving a step |
| Allow for this session | Allow for this run | **Permitir nesta sessão** | | low risk only (#243) |
| Activity center | Activity | **Atividade** | Notificações | the bell |
| Agents central (S7) | Agents | **Agentes** | Central de missão | "mission control" is internal |
| Settings | Settings | **Configurações** | Ajustes, Preferências | 79 uses |
| Command palette | command palette | **paleta de comandos** | | |
| Shortcut | shortcut | **atalho** | | |
| Provider | provider | **provedor** | | Claude, Codex… |
| Model | model | **modelo** | | |
| Tool (MCP) | tool | **ferramenta** | tool | |
| Cost | cost | **custo**; "informado" for provider-reported | | S7 |
| Context window | context | **contexto** | | |
| Draft | draft | **rascunho** | | |
| Attachment | attachment | **anexo** | | |
| Section (conversation list) | section | **seção** | grupo | F13 |
| Review (of a diff) | review | **revisão** | review | |
| OS dictation | dictation | **ditado do sistema** | | F34 toast |

## 5. Agent states (S7 contract, #313 §3)

| State | en | pt-BR |
|---|---|---|
| needs-you | Needs you | Precisa de você |
| failed | Failed | Falhou |
| working | Working | Trabalhando |
| finished | Finished | Terminou |
| idle | Idle | Ocioso |
| stopped | Stopped | Interrompido |
| unknown | Not confirmed | Não confirmado |
| (terminal only) starting / exited | Starting / Exited | Iniciando / Encerrado |

One i18n namespace, `agents.state.*`, holds them. No other catalog may define these state words.

## 6. Risk (approvals; desktop and phone)

| Level | en | pt-BR | One-line meaning (phone and modal) |
|---|---|---|---|
| low | Low | Baixo | Only reads / Só lê |
| medium | Medium | Médio | Changes something / Muda algo |
| high | High | Alto | Deletes, escalates or publishes / Apaga, eleva ou publica |
| critical | Critical | Crítico | Can't be undone, or affects production / Não tem volta ou afeta produção |

Colour never carries it alone. The badge says "Risco: Alto"; inside a sentence it's lowercase ("Risco: alto.").

## 7. Actions (verbs)

| Action | en | pt-BR | Never (pt-BR) | Use for |
|---|---|---|---|---|
| Delete for good | Delete | **Excluir** | Apagar, Deletar | items that are gone afterwards (39 uses) |
| Erase stored data | Erase / Clear | **Apagar** | | bulk wipes of stored data only ("Apagar toda a memória") |
| Take out of a list | Remove | **Remover** | Excluir | the thing still exists elsewhere (a project from the list, a member) |
| Archive | Archive | **Arquivar** | | |
| Search (a field) | Search | **Buscar** | Pesquisar | 35 uses; "Procurar" only for "browse for a file" |
| Find in page | Find | **Encontrar** | | the find bar |
| Retry | Try again | **Tentar de novo** | Tentar novamente, Repetir | `ui.tryAgain` |
| Cancel | Cancel | **Cancelar** | | |
| Close | Close | **Fechar** | | |
| Open | Open | **Abrir** | | |
| Stop a turn | Stop | **Parar**; done: "Turno interrompido" | Cancelar | S7 |
| Start over | Start fresh | **Começar do zero** | Reiniciar | F32 |
| Copy | Copy | **Copiar** | | |
| Save | Save | **Salvar** | Gravar | |

## 8. Changing this file

- A PR that needs a new term adds the row; DESIGN approves it in the design review.
- A PR that changes an existing term changes every catalog use in the same PR and says so in its body.
- Decisions that change a term relayed to other roles get one HANDOFF line to FRONTEND and MOBILE.
