# Paridade operacional entre CLI e Thread

Data: 2026-09-18. Execução atualizada em 2026-09-20. Estado: **implementação ampla concluída para o núcleo P1; certificação total parcial/bloqueada pelas lacunas registradas**.

Resultado e provas: [EVIDENCE.md](EVIDENCE.md) e [CAPABILITY-MATRIX.md](CAPABILITY-MATRIX.md). O plano continua sendo o contrato de escopo; itens parciais/bloqueados não são considerados completos.

Objetivo: permitir que o usuário realize na Thread as mesmas operações funcionais oferecidas pelos agentes nos terminais Code, com configuração e efeitos equivalentes, sem abandonar a conversa nem abrir Advanced CLI tools. A referência de identidade visual é o design system Code do OXESpace; paridade funcional não exige reproduzir aparência/ANSI da TUI.

Base: [auditoria atual](../../audits/thread-cli-capabilities-2026-09-18.md), [matriz](CAPABILITY-MATRIX.md), [aceite/pilotos](ACCEPTANCE.md), [contrato UI](UI-SPEC.md), [baseline de protocolo](protocol-baseline.json). O plano enriquecido com todos os campos e dependências está em [steps.json](steps.json).

## 1. Escopo e definição de conclusão

**P1 — Claude e Codex:** capacidades da versão CLI de referência, em configurações de autenticação/permissão declaradas. Primeira qualificação: assinatura, como solicitado pelo usuário. Perfis API/configurações alternativas entram em qualificação separada quando selecionados, sem trocar assinatura por API silenciosamente. Todas as funções obrigatórias do manifesto de P1 devem ter equivalente operacional, incluindo comandos, inputs, perguntas/aprovações, ferramentas, extensões, sessões, recuperação e observabilidade.

**P2 — Demais providers/perfis Code:** Copilot/gh-copilot, Antigravity, Cursor, Grok e custom conforme o inventário real de `shared/types/agent.ts`. Perfis derivados Claude/Codex são atendidos pelo respectivo adapter. Providers sem protocolo utilizável exigem pesquisa/extensão concreta. CLI arbitrário em perfil custom não permite promessa de adaptação universal; precisa declarar adapter/capabilities. P1 concluído não significa P2 concluído nem paridade geral de todos os perfis.

**P3 — Equivalência de ambiente OXESpace:** Git, arquivos/editor, Preview, terminal auxiliar explícito, várias sessões e delegação já existentes em Code devem ter destino/contexto correto na Thread. Reutilizar as tarefas restantes do workbench, sem reconstruir serviços ou duplicar entregas.

Estados do manifesto: inventariado, implementado, verificado com fixture, verificado nativo sem inferência, verificado em tarefa real, bloqueado, experimental. `unsupported` explicado é melhor UX, mas continua lacuna. Um recurso funcional obrigatório sem API não pode ser removido da matriz para fechar o plano; deve ganhar uma tarefa de adapter/protocolo/contribuição e evidência posterior.

Não contam como paridade: nomes de comandos presentes, mocks passando sozinhos, resposta do modelo dizendo que mudou uma configuração, tool entrada apresentada como diff confirmado, terminal oculto que manipula teclas ou alteração de CSS. Comandos apenas visuais da TUI ganham equivalente desktop especificado; comandos que executam uma função precisam executar essa função.

## 2. Base existente a preservar

- Executáveis nativos: Codex app-server e Claude print/stream-json, com modelo/esforço/acesso no compositor, assinatura, resume, interrupt e aprovação simples.
- Markdown GFM, sidebar/rodapé compartilhados, rascunhos, scroll, diagnóstico sanitizado e quotas/reset Codex.
- Migração054: eventos/turnos/artefatos e importação lazy transacional; patches/diff por turno Codex, entrada/resultado de arquivo Claude e artefatos sob demanda.
- Workbench lateral/drawer com Session changes, Project changes tracked, Plan, Activity; comentário de diff para o rascunho da mesma Thread.
- Bridge MCP próprio da Thread com14 ferramentas de consulta/contexto/memória; leases e isolamento de ambiente já corrigidos. Essa correção não entregou automação MCP completa.

O histórico ainda é lido/serializado como snapshot; writes atuais podem substituir seqs. O backend bloqueia send por2.000 eventos/2MiB. Claude read-only não oferece AskUserQuestion no toolset e usa permission-prompts none; sua aprovação genérica não é um formulário de resposta. Codex aceita somente duas classes de host approval. Essas são prioridades reais, não problemas de estética.

## 3. Descobertas de protocolo que orientam implementação

O schema experimental foi exportado do Codex0.154.0 instalado, sem inferência. O baseline JSON guarda hashes e métodos extraídos exclusivamente de `properties.method.enum`:

- `turn/steer` e família `thread/queue/*`: fila e direcionamento nativos, evitando uma fila duplicada quando suportados.
- `item/tool/requestUserInput`, `item/permissions/requestApproval`, `mcpServer/elicitation/request` e `item/tool/call`: interações além das aprovações atuais.
- `permissionProfile/list`, `configRequirements/read`, `thread/settings/update`: políticas efetivas/configuração.
- `thread/list/read/search/name/set/archive/delete/unarchive/fork`, `thread/goal/*` e background terminals: sessões/metas/processos.
- APIs de MCP OAuth/reload/status/resource/tool e plugins/apps/skills/hooks. Método presente no schema ainda precisa handshake e piloto para conta/plataforma selecionada.

Claude: a documentação oficial descreve AskUserQuestion via canUseTool, regras/modos/hooks e entradas streaming com imagens. A implementação deve verificar a tradução no executável2.1.274 instalado. Trocar biblioteca/transporte só será necessário se o protocolo direto não conseguir os mesmos resultados; não assumir que incluir uma dependência nova resolve auth/permissões.

## 4. Decisões de arquitetura

### D01 — Preservar Codex app-server e Claude headless/stream-json; negociar capacidades por versão.

São os motores já usados; paridade deve vir de APIs reais, sem automação TUI ou troca para Advanced CLI.

### D02 — Native runtime é a fonte de contexto, fila nativa e estado de sessões quando expostos.

Evita duas filas, nomes e históricos divergentes; SQLite armazena projeção/evidência e estado UI.

### D03 — Configuração solicitada e efetiva, autorização e disponibilidade são estados separados.

Um seletor não prova configuração aplicada e catálogo não concede permissão.

### D04 — Um request registry por execução/turno, com geração e resolução controlada.

Respostas tardias, troca de Thread e reconnect não podem aprovar outro comando ou perder perguntas.

### D05 — Persistência incremental e paginação antes de ampliar input/streaming.

O write atual usa snapshots completos; paginar sem alterar write pode apagar eventos não carregados.

### D06 — Execução MCP com owner discriminado pane/thread e autorização no main.

A infraestrutura atual exige pane; criar um pane fictício contornaria o contexto e não resolveria a autorização.

### D07 — Comandos têm equivalência semântica documentada, não só nomes iguais.

Resume/delete/export/stop locais hoje diferem do CLI; a UI deve explicitar efeito/escopo.

### D08 — Design system Code com composição de Thread e controles permanentes de modelo/esforço.

Identidade OXESpace, acessibilidade e chat estável são requisitos persistentes do usuário.

