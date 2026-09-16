# Coordenação de agentes entre workspaces

Status: fluxo cross-workspace conectado; validação final em andamento. Não publicado.
Data: 2026-09-15. Base inspecionada: OXESpace 0.12.1.

### Progresso de execução — 2026-09-15

Atualização posterior às fundações abaixo:

- Migração 052: rotas consentidas, chaves idempotentes por painel, recibos, resultados versionados e cursores persistentes.
- MCP conectado a destino explícito, descoberta de destinos autorizados, resultados e confirmação de cursor. DelegationService continua fonte de verdade do lifecycle.
- UI de concessão/revogação por 30 dias, cadastro de repositório local, origem → destino, abertura do destino e adoção explícita de terminal de origem.
- Evidência limitada a oito blobs de texto commitados, 64 KB total, SHA do commit e hash do conteúdo. Sem dirty files nesta versão.
- Cancelamento/retry preservam código e verificam propriedade da execução. Autorização de adoção renova apenas o participante solicitante, não o executor.
- MCP interno deixa de serializar tokens em arquivos de projeto; terminal gerenciado fornece ambiente. Isso não remove segredos já presentes no histórico Git.
- Windows: suíte completa serial passou com 769 testes, zero falhas e 14 ignorados (`coverage/coordination-final.json`). E2E de coordenação e navegação de settings passaram. Teste nativo de argumentos Claude/Codex via PTY passou sem chamadas a modelos. Falhas anteriores sob pressão de recursos não se repetiram na execução integral serial.
- Recuperação em outro painel: adoção explícita preserva a chave idempotente da tarefa no novo painel; rejeita colisão com chave já usada por outra tarefa.
- Após esse ajuste: seis testes de workflow passaram, typecheck e lint focal passaram. Build final passou com os limites de bundle mantidos; IPC de delegação é carregado junto ao serviço por import dinâmico. Permanece aviso CSS preexistente do seletor `btn-open-tools`.
- Linux: preparação da imagem Docker interrompida durante exportação sob pressão de memória; nenhum resultado de validação Linux. Não confundir build Windows, testes simulados ou `--help` nativo com piloto autenticado cross-agent.

### Lacunas explícitas para o fechamento integral do plano

- Cadastro de destino é pela UI confiável, não uma ferramenta MCP de registro com autorização pendente.
- Preflight MCP informativo exposto, sem criar recursos nem reservar capacidade. Recibo persistente de preflight e previsão de capacidade concorrente ainda pendentes; criação/provisionamento mantêm as validações obrigatórias.
- IntegrationService não recebe vínculos de tarefa nesta fatia; grupos existentes não concedem acesso implicitamente.
- Não há snapshots autorizados de dirty files, grants por arquivo individual, export de artefatos/retention ou controle de revisão de resultado pelo cliente.
- Validação Linux e piloto Claude→Codex/Codex→Claude autenticados ainda pendentes. Não marcar as 12 etapas como integralmente concluídas com estas lacunas.

Histórico das primeiras fatias (não representa o estado final):

- Baseline Windows: migrations + delegation, 15 testes passando antes das alterações.
- Primeira fatia implementada: tipos de identidade, migração aditiva 050, backfill de escopos/participantes legados e repositório de leitura/revisão otimista.
- Verificação focal após alterações: 10 testes passando (migrações e persistência), incluindo rollback transacional e preservação de payload/eventos.
- Regressão após alterações: 8 testes de delegação passando; typecheck, ESLint dos arquivos novos e git diff --check passaram. Linux não executado nesta fatia.
- Incremento seguinte: migração 051 persiste grants por participante/ação, com expiração/revogação. CoordinationAuthorization aplica papéis, grants explícitos e vínculo volátil à execução autenticada. Adoção é uma primitiva interna de consentimento confiável, ainda sem endpoint UI/MCP. Usa cwd do ExecutionRegistry, nunca o informado pelo chamador.
- Validação acumulada após esse incremento: 23 testes passando (persistência, autorização, migrações e delegação), typecheck, ESLint focal e diff check. Linux e UI não executados.
- Ainda faltam grants de criação/provisionamento entre projetos, consentimento UI, operações, resultados e subscriptions. Os grants atuais são somente para acesso a tarefas existentes. O MCP e o provisionamento ainda usam o fluxo local existente. Tarefas novas ainda não populam os metadados de coordenação; isso depende da integração com o coordenador.
- Próximo incremento: completar persistência e contratos de autorização antes de conectar destino explícito ao provisionamento. Etapas 1 e 2 permanecem parciais; nenhum suporte cross-workspace ou Linux declarado como entregue.

