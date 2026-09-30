# Thread independente do modo Code

Estado: em implementação — 2026-09-29. Base inicial analisada: OXESpace `v0.15.2` (`5f56f70`).

## Progresso verificado em 2026-09-29

- Cadastro `thread_projects` próprio (IDs novos independentes de `memory_projects`), migração do vínculo de `conversation_threads` sem cascata de Code, preservação de eventos/operações/checkpoints e teste de exclusão de workspace Code.
- Adição, ocultação, restauração e religamento de diretório da Thread independentes da lista Code; criação de conversa sem workspace Code; ponte **Abrir no Code** somente por clique explícito.
- Seleção, configurações de projeto e conta resolvidas pelo escopo Thread; destino de delegação em Thread ou terminal passa a ser escolhido explicitamente.
- Verificações locais: `typecheck`, lint sem erros, build e orçamento de bundle passaram; suíte Vitest passou com 1.079 testes e 25 ignorados; Playwright Electron no Windows passou para navegação/reinício/religamento, ações de conversa e workbench.

**Ainda necessário para o gate integral:** eliminar o `workspaceId` de compatibilidade no runtime/registro legado, migrar preferências e tarefas legadas com cobertura de quatro direções de delegação, testar `/resume` e sessões grandes após migração com dados reais, validar o fluxo completo no Linux e publicar em duas etapas. Projetos migrados conservam seus IDs históricos; projetos novos já usam IDs exclusivos da Thread. Estes itens não estão declarados como validados pelos testes acima.

## Objetivo e limite

Thread terá cadastro de projetos, seleção, conversas, sessões nativas, preferências e configurações de delegação próprios. Abrir, remover, renomear ou trocar um workspace/terminal no Code não deve alterar a lista, a seleção nem os dados da Thread; e ações equivalentes na Thread não devem criar ou alterar um workspace Code. Uma transferência entre os modos só ocorrerá por ação explícita do usuário, por exemplo **Abrir esta pasta no Code** ou **Abrir conversa delegada na Thread**.

O mesmo diretório ainda pode ser aberto nos dois modos. Nesse caso, ambos verão as alterações reais nos arquivos e no Git; independência de arquivos exigiria worktrees distintos. Contas Claude/Codex e preferências globais do aplicativo podem continuar compartilhadas, mas o estado de cada sessão e as autorizações por superfície devem ter escopo explícito.

## Diagnóstico confirmado no código

| Acoplamento atual | Consequência |
| --- | --- |
| `thread-projects.ts` constrói o catálogo a partir de `workspaces` e `panes` e usa `MemoryProjectService` como registro de identidade | Um projeto do Code aparece automaticamente na Thread, inclusive contextos de terminais. |
| `App.tsx` passa todos os `workspaces` para Thread, carrega suas conversas e usa o workspace ativo do Code como preferência | A abertura e a seleção da Thread dependem da navegação do Code. |
| `App.tsx` cria um workspace Code de uma pane quando a pasta é adicionada à Thread | Uma ação da Thread altera a sidebar e a persistência do Code. |
| `conversation_threads.workspace_id` referencia `workspaces(id) ON DELETE CASCADE` | Excluir um workspace Code pode apagar a conversa e seus eventos, operações e checkpoints. |
| `NewThreadDialog` e `thread.create` recebem `workspaceId` e opcionalmente `paneId` | A Thread não consegue criar conversa sem contexto Code. |
| `SettingsCenter` recebe `activeWorkspace?.id` mesmo em Thread | Configuração pode ser aplicada ao projeto aberto no Code, e não à conversa/projeto visível na Thread. |
| Delegação usa `workspaceId` e escolhe a superfície Thread por padrão quando `threadHost` existe | Trabalho iniciado no Code pode aparecer/abrir na Thread sem uma decisão explícita sobre a superfície. |

Os arquivos centrais são `electron/main/services/conversation/thread-projects.ts`, `electron/main/db/migrations/053_threads.sql`, `electron/main/ipc/thread.ipc.ts`, `src/App.tsx`, `src/store/thread.store.ts`, `src/components/Threads/ThreadDialogs.tsx` e `electron/main/services/delegation/delegation-application.service.ts`.

## Contrato de destino