### D09 — Paridade certificada por provider/versão/plataforma/autenticação.

SDK e CLI evoluem; mocks, lista descoberta e screenshots não certificam tarefa real.


### Contratos centrais

- **ThreadExecutionContext:** owner discriminado, IDs locais/nativos, perfil/auth, root canônico/worktree, geração, policy/config revision. Main resolve caminhos, executáveis e credenciais; renderer envia IDs/inputs validados.
- **ThreadRequest:** native request/turn/generation, tipo, payload público, escopo, prazo, resolução e provenance. Uma aprovação não concede acesso a requests futuros sem escopo escolhido.
- **ThreadInput/QueueItem:** texto/anexos/menções/skill, ID estável, config snapshot, estado e ACK. Onde o runtime não tiver idempotência, ACK perdido vira resultado desconhecido; não prometer exactly-once nem repetir escrita automaticamente.
- **ThreadHistory API:** metadata + janela inicial; eventos/turnos por cursor estável e epoch; append/update e replace explícito. Salvar janela paginada nunca equivale a apagar histórico não carregado. Compactação do contexto nativo e retenção local são operações distintas.
- **ThreadCommandManifest:** aliases, argumentos, versão/provider/auth/plataforma, efeito/escopo, handler, confirmação, origem/evidência e qualificação. Menu, slash e botão usam o mesmo executor.
- **MCP lease:** autorização server-side por owner/contexto/política, revogação por geração e decisões correlacionadas. Filtro do bridge não é a única fronteira. Memória é opcional e continua habilitada por preferência explícita.

Não reduzir managed policy para aproximar visualmente os modos. Se a mesma conta estiver em duas execuções do mesmo nativeId, controlar ownership e não permitir dois escritores sem suporte explícito do runtime. Caches/watchers usam contexto do root/worktree e geração; nunca o pane Code oculto como destino da Thread.

## 5. Ondas e gates

| Onda | Passos | Entrega | Gate de saída |
|---|---|---|---|
| W0 |01–04| Baseline, manifesto, escopo/policies e contrato UI | Nenhum recurso inventariado sem classificação; APIs confirmadas versus pendentes separadas |
| W1 |05–10| Configuração efetiva, requests, perguntas e aprovações | A01–A07 e A12; interação approve/deny/cancel real por provider |
| W2 |11–17| Histórico escalável, fila/steering, anexos e voz | A08–A11/A16–A18/A23; sem PTY ao digitar slash, sem duplicação de envio |
| W3 |18–22| Comandos, operações nativas de sessão, export/revert | A13–A15/A19/A20; sem comandos obrigatórios apenas catalogados |
| W4 |23–26| Execução MCP, autenticação/extensões/hooks/skills | A21–A24; tools mutantes aprováveis e efeitos observados |
| W5 |27–31| Observabilidade, evidência, workbench, subagentes e múltiplas sessões | A25–A29; estado/evidência e isolamento de root confirmados |
| W6 |32–33| Providers/perfis adicionais | Manifesto+conformance+pilotos por provider; requisito específico P2 |
| W7 |34–36| Falhas/regressão, comparação real e certificação | A30–A32; relatório por escopo, zero lacuna crítica ocultada |

W4 não requer terminar todo W3 visual para iniciar infraestrutura, mas segue as dependências em steps.json. W2 backend deve anteceder anexos/streams amplos. W5 usa workbench já construído. Pesquisa W6 pode ocorrer após W0, mas não atrasa o desbloqueio de P1.

Packs19,29 e33 são épicos delimitados: antes de executá-los, criar subtarefas de uma sessão por família de comandos/painel/provider, com critérios e write-set. O épico só termina quando todas as subtarefas obrigatórias passam; não implementar todas as famílias em um patch grande. Estimativas low/medium/high medem complexidade, não prazo prometido. Calendário só depois de W0 e medição dos pilotos.

## 6. Plano detalhado

### 01 — Fixar baseline nativo e inventário de comandos

**Onda:** W0 · **Tipo:** research · **Esforço:** medium · **Depende de:** nenhum · **Estado:** planejado.

Exportar schemas da versão instalada; registrar comandos documentados/disponíveis e diferenças de Windows/Linux/macOS. Criar handshake Claude e identificar control requests, modelos, tools, inputs e persistência. Confirmar capacidades experimentais por probe sem inferência, sem iniciar processos por tecla.

**Aceite:**

- Baseline tem versões/hashes e operações com origem rastreável; cada comando possui semântica/argumentos/efeitos.
- Runtimes são sondados em subprocessos controlados; falta de API vira bloqueio de provider e tarefa específica, não suporte presumido.

**Arquivos:** `shared/threadCommands.ts`, `electron/main/services/conversation/claude-command-catalog.ts`, `tests/conversation-process-smoke.test.ts`, `docs/plans/thread-cli-parity/protocol-baseline.json`.

**Verificação:** Evidência por provider, versão, plataforma e autenticação; um mock não certifica execução nativa.

### 02 — Definir manifesto de capacidades e contrato de adapter

**Onda:** W0 · **Tipo:** design · **Esforço:** high · **Depende de:** 1 · **Estado:** planejado.

Substituir booleanos genéricos por capacidades discriminadas por versão, modelo, conta, política e plataforma. Separar suportado, habilitado, autorizado, implementado e verificado. Definir entradas tipadas, requests, filas, sessões, eventos e erros sem RPC arbitrário no renderer.

**Aceite:**

- Toda capacidade da matriz possui responsável, handler/protocolo, gate e cenário real.
- Contratos antigos possuem leitura/migração definida; preview experimental não entra no denominador certificado.

**Arquivos:** `shared/types/thread.ts`, `shared/threadDesktopCommands.ts`, `shared/types/ipc.ts`, `electron/preload/api.ts`.

**Verificação:** Evidência por provider, versão, plataforma e autenticação; um mock não certifica execução nativa.

### 03 — Definir escopo, políticas efetivas e ciclo da sessão

**Onda:** W0 · **Tipo:** design · **Esforço:** high · **Depende de:** 1, 2 · **Estado:** planejado.

Especificar ThreadExecutionContext com thread/project/workspace/root canônico/worktree/geração/native ID/perfil/autenticação. Modelar configuração solicitada e efetiva, revisão e próxima execução. Auditar settings, prompt, tools, hooks, sandbox, rede e auth, evitando equivalências falsas entre providers. Definir auth subscription e perfis API explícitos quando fizerem parte do baseline, com referência de credencial no main; não restaurar API keys do ambiente pai.

**Aceite:**

- Tabela de tradução de políticas e origem de instruções definida por provider; sem mapear níveis incompatíveis por nome.
- Shutdown/reconnect/troca de perfil e conta invalidam leases/caches; nenhuma credencial do terminal pai é reutilizada.

**Arquivos:** `electron/main/services/conversation/thread-runtime.ts`, `electron/main/services/conversation/process-transport.ts`, `electron/main/services/execution-registry.ts`, `electron/main/services/conversation/native-account.service.ts`.

**Verificação:** Evidência por provider, versão, plataforma e autenticação; um mock não certifica execução nativa.

### 04 — Fechar contrato visual das interações novas

