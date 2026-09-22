# Evidence — Delegação persistente por worktree e branch

Estado em 2026-09-21: implementação funcional; gate de certificação ainda aberto. Checkout Windows `C:\Users\dudu-\Estudos\oxespace`, OXESpace 0.13.0, banco v57. Este relatório distingue implementação, testes simulados e chamadas autenticadas aos providers.

## Entrega implementada

- Intenção de branch `existing`, `create` ou `generated`; base e SHA explícitos, preview revalidado, worktree isolada e journal de provisionamento. O fluxo não troca a branch da origem e não depende de Azure DevOps ou de qualquer gerenciador de cards.
- Destino Thread persistente por padrão, com terminal legado compatível. A tarefa persiste o vínculo entre projeto, branch, worktree, provider, ID nativo e geração. Boot reconcilia sem relançar o agente nem escolher uma sessão pela recência.
- Leases MCP ligados ao owner Code/Thread e revogados no encerramento; AI Memory é fonte opcional. Handoff, evidências selecionadas e checkpoints têm revisões persistidas.
- Criação e central Delegated Work em Code e Thread, com busca, detalhes da sessão, paginação e ações separadas de Open, Resume, Retry e New session. `/delegations` e `/delegation` são comandos locais da Thread.
- `/resume` na Thread oferece outras conversas salvas e delegações persistidas; a conversa atual é indicada como já aberta. Um UUID nativo informado explicitamente passa pelo leitor Claude/Codex, que valida provider e diretório antes de importar apenas histórico público. Não existe escolha automática da sessão mais recente.
- Migração v57 preserva payloads legados; recuperação por handoff permanece quando o terminal antigo não possui um ID nativo confiável.
- A criação aceita até cinco conversas Thread salvas do projeto como fontes explícitas. Captura no momento da criação somente as últimas 12 mensagens públicas por sessão (até 3 KB), com ID/título/provider e persistência no payload da tarefa; o bundle de 24 KB reparte o orçamento entre handoff, sessões, AI Memory e CodeGraph, registrando fontes distintas. Um teste com handoff de 16 KB verificou que AI Memory e as cinco sessões continuam representadas. A UI permite selecionar várias sessões e incluir AI Memory explicitamente quando habilitada, independentemente do contexto automático.

## Validação automatizada

| Verificação | Resultado | Limite da evidência |
|---|---|---|
| Typecheck | Passou | `npm run typecheck` |
| Lint | Passou, 0 erros e 35 avisos | `npm run lint`; avisos não bloqueantes do checkout atual |
| Build e budgets | Passou | Entradas: main 485/904 kB, preload 32/40 kB, renderer 464/500 kB, CSS base 422/500 kB |
| Git, migração, repositório, hosts, lifecycle | 32 testes direcionados passaram | Git/SQLite reais onde aplicável; provider simulado |
| Branch remota existente | Passou em fixture com repositório bare | Cria worktree isolada com tracking `origin/feature/CARD-99` e mantém `main` na origem |
| MCP local da Thread | 12 testes passaram | Chamada RPC com lease de owner real, incluindo token inválido/revogado; provider não autenticado nesse teste |
| Cross-workspace | 6 testes passaram isolados | Um timeout de 30 s na primeira suíte concorrendo com build e E2E; isolado passou em 6,5 s. Suíte completa foi repetida sem cargas paralelas. |
| Suíte Electron completa | 164 arquivos e 1011 testes passaram; 6 arquivos/25 testes ignorados | Repetição sem build/E2E concorrentes, 84,47 s |
| Comandos locais da Thread após ajuste | 49 testes direcionados passaram | Inclui `/delegation <taskId>` sem lançamento de provider e MCP local |
| Resume da Thread | 54 testes direcionados passaram | Inclui vínculo exato, recusa de projeto divergente e seleção da tarefa delegada na UI; CLI nativo real continua sujeito ao piloto autenticado |
| E2E Code/Thread | 1 teste passou | Renderer Electron real, IPC de delegação simulado; criação, detalhes, resume e larguras 850/1440 px |
| Consulta com 1005 tarefas | p95 de 2,06–5,83 ms nas execuções observadas, página de 50 | Mede repositório no host Windows, não o tempo até primeira página na UI |
| Fontes de sessão e AI Memory | 21 testes direcionados passaram; E2E selecionou 2 conversas e AI Memory | Captura pública limitada, origem cruzada rejeitada, tool output excluído, contexto estável após restart e orçamento reservado para todas as fontes; Memory real depende da configuração do projeto |

## Piloto autenticado

O piloto opt-in `tests/integration/delegation-native-resume.test.ts` usa a subscription instalada, um marcador público e seis turnos pequenos por provider. Ele inicia uma sessão e reinicia o processo cinco vezes, sempre com o ID nativo exato.

| Provider | Resultado |
|---|---|
| Codex | Passou: cinco reinícios, mesmo ID nativo e marcador recuperado em todos os turnos. |
| Claude | Não certificado: a primeira interação retornou `authentication`. A conta/CLI precisa estar autenticada para repetir o piloto; nenhum resultado de resume Claude foi inferido. |

O piloto acima exercita o adapter nativo. Ainda não constitui prova de cinco ciclos completos de fechar/abrir a aplicação usando o banco real para ambos os providers. Os testes de aplicação cobrem essa máquina de estados com host simulado.

## Gate e lacunas remanescentes

- A suíte Electron completa teve uma execução com **1010 testes aprovados, 1 timeout, 25 ignorados** enquanto build e E2E rodavam em paralelo. O teste que estourou o tempo passou isoladamente (6/6 no arquivo); o resultado da repetição integral está registrado abaixo.
- O `oxespace_quality_check` retornou `FAIL` por `CONTRACT_CONSUMERS_UNCHANGED`: 323 arquivos alterados e 565 consumidores de referência fora do diff no checkout amplo de Code/Thread. Disposição técnica: o achado aponta raio de impacto por referência textual, não uma falha concreta; typecheck do projeto inteiro, 1011 testes Electron, 49 testes direcionados de comandos/MCP, 15 de lifecycle, E2E e build passaram. Esses checks cobrem compatibilidade estática e os fluxos principais, mas não equivalem a revisar manualmente os 565 consumidores nem certificam dispatch dinâmico. O verdict automático permanece `FAIL` e deve acompanhar a revisão de release; nenhum falso `PASS` foi registrado.
- A meta de até 200 ms para renderizar a primeira página da central ainda não foi medida no host de referência. O teste de 1005 tarefas mede somente a consulta indexada.
- Os cenários autenticados Claude × Code/Thread e o ciclo completo de app restart para ambos os providers seguem pendentes. O modo terminal legado permanece `handoff-only` quando não há boundary nativa certificada.
- Não houve push, merge, release ou integração com Azure DevOps.

## Resultado da repetição integral

`npm run test:electron` executado sozinho: **164 arquivos passaram, 6 ignorados; 1011 testes passaram, 25 ignorados; exit code 0**. O primeiro timeout foi restrito à execução concorrente com outros jobs pesados e passou no rerun isolado e integral.

Após incluir as fontes de conversas, uma execução integral passou 1017 testes e teve um timeout de 5 s em `fs-allowlist` sob carga; o mesmo teste passou isolado em 202 ms. A repetição integral com `--maxWorkers=2 --minWorkers=1` passou: **164 arquivos, 1018 testes, 25 ignorados, exit code 0**. O E2E do diálogo confirmou a seleção de duas conversas e a opção de AI Memory; o build e os budgets passaram. O piloto autenticado Claude continua pendente como descrito acima.