## Objetivo e cenário de aceite

Uma sessão no projeto A solicita uma análise no projeto B sem o usuário transportar prompts ou relatórios. O OXESpace resolve o destino, verifica autorização, prepara evidências selecionadas, inicia uma sessão independente, persiste o resultado e notifica a origem. Reiniciar a aplicação ou trocar a sessão não perde a tarefa nem permite acesso por terceiros.

Caso de referência: sessão em `sdz-api-main` solicita análise dos workflows de `sdz-claude-config`, fornecendo documentos selecionados do primeiro projeto; o relatório retorna à origem. As fotos analisadas são evidência do fluxo de uso, não logs completos de execução.

## Estado atual verificado

- `shared/types/delegation.ts`: entrada sem destino; tarefa possui apenas um workspace/projeto.
- `electron/main/mcp-internal/delegation-tools.ts`: delegate_task herda a execução solicitante; mensagens não digitam em terminais.
- `electron/main/services/delegation.service.ts`: criação em origin.workspaceId; authorize exige mesmo workspace/projeto e uma das duas execuções. Inbox também depende desses IDs. Restart marca tarefas ativas como interrupted; não relança automaticamente.
- `electron/main/db/migrations/048_delegations.sql`: tarefas/eventos persistidos; unicidade por origin_execution + request_key.
- `electron/main/services/execution-registry.ts`: credenciais por processo, revogadas ao encerrar painel.
- `electron/main/services/integration.service.ts`: grupos, membros, sessões e handoffs multiprojeto existentes; não são autorização de delegação entre projetos.
- `electron/main/services/agent-launch.service.ts`: ponto existente para execução de agentes, a reaproveitar.
- O MCP lista workspaces, mas não oferece cadastro de workspace equivalente ao fluxo necessário.

## Escopo

Incluído: destino local existente ou cadastro autorizado, participantes persistentes, grants entre projetos, tarefa recuperável, pacote de evidências, resultado versionado, notificações e UI integrada. Claude/Codex prioritários; adapters mantêm IDs nativos independentes.

Fora da primeira entrega: clonagem automática, push/merge/release, delegação recursiva, execução remota, unificação de memórias, disparo universal de turnos em CLIs, isolamento de segurança do processo inteiro e consolidação LLM. Uma worktree NÃO é sandbox: restringir ferramentas MCP não restringe todos os comandos de um agente com shell. O modo de análise deve usar capacidades nativas verificadas do adapter; na ausência delas, declarar o limite, sem prometer leitura somente técnica.

## Decisões arquiteturais

1. Projeto possui conhecimento; tarefa possui objetivo, evidências e resultados; worktree possui mudanças; execução possui credenciais temporárias. Não usar o ID nativo da conversa como identidade durável da tarefa.
2. Evoluir DelegationService, mantendo as ferramentas existentes compatíveis. Adicionar camada pequena de coordenação e política, não um segundo scheduler concorrente.
3. Reaproveitar IntegrationService para associação multiprojeto. Participar de um grupo não concede acesso automaticamente; grants separados, explícitos e revogáveis.
4. Persistir origem e destino separadamente. O caller nunca altera sua própria identidade para impersonar o destino. Autorizar cada operação no backend.
5. Identidade de projeto canônica por repositório; caminhos reais validados, incluindo links/junctions, maiúsculas no Windows e worktrees. Nome exibido não é identidade.
6. Tarefa/participante sobrevivem ao processo; novos tokens nunca reutilizam os anteriores. Rebind exige autorização de adoção, não apenas conhecer taskId ou estar no mesmo workspace.
7. Idempotência por solicitação durável autorizada, com hash do payload. Mesmo identificador + mesmo conteúdo retorna a operação; conteúdo diferente retorna conflito. Sobrevive à troca de execução autorizada.
8. Resultados e eventos locais independem de AI Memory/CodeGraph. Memória opcional somente enriquece evidências e registra aprendizados dentro do escopo autorizado.
9. Entrega de evento e início de turno são capacidades distintas. Inbox persistente e notificação UI garantidas; despertar de agente só com adapter validado e consentimento específico.
10. Sem rollback destrutivo: falhas preservam mudanças; cancelamento bloqueia trabalho futuro e encerra apenas execução comprovadamente pertencente à tarefa.