**Onda:** W0 · **Tipo:** design · **Esforço:** medium · **Depende de:** 2, 3 · **Estado:** planejado.

Aplicar design system Code a perguntas/aprovações, fila, anexos, estado efetivo, sessões e extensões. Preservar sidebar e workbench; mensagens/configuração nunca viram terminal. Detalhar teclado, foco, loaders, estados vazios e falhas em UI-SPEC.

**Aceite:**

- Pergunta pendente permanece visível após trocar de Thread e apresenta sessão/efeito.
- 900/1440 px, tema claro/escuro, teclado e leitores de tela têm comportamento especificado.

**Arquivos:** `docs/plans/thread-cli-parity/UI-SPEC.md`, `src/components/Threads/ThreadView.tsx`, `src/styles/tokens.css`.

**Verificação:** Evidência por provider, versão, plataforma e autenticação; um mock não certifica execução nativa.

### 05 — Aplicar e observar configuração efetiva do Codex

**Onda:** W1 · **Tipo:** implement · **Esforço:** high · **Depende de:** 3 · **Estado:** planejado.

Integrar permissionProfile/list, configRequirements/read, config/read e configurações por sessão/turno disponíveis no baseline. Remover networkAccess=false incondicional em favor de política escolhida. Preservar perfil/model provider/prompt/settings realmente selecionados, observando os retornos nativos. Respeitar modelProvider/auth do perfil escolhido; remover forced subscription somente em modo API explícito previsto no contrato e coberto por teste.

**Aceite:**

- UI mostra valores confirmados; falha de mudança mantém última revisão efetiva.
- Políticas de leitura/escrita/rede e acesso adicional possuem testes de permissão/negação e confirmação quando exigida.

**Arquivos:** `electron/main/services/conversation/codex-conversation.ts`, `electron/main/services/conversation/thread-manager.ts`, `src/components/Threads/ThreadConfigurationBar.tsx`, `tests/codex-conversation.test.ts`, `electron/main/services/conversation/native-account.service.ts`.

**Verificação:** `node scripts/test-electron.mjs tests/codex-conversation.test.ts tests/integration/thread-manager.test.ts tests/thread-models.test.ts`.

### 06 — Aplicar política de ferramentas e configuração Claude

**Onda:** W1 · **Tipo:** implement · **Esforço:** high · **Depende de:** 3 · **Estado:** planejado.

Traduzir modos/regras/settings/toolset reais sem confundir plan com sandbox de leitura. Acrescentar AskUserQuestion ao toolset restrito e permitir perguntas via host sem autorizar escrita. Preservar prompt/perfil/skills e configuração efetiva; mudança headless só em fronteira de turno com resume confirmado. Resolver auth API apenas quando selecionada explicitamente; nunca alternar assinatura/API por erro de login.

**Aceite:**

- AskUserQuestion funciona em leitura; aprovar pergunta não libera Edit/Bash arbitrariamente.
- Modos e allow/deny respeitam precedência nativa; configuração inválida falha antes de consumir turno.

**Arquivos:** `electron/main/services/conversation/claude-conversation.ts`, `electron/main/services/conversation/claude-command-catalog.ts`, `electron/main/services/conversation/thread-models.ts`, `tests/claude-conversation.test.ts`, `electron/main/services/conversation/native-account.service.ts`.

**Verificação:** `node scripts/test-electron.mjs tests/claude-conversation.test.ts tests/thread-models.test.ts`.

### 07 — Criar registro de requests pendentes e resolução única

**Onda:** W1 · **Tipo:** implement · **Esforço:** high · **Depende de:** 2, 3 · **Estado:** planejado.

Introduzir ThreadRequestRegistry com request/native/turn IDs, tipo, deadline, geração, escopo e estado. Não armazenar segredos. Reconexão pergunta ao runtime se request ainda existe; restart não reaplica decisões automaticamente. Responder exatamente uma vez e invalidar após resolved/interrupt/exit.

**Aceite:**

- Troca de sessão, resposta duplicada/atrasada e request de outra geração não atingem o adapter errado.
- Request expirado/cancelado é explicado e nunca fica como modal impossível de fechar.

**Arquivos:** `electron/main/services/conversation/thread-request-registry.ts (novo)`, `electron/main/services/conversation/thread-manager.ts`, `shared/types/thread.ts`, `tests/thread-requests.test.ts (novo)`.

**Verificação:** `node scripts/test-electron.mjs tests/thread-requests.test.ts tests/integration/thread-manager.test.ts`.

### 08 — Implementar requests estruturados do Codex

**Onda:** W1 · **Tipo:** implement · **Esforço:** high · **Depende de:** 5, 7 · **Estado:** planejado.

Tratar user input, permissions, elicitation MCP, tool/call e utilidades host conforme schemas. Mapear decisões simples, sessão, cancelamento e emendas suportadas. Requests de auth/attestation ficam no serviço correto; não fabricar credenciais. Elicitation URL/form usa contexto validado e UI específica.

**Aceite:**

- Perguntas simples/múltiplas/formulários retornam payload esperado pelo agente; permissions concede somente o subconjunto escolhido.
- Cada ServerRequest do baseline é classificado e coberto; desconhecidos retornam erro específico com recuperação, não negação silenciosa.

**Arquivos:** `electron/main/services/conversation/codex-conversation.ts`, `electron/main/services/conversation/rpc-peer.ts`, `electron/main/services/conversation/thread-request-registry.ts (novo)`, `tests/codex-conversation.test.ts`.

**Verificação:** `node scripts/test-electron.mjs tests/codex-conversation.test.ts tests/thread-requests.test.ts`.

### 09 — Implementar perguntas e controle Claude

**Onda:** W1 · **Tipo:** implement · **Esforço:** high · **Depende de:** 6, 7 · **Estado:** planejado.

Distinguir AskUserQuestion de aprovação genérica can_use_tool; serializar respostas em updatedInput/answers conforme runtime. Preservar cancelamento e control request errors. Implementar demais requests necessários registrados no baseline, sem aprovar todos os tools por efeito colateral.

**Aceite:**

- Seleção única/múltipla e texto livre chegam ao native tool corretamente.
- Question deny/cancel, MCP interaction e aprovação de escrita têm efeitos distintos e verificáveis.

**Arquivos:** `electron/main/services/conversation/claude-conversation.ts`, `electron/main/services/conversation/thread-request-registry.ts (novo)`, `tests/claude-conversation.test.ts`.

**Verificação:** `node scripts/test-electron.mjs tests/claude-conversation.test.ts tests/thread-requests.test.ts`.

### 10 — Renderizar perguntas/aprovações e estados de recuperação

**Onda:** W1 · **Tipo:** implement · **Esforço:** medium · **Depende de:** 4, 8, 9 · **Estado:** planejado.

Criar cartões semânticos na conversa com opções, texto livre, escopo de autorização, confirmação/negação/cancelamento e estado final. Fechar detalhe não resolve o request. Sidebar indica sessão aguardando interação; retomar mantém pergunta e draft.

**Aceite:**

- Fluxo funciona pelo teclado e preserva compositor/scroll; trocar de Thread não transfere resposta.
- Sessão resolvida/expirada remove controles ativos; ações inválidas mostram motivo e recovery.

