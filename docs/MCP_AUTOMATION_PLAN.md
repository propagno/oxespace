# Plano de evolução da automação MCP

Data: 2026-09-10. Base: v0.10.1 / 61493db.
Estado: proposto; este documento não implementa as ferramentas descritas.
Atualização: primeiro incremento local implementado — capacidades/contexto e
diagnóstico básico observável. Ver MCP_AUTOMATION.md para contratos e limites.
Journal durável, handoff estruturado, coordenação avançada, eventos gerais e
automação de terminais/layout permanecem pendentes.
Escopo: ambiente, recuperação, diagnóstico de memória, handoff, coordenação,
eventos e automação de terminais/layout. Push, PR, merge e release automáticos
por agentes ficam fora desta etapa.

## 1. Situação atual e decisões

- `tool-registry.ts` publica schemas e handlers; há ferramentas de workspace,
  panes, worktrees, scripts, CodeGraph, memória e delegação.
- `ExecutionRegistry` autentica a execução por credencial temporária, workspace
  e pane. Não representa a conversa nativa do agente.
- `DelegationService` já tem chave idempotente por execução, provisioning
  serializado por projeto, limite de quatro tarefas ativas, retry, cancelamento
  que preserva código e interrupção após reinício.
- `delegations` guarda payload JSON; `delegation_events` oferece cursor persistente
  e leitura não consumidora. Eventos de worktree/UI também usam buses em memória.
- Handoff e relatório são predominantemente texto. Aprovação não verifica testes
  nem faz merge. Nova sessão não herda controle da sessão anterior.
- `MemoryService.status()` informa saúde, configuração e sessões observadas.
  O hook nativo processa captura; observar metadados não prova persistência.
- Panes/processos estão no main/SQLite; árvore visual no renderer/localStorage.
  A v0.10.1 corrige resize, preservação e posicionamento associado à origem.

Direção: serviços de aplicação compartilhados por IPC e MCP, com autenticação e
validação no main. Adaptadores preservam os contratos atuais. Implementar por
incrementos; não substituir TerminalManager, o provider de memória nem CodeGraph.

## 2. Contratos transversais

- Novas ferramentas usam execução autenticada e escopo explícito; nunca inferem
  destino pelo workspace ativo na UI. Auditar handlers legados antes de migrá-los,
  documentando diferenças de compatibilidade.
- Separar operação publicada no catálogo de operação atualmente permitida.
  A descoberta não concede permissão: revalidar no momento da execução.
- Respostas versionadas com `schemaVersion`, `requestId`, `status`, `data` ou
  erro `{ code, message, retryable, suggestedAction }`. Preservar `isError` MCP.
- Erros estruturados não expõem tokens, ambiente completo, prompts ou stack traces.
- Políticas por projeto: leitura, criação de recursos, organização visual e controle
  de processos. Reutilizar opt-in de delegação; não transformar esse opt-in em
  autorização genérica para encerrar outras sessões.
- Dados locais. Handoff fornecido a um agente externo mantém o consentimento e
  avisos já existentes. Limites de payload, paginação e deadlines nos contratos.
- Nomes abaixo são propostas, sujeitos à revisão final de schemas na implementação.

## 3. Incrementos de implementação

### A. Ambiente e capacidades — item 1

Ferramentas: `oxespace_capabilities`, `oxespace_execution_context`.

Capacidades: versão dos contratos, ferramentas disponíveis, pré-requisitos,
políticas efetivas, limites, provedores elegíveis e motivo de indisponibilidade.
Derivar o catálogo do registro real; evitar listas duplicadas.

Contexto: projeto, workspace, pane, cwd registrado no lançamento, branch/HEAD
consultados nesse checkout, perfil e papel na delegação. Informar separadamente
cwd de lançamento e cwd corrente desconhecido; não presumir detectar todo `cd`.
Saúde opcional retorna resultado parcial se memória/CodeGraph falharem.

Aceite: mudar o workspace ativo não altera o contexto da chamada; credenciais
revogadas ou estrangeiras são rejeitadas; nenhum segredo aparece no resultado;
indisponibilidade da memória não impede a descoberta.

### B. Operações recuperáveis — item 2

Criar journal local `automation_operations` e `automation_operation_steps` com
operação, ator, escopo, tipo, chave, hash da entrada, tentativa, estado, timestamps,
recursos criados e resultado/erro limitado. Não duplicar o payload privado inteiro.
Adicionar unicidade por escopo/ator/tipo/chave e controle otimista de revisão.

Estados operacionais: queued, running, waiting, succeeded, failed, cancelled,
interrupted. Manter estado da tarefa de trabalho separado do provisioning.

Ferramentas: `oxespace_operation_get`, `oxespace_operation_list`,
`oxespace_operation_retry`, `oxespace_operation_cancel`.
Primeiro integrar a delegação existente; depois criação de terminal/worktree.
Scripts arbitrários não recebem retry automático sem contrato próprio.

