# Plano da 1.5.0 (TECH LEAD, 04/11/2026)

**Fonte:** o playground aprovado pelo usuário (#577 @ 718ddfcf), `playground/HANDOFF-1.5.md` e `FIDELITY.md`, mais as 5 rodadas de revisão, o CCR T71 (#580), `docs/design/plan-1.5-ui.md` e a sequência do backend.

**Ferramenta:** OXE (oxe-cc) **1.21**, como programa por fases. A SPEC está em `.oxe/SPEC.md` (R1–R13, A1–A41) e o ROADMAP em `.oxe/ROADMAP.md`. Como a pasta `.oxe/` é local e não versionada, uma cópia de ambos acompanha este documento em `docs/roadmap-1.5/oxe/`.

**Decisões do usuário (04/11):**

- playground aprovado;
- verde caatinga no tema escuro;
- próximo lançamento é só a 1.5.0, e a correção do pareamento vai junto;
- a estrutura de workspaces do OxeCode e do OxeChat fica como na 1.4.

## 1. Como o OXE conduz a entrega

Para cada fase F1…F8, o ciclo é:

```text
runtime program start --phase Fn
  → /oxe-plan: PLAN.json da fase + testes de aceite congelados (escritos antes, fora do escopo das tarefas)
  → oxe-cc plan lint --dry-verify
  → runtime execute --checkpoint-commits --budget-turns N --budget-usd X   (executor claude -p; uma worktree por tarefa)
  → runtime verify   (testes congelados + phase_gates do repo)
  → PR(s) pelo trem (na-fila) → runtime ci --attach <run da main>
  → runtime dossier + handoff "O que a próxima fase deve saber"
  → runtime program close --phase Fn
```

**Gates do repositório em toda fase** (`phase_gates` no PLAN.json):

| id | comando | quando |
|---|---|---|
| typecheck | `npm run typecheck` | verify |
| lint | `npm run lint` | verify |
| governance | `npx vitest run tests/design-lint.test.ts tests/integration/fs-allowlist.test.ts tests/i18n-catalog.test.ts tests/mcp-coverage.test.ts tests/remote-ipc-contract.test.ts` | verify |
| bundle | `npm run verify:bundle` | verify |
| ci | `kind: ci`, repo `propagno/oxespace` | program_close |

Os gates pesados rodam pelo heavy-lock (`phase_gates_runner`). A suíte completa de vitest, o e2e e o axe ficam na CI, pela regra de execuções pesadas.

**Regras do repositório que o executor recebe** (`policy_rules` + CLAUDE.md):

- um PR por item, a partir de `origin/main`, pelo trem (na-fila);
- nunca dar push num PR na fila;
- textos de PR e de commit sempre por arquivo;
- Conventional Commits em inglês, com o trailer `OXE-Task: Tn`;
- antes de criar uma migração, conferir o próximo número livre na main;
- todo PR que toca `protocol.ts` roda `android:generate`;
- nunca `git stash` nem checkout na árvore principal do usuário;
- nunca ler os dados reais do app;
- remover as variáveis `OXESPACE_*` de tudo que for iniciado em teste.

**Papéis do time** (o OXE executa, e as pessoas-agentes revisam e destravam):

| Papel | Sessão | Responsabilidade |
|---|---|---|
| TECH LEAD | oxespace-87 | dono do programa; escreve o PLAN.json de cada fase (/oxe-plan) e os testes congelados; decide os CRs |
| BACKEND | oxespace-54 | revisa as tarefas de main, IPC e migrações; CCR; pede a revisão SECURITY |
| FRONTEND | oxespace-d3 | revisa as tarefas do renderer; orçamento da entrada; axe; baselines |
| MOBILE | oxespace-9d | Android, C5, celular (AVD) |
| DESIGN | oxespace-4b | fidelidade ao playground por tela; aceite visual (sign-off) |
| HML | oxespace-0d | homologação caixa-preta por fase e na release (A38) |
| SRE | oxespace-34 | trem, CI, flakes, gates pesados |
| Coordenador | oxespace-1-4-0-roadmap-planning | gate da release, notas, tag (com o OK do usuário) |

## 2. Fases e tarefas

O tamanho segue a escala S/M/L. "Ext" indica um PR já em voo, que entra como `blocked_by` externo. "SEC" indica revisão de segurança obrigatória.

### F1 — Base (A35, A36, A1–A6, A8, A9)

| Tarefa | O quê | Tam. | Dono-revisor | Dependência |
|---|---|---|---|---|
| F1-T1 | Ext: pareamento (#594 celular; #601 com #595) | — | MOBILE/FE/BE | AVD com ≥ 4 GB livres |
| F1-T2 | Ext: tela de falha do banco #597 (T87) | — | BE | CI |
| F1-T3 | Ext: #602 (T88/T89), #600 (FL-16), #441 (S7.1), #526 (C5), #521 (aba Agents) | — | todos | trem |
| F1-T4 | Tokens C4: caatinga escuro, attn*, k-*, syn-*, term-*, z-*, motion, `--ws-1..8` e `--ws-N-fg`; as 22 mudanças da U4 e a rota de `--nav-selected` | M | FE | — |
| F1-T5 | Migração `workspaces.color` (próximo número livre) + `workspace:update-settings` + hash estável como padrão | S | BE | — |
| F1-T6 | Cor do workspace em todo lugar: CSS em `data-ws` (cartões, cabeçalhos de painel, conversa, barra de status) + seletor no menu do workspace | S | FE | T4, T5 |
| F1-T7 | Ícones Mandacaru próprios em módulos por ícone, com peso display (Bricolage, sem custo novo) | S | FE/DESIGN | T4 |
| F1-T8 | U5a: diálogos do OxeChat no U1 | M | FE | — |
| F1-T9 | U5b: diálogos do OxeQuery, OxePod e OxePost no U1 (remove as 20 regras `oq-scope`) | M | FE | — |
| F1-T10 | U5c: os demais diálogos no U1 (About, Shortcuts, Usage, Report, Team, Delegation, Devices, Approvals, Agents, Unsaved, Terminal restore). NewWorkspaceModal **sem mudança de conteúdo** | M | FE | — |
| F1-T11 | U6: o Callout e seus 4 usos | S | FE | T8–T10 |
| F1-T12 | U7: regras de Menu nos 15 menus + regra no design-lint | M | FE | — |
| F1-T13 | Baselines visuais refeitas uma vez na main (linux + windows) | S | SRE/FE | T4–T12 na main |

Testes congelados: contraste de tokens (A1); ratchet ≤ 22 (A2); migração e settings (A8); `verify:bundle` (A9); unit de Dialog, Callout e Menu (A4–A6); e2e de pareamento em qualquer tela (A35); e2e com banco em versão futura (A36).

### F2 — Atividade dos agentes e Settings (A10, A11, A12, A7)

| Tarefa | O quê | Tam. | Dono-revisor | Dependência |
|---|---|---|---|---|
| F2-T1 | U12-be: read model de atividade com `source`, paginação e filtros no servidor | M | BE | — |
| F2-T2 | T64a: ferramenta MCP do OxePost (read e send), níveis em `mcp-coverage` | M | BE, SEC | — |
| F2-T3 | T64b: acesso de agente por coleção, aprovação para escrita, segredos como •••• (NAME) | M | BE, SEC | T2 |
| F2-T4 | T64c: tabela de auditoria do OxePost (migração) + fonte `post` no U12-be | S | BE | T1, T3 |
| F2-T5 | U12: Settings › Atividade dos agentes com todas as fontes e o modal T63 | M | FE | T1 |
| F2-T6 | Linha "o que os agentes fizeram" no topo do OxeQuery, OxePod e OxePost, abrindo o detalhe | S | FE | T1, T4 |
| F2-T7 | U8: páginas de Settings em SettingRow (Application e Workspace), Automações em Agentes, ações do arquivo de Policy | M | FE | — |
| F2-T8 | U9 (loading estável nos diálogos; estados de Team) + U10 (botões de adicionar) | S | FE | — |

### F3 — Worktrees e lugares (A13–A18), conforme o CCR #580

| Tarefa | O quê | Tam. | Dono-revisor | Dependência |
|---|---|---|---|---|
| F3-T1 | T72 PR1: modelo ThreadPlace, lugares a partir de evidência, base no primeiro toque, cwd do turno (migração) | M | BE | — |
| F3-T2 | T72 PR2: `thread:places`, `thread:place-diff`, diff por lugar e pastas de fora | M | BE | T1 |
| F3-T3 | T79: cwd passivo por OSC 7/633/9;9/1337 (validação de caminho) | S | BE, SEC leve | — |
| F3-T4 | §6: `thread:panes`, dono do container pela pasta do Compose, revisores do PR (`reviewRequests`, `latestReviews`) | S | BE | T1 |
| F3-T5 | T72 PR3: deriva de branch, `place-drift-answer` (proibido ao MCP), evento e respostas | M | BE, **SEC (todo o T72)** | T2 |
| F3-T6 | T72 PR4: resolvedor único `thread:resolve-path` + `thread:place-read` só leitura (substitui o T70) | M | BE, SEC | T1, T5 |
| F3-T7 | T73: branch por painel com aviso "trocou de X" | S | BE/FE | T3 |
| F3-T8 | UI: aba Alterações por lugar (base por lugar; desfazer por trecho, arquivo e turno; comentário), cartão de deriva com confirmação | M | FE | T2, T5 |
| F3-T9 | UI: chips e links de caminho com "procurei em…"; aba só leitura "fora do repositório", sem "Abrir no editor" | S | FE | T6 |
| F3-T10 | UI: abas Terminal, Containers e PR da conversa | S | FE | T3, T4 |

### F4 — Conversa B leve (A19–A23)

| Tarefa | O quê | Tam. | Dono-revisor | Dependência |
|---|---|---|---|---|
| F4-T1 | T90: campo `activity` no read model S7.1, montado no main, só para conversas | S | BE | — |
| F4-T2 | Cabeçalho como tarefa (projeto, branch, agente, modelo, acesso, custo, tempo), linha "agora" e abas só do que foi usado | M | FE | T1 |
| F4-T3 | Painel de impacto: o que tocou, checkpoints e PR | S | FE | F3 |
| F4-T4 | T58-a/b: mensagens, código e dobra das ferramentas (uma linha por grupo, barra de 3 px por tipo) | M | FE | — |
| F4-T5 | T58-d/e/f: composer, chips e larguras estreitas; T76 "Direcionar com isto" e "Enviar agora" (canSteer pelas capacidades) | M | FE/BE | — |
| F4-T6 | T77: shell em segundo plano (com fixtures de sinal de parada) e "estado desconhecido desde…" | M | BE/FE | — |
| F4-T7 | U11 (ferramentas ao lado da conversa, ≥ 320 px, redimensionar e maximizar) + U14 ("View" e painéis no rail) | M | FE | — |
| F4-T8 | Conversas lado a lado no modelo do ThreadGrid (células fixas, ✕ no lado certo, teclado ativa o lado; 900 px = um lado com seletor) | S | FE | T7 |
| F4-T9 | T58-g/h/i/j + U13: detalhes, menu da conversa, side chat, sugestões 2×2 e regras de janela curta | M | FE | — |

### F5 — Aprovações (A24–A28)

| Tarefa | O quê | Tam. | Dono-revisor | Dependência |
|---|---|---|---|---|
| F5-T1 | Aprovação que vem até você: cartão na conversa em foco, toast com Negar/Permitir fora dela (Ver impacto se irreversível), fila como extra | M | FE | F4 |
| F5-T2 | Prévia de impacto e caminho sem hold (caixa "entendo que não dá para desfazer"); sem Desfazer no irreversível | M | FE | T1 |
| F5-T3 | T78: irreversível → `risk: 'critical'` no gateway do celular | S | BE, SEC leve | — |
| F5-T4 | T74: Sempre permitir com a regra do provedor (Claude: regra do projeto; Codex: só a sessão), nunca para destrutivo ou rede, revogável em Settings | M | BE/FE, **SEC** | — |
| F5-T5 | T75 Mongo: snapshot local criptografado (migração), prévia pelo filtro, restaurar pelos Checkpoints | M | BE, **SEC** | — |
| F5-T6 | T75 Postgres: prévia por `UPDATE … RETURNING` com rollback, snapshot por chave primária, mesma contagem de linhas, desligado em produção | L | BE, **SEC** | T5 |
| F5-T7 | UI do snapshot: "Fazer snapshot e aprovar" na prévia, com estado por engine | S | FE | T5 |

**Linha de corte**, se a fase estourar: primeiro T75 Postgres (F5-T6) e T77 (F4-T6) vão para a 1.5.x, depois T75 Mongo e T74.

### F6 — Agora, viagem no tempo e barra de comando (A29–A31)

| Tarefa | O quê | Tam. | Dono-revisor | Dependência |
|---|---|---|---|---|
| F6-T1 | T82 backend: ações do Agora sobre o S7.1 (sem Parar em painel) | S | BE | F4-T1 |
| F6-T2 | Agora na UI: lazy, Ctrl+Shift+G, 7 estados, delegação e trabalho, fonte parcial, A/D no cartão, J/K, virtualização acima de 60 | M | FE | T1 |
| F6-T3 | T83 backend: arquivos por checkpoint e ramificar (worktree no `base_commit` + pré-imagens + `forkClaudeBefore` / fork+rollback do Codex, worktree própria) | M | BE, SEC leve | F3 |
| F6-T4 | Viagem no tempo na UI: Ctrl+H, régua com variável CSS, ticks em gradiente, Restaurar = rewind, Ramificar cria e seleciona o cartão | L | FE | T3 |
| F6-T5 | T84: barra de comando com o combobox completo, parser lazy, `/approve` só na janela e botões de reserva | M | FE | — |

### F7 — Modos e fidelidade à 1.4 (A32–A34)

| Tarefa | O quê | Tam. | Dono-revisor | Dependência |
|---|---|---|---|---|
| F7-T1 | OxeCode: o visual novo sobre as laterais da 1.4; NewWorkspaceModal **idêntico** (layouts 1–16, agentes, textos); "Novo terminal em <worktree>" no cartão certo | M | FE | — |
| F7-T2 | OxeCode: divisão completa, presets até 2×7, Foco com abas, maximizar e dock (A2) | M | FE | T1 |
| F7-T3 | OxeQuery A5 + Q-*; OxePod A3 + P-*; OxePost A4 (junto com o T64) | M | FE | F2 |
| F7-T4 | Primeiro uso A1 com conexão de agente real (detectar CLI, entrar, checar pronto); A6 (campo de caminho); A7 | M | FE | — |

### F8 — Endurecimento e release (A37–A41)

| Tarefa | O quê | Tam. | Dono-revisor | Dependência |
|---|---|---|---|---|
| F8-T1 | Spike: o electron-vite suporta o vite 8? (`kind: spike` → D-SPIKE) | S | SRE | — |
| F8-T2 | xterm 6 com headless e todos os addons + bench do terminal | M | FE | — |
| F8-T3 | Homologação HML no app empacotado contra a 1.4.1 (6 + 3 cenários, passos ≤ 1.4.1) e sign-off do usuário | M | HML | F1–F7 |
| F8-T4 | Orçamentos (bundle, perf, memória), axe nas telas novas e baselines finais | S | FE/SRE | — |
| F8-T5 | Atualização e volta no app empacotado (A40): 1.4.1 com dados → auto-update para a 1.5.0, todas as migrações e o backup vNN; voltar à 1.4.1 mostra a tela T87; `install-over.yml` com `candidate_version` 1.5.0 | M | HML | F1–F7 |
| F8-T6 | Compatibilidade do celular (A41): APK 1.4.1 ↔ desktop 1.5.0 e APK 1.5.0 ↔ desktop 1.4.1; pareamento real em rede real, incluindo a Pública (celular do usuário, ≥ 1,5 GB livres); `android-release` verde, com sha256 e apksigner conferidos | M | MOBILE/HML/Coordenador | T5 |
| F8-T7 | Corte (A39):<br>• trem vazio e run **concluído** da main verde no commit da tag;<br>• nenhum flake com 2 falhas em 3 runs;<br>• baselines depois do último PR de UI;<br>• PR de versão (package/lock + `1.5.0.md` en/pt-BR) pelo trem;<br>• strings das notas conferidas em `shared/locales`;<br>• SECURITY de F5-T5/T6 e F6-T3 nos PRs;<br>• limites conhecidos escritos a partir da HML.<br>**A tag sai com o OK do usuário.** | S | Coordenador | T1 e T2 (ou adiamento registrado), T3–T6 |

## 3. Orçamento e custo (decisão do usuário)

O executor do OXE roda `claude -p` na conta do usuário, que é paga. Proposta de teto por fase, cobrando o ledger do OXE entre execuções:

| Fase | Tarefas OXE | Teto de turnos | Teto US$ |
|---|---|---|---|
| F1 | 10 (3 externas) | 300 | 40 |
| F2 | 8 | 260 | 35 |
| F3 | 10 | 320 | 45 |
| F4 | 9 | 300 | 40 |
| F5 | 7 | 260 | 40 |
| F6 | 5 | 200 | 30 |
| F7 | 4 | 160 | 25 |
| F8 | 7 | 160 | 20 |
| **Total** | **60** | **1.960** | **275** |

Ao bater o teto, o runtime emite `BudgetExhausted` e para. Só continua com um novo OK, nunca com reset silencioso. Nenhuma execução começa sem o OK do usuário para o teto da fase.

## 4. Pré-condições antes da F1

1. **Node da máquina:** 22.17.1, abaixo de `^22.22.2 || ^24.15`, que é o que as dependências pedem. Atualizar o Node (recomendado) ou aceitar `project_env_check: warn` com dono. Sem isso, o `npm ci` remove o `better-sqlite3` em silêncio (OXB).
2. **Memória:** execução pesada só com ≥ 1 GB livre e o lock; o AVD pede ≥ 4 GB.
3. **#577 na main:** o playground vira a referência visual do repositório.
4. **OK do usuário** para o orçamento da F1.