**Arquivos:** `src/components/Threads/ThreadView.tsx`, `src/components/Threads/ThreadRequestCard.tsx (novo)`, `src/components/Threads/ThreadSidebar.tsx`, `src/store/thread.store.ts`, `e2e/thread-view.spec.ts`.

**Verificação:** `npx playwright test e2e/thread-view.spec.ts`.

### 11 — Persistir eventos incrementalmente e paginar no backend

**Onda:** W2 · **Tipo:** implement · **Esforço:** high · **Depende de:** 2, 7 · **Estado:** planejado.

Evoluir migration054 sem refazer importação: append/update por ID/seq, read metadata/latest window, cursor de eventos/turnos e fetch artefatos. Remover leitura/serialização do histórico inteiro em cada write/send. Projeção legacy fica adaptativa e limitada; compactação nativa separada de retenção local.

**Aceite:**

- 10.000+ eventos permitem novos turnos; não há bloqueio por quantidade de mensagens locais.
- Migração idempotente, crash/flush, rewind e cursor estável testados; APIs não podem ler artefato de outra Thread.
- Salvar uma janela paginada nunca apaga eventos fora dela; somente replace/rewind explícito pode trocar a geração do histórico.

**Arquivos:** `electron/main/services/conversation/thread-history.ts`, `electron/main/services/conversation/thread-manager.ts`, `electron/main/db/index.ts`, `electron/main/db/migrations/NNN_thread_runtime.sql (novo; próximo número livre)`, `electron/main/ipc/thread.ipc.ts`, `tests/integration/thread-history.test.ts`.

**Verificação:** `node scripts/test-electron.mjs tests/integration/thread-history.test.ts tests/integration/migrations.test.ts`.

### 12 — Virtualizar timeline e preservar âncoras de scroll

**Onda:** W2 · **Tipo:** implement · **Esforço:** high · **Depende de:** 4, 11 · **Estado:** planejado.

Criar cache de janelas por Thread e timeline virtualizada com alturas dinâmicas, âncora ao carregar passado, itens atualizáveis e follow-bottom em mudanças de qualquer output. Não desmontar compositor/painéis ao paginar ou renderizar erro.

**Aceite:**

- Expandir output antigo durante streaming respeita follow-bottom sem roubar leitura do histórico.
- Troca rápida de Thread, tabela/diff/imagem e prepend de páginas preservam seleção/foco/scroll.

**Arquivos:** `src/store/thread.store.ts`, `src/components/Threads/ThreadView.tsx`, `src/components/Threads/ThreadTimeline.tsx (novo)`, `tests/thread-view.test.tsx`, `e2e/thread-view.spec.ts`.

**Verificação:** `node scripts/test-electron.mjs tests/thread-view.test.tsx`.

### 13 — Integrar fila e steering nativos Codex

**Onda:** W2 · **Tipo:** implement · **Esforço:** high · **Depende de:** 5, 7, 11 · **Estado:** planejado.

Usar thread/queue add/list/update/delete/reorder/start da versão0.154.0 como fonte da fila e turn/steer para direcionar turno ativo. Separar visualmente Agora de Próximo. Não duplicar fila local e nativa; versões sem fila usam mecanismo serializado explicitamente negociado.

**Aceite:**

- Adicionar/editar/reordenar/cancelar fila coincide com lista nativa e sobrevive ao resume quando suportado.
- Steer usa expectedTurnId; falha mantém input; perguntas/falhas pausam avanço sem reenvio duplicado.

**Arquivos:** `electron/main/services/conversation/codex-conversation.ts`, `electron/main/services/conversation/thread-manager.ts`, `src/components/Threads/ThreadPromptQueue.tsx (novo)`, `src/store/thread.store.ts`, `tests/thread-queue.test.ts (novo)`.

**Verificação:** `node scripts/test-electron.mjs tests/thread-queue.test.ts tests/codex-conversation.test.ts`.

### 14 — Integrar fila Claude e entrada streaming

**Onda:** W2 · **Tipo:** implement · **Esforço:** high · **Depende de:** 6, 7, 11, 13 · **Estado:** planejado.

Implementar entrega sequencial com IDs/idempotência. Conectar entrada streaming/interrupção suportadas pelo baseline Claude; não chamar steering se não houver equivalente comprovado. Persistir estados queued/sending/ack/running/completed/interrupted/failed com recuperação explícita de resultado desconhecido.

**Aceite:**

- Turnos e configuração snapshot não se misturam; saída atrasada não conclui o item seguinte.
- Restart/login/quota/request pendente deixam fila pausada e não repetem escrita automaticamente.

**Arquivos:** `electron/main/services/conversation/claude-conversation.ts`, `electron/main/services/conversation/thread-queue.ts (novo)`, `electron/main/services/conversation/thread-manager.ts`, `tests/thread-queue.test.ts (novo)`.

**Verificação:** `node scripts/test-electron.mjs tests/thread-queue.test.ts tests/claude-conversation.test.ts`.

### 15 — Implementar inputs estruturados e armazenamento de anexos

**Onda:** W2 · **Tipo:** implement · **Esforço:** high · **Depende de:** 2, 11 · **Estado:** planejado.

Alterar send para lista tipada text/image/file-reference/skill/app-mention quando suportada. Main valida arquivos selecionados/paste, MIME/tamanho/hash, root e IDs de upload; renderer não fornece paths confiáveis. Codex usa image/localImage; Claude usa conteúdo estruturado conforme API instalada. Rever limite do JSON-line/RPC e backpressure para base64 Claude; arquivo binário não entra no snapshot nem no log.

**Aceite:**

- Imagem chega ao runtime como imagem, não descrição textual simulada.
- Anexos sobrevivem ao retry/fork apropriado; arquivo ausente/truncado tem erro claro; limpeza respeita referências e retenção.

**Arquivos:** `shared/types/thread.ts`, `electron/preload/api.ts`, `electron/main/ipc/thread.ipc.ts`, `electron/main/services/conversation/thread-attachments.ts (novo)`, `electron/main/services/conversation/codex-conversation.ts`, `electron/main/services/conversation/claude-conversation.ts`, `tests/thread-attachments.test.ts (novo)`, `electron/main/services/conversation/json-lines.ts`, `electron/main/services/conversation/process-transport.ts`.

**Verificação:** `node scripts/test-electron.mjs tests/thread-attachments.test.ts`.

### 16 — Adicionar paste/drop, referências e fila ao compositor

**Onda:** W2 · **Tipo:** implement · **Esforço:** medium · **Depende de:** 4, 10, 13, 14, 15 · **Estado:** planejado.

Adicionar chips/remover/preview de anexos e menções, fila visível e escolha enviar agora/próximo. Slash, multiline, colagem de código/imagem e teclado mantêm handlers distintos. Não criar execução nativa ao digitar barra.

**Aceite:**

- Input preservado em erro/negação/troca de Thread; upload pending bloqueia somente envio daquele item.
- Anexo+skill+texto e envio em busy/request funcionam sem abrir/fechar terminais.

**Arquivos:** `src/components/Threads/ThreadView.tsx`, `src/components/Threads/ThreadComposer.tsx (novo)`, `src/components/Threads/useThreadCommands.tsx`, `e2e/thread-view.spec.ts`.