- `thread_projects` é o cadastro persistente da Thread: `id`, caminho canônico, nome, identidade Git/repositório, caminho de abertura e estado de visibilidade. Identidade Git serve para deduplicar worktrees do mesmo repositório, mas não torna o projeto dependente de `memory_projects` ou `workspaces`.
- `conversation_threads` pertence a `thread_projects` por `thread_project_id`; conserva `root_path` da conversa para reabrir exatamente o checkout usado. `workspace_id` deixa de ser requisito e não possui `ON DELETE CASCADE` para workspaces Code. O histórico por `thread_id` permanece intacto.
- `ThreadProjectService` resolve pastas, valida existência/Git, lista/oculta/restaura projetos e oferece um contexto de execução Thread sem criar pane ou workspace Code. Projeto temporariamente indisponível continua visível com opção de corrigir caminho; não apaga histórico.
- `ThreadState` guarda `activeThreadProjectId` e `selectedThreadId` independentes de `activeWorkspaceId`. Alternar Code ↔ Thread preserva a seleção e a posição de leitura de cada modo. A primeira abertura não usa automaticamente o projeto ativo no Code.
- Configurações de Thread resolvem o projeto Thread selecionado. Configurações de Code resolvem o workspace Code selecionado. Tema global e contas são explicitamente globais; delegação, memória e permissões exibem seu escopo na tela antes de salvar.
- Delegação recebe origem `{ surface: 'code' | 'thread', projectId, sessionId }` e destino explícito. A escolha de Thread/terminal no formulário e na ferramenta deve corresponder ao destino persistido; nenhuma superfície é escolhida apenas porque um host está disponível. Autorizações entre projetos são por identidade canônica, origem e destino, com prazo e evidências separados. Rotas antigas continuam válidas apenas para tarefas antigas até serem migradas/reautorizadas; não ampliar uma autorização silenciosamente.

## Implementação em ondas

### 1. Contrato e inventário de dados

1. Adicionar testes de contrato que reproduzam: projeto Code aparecendo na Thread, projeto Thread criando workspace Code, remoção Code afetando Thread, abertura de Settings na Thread apontando para Code e delegação Code→Thread automática.
2. Inventariar todos os consumidores de `ConversationThread.workspaceId`, `ThreadApi`, `DelegationTask` e `AgentAccountContext`. Separar três conceitos nos tipos: **projeto Thread**, **workspace Code** e **execução/sessão nativa**. Não reutilizar `workspaceId` como alias de `threadProjectId`.
3. Fixar comportamento para pastas não Git, worktrees, caminhos simbólicos, projetos indisponíveis, várias conversas por projeto e importação `/resume` antes de alterar o esquema.

**Aceite:** testes de reprodução falham no estado atual e o mapa de consumidores cobre IPC, renderer, persistência, contas, memória, delegação e atualização de eventos.

### 2. Persistência independente e migração segura

1. Criar migração numerada após `058` com `thread_projects` e tabela de mapeamento legado `workspace_id → thread_project_id`. Deduplicar pela identidade canônica sem fundir checkouts/conversas diferentes; manter o `root_path` original de cada conversa.
2. Migrar `conversation_threads` para a nova referência, removendo a dependência `ON DELETE CASCADE` de `workspaces`. Como eventos, turnos, artefatos, operações e checkpoints referenciam `conversation_threads`, usar cópia/transação controlada e verificar `PRAGMA foreign_key_check`, contagens e hashes de IDs/ordem antes e depois. Não executar `DROP` do pai com chaves estrangeiras ativas sem um procedimento testado de reconstrução.
3. Preservar o JSON legado e o `nativeSessionId` até o leitor novo confirmar todos os campos; reexecutar a migração sem duplicar projetos. Manter backup pré-migração e interromper o upgrade se qualquer conversa não puder ser mapeada. Testar restauração do backup.
4. Mover anexos e referências de delegação por ID estável de thread; manter IDs de conversa e histórico, inclusive threads arquivadas, falhas, sessões grandes e destinos de delegação.

**Aceite:** excluir um workspace Code após a migração não remove nenhum projeto, thread, evento, anexo, operação ou checkpoint da Thread. Bancos antigos atualizam sem perda; `foreign_key_check` fica vazio e `/resume` abre a mesma sessão nativa.

### 3. Serviço e API da Thread