Retornar operationId rapidamente. Mesma chave/entrada retorna a operação existente;
mesma chave com conteúdo diferente retorna conflito. Registrar etapas antes e após
efeitos externos. Após crash, verificar Git, pane e processo antes de prosseguir.
Não prometer exactly-once entre SQLite, Git e PTY: estados incertos exigem
reconciliação e podem terminar em intervenção necessária.

Aceite: timeout após criar worktree ou pane não duplica recursos; concorrência entre
retry/cancel é determinística; reinício não relança agentes sem política explícita.

### C. Saúde observável da memória — item 3

Ferramenta: `oxespace_memory_diagnostics`, somente leitura por padrão.
Modelo com origem, timestamp e nível de observabilidade de cada indicador:

1. runtime responde;
2. execução está vinculada;
3. último hook admitido pelo OXESpace;
4. última escrita MCP confirmada pelo provider;
5. última consulta de memória bem-sucedida;
6. spool e consolidação nativos: observados somente se houver contrato validado.

Instrumentar metadados, contadores e erros sanitizados; não guardar prompts ou
saída do terminal para produzir métricas. Histórico limitado e retenção definida.
Health ready nunca deve ser apresentado como captura funcionando.

Antes de acessar spool/consolidação, validar documentação/implementação da versão
instalada do AI Memory. Quando não houver API suportada, retornar unknown ou
not_observable, sem varrer arquivos internos por convenção presumida.
Uma verificação de escrita/leitura será ação explícita, identificada como teste;
documentar retenção se o provider não oferecer remoção suportada.

Aceite: hook recebido sem persistência não gera sucesso de gravação; desligado,
indisponível, atraso e ausência de observabilidade têm respostas distintas.

### D. Handoff estruturado — item 4

Criar contrato versionado e revisões imutáveis vinculadas à tarefa: objetivo,
aceite, decisões/justificativas, tentativas falhas, concluído/pendente, bloqueios,
arquivos, commits e evidências de testes.

Cada evidência informa fonte (agente, memória, Git ou verificação executada),
checkout, data e estado de verificação. Não elevar afirmação do agente a fato.
Ferramentas propostas: `oxespace_handoff_create`, `oxespace_handoff_get`,
`oxespace_handoff_checkpoint`; manter ferramentas de memória existentes separadas.
Revisões novas exigem revisão-base para evitar sobrescrita concorrente.

Renderizar briefing limitado por orçamento e relevância; disponibilizar seções
restantes sob consulta. Aceitar texto legado como seção explicitamente não
estruturada. Reutilizar contexto CodeGraph/memória com falhas independentes.

Aceite: Claude → Codex recupera objetivo, decisões e pendências sem compartilhar
session ID; funciona sem memória; arquivos não commitados são identificados como
não transferidos; revisões concorrentes não perdem conteúdo.

### E. Coordenação de tarefas — item 5

Evoluir DelegationService com prioridade, dependências e bloqueios tipados;
adicionar tabelas de dependências e leases/tentativas quando necessário.
Rejeitar ciclos e relações entre projetos não autorizados.

Dependências desbloqueiam por aprovação ou verificação configurada, não apenas
por saída do processo. Preservar o limite atual de concorrência inicialmente.
Adicionar aviso de sobreposição de arquivos baseado em escopo declarado/Git;
não alegar detectar todos os conflitos semânticos.

Heartbeat distingue processo vivo, agente aceitou e progresso reportado. Ausência
de eventos não prova travamento; marcar situação incerta antes de interromper.
Retomada por nova conversa usa claim explícito autorizado pelo usuário/política,
com revisão e troca de proprietário; jamais reaproveita token antigo.
Ferramentas propostas: task_list, task_get, task_update_dependencies e task_claim,
com prefixo oxespace e controle de papel originador/executor.

Aceite: dependências determinísticas, quatro execuções simultâneas no máximo,
claim concorrente com único vencedor e executor sem poder de assumir tarefas alheias.

### F. Eventos incrementais — item 6

Reutilizar semântica de cursor persistente de delegation_events e criar envelope
uniforme para operação, tarefa e memória. Persistir evento e mudança de estado
na mesma transação quando ambos forem locais; notificar somente após commit.

Ferramenta proposta: `oxespace_events_read`, com after, tipos, limite e espera
opcional limitada pelo menor timeout do bridge/cliente. Resposta inclui nextCursor,
hasMore e cursorExpired. Leitura não consome eventos; filtros respeitam escopo e ator.
Definir retenção e evento de ressincronização para cursores expirados.

Notificações MCP são melhoria opcional por adaptador/cliente. O baseline é consulta
em checkpoints ou espera limitada. Não inserir texto em PTY ocupado nem prometer
que um cliente/modelo ocioso acordará. Heartbeat e espera não geram loops ilimitados.