**Verificação:** `npx playwright test e2e/thread-view.spec.ts`.

### 17 — Integrar OXEVoice ao rascunho da Thread

**Onda:** W2 · **Tipo:** implement · **Esforço:** medium · **Depende de:** 16 · **Estado:** planejado.

Reutilizar useOxeVoice com destino explícito da Thread. Hotkey no modo Thread nunca dispara voz no pane Code oculto. Texto reconhecido entra no rascunho, sem envio automático; dismiss funciona em captura, erro, cancelamento e processamento.

**Aceite:**

- Ctrl+Shift+V e hold resolvem somente o contexto focado; AbortError não prende a UI.
- Troca de sessão durante captura não insere texto na conversa errada; foco e cancelamento testados.

**Arquivos:** `src/App.tsx`, `src/hooks/useOxeVoice.ts`, `src/components/Threads/ThreadComposer.tsx (novo)`, `src/components/Voice/VoiceHud.tsx`, `tests/integration/useOxeVoice.test.tsx`.

**Verificação:** `node scripts/test-electron.mjs tests/integration/useOxeVoice.test.tsx`.

### 18 — Criar executor único de comandos com argumentos tipados

**Onda:** W3 · **Tipo:** implement · **Esforço:** high · **Depende de:** 2, 3, 5, 6, 8, 9, 11 · **Estado:** planejado.

Unificar slash/botão/menu em registro main com aliases, schema args, escopo, efeitos, confirmação e handler. Implementar resultados applied/panel/started-turn/needs-input/unsupported/failed; gerar catálogo da mesma fonte. Não classificar como completo um nome com handler indisponível.

**Aceite:**

- Cada nome do inventário recebe tratamento rastreável e equivalência definida; unknown não vira prompt AI.
- Argumentos inválidos/versão incompatível mantêm rascunho e não iniciam PTY/inferência.

**Arquivos:** `shared/threadCommands.ts`, `shared/threadDesktopCommands.ts`, `electron/main/services/conversation/thread-commands.ts`, `electron/main/services/conversation/thread-command-registry.ts (novo)`, `tests/thread-commands.test.ts`.

**Verificação:** `node scripts/test-electron.mjs tests/thread-commands.test.ts tests/thread-cli.test.ts`.

### 19 — Implementar operações Codex faltantes do manifesto

**Onda:** W3 · **Tipo:** implement · **Esforço:** high · **Depende de:** 13, 18 · **Estado:** planejado.

Executar por packs pequenos: goal/pause/resume, review targets, plan inline, fast/personality, background terminal list/terminate, approve denied, memoryMode e configurações supported. Cada pack vira subtarefa derivada antes de editar; usar APIs do baseline e confirmação conforme semântica nativa.

**Aceite:**

- Packs não podem concluir com placeholders; métodos experimentais são testados/rotulados por versão.
- Operações de conta/daemon/setup usam serviço controlado próprio quando necessárias, sem spawn TUI como fallback.

**Arquivos:** `electron/main/services/conversation/codex-conversation.ts`, `electron/main/services/conversation/thread-command-registry.ts (novo)`, `src/components/Threads/ThreadConfigurationBar.tsx`, `tests/thread-commands.test.ts`, `tests/codex-conversation.test.ts`.

**Verificação:** `node scripts/test-electron.mjs tests/thread-commands.test.ts tests/codex-conversation.test.ts`.

### 20 — Implementar equivalentes desktop e comandos Claude

**Onda:** W3 · **Tipo:** implement · **Esforço:** high · **Depende de:** 9, 18 · **Estado:** planejado.

Separar comandos de execução de controles visuais. Theme/raw/statusline/vim/keymap/voice precisam equivalentes desktop quando aplicáveis. Commands Claude descobertos só são enviados se o modo SDK realmente executar a operação. Falta de API gera contribuição/adapter feature específica com bloqueio rastreado.

**Aceite:**

- Registro distingue TUI-only equivalência visual de lacuna funcional; sem alegar suporte com retorno de texto.
- Comandos custom/skills preservam argumentos, contexto e toolset; testes real-native selecionados confirmam execução.

**Arquivos:** `electron/main/services/conversation/claude-conversation.ts`, `electron/main/services/conversation/thread-command-registry.ts (novo)`, `src/components/Threads/useThreadCommands.tsx`, `src/store/navigation-prefs.store.ts`, `tests/thread-commands.test.ts`.

**Verificação:** `node scripts/test-electron.mjs tests/thread-commands.test.ts tests/claude-conversation.test.ts`.

### 21 — Integrar histórico nativo e operações de sessão

**Onda:** W3 · **Tipo:** implement · **Esforço:** high · **Depende de:** 11, 18 · **Estado:** planejado.

Codex thread/list/search/read/name/archive/delete/unarchive/fork; Claude sessões nativas via interface suportada e leitor isolado existente. Importar/vincular por provider/root/conta/nativeId sem duplicar. Separar Remover do OXESpace de Excluir sessão nativa, com efeitos claros e confirmação.

**Aceite:**

- Sessão criada no CLI aparece e retoma na Thread com contexto nativo; operação inversa também validada.
- Rename/archive/delete seguem escopo escolhido e estado real; session locks impedem dois escritores no mesmo nativeId.

**Arquivos:** `electron/main/services/conversation/native-session-history.ts`, `electron/main/services/conversation/thread-manager.ts`, `electron/main/services/usage/codexProvider.ts`, `electron/main/services/usage/claudeProvider.ts`, `src/components/Threads/ThreadSidebar.tsx`, `tests/native-session-history.test.ts`.

**Verificação:** `node scripts/test-electron.mjs tests/native-session-history.test.ts tests/integration/thread-manager.test.ts`.

### 22 — Completar exportação, replay e revert com efeitos distintos

**Onda:** W3 · **Tipo:** implement · **Esforço:** high · **Depende de:** 11, 15, 21 · **Estado:** planejado.

Exportar mensagens/atividades/requests/turnos/artefatos com schema versionado e referências redigidas. Distinguir rollback de contexto de revert de arquivos. Usar thread/revert/checkpoint quando comprovado; fallback de arquivo exige baseline e hashes e não usa reset/clean. Import/replay não reexecuta tools.

**Aceite:**

- Exportação reabre offline a evidência sem credenciais; thumbnails/patches missing são identificados.
- Revert preserva dirty anterior e mudanças posteriores ou bloqueia conflito; sem restaurar arquivo só por input da ferramenta.

**Arquivos:** `electron/main/services/conversation/thread-history.ts`, `electron/main/services/conversation/thread-manager.ts`, `electron/main/services/conversation/thread-export.ts (novo)`, `src/components/Threads/ThreadConversationActions.tsx`, `tests/thread-export.test.ts (novo)`.

**Verificação:** `node scripts/test-electron.mjs tests/thread-export.test.ts tests/integration/thread-history.test.ts`.

### 23 — Estender autenticação de execução MCP para Threads

**Onda:** W4 · **Tipo:** implement · **Esforço:** high · **Depende de:** 3, 7, 8, 9, 11, 10 · **Estado:** planejado.