1. Substituir catálogo baseado em `workspaces/panes` por `ThreadProjectService`; IPC oferece `projects.list/add/hide/restore/relink`, `threads.list(projectId)` e `threads.create(threadProjectId, provider, checkout?)`.
2. Resolver conta e diretório pelo projeto/conversa Thread, não por pane Code. Validar o caminho e a identidade novamente antes de enviar, importar ou retomar sessões; exibir erro recuperável se a pasta mudou.
3. Eliminar a criação de workspace de compatibilidade no fluxo **Add project**. `hide/remove` da Thread altera só o seu registro; excluir Code não chama a API Thread. Manter uma ponte explícita **Abrir no Code** que cria/seleciona um workspace apenas após clique.

**Aceite:** API da Thread funciona com zero workspaces Code; adicionar/remover projeto em qualquer modo não modifica o catálogo do outro. Conversas existentes continuam legíveis e graváveis após reinício.

### 4. Navegação e configurações sem sincronização implícita

1. Fazer `ThreadGrid`, `ThreadSidebar` e `NewThreadDialog` receberem projetos/contextos Thread. Remover `workspaces` e `activeWorkspaceId` de sua seleção normal. Persistir seleção Thread e Code separadamente, com fallback apenas dentro do respectivo modo.
2. Passar `threadProjectId` selecionado ao abrir configurações na Thread; mostrar claramente **Configurações da Thread · projeto X**. Impedir salvar delegação/memória no workspace Code ativo por engano. Se não houver projeto Thread, pedir seleção antes de abrir configurações de projeto.
3. Mostrar projetos Thread indisponíveis com opção de religar diretório; mostrar distinção entre projeto, conversa e sessão nativa. Não criar sessões ou workspaces silenciosamente ao alternar modos.

**Aceite:** alternar 20 vezes entre modos, trocar seleção em cada um, reiniciar o app e abrir configurações preserva contextos corretos. O teste inclui Code no projeto A e Thread no projeto B.

### 5. Delegação, memória e pontes explícitas

1. Tornar a origem e o destino da delegação independentes de um pane/workspace Code quando partem da Thread. Para origem Code, manter a execução/pane original. A API de destino informa explicitamente `thread` ou `terminal`; o diálogo apresenta essa escolha e a revisão do projeto/checkout antes de iniciar.
2. Separar opt-in do projeto de uma autorização cruzada. A tela da origem lista destinos autorizados ativos e o projeto de destino mostra seu próprio opt-in. Pré-visualização/erro `CROSS_PROJECT_CONSENT_REQUIRED` deve indicar origem, destino, tipo de autorização ausente e ação exata, sem sugerir reiniciar terminal como solução universal.
3. Migrar tarefas delegadas existentes por `destinationThreadId` sem perder resultado, checkpoints, execução de origem ou permissão já exercida. Novas tarefas não herdam permissões Code→Thread por acidente. Vincular memória à execução correta no lançamento; a indisponibilidade de memória não se apresenta como falha de autorização de delegação.

**Aceite:** Code→Code, Code→Thread, Thread→Thread, Thread→Code e delegação entre repositórios têm testes separados de sucesso/negação; cada tarefa abre exatamente o destino escolhido. A lista de destinos mostra a autorização recém-criada sem abrir novo terminal, e revogação/expiração bloqueiam novas tarefas.

### 6. Validação e implantação

1. Testes de migração com banco `v0.15.2` realista e cópia de segurança; testes de propriedade para IDs, contagens, eventos e FKs. Testes de integração para registro independente, caminhos, autorização e tarefas legadas.
2. Playwright Electron em Windows e Linux: navegação cruzada, configurações A/B, criar/remover projeto, reinício, `/resume`, sessões longas, delegação nas quatro combinações, autorização/revogação e recuperação de projeto ausente. Conferir visualmente estados vazios, erros e seleção, sem depender apenas de capturas.
3. Liberar em duas etapas: primeiro migração e leituras novas com telemetria local de inconsistência; depois remover ponte automática de criação/seleção após passar os cenários. Não apagar colunas/compatibilidade antigas antes de ao menos uma versão estável validada. Documentar recuperação via backup e impedir downgrade silencioso para binário que desconheça o esquema novo.

**Gate de entrega:** nenhum workspace ou pane Code é criado pela Thread; apagar Code não apaga Thread; a pasta aberta no Code não altera a seleção Thread; configurações e delegação apontam ao projeto visível; históricos, anexos, IDs de `/resume` e tarefas antigas sobrevivem à migração; `typecheck`, lint sem erros, suíte completa, build e E2E Windows/Linux passam.