## Modelo e contratos propostos

Nomes abaixo são propostas internas, não APIs disponíveis hoje.

- Task: id, schemaVersion, originProjectId/workspaceId, targetProjectId/workspaceId, objective, acceptance, mode, agentProfileId, lifecycleState, revision, createdAt/updatedAt.
- Participant: taskId, participantId, role (requester/executor/observer), vínculo durável, execução atual opcional, estado da autorização. Capacidade de observar não implica controlar.
- Grant: origem/destino, operações, escopo de arquivos/evidências, expiração/revogação e consentimento de entrega a agente externo. Credenciais não ficam no payload.
- Operation: requestId, payloadHash, etapa, recursos provisionados, tentativas, erro estruturado e recibo. Revisões/locks impedem retries simultâneos duplicados.
- EvidenceManifest: versão, origem, SHA ou snapshot, hashes, trechos/arquivos permitidos, motivo da seleção, tamanho e classificação. Resumos históricos são evidência não confiável, nunca instruções de autoridade.
- Result: versão, resumo, artefatos locais, achados com fontes, testes/limitações, pendências. Notificação referencia resultado persistido; não transporta transcript.
- Subscription: participante autorizado, cursor persistente e confirmação explícita. Leitura não consome eventos; deduplicação permite reentrega segura.

Estado funcional reaproveita preparing/starting/accepted/blocked/review/approved/failed/interrupted/cancelled. Etapas de provisionamento ficam na operação, não multiplicam estados de tarefa. Processo vivo não significa aceite; processo encerrado não significa sucesso.

Superfície MCP proposta: resolver destino, cadastrar repositório local, delegar com destino/modo/evidências, consultar operação, acompanhar tarefa, consultar resultado e solicitar adoção. Preferir extensão compatível de ferramentas existentes. Respostas informam código do impedimento, retryability e próxima ação; nunca expõem tokens ou caminhos de projetos não autorizados.

## Etapas executáveis

Cada etapa inclui teste focal junto da implementação; a etapa 11 executa regressão integrada. Esforço é relativo, não estimativa de prazo.

### 1. Fechar contratos e baseline

- Tipo: research/design. Esforço: médio. Dependências: nenhuma.
- Inspecionar bootstrap/local RPC, WorkspaceService, launch adapters, migrações e UI; registrar contratos de autorização e tabela de transições. Validar capacidades reais dos agentes instalados antes de definir flags de análise ou wake-up.
- Arquivos existentes: `electron/main/mcp-internal/bootstrap.ts`, `local-rpc-server.ts`, `automation-tools.ts`, `electron/main/services/workspace.service.ts`, `agent-launch.service.ts`, `tests/integration/delegation.test.ts`.
- Aceite: baseline de delegação local documentado; contratos sem APIs externas presumidas; mapa de chamadas e permissões aprovado.
- Verificação: manual_review + test; `npm run test:electron -- tests/integration/delegation.test.ts` após confirmar encaminhamento de argumentos do runner.

### 2. Persistência e migração compatível

