# Acceptance — Delegação persistente por worktree e branch

Estado: execução parcial; ver [EVIDENCE.md](EVIDENCE.md). A matriz continua como gate de certificação, não como declaração de aprovação.

## Matriz funcional

| ID | Cenário | Resultado exigido | Evidência mínima |
|---|---|---|---|
| A01 | Delegar a partir de Code | Tarefa criada sem mudar branch/index/arquivos da origem | Git antes/depois + integration test |
| A02 | Delegar a partir de Claude Thread | Chamada MCP autenticada cria uma única tarefa | Bridge/local RPC test + piloto |
| A03 | Delegar a partir de Codex Thread | Chamada MCP autenticada cria uma única tarefa | Bridge/local RPC test + piloto |
| A04 | Usar branch local existente | Worktree abre branch exata sem `-b` | Git integration test |
| A05 | Usar branch remota existente | Branch local tracking e worktree corretas | Bare remote fixture |
| A06 | Criar branch com nome exato | Branch parte do SHA/base mostrados no preflight | Git log/rev-parse assertions |
| A07 | Gerar branch por template | Preview e branch final coincidem | Unit + E2E |
| A08 | Branch já aberta em worktree | Conflito ou reuso deliberado, nunca duplicação | Multi-worktree fixture |
| A09 | Reiniciar durante provisionamento | Recovery não cria segunda branch/worktree | Fault injection por receipt |
| A10 | Reiniciar durante sessão ativa | Estado vira resumable e Continue usa native ID exato | Fake CLI + app restart E2E |
| A11 | Sessão nativa ausente | Estado handoff-only e fallback requer escolha | Fake CLI missing-session fixture |
| A12 | Root/provider divergente | Resume é bloqueado e explica o conflito | Security/integration test |
| A13 | Sessão ainda live | Open apenas foca; não inicia segundo writer | Lifecycle test |
| A14 | AI Memory habilitado | Worktrees compartilham projeto e contexto relevante | Memory project + bundle test |
| A15 | AI Memory indisponível | Handoff explícito ainda inicia a tarefa | Source failure matrix |
| A16 | Evidência selecionada | Somente texto commitado, limitado e com hashes | Evidence tests |
| A17 | Conteúdo dirty | Apenas paths/status entram automaticamente | Privacy snapshot test |
| A18 | Checkpoint | Progresso, arquivos, testes e próxima ação sobrevivem restart | Repository/inbox test |
| A19 | Tarefa legada | Continua visível e recuperável por handoff | Migration fixture v48/v52 |
| A20 | Central Delegated Work | Busca por objective/branch/task e ação correta por estado | React + E2E |
| A21 | `/resume` | Mostra vínculo da delegação sem escolher sessão por recência | Command test |
| A22 | `/delegations` | Abre lista local sem iniciar CLI/processo | Command/process-count test |
| A23 | Cross-workspace revogado | Novas entregas/resume são bloqueados | Coordination test |
| A24 | Cancelamento | Processo para; branch, worktree e código permanecem | Integration test |
| A25 | Escala de 1000 tarefas | Consulta e UI permanecem dentro dos SLOs | Bench JSON + trace |
| A26 | Uma ou várias sessões de origem | Até cinco Threads salvas do mesmo projeto, selecionadas explicitamente, têm mensagens públicas limitadas e fontes identificáveis no bundle; eventos internos são excluídos e o recorte persiste após restart | Integration + E2E |
| A27 | AI Memory selecionada | Quando habilitada, entra como fonte distinta do CodeGraph mesmo com contexto automático desligado; sem Memory, handoff segue funcional | Integration + project settings test |

## Matriz de restart

Executar para origem Code e Thread, destino Thread e terminal quando aplicável:

| Fase interrompida | Estado esperado no boot | Ação permitida |
|---|---|---|
| Antes de resolver branch | failed/interrupted sem recurso Git | Retry provisioning |
| Depois de resolver branch, antes de criar | plano preservado; revalidação obrigatória | Retry provisioning |
| Depois de criar branch | receipt detecta branch existente | Continue provisioning |
| Depois de criar worktree | checkout é verificado, não recriado | Continue provisioning |
| Antes de capturar native ID | handoff-only se processo não existe | Start recovery session |
| Depois de capturar native ID | resumable | Resume exact session |
| Sessão ainda live | live | Open |
| Durante checkpoint | última revisão confirmada permanece | Resume/fallback |
| Em review | review permanece | Review/Approve/Cancel |
| Resultado externo desconhecido | unknown | Inspect/Reconcile; sem replay automático |

## Matriz Git

- Windows case-insensitive branch/path collision.
- Repositório sem remote.
- `origin/HEAD` configurado e ausente.
- Default branch `main`, `master` e `develop` remoto.
- Detached HEAD.
- Branch com slash e path longo.
- Branch inválida segundo `git check-ref-format`.
- Remote offline com fetch solicitado.
- Dirty origem e dirty worktree reutilizada.
- Worktree locked/prunable.
- Duas requests simultâneas para a mesma branch.

## Gate obrigatório

- [ ] Typecheck passou.
- [ ] Lint passou sem novos erros.
- [ ] Migrações e fixtures antigas passaram.
- [ ] Suíte Electron passou.
- [ ] E2E de restart passou.
- [ ] Build e budgets passaram.
- [ ] Quality controller sem HIGH não disposto.
- [ ] Claude Code autenticado: três execuções completas.
- [ ] Codex autenticado: três execuções completas.
- [ ] Origem Code e Thread validadas.
- [ ] Cinco resumes consecutivos sem sessão errada.
- [ ] Documentação e matriz de capabilities atualizadas.