Aceite: reconexão e eventos duplicados não perdem estado; retenção é explícita;
espera é cancelável; nenhuma informação de outro projeto aparece no stream.

### G. Terminais e automação visual — item 7

Ferramentas propostas: `oxespace_terminal_create`, `oxespace_terminal_status`,
`oxespace_terminal_stop`, `oxespace_layout_get`, `oxespace_layout_apply`.
Reutilizar list_panes e AgentLaunchService, com perfis/executáveis validados.
Criação exige operação idempotente, cwd autorizado e handoff opcional.

Separar criação, execução e apresentação. Controle de processo exige propriedade
ou permissão explícita. Nunca escrever comandos automaticamente em agente ocupado.
Foco/ativação é opcional, desligado por padrão para trabalho paralelo.

Para layout MCP confiável, mover a árvore canônica para serviço no main/SQLite,
mantendo renderer como aplicador da geometria. Migrar localStorage uma vez por
workspace, validar IDs e preservar proporções. Usar revisão esperada para conflito
entre mouse, MCP e outra janela; salvar em frequência limitada durante resize.
Não criar uma segunda árvore independente no MCP.

layout_apply permite mover relativo a pane, right/bottom/auto, equilibrar,
maximizar/restaurar. No modo auto, usar medidas reais reportadas pela UI e mínimos
de legibilidade. Sem renderer disponível, registrar intenção pendente e não afirmar
que o terminal ficou visível. Em áreas pequenas, preferir foco explícito/organização
solicitada a criar subdivisões inutilizáveis.

Aceite: três ou mais panes, resize nos dois eixos, conflito de revisões,
renderer ausente, reinício e migração; layout nunca reinicia PTY nem duplica pane.

## 4. Ordem e dependências

1. Contratos, escopo, erros e testes de compatibilidade.
2. A: capacidades/contexto; C: diagnóstico básico observável.
3. B: journal e recuperação de delegação; F: eventos duráveis e consulta.
4. D: handoff versionado e checkpoints.
5. E: dependências, claims e acompanhamento.
6. G: terminais; migração de layout e automação visual.
7. Revisão integrada UI/UX e validação de release por plataforma.

Testes acompanham cada fase. Primeiro incremento entregável: A + C básico;
não bloquear descoberta esperando todos os recursos de coordenação.

## 5. Arquivos e módulos

Modificar: mcp-internal/tool-registry.ts, tool-handlers.ts, delegation-tools.ts,
memory-tool-handlers.ts, local-rpc-server.ts e bridge conforme transporte necessário;
services/execution-registry.ts, delegation.service.ts, agent-launch.service.ts,
memory/memory.service.ts, memory-manager.ts e workspace.service.ts;
shared/types/delegation.ts, memory.ts, mcp-internal.ts, ipc.ts e workspace.ts;
IPC/preload e registro de migrações no db/index.ts.

Criar, conforme responsabilidade: automation contracts, capability service,
operation service/repository, memory diagnostics, handoff service, event journal
e pane layout service. Schemas/validadores centralizados, sem regras de cliente
Claude/Codex espalhadas pelos serviços.

Novas migrações incrementais com números escolhidos na implementação (não presumir
que 049 continuará livre). Preservar delegations e payloads antigos; importações
de layout só substituem estado canônico inexistente.

UI: reutilizar Workspace settings, Agent delegation, Project memory e menu dos
panes. Progresso, falhas e recuperação em controles existentes; linguagem de
produto, sem mostrar tokens, stack traces ou nomes de tabelas.

## 6. Validação e limites

- Unitários: schemas, autorização, transições, idempotência, revisões, dependências,
  redaction, limites e orçamentos de contexto.
- Integração: SQLite + Git temporário, reinício entre etapas, concorrência,
  credenciais revogadas, isolamento de projeto e retry sem duplicação.
- Provider: usar versão real pinada do AI Memory e contratos validados; separar
  metadados observados de sucesso de persistência/consolidação.
- Electron E2E: UI usa os mesmos serviços que MCP; snapshots, eventos repetidos,
  resize, menus em viewports menores e preservação dos terminais.
- Windows/Linux CI: typecheck, lint, testes, build e testes dos artefatos.
  Smoke com CLI autenticada é verificação separada, sem bypass de permissões.
- Cenário final: origem descobre capacidades → cria tarefa/handoff → acompanha
  operação → destino aceita → reporta evidências → origem consulta eventos;
  reiniciar OXESpace em uma etapa intermediária não perde recursos nem conhecimento.

Riscos principais: compatibilidade de clientes/hooks, corrida entre efeitos externos
e journal, migração de layout, permissões de takeover e observabilidade limitada do
provider. Cada um precisa de cenário negativo antes de habilitar sua automação.