Refatorar ExecutionRegistry para discriminated owner pane/thread, geração, cwd/projeto/policy e validade. ToolContext/automation/delegation não exigem pane inexistente. Autorizar mutações no main por escopo e policy; bridge allowlist reflete capacidade autorizável, não concede autorização por descoberta.

**Aceite:**

- Leases Thread funcionam sem pane sintético; revogação por dispose/reconnect/policy é imediata.
- Scripts/worktrees/delegação passam pela decisão de usuário/política aplicável; outra Thread/workspace/token não herda autorização.

**Arquivos:** `electron/main/services/execution-registry.ts`, `electron/main/mcp-internal/tool-registry.ts`, `electron/main/mcp-internal/automation-tools.ts`, `electron/main/mcp-internal/delegation-tools.ts`, `electron/main/services/conversation/thread-mcp.ts`, `resources/mcp-bridge/oxespace-mcp.cjs`, `tests/thread-mcp.test.ts`.

**Verificação:** `node scripts/test-electron.mjs tests/thread-mcp.test.ts tests/integration/mcp-internal.bridge.test.ts`.

### 24 — Gerenciar servidores MCP e autenticação por contexto

**Onda:** W4 · **Tipo:** implement · **Esforço:** high · **Depende de:** 23, 18 · **Estado:** planejado.

Codex mcp oauth/status/resource/tool/reload APIs negotiated; Claude substituir strict-only bridge por política de servidores escolhida/trusted com fallback explícito. Preservar MCP do usuário/projeto sem sobrescrever configuração alheia. Fluxo de OAuth/form/query na Thread e diagnóstico por servidor.

**Aceite:**

- Adicionar/editar/habilitar/testar/autenticar/recarregar gera efeito real e estados de conexão distintos de resources vazios.
- Tool mutante/input interativo exige request adequado; cancelar OAuth/desligar servidor não trava sessão.

**Arquivos:** `electron/main/services/conversation/thread-mcp.ts`, `electron/main/services/mcp.service.ts`, `electron/main/services/mcp-sync.service.ts`, `electron/main/services/conversation/codex-conversation.ts`, `src/components/Threads/ThreadIntegrationsPanel.tsx (novo)`, `tests/thread-mcp-native.test.ts`.

**Verificação:** `node scripts/test-electron.mjs tests/thread-mcp.test.ts tests/integration/mcp-internal.bridge.test.ts`.

### 25 — Restaurar configuração de hooks/perfis de forma verificável

**Onda:** W4 · **Tipo:** implement · **Esforço:** high · **Depende de:** 5, 6, 7, 18 · **Estado:** planejado.

Eliminar disableAllHooks incondicional somente quando configuração/trust/policies estiverem mapeados. Integrar hooks/list e alterações por fonte suportadas; Claude hooks callback/script conforme provider. Reutilizar binding MemoryService por Thread, sem compartilhar sessão nativa ou memória-run de pane.

**Aceite:**

- Hook do baseline é observado na Thread com resultado/negação; managed deny permanece válido.
- Configuração e origins de profile/systemPrompt são mostrados sem segredos; mudança exige fronteira de turno quando necessário.

**Arquivos:** `electron/main/services/conversation/thread-runtime.ts`, `electron/main/services/conversation/claude-conversation.ts`, `electron/main/services/memory/agent-memory-adapter.ts`, `electron/main/services/memory/memory.service.ts`, `tests/integration/memory-service.test.ts`.

**Verificação:** `node scripts/test-electron.mjs tests/integration/memory-service.test.ts tests/claude-conversation.test.ts`.

### 26 — Completar apps, plugins e skills por provider

**Onda:** W4 · **Tipo:** implement · **Esforço:** high · **Depende de:** 18, 24, 25 · **Estado:** planejado.

Codex plugin install/uninstall/reconcile/search/read e apps/skills config APIs; Claude equivalente SDK/perfil quando documentado e validado. Implementar app mention/input e approvals para chamadas com efeitos. Não transformar somente listagem em painel de gestão.

**Aceite:**

- Instalar/desabilitar/atualizar skill/plugin altera catálogo efetivo e aplica ao próximo turno ou reload indicado.
- Apps usados por menção geram tool call observada e aprovação quando exigida; ações sem API ficam bloqueadas com tarefa concreta.

**Arquivos:** `electron/main/services/conversation/thread-commands.ts`, `electron/main/services/conversation/codex-conversation.ts`, `electron/main/services/conversation/claude-conversation.ts`, `src/components/Threads/ThreadIntegrationsPanel.tsx (novo)`, `tests/thread-commands.test.ts`.

**Verificação:** `node scripts/test-electron.mjs tests/thread-commands.test.ts tests/codex-conversation.test.ts tests/claude-conversation.test.ts`.

### 27 — Normalizar streaming, tool results e uso observados

**Onda:** W5 · **Tipo:** implement · **Esforço:** high · **Depende de:** 11, 12, 8, 9 · **Estado:** planejado.

Preservar output delta, MCP result/error, progresso público, compactação, reroute de modelo, child links e origem. Não expor raciocínio privado. Separar quota/reset de tokens/contexto/custos API; reutilizar usage/credits providers apenas quando vinculados à sessão correta.

**Aceite:**

- Atividade mostra erros/output/status reais sem 'completed' enganoso para tool failed/refused.
- Contexto/reset têm fonte/instante ou indisponibilidade explícita; truncamento de visualização não é confundido com contexto do motor.

**Arquivos:** `electron/main/services/conversation/codex-conversation.ts`, `electron/main/services/conversation/claude-conversation.ts`, `src/components/Threads/ThreadActivityGroup.tsx`, `src/components/Threads/ThreadFailureCard.tsx`, `electron/main/services/agentCredits/claudeCredits.service.ts`, `tests/thread-activity.test.tsx`.

**Verificação:** `node scripts/test-electron.mjs tests/thread-activity.test.tsx tests/thread-failure.test.ts tests/thread-failure-card.test.tsx`.

### 28 — Verificar evidência de alterações Claude e shell

**Onda:** W5 · **Tipo:** implement · **Esforço:** high · **Depende de:** 11, 27 · **Estado:** planejado.

Capturar baseline pontual/índice e snapshots para arquivos observados; pós-tool gera artefato confirmado quando possível. Distinguir ferramenta, turno e projeto. Ações concorrentes/shell sem autoria demonstrável ficam observadas/autoria indeterminada, sem atribuir git diff inteiro à Thread.

**Aceite:**

- Dirty anterior, staged, rename/delete/binário/untracked e edição concorrente não recebem autoria/totais falsos.
- Revert só habilita com baseline suficiente; arquivos sem evidência permanecem informados explicitamente.

**Arquivos:** `electron/main/services/conversation/thread-history.ts`, `electron/main/services/conversation/claude-conversation.ts`, `electron/main/services/conversation/thread-file-evidence.ts (novo)`, `src/components/Threads/threadChanges.ts`, `tests/thread-changes.test.tsx`.

**Verificação:** `node scripts/test-electron.mjs tests/thread-changes.test.tsx tests/claude-conversation.test.ts`.

### 29 — Integrar ferramentas Code ao workbench Thread

**Onda:** W5 · **Tipo:** implement · **Esforço:** high · **Depende de:** 3, 12, 21, 23, 28 · **Estado:** planejado.