- Tipo: implement. Esforço: alto. Dependência: 1.
- Expandir tipos de tarefa; persistir participantes, grants, operações, resultados e subscriptions em migração aditiva. Separar subpassos em commits: modelo/migração; repositório/revisões; testes.
- Existentes: `shared/types/delegation.ts`, `electron/main/db/migrations/`, `tests/integration/migrations.test.ts`.
- Novos propostos: `shared/types/coordination.ts`, próxima migração numerada disponível, `electron/main/services/coordination/task-repository.ts`.
- Aceite: dados legados preservados com origem=destino; nenhum grant multiprojeto criado na migração; leitores legados compatíveis durante transição; concorrência protegida por transações/revisões.
- Verificação: test com banco novo e fixture pré-migração, dupla execução da migração conforme runner, rollback transacional em falha e conservação de eventos.

### 3. Política e adoção de participantes

- Tipo: implement. Esforço: alto. Dependências: 1, 2.
- Implementar autorização por ação, destino e participante; revogação verificada também imediatamente antes de provisionar/ler artefatos. Adoção via confirmação UI ou grant explícito anterior, sem autoassociação por workspace.
- Existentes: `electron/main/services/execution-registry.ts`, `delegation.service.ts`.
- Novo: `electron/main/services/coordination/authorization.ts`.
- Aceite: token antigo rejeitado; terceiro projeto e observador sem controle rejeitados; IDs conhecidos não concedem acesso; revogação durante fila impede lançamento. Conteúdo já entregue não pode ser revogado retroativamente, e isso é informado.
- Verificação: test de matriz papel × operação × projeto, troca de execução, revogação e paths com symlink/junction.

### 4. Resolver e cadastrar destino

- Tipo: implement. Esforço: médio. Dependências: 2, 3.
- Resolver workspace por identidade; cadastro autorizado de repositório local sem clone; preflight retorna destino canônico, recursos esperados, capacidades e permissões pendentes. Não revelar catálogo completo sem autorização.
- Existentes: `electron/main/services/workspace.service.ts`, `electron/main/mcp-internal/tool-registry.ts`, `tool-handlers.ts`.
- Novos: `electron/main/services/coordination/workspace-resolver.ts`, `electron/main/mcp-internal/coordination-tools.ts`.
- Aceite: não duplica workspace por aliases; rejeita destino ausente/ambíguo e mudança de identidade entre preflight e execução; destino omitido mantém comportamento local.
- Verificação: test com dois repos e worktrees, espaços/Unicode, paths Windows/Linux e cadastro repetido.

### 5. Provisionar com destino e recuperação

- Tipo: implement. Esforço: alto. Dependências: 2–4.
- Coordenador mantém caller e target distintos; DelegationService provisiona recursos no destino e registra recibos. Reutilizar launcher, locks e limites existentes; adicionar limite global para evitar contornar limite por projeto. Implementar primeiro local compatível, depois cross-project, depois recuperação.
- Existentes: `electron/main/services/delegation.service.ts`, `agent-launch.service.ts`, `electron/main/mcp-internal/delegation-tools.ts`, `electron/main/ipc/delegation.ipc.ts`.
- Novo: `electron/main/services/coordination/coordinator.ts`.
- Aceite: branch/worktree derivam do destino; sessão independente; retry não duplica; conflito de chave/payload explícito; falha preserva código; nenhum relançamento cego no boot. Modos analysis e isolated-change exibem seu nível real de isolamento.
- Verificação: test com falha injetada após cada efeito externo e antes do recibo, duas solicitações concorrentes, cancelamento e restart. Reconciliar por identidade de recurso comprovada, nunca só por nome.

### 6. Evidências e handoff delimitados

- Tipo: implement. Esforço: alto. Dependências: 3–5.
- Gerar manifesto e snapshots locais permitidos, com orçamento de tamanho; ler CodeGraph do checkout correto e memória só com scope autorizado. Projeto A fornece fontes selecionadas, não acesso geral ao repositório. Revisão/redação de dados sensíveis antes de entregar ao destinatário.
- Existentes: `electron/main/services/integration.service.ts`, `electron/main/mcp-internal/memory-tool-handlers.ts`.
- Novo: `electron/main/services/coordination/evidence-bundle.ts`.
- Aceite: referências resolvíveis no destino; SHA/hash identifica versão; dirty files apenas por opt-in; falha de memória não bloqueia; não incluir tokens/transcript inteiro; regras de retenção e acesso por tarefa definidas. Detector de segredos é defesa adicional, não garantia absoluta.
- Verificação: test de traversal, links externos, limite de bytes, fonte alterada durante captura, credenciais fixture e providers indisponíveis.