Executar packs derivados de R08–R14/R18 do workbench: Files/editor/referências, Git tracked/untracked/watchers/stage/commit/PR, Preview e terminal de projeto aberto explicitamente. Stores/readers resolvem root+Thread; comentários/review nunca pasteiam no terminal Code.

**Aceite:**

- Mesma operação local fica disponível sem trocar de modo; Git remoto usa auth própria e confirmação adequada.
- Dois worktrees do mesmo workspace não disputam cache/watchers/selection; fechamento de painel não interrompe o agente.

**Arquivos:** `src/components/Threads/ThreadChangesPanel.tsx`, `src/components/Review/ReviewPane.tsx`, `src/components/Review/DiffCard.tsx`, `src/components/Editor/FileBrowser.tsx`, `src/components/Editor/EditorPane.tsx`, `electron/main/services/git.service.ts`, `electron/main/services/github/repository.service.ts`, `src/store/thread-workbench.store.ts`.

**Verificação:** `node scripts/test-electron.mjs tests/integration/thread-project-review.test.ts tests/thread-changes.test.tsx`.

### 30 — Integrar subagentes e delegação com ciclo próprio

**Onda:** W5 · **Tipo:** implement · **Esforço:** high · **Depende de:** 8, 9, 21, 23, 27 · **Estado:** planejado.

Preservar events de colaboração/child sessions e distinguir subagentes nativos de delegação OXESpace. Cada child possui native ID/root/status/policy/config e links. Implementar requests de child, inbox/resultado/cancelamento/retry conforme ownership, sem criar recursão automática.

**Aceite:**

- Usuário acompanha sessão child e resultado sem perder conversa principal; cancelamento/policy respeitam escopo.
- Delegação MCP Thread funciona com execução autenticada real e worktree escolhida, sem fabricar pane para contornar validações.

**Arquivos:** `electron/main/services/conversation/thread-manager.ts`, `electron/main/services/conversation/codex-conversation.ts`, `electron/main/services/conversation/claude-conversation.ts`, `electron/main/services/delegation.service.ts`, `src/components/Threads/ThreadSubagents.tsx (novo)`, `tests/thread-subagents.test.ts (novo)`.

**Verificação:** `node scripts/test-electron.mjs tests/thread-subagents.test.ts`.

### 31 — Dar visibilidade a múltiplas sessões e melhorar navegação

**Onda:** W5 · **Tipo:** implement · **Esforço:** high · **Depende de:** 12, 21, 30 · **Estado:** planejado.

Integrar duas/quatro células opcionalmente e alternância com drafts/painéis/foco independentes. Sidebar usa branch/contexto, estado de execução/pedido e menus por projeto/Thread; ação destrutiva sai da lista permanente sem perder descoberta por teclado. Respeitar dimensões compartilhadas Code.

**Aceite:**

- Duas execuções simultâneas não misturam mensagens/inputs/requests; apenas a célula focada recebe hotkey.
- Navegação funciona em poucos/muitos projetos, nomes repetidos, paths longos, collapse e viewport estreito.

**Arquivos:** `src/App.tsx`, `src/components/Threads/ThreadSidebar.tsx`, `src/components/Threads/ThreadView.tsx`, `src/store/thread.store.ts`, `src/store/thread-workbench.store.ts`, `e2e/thread-view.spec.ts`.

**Verificação:** `npx playwright test e2e/thread-view.spec.ts`.

### 32 — Inventariar providers e perfis adicionais do Code

**Onda:** W6 · **Tipo:** research · **Esforço:** high · **Depende de:** 1, 2, 3 · **Estado:** planejado.

Abrir trilha separada para providers reais de shared/types/agent.ts: Copilot/gh-copilot, Antigravity, Cursor, Grok e custom; perfis derivados de Claude/Codex reutilizam adapter e configuração. Não importar lista de providers do cdesktop como se existisse no OXESpace. Para cada provider investigar protocolo headless/auth/tools/sessions/perms.

**Aceite:**

- Cada provider/perfil tem manifesto e lacunas verificadas; ausência de API não vira automação de TUI.
- P1 Claude/Codex e P2 providers Code possuem denominadores separados; nenhuma alegação de paridade geral enquanto P2 obrigatório estiver aberto.

**Arquivos:** `shared/types/agent.ts`, `electron/main/services/agent.service.ts`, `electron/main/services/conversation/thread-runtime.ts`, `shared/types/thread.ts`, `docs/plans/thread-cli-parity/CAPABILITY-MATRIX.md`.

**Verificação:** Evidência por provider, versão, plataforma e autenticação; um mock não certifica execução nativa.

### 33 — Adicionar adapters por provider/perfil certificado

**Onda:** W6 · **Tipo:** implement · **Esforço:** high · **Depende de:** 18, 21, 32 · **Estado:** planejado.

Criar subtarefa por provider após pesquisa32 com auth, transport, requests, entradas, sessões, configuração e conformance. Perfis custom derivados usam parent adapter; CLI custom arbitrário precisa extension adapter declarado. Registrar protocolo e blocos externos necessários antes de liberar UI.

**Aceite:**

- Provider aparece somente com capacidades efetivamente implementadas e testes nativos; não alterar Claude/Codex para simular funções ausentes.
- Adapter extension conserva contexto, auth, lifecycle e requests; sem SDK funcional, P2 segue bloqueado explicitamente.

**Arquivos:** `electron/main/services/conversation/thread-runtime.ts`, `electron/main/services/conversation/adapters/ (novo)`, `shared/types/thread.ts`, `tests/thread-adapter-conformance.test.ts (novo)`.

**Verificação:** `node scripts/test-electron.mjs tests/thread-adapter-conformance.test.ts`.

### 34 — Executar conformance, falhas e regressões integradas

**Onda:** W7 · **Tipo:** test · **Esforço:** high · **Depende de:** 10, 12, 16, 17, 19, 20, 21, 22, 26, 27, 28, 29, 30, 31 · **Estado:** planejado.

Habilitar suite por provider/plataforma/config; testar protocolo real sem inferência, corrupção/crash/restart, request pendente, account expiry/quota, saída atrasada, queue desconhecida, migração, lifecycleMCP e isolamento de worktree. Preservar todo Code/UI/settings/voz e bundle budgets.

**Aceite:**

- Todos os cenários obrigatórios de ACCEPTANCE passam com evidência e sem credenciais em logs.
- Mocks cobrem determinismo; smokes nativos separados não são contados como tarefa real concluída.

**Arquivos:** `tests/thread-adapter-conformance.test.ts (novo)`, `tests/integration/thread-manager.test.ts`, `tests/integration/thread-history.test.ts`, `tests/thread-mcp-native.test.ts`, `e2e/thread-view.spec.ts`, `scripts/verify-bundle-budgets.mjs`.

**Verificação:** `npm run typecheck; npm run lint; npm run test:electron; npm run build; npx playwright test e2e/thread-view.spec.ts`.

### 35 — Comparar CLI e Thread com tarefas reais equivalentes

**Onda:** W7 · **Tipo:** verify · **Esforço:** high · **Depende de:** 34 · **Estado:** planejado.