### 7. Resultado, eventos e acompanhamento durável

- Tipo: implement. Esforço: médio. Dependências: 2, 3, 5, 6.
- Persistir resultado versionado antes de evento; participantes consultam eventos cross-workspace autorizados; salvar cursor e permitir ressincronização por snapshot. Reutilizar handoffs de integração como referências à tarefa, sem duplicar fonte de verdade.
- Existentes: `electron/main/services/delegation.service.ts`, `integration.service.ts`, `electron/main/mcp-internal/delegation-tools.ts`.
- Novo: `electron/main/services/coordination/subscriptions.ts`.
- Aceite: solicitante recebe resultado do outro projeto; replay não perde nem duplica efeitos; revisão concorrente gera conflito; nova sessão adotada retoma cursor; aprovação não faz merge.
- Verificação: test de restart, duas consultas simultâneas, evento repetido, resultado revisado e leitor não autorizado.

### 8. Bootstrap e adapters de agentes

- Tipo: implement. Esforço: médio. Dependências: 5–7.
- Fornecer instruções curtas de capacidades, taskId, consulta de contexto e envio de resultado. Diferenciar observer/UI notification de suporte real a novo turno. Sessões já abertas recebem diagnóstico acionável se não têm credenciais/capacidades; não editar transcript nem injetar teclas em processo ocupado.
- Existentes: `electron/main/services/agent-launch.service.ts`, `electron/main/services/execution-registry.ts`, `electron/main/mcp-internal/bootstrap.ts`.
- Aceite: Claude e Codex iniciam independentemente e retornam resultado; indisponibilidade de adapter vira impedimento claro, sem fallback silencioso para outro agente; recursos opcionais não bloqueiam terminal normal.
- Verificação: test de contrato com adapters fake + smoke nativo autorizado de ambos; APIs/flags externas validadas na versão testada e documentadas.

### 9. UI e consentimentos no padrão atual

- Tipo: implement. Esforço: médio. Dependências: 3, 4, 7, 8.
- Implementar primeiro concessão/revogação de grants; depois visão origem → destino, estado, impedimento, artefatos e ações autorizadas. Integrar SettingsCenter, configurações de delegação e painel de integração existentes; não redesenhar sidebar nem recriar menus removidos.
- Existentes: `src/components/Settings/SettingsCenter.tsx`, `src/components/Workspace/WorkspaceDelegationSettings.tsx`, `src/components/Workspace/WorkspaceIntegrationPanel.tsx`, `src/components/Integration/HandoffInbox.tsx`, `src/store/integration.store.ts`, `shared/types/preload.ts`, `electron/main/ipc/delegation.ipc.ts`.
- Aceite: criar autorização sem CLI; distinguir terminal ativo/tarefa aceita/resultado pronto; abrir destino sem reiniciar sessão; aviso de conclusão persiste além do toast; operar teclado/foco e viewport reduzido; controles por papel.
- Verificação: test + manual_review de screenshots Playwright em 850×650, 1280×720 e 1920×1080, temas existentes e restart.

### 10. Segurança e observabilidade da entrega

- Tipo: implement/test. Esforço: médio. Dependências: 3–9.
- Logs estruturados por taskId/operationId, sem tokens/prompts por padrão; erros distinguem permissão, destino, runtime, agente e memória. Validar que configuração MCP não grave segredos em arquivos versionados; corrigir essa exposição antes de habilitar a nova superfície. Inspecionar implementação atual de sync antes de escolher transporte de credencial.
- Existentes: `electron/main/services/mcp-sync.service.ts`, `electron/main/mcp-internal/local-rpc-server.ts`; novos testes em `tests/integration/`.
- Aceite: nenhum segredo fixture em configuração rastreável/logs; kill switch bloqueia novas operações sem apagar dados; export de diagnóstico redigido; ausência de AI Memory não aparece como falha da tarefa.
- Verificação: test de serialização e busca por segredo fixture, grants revogados, artefatos bloqueados e cancelamento durante provisioning.