Executar protocolos de ACCEPTANCE em checkouts temporários equivalentes, mesmos provider/version/model/effort/auth/instruções/policies e fixtures. CLI lado nativo com operador e checkpoints reproduzíveis; Thread UI lado real. Contabilizar sucesso por cenário, erros, mudanças/artefatos, interrupção/retomada e latência; não automatizar TUI como runtime do produto.

**Aceite:**

- Cada cenário crítico passa nos dois modos; divergência funcional vira issue bloqueante, não média escondida.
- Ao menos3 repetições por tarefa/provider; falha ambiental é registrada separadamente; evidência valida estado do repo e native session, não só frase do agente.

**Arquivos:** `docs/plans/thread-cli-parity/ACCEPTANCE.md`, `tests/integration/thread-parity-pilots.test.ts (novo)`, `docs/plans/thread-cli-parity/EVIDENCE.md (novo durante execução)`.

**Verificação:** Evidência por provider, versão, plataforma e autenticação; um mock não certifica execução nativa.

### 36 — Certificar escopo, publicar documentação e fechar lacunas

**Onda:** W7 · **Tipo:** document · **Esforço:** medium · **Depende de:** 35 · **Estado:** planejado.

Gerar relatório por capacidade/provider/versão/plataforma/auth. P1 exige packs obrigatórios zero lacunas; P2 só encerra após33+conformance+pilotos de cada provider declarado. Atualizar planos antigos com links e status corretos, sem marcar ondas visuais completas por inferência.

**Aceite:**

- Release candidate apresenta matriz/evidências/known limitations e todos os gates; itens experimental/blocked não recebem selo completo.
- Instruções de migração/recovery/configuração e rollback de schema/code consistentes; sem commit/release automático apenas por gerar este plano.

**Arquivos:** `docs/plans/thread-cli-parity/EVIDENCE.md (novo durante execução)`, `docs/plans/thread-workbench/PLAN.md`, `docs/plans/thread-professional/PLAN.md`, `docs/thread-view.md`.

**Verificação:** Evidência por provider, versão, plataforma e autenticação; um mock não certifica execução nativa.

Para certificação P2, passos34–36 possuem dependência condicional adicional de33 e exigem conformance/pilotos de cada provider extra; P1 pode ser certificado antes, com escopo declarado.

## 7. Riscos e tratamento

| Risco | Mitigação |
|---|---|
|Mudança de schema/SDK ou API experimental|Baseline versionado, capability probes sem inferência, packs por versão e conformance; atualizar adaptador ou manter bloqueio explícito.|
|API ausente para recurso funcional do CLI|Criar investigação e contribuição/extensão específica; não usar TUI oculto nem excluir item obrigatório para declarar paridade.|
|Janela paginada salva como histórico completo|Writes append/update por ID/seq, epochs e replace explícito; teste que páginas não carregadas nunca desaparecem.|
|Envio com ACK perdido repetido após restart|IDs e reconciliação nativa; onde não houver idempotência, marcar resultado desconhecido e exigir recuperação explícita antes de reenviar.|
|Pergunta expirada ou aprovação aplicada a outra sessão|Native request/turn/geração e registry; validação main, resolução nativa observada e nenhuma replay automática.|
|Permissões/rede/hooks divergem entre Code e Thread|Perfil efetivo e managed constraints por provider, policy snapshot por execução e pilotos approve/deny fora do mock.|
|Ferramenta MCP mutante contorna filtro do bridge|Autenticação/escopo/policy e aprovações no servidor main; allowlist é só superfície adicional, não fronteira única.|
|Anexos/base64 excedem framing/backpressure|Blob store/IDs e MIME/limites negociados; ajustar framing por classe de payload sem remover limite global arbitrariamente.|
|Diff de dirty anterior/concorrente é atribuído ao agente|Baselines e artefatos separados; autoria indeterminada e conflitos bloqueiam Undo, sem reset/clean.|
|Refatorações afetam Code ou bundle|Compartilhar serviços com owner/contexto explícito; imports dinâmicos, gates existentes, testes Code e comparação de screenshots.|

## 8. Verificação e recuperação

Em cada passo: testes comportamentais do fluxo alterado, contrato e isolamento; typecheck/lint direcionados. Ao concluir onda: Electron E2E e smokes nativos da capacidade. Depois de regressão passar, não repetir suites sem nova mudança/falha. Execução de pilotos de inferência só durante implementação, em checkouts temporários, com conta/modo selecionados; este planejamento não consome inferência, não altera login nem publica nada.

Gate final: typecheck, lint, test:electron completo, build/budgets e E2E. Comandos de steps.json que possuem múltiplos checks são uma lista de verificação; executar cada comando separado. Usar scripts/test-electron.mjs para SQLite/Electron ABI; não reconstruir módulos nativos para outro ABI apenas para contornar teste.

Migrações aditivas/transacionais usam o próximo número livre; backup/restore de fixture e reentrada são testados. Não apagar a migração054 ou snapshots antigos. Feature gates por capability mantêm leitura legado; rollback de aplicação não tenta apagar dados novos. Operação cujo resultado externo ficou desconhecido é reconciliada/mostrada, sem auto-replay de writes. Shutdown cancela registry e drena SQLite com prazo, revoga execução MCP e preserva IDs de resume.

Budgets observados no build anterior: main903/904KiB, renderer487/500KiB, preload30/40KiB e CSS412/500KiB. Manter runtime/extensões em chunks lazy; aumentar budget exige evidência/decisão técnica registrada, não ajuste para silenciar gate.

Métricas propostas a validar em hardware de referência W0: com10.000 eventos, entrada p95<=50ms, menu p95<=100ms e página quente de100 eventos p95<=200ms; timeline deve montar quantidade limitada de nós. Startup/probe/RPC têm limites próprios por capacidade, sem bloquear digitação nem disparar processo por tecla. Modelos/conta/perfil/versão invalidam single-flight caches. Quota/contexto/custo exibem fonte e instante, sem percentuais inventados.

## 9. Relação com planos existentes

Este plano governa paridade operacional CLI/Thread. Reutiliza pendências A06/manifesto do [plano profissional](../thread-professional/PLAN.md) e R10–R24 aplicáveis do [workbench](../thread-workbench/PLAN.md): histórico, perguntas/fila, anexos, Git/Files/Preview, Undo, extensões e equipes. O workbench mantém recursos adicionais como rotinas recorrentes; esses não são requisito CLI quando não fizerem parte do baseline. Não declarar concluído aqui o que estava somente planejado lá.

Status inicial dos36 passos: planejado. Baseline Codex fornecido é evidência preliminar do passo01; ainda faltam inventário completo de comandos/flags, Claude handshake e qualificações. Código já existente é base preservada, não entrega atribuída a este plano.

## 10. Fontes e armazenamento

- [Codex App Server](https://learn.chatgpt.com/docs/app-server): referência de inputs, requests, filas, sessões e configurações; confrontada com schema local0.154.0.
- [Claude permissões](https://code.claude.com/docs/en/agent-sdk/permissions), [perguntas](https://code.claude.com/docs/en/agent-sdk/user-input) e [streaming input](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode): referência para investigação/runtime local.
- Skill aplicada: create-rich-plan. O comando quadflow não está instalado; o plano enriquecido foi salvo no repositório, sem criação de issues ou publicação em sistema externo.