### 11. Validação integrada Windows/Linux

- Tipo: test/verify. Esforço: alto. Dependências: 1–10.
- Novos propostos: `tests/integration/coordination.test.ts`, `coordination.authorization.test.ts`, `coordination.recovery.test.ts`, `coordination.evidence.test.ts`, `e2e/cross-workspace-coordination.spec.ts`.
- Regressão: `tests/integration/delegation.test.ts`, `integration.service.test.ts`, `workspace.service.test.ts`, `migrations.test.ts` e E2E de settings/workspaces.
- Verificação: build/typecheck/lint, testes no runner correto para módulos nativos, E2E Electron e matriz Windows/Linux. Comandos de referência existentes: `npm run typecheck`, `npm run lint`, `npm run test:electron`, `npm run build`, `npm run test:e2e`. Confirmar filtros e ABI antes de executar suites; não reconstruir módulos indiscriminadamente durante outros testes.
- Aceite obrigatório: cenário A→B com retorno; B cadastrado durante fluxo; terceiro projeto negado; retry duplicado; restart em cada fronteira; adoção segura; duas tarefas concorrentes; cancelamento preserva alterações; memória offline; caminho com espaços/Unicode; Claude→Codex e Codex→Claude com smoke real, separado dos testes simulados.
- Só declarar suporte de plataforma após execução nela. Falhas/flakes requerem diagnóstico registrado; sucesso de retry isolado não substitui entendimento da causa.

### 12. Documentação e entrega gradual

- Tipo: document/verify. Esforço: baixo. Dependência: 11.
- Documentar permissões, exemplo das evidências, recuperação, limites do modo de análise, privacidade e diferença entre notificação e wake-up. Atualizar este plano com resultados reais.
- Novo proposto: `docs/cross-workspace-coordination.md`; configuração default off para acesso entre projetos, delegação local preservada.
- Aceite: piloto reproduz caso sem copiar prompts/relatórios; critérios rastreados aos testes; migração backup validada; desligar feature mantém tarefas legíveis e terminais funcionais. Downgrade de binário não é rollback seguro de schema: recuperação via backup e procedimento testado.
- Verificação: manual_review + checklist de aceite. Commit/push/release somente mediante solicitação específica; não fazem parte desta aprovação de planejamento.

## Riscos e mitigação

| Risco | Mitigação |
| --- | --- |
| Acesso cruzado excessivo | Grants por operação/fonte/destino; deny by default; backend revalida a cada ação. |
| Agente com shell ignora intenção read-only | Capacidade nativa validada ou limitação explícita; worktree não apresentada como sandbox. |
| Prompt injection em evidências | Conteúdo marcado como dado não confiável; nunca concede permissões nem altera grants. |
| Duplicação após crash entre Git e SQLite | Recibos por etapa, identidade de recursos e reconciliação sem apagar código. |
| Perda de acesso após troca de execução | Participantes persistentes e adoção autorizada, sem reviver tokens. |
| Contexto sensível enviado a nuvem | Escopo de evidência e consentimento de saída; retenção mínima, revisão e redação. |
| Memória automática incompleta | Não depender dela para resultado/handoff; tratar correção de gerações de sessão em trilha separada. |
| Duplicação de Integration/Delegation | Tarefa como fonte de verdade; grupos e handoffs referenciam tarefas. |
| UI promete monitoramento inexistente | Separar notificação persistente, inbox e adapter de despertar. |

## Gate final

Não encerrar como concluído apenas por abrir o terminal B. Conclusão exige que B receba evidências corretas, produza resultado verificável, A o recupere sem transporte manual, a recuperação após restart funcione e um projeto sem autorização permaneça isolado.
