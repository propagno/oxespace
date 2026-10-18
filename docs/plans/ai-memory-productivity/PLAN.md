---
oxe_doc: plan
status: in_progress
updated: 2026-10-09
inputs:
  - SPEC.md
  - VALIDATION.md
---

# Plano de implementação — produtividade do OXESpace

## Objetivo e modo de execução

Implementar os requisitos da [SPEC](SPEC.md) em seis ondas com gates explícitos. A [matriz de validação](VALIDATION.md) define como demonstrar cada aceite. Plano aprovado pelo usuário; execução iniciada. Evidências e limitações estão no [relatório de compatibilidade](../../validation/ai-memory-productivity/compatibility.md).

Situação: **ondas 1 e 2 concluídas; implementação da onda 3 entregue localmente em 2026-10-10**. T01–T04 concluídas nos escopos e limites registrados em [wave-1.md](../../validation/ai-memory-productivity/wave-1.md) e [wave-2.md](../../validation/ai-memory-productivity/wave-2.md). T05/T06 implementadas e verificadas; T07 tem integração e testes de fixture, mas seu gate de provedor autenticado e Linux ainda está pendente em [wave-3.md](../../validation/ai-memory-productivity/wave-3.md). T08–T16 pendentes. A instalação gerenciada foi fixada em 2.6.2 com migração explícita e rollback; dados pessoais em uso não foram migrados. Em 2026-10-14: T12 (diagnóstico de pipeline) entregue localmente e a campanha autenticada Claude+Codex passou no Windows (ver wave-3.md); o piloto na janela do Electron, o Linux autenticado e T08–T11/T13–T16 seguem pendentes. T08–T11 e T13 (reduzido) entregues em 2026-10-14; faltam T15–T16. Alvo atual: beta opt-in na 1.0 (marco M1 em CLOSEOUT.md). Nenhuma publicação realizada.

Ajuste de sequenciamento no fechamento: o benchmark **comparativo** V12 depende das funcionalidades T08–T11 e permanece em T15; a certificação completa Code/Thread × provedor × SO pertence a T04/T07/T16. Os registros anteriores incorretamente exigiam esses resultados para concluir T01. A onda 1 entrega baseline de recuperação, protocolo de medição e caracterização do ambiente atual. A coleta ponta a ponta do controle 2.1.0 deve ocorrer em T15 antes da comparação, com a mesma configuração do candidato. Não há aprovação de V12/V14 nem redução de metas; esse ajuste muda o gate da onda, não os aceites finais do produto.

Plano independente em `docs/plans`, seguindo a convenção do repositório. A trilha de delegação registrada em `.oxe/STATE.md` permanece ativa e intacta. Aplicados os critérios de tarefas, hipóteses, dependências e confiança da skill `oxe-plan`; usado fallback de leitura direta porque não havia pacote de contexto atualizado para este escopo. Antes de implementar, verificar novamente HEAD, arquivos e alterações concorrentes.

## Decisões propostas

1. Preservar `MemoryManager` e a interface de provider; acrescentar capacidades e resultados tipados. Runtime gerenciado usa versão fixa; conectado tem negociação de capacidades e não sofre migração automática.
2. Certificar captura externa para Threads primeiro. Code permanece com hooks nativos até passar testes de paridade. Selecionar o produtor antes do lançamento: nunca executar simultaneamente captura externa e hooks de captura para a mesma sessão. Não tentar corrigir a variável ausente ativando captura duplicada.
3. Avaliar o companion relay upstream em T01. Preferir reutilizá-lo se empacotamento, limites e contratos forem comprovados; caso contrário implementar outbox OXESpace separada. T05 encapsula a escolha atrás do mesmo contrato e dos mesmos testes.
4. Outbox proposta: concorrência global 2, ordem por sessão, lotes até 64 eventos, backoff exponencial de 1 a 60 segundos com jitter. Chave estável baseada na identidade do evento, persistida com ele; não derivar apenas do conteúdo. Eventos idênticos legítimos precisam permanecer distintos.
5. Sanitizar antes de gravar e transmitir. Ao atingir 64 MiB/10.000 eventos, suspender novas admissões e mostrar lacuna/contagem, sem bloquear o agente. Pendências não são expulsas para abrir espaço. Eventos com mais de 7 dias ficam em quarentena contabilizada na mesma quota até decisão explícita, sem replay automático além da janela certificada.
6. Usar contexto local em cache com orçamento, invalidação e fallback. Nunca aguardar busca remota ilimitada no início do turno. Memória não controla permissões, execução de ferramentas ou jobs.
7. Ofertas de handoff não consumidas automaticamente. Perfil entre projetos inicialmente desligado no runtime gerenciado. Configuração global de servidor conectado exige informar o impacto e não pode ser alterada silenciosamente por um projeto.
8. Inicialmente sem Docker; o usuário posteriormente autorizou Docker para a etapa de certificação Linux, executada com 1 CPU/1 GiB e registrada no relatório. Usar fixtures sintéticas, binários nativos verificados e portas loopback temporárias. Não executar manutenção na memória real do usuário durante desenvolvimento.

## Ondas e gates

| Onda | Tarefas | Entrega | Gate para avançar |
|---|---|---|---|
| 1 | T01–T02 | Contratos, baseline e capacidades | Binário 2.6.2 e limitações comprovados; confiança revista para pelo menos 90/100 |
| 2 | T03–T04 | Runtime atualizável e identidade segura | Migração/rollback em fixtures, isolamento e seleção única de produtor |
| 3 | T05–T07 | Captura durável e ciclo Code/Thread | Falhas injetadas, recuperação e paridade passam |
| 4 | T08–T11 | Contexto, conhecimento e retomada úteis | Relevância, fontes e aceitação exata passam nos fluxos reais |
| 5 | T12–T14 | Diagnóstico, armazenamento e perfil opcional | Falhas visíveis, limites comprovados, opt-in e isolamento passam |
| 6 | T15–T16 | Produtividade e entrega certificadas | Benchmark, piloto, CI e pacote instalado aprovados |

Dependências são requisitos de execução, não uma autorização para implementar tudo de uma vez. T14 pode ser adiada sem impedir a entrega do núcleo; nesse caso R10/A10 permanecem parciais e perfil deve continuar desativado. Não apresentar a ampliação inteira como concluída.

## Tarefas

### T01 — Certificar contratos e coletar baseline
- **Arquivos prováveis:** `tests/integration/ai-memory.native.test.ts`, `tests/integration/memory-runtime.native.test.ts`; novo `docs/validation/ai-memory-productivity/compatibility.md`.
- **Entrada/evidência:** pin 2.1.0 em `memory-runtime.ts`; documentos upstream fixados na SPEC; native tests atuais dependem de variável de ambiente.
- **Depende de:** —
- **Onda:** 1
- **Complexidade:** L
- **Verificar:** V01, V12; verificar checksum/versão, API-only, inicialização MCP, capacidades, política de captura, ACK, IDs e handoff; reproduzir a omissão de ambiente em Thread. Medir baseline de recuperação com 2.1.0 em dados sintéticos e congelar protocolo do benchmark; o controle ponta a ponta e a comparação pareada serão coletados em T15.
- **Implementar:** Criar fixtures de contrato e registrar capacidades realmente presentes em 2.6.2. Escolher relay ou outbox própria com justificativa de tamanho, distribuição, quota e recuperação; registrar limites de plataformas/provedores e revisar a confiança antes da onda 2.
- **Aceite vinculado:** A01, A03, A11, A12
<!-- oxe-task: {"id":"T01","wave":1,"type":"research","files":["tests/integration/ai-memory.native.test.ts"],"done":true,"complexity":"L"} -->

### T02 — Tipar capacidades, estados e erros
- **Arquivos prováveis:** `shared/types/memory.ts`, `electron/main/services/memory/memory-provider.ts`, `ai-memory.client.ts`, `memory-manager.ts` no mesmo diretório.
- **Entrada/evidência:** cliente com timeout e limite de resposta; status atual não comprova persistência.
- **Depende de:** T01
- **Onda:** 1
- **Complexidade:** M
- **Verificar:** V01, V02; simular HTTP 200 com erro JSON-RPC/`isError`, autenticação inválida, timeout, formato inesperado e capacidade ausente.
- **Implementar:** Separar disponibilidade, captura, entrega e consolidação; expor erros sanitizados e estado desconhecido. Propagar cancelamento e deadlines ao transporte e manter compatibilidade com servidores conectados antigos.
- **Aceite vinculado:** A01, A08
<!-- oxe-task: {"id":"T02","wave":1,"type":"feature","files":["shared/types/memory.ts"],"done":true,"complexity":"M"} -->

### T03 — Atualizar runtime com migração e recuperação
- **Arquivos prováveis:** `electron/main/services/memory/memory-runtime.ts`, `agent-memory-adapter.ts`, `src/components/Workspace/WorkspaceMemorySettings.tsx`, `docs/PROJECT_MEMORY.md`.
- **Entrada/evidência:** configuração gerenciada é reescrita no startup; UI contém versão fixa; instalação já verifica assets.
- **Depende de:** T02
- **Onda:** 2
- **Complexidade:** L
- **Verificar:** V03; testar atualização, interrupção em cada fase, restauração e regeneração idempotente de hooks em Windows/Linux.
- **Implementar:** Fixar 2.6.2 após certificação, usar API-only quando disponível e persistir estado da migração. Parar apenas servidor próprio, criar snapshot consistente incluindo dados/configuração e SQLite/WAL, migrar cópia e trocar somente após saúde validada; desligar explicitamente perfil e configurar ofertas sem consumo no runtime dedicado.
- **Aceite vinculado:** A01, A02, A10
<!-- oxe-task: {"id":"T03","wave":2,"type":"feature","files":["electron/main/services/memory/memory-runtime.ts"],"done":true,"complexity":"L"} -->

### T04 — Definir identidade e proprietário de captura
- **Arquivos prováveis:** `electron/main/services/memory/memory.service.ts`, `memory-project.service.ts`, `resources/memory/agent-hook.cjs`, `electron/main/services/conversation/process-transport.ts`, `electron/main/index.ts`.
- **Entrada/evidência:** bindings de execução existentes e diferença entre variáveis propagadas em Code/Thread.
- **Depende de:** T02
- **Onda:** 2
- **Complexidade:** L
- **Verificar:** V04; reproduzir lançamento real, ambiente filtrado, sessão nativa, dois worktrees, dois projetos e filhos. Garantir ausência de caminhos/tokens de outro workspace.
- **Implementar:** Definir binding explícito execução→sessão nativa→escopo→produtor e allowlist mínima por modo. Aplicar capture-owner somente quando o adaptador externo certificado estiver ativo; preservar contexto/MCP sem ativar outro produtor e rejeitar bindings ambíguos.
- **Aceite vinculado:** A03, A05
<!-- oxe-task: {"id":"T04","wave":2,"type":"feature","files":["electron/main/services/conversation/process-transport.ts"],"done":true,"complexity":"L"} -->

### T05 — Persistir eventos admitidos em outbox limitada
- **Arquivos prováveis:** novos módulos de outbox em `electron/main/services/memory/`, `shared/types/memory.ts`, novos testes unitários/integrados de fila.
- **Entrada/evidência:** escolha documentada em T01 e política de captura upstream; filas do provedor e do aplicativo têm proprietários distintos.
- **Depende de:** T03, T04
- **Onda:** 3
- **Complexidade:** L
- **Verificar:** V05; interromper processo após admissão, reabrir fila e verificar ordenação, chaves, sanitização, quota física e arquivos auxiliares.
- **Implementar:** Persistir envelope mínimo sanitizado com identidade, política, tamanho e chave estável antes de transmitir. Aplicar política antes da admissão, limites e quarentena da decisão 5; controles de arquivo seguem usuário local, sem logs de conteúdo ou credenciais.
- **Aceite vinculado:** A03, A04, A09
<!-- oxe-task: {"id":"T05","wave":3,"type":"feature","files":["electron/main/services/memory/"],"done":true,"complexity":"L"} -->

### T06 — Entregar lotes e reconciliar resultados
- **Arquivos prováveis:** `electron/main/services/memory/ai-memory.client.ts`, novos worker e testes de outbox.
- **Entrada/evidência:** `/hook/batch` e resultados por item certificados em T01.
- **Depende de:** T05
- **Onda:** 3
- **Complexidade:** L
- **Verificar:** V06; ACK parcial, 429 com ACK, timeout após commit remoto, falha permanente, colisão e reinício do worker.
- **Implementar:** Aplicar ACKs por índices ou prefixo conforme contrato, inclusive em respostas de erro; reenviar somente itens sem confirmação com a mesma chave. Separar armazenado, replay e descarte por política/erro; manter ordem por sessão, backoff e encerramento limitado sem loops de reenvio acelerado.
- **Aceite vinculado:** A04, A08
<!-- oxe-task: {"id":"T06","wave":3,"type":"feature","files":["electron/main/services/memory/ai-memory.client.ts"],"done":true,"complexity":"L"} -->

### T07 — Integrar eventos de Thread e certificar Code
- **Arquivos prováveis:** `electron/main/services/conversation/thread-orchestrator.ts`, `claude-conversation.ts`, adaptadores Codex correspondentes, `electron/main/services/memory/memory.service.ts`, `resources/memory/agent-hook.cjs`.
- **Entrada/evidência:** eventos estruturados dos provedores, finalização por ID e retenção atual de execução.
- **Depende de:** T06
- **Onda:** 3
- **Complexidade:** L
- **Verificar:** V07; multi-turno, interrupção, crash, reconexão, pai/filho e saída do aplicativo. Provar ausência de dupla persistência com hooks e adaptador.
- **Implementar:** Mapear somente eventos suportados para o ciclo externo, sem aguardar rede no orquestrador. Fechar sessão apenas com evidência explícita, drenar anteriores primeiro e evitar concorrência entre sessão externa e `finalize-session`; manter Code nativo até demonstrar paridade por provedor/plataforma.
- **Aceite vinculado:** A03, A04, A05
<!-- oxe-task: {"id":"T07","wave":3,"type":"feature","files":["electron/main/services/conversation/thread-orchestrator.ts"],"done":false,"complexity":"L"} -->

### T08 — Recuperar contexto relevante com proveniência
- **Arquivos prováveis:** `electron/main/services/memory/ai-memory.provider.ts`, `memory-manager.ts`, `shared/types/memory.ts`, `electron/main/mcp-internal/memory-tool-handlers.ts`.
- **Entrada/evidência:** composição atual limita caracteres, mas reduz metadados e depende de heurística simples.
- **Depende de:** T03, T07
- **Onda:** 4
- **Complexidade:** M
- **Verificar:** V08; corpus rotulado, contexto vazio/obsoleto, opt-out, conteúdo hostil e orçamento. Verificar cursor incremental e reconciliação de exclusões.
- **Implementar:** Preservar fonte/escopo/versão disponíveis e priorizar contexto do projeto com cache limitado. Usar leitura incremental apenas se certificada; reconciliar remoções separadamente e nunca apresentar memória como instrução confiável ou autorização.
- **Aceite vinculado:** A06, A11
<!-- oxe-task: {"id":"T08","wave":4,"type":"feature","files":["electron/main/services/memory/ai-memory.provider.ts"],"done":false,"complexity":"M"} -->

### T09 — Registrar conhecimento útil sem duplicação acidental
- **Arquivos prováveis:** `shared/types/memory.ts`, `electron/main/services/memory/ai-memory.provider.ts`, `electron/main/mcp-internal/memory-tool-handlers.ts`.
- **Entrada/evidência:** `remember` atual cria página UUID em decisions para toda nota.
- **Depende de:** T08
- **Onda:** 4
- **Complexidade:** M
- **Verificar:** V08; decisão corrigida, preferência revogada, mesmo pedido repetido e duas notas legitimamente semelhantes.
- **Implementar:** Acrescentar tipos de nota, fonte e ligação à sessão sem quebrar chamadas existentes. Aplicar idempotência por operação e relação explícita de substituição quando suportada; não fundir decisões automaticamente por similaridade textual.
- **Aceite vinculado:** A04, A06
<!-- oxe-task: {"id":"T09","wave":4,"type":"feature","files":["electron/main/mcp-internal/memory-tool-handlers.ts"],"done":false,"complexity":"M"} -->

### T10 — Oferecer e aceitar handoff por ID exato
- **Arquivos prováveis:** `electron/main/services/memory/memory-provider.ts`, `ai-memory.provider.ts`, `electron/main/mcp-internal/memory-tool-handlers.ts`, `shared/types/memory.ts`.
- **Entrada/evidência:** accept atual não transmite `handoff_id`; upstream oferece modo sem consumo automático.
- **Depende de:** T08
- **Onda:** 4
- **Complexidade:** M
- **Verificar:** V09; múltiplas ofertas, cwd/worktree, oferta consumida por outra janela, reinício e servidor antigo.
- **Implementar:** Expor criação explícita e listagem de ofertas, exigindo ID na aceitação iniciada pela UI. Se servidor não garantir seleção exata, explicar indisponibilidade; não aceitar silenciosamente outra oferta.
- **Aceite vinculado:** A03, A07
<!-- oxe-task: {"id":"T10","wave":4,"type":"feature","files":["electron/main/services/memory/ai-memory.provider.ts"],"done":false,"complexity":"M"} -->

### T11 — Criar experiência de retomada e inspeção
- **Arquivos prováveis:** componentes de Thread em `src/components/`, `src/components/Workspace/WorkspaceMemorySettings.tsx`, contratos IPC de memória, `e2e/thread-view.spec.ts` ou spec dedicada.
- **Entrada/evidência:** APIs e fontes de T08–T10; histórico de problemas com cartões sem ação visível.
- **Depende de:** T09, T10
- **Onda:** 4
- **Complexidade:** M
- **Verificar:** V09, V10; teclado, zoom 200%, janela estreita, loading, vazio, erro, concorrência e texto longo.
- **Implementar:** Mostrar resumo, origem e ação “Retomar” para a oferta selecionada; permitir inspecionar contexto usado e dispensar sugestões. Toda espera deve ter estado compreensível e saída; evitar avisos persistentes sem ação e não bloquear composer por falha de memória.
- **Aceite vinculado:** A06, A07, A08
<!-- oxe-task: {"id":"T11","wave":4,"type":"feature","files":["src/components/Workspace/WorkspaceMemorySettings.tsx"],"done":false,"complexity":"M"} -->

### T12 — Exibir diagnóstico enxuto e exportável
- **Arquivos prováveis:** `electron/main/mcp-internal/automation-tools.ts`, `electron/main/services/memory/memory-manager.ts`, IPC/types e painel de memória.
- **Entrada/evidência:** métricas atuais não observam persistência/consolidação; capacidades novas incluem identidade e jobs de consolidação.
- **Depende de:** T06, T11
- **Onda:** 5
- **Complexidade:** M
- **Verificar:** V10; serviço saudável com fila atrasada, autenticação falha, consolidação pendente/falha/ausente e operação interrompida.
- **Implementar:** Mostrar último evento, pendências, idade, última entrega e consolidação com “desconhecido” quando não observável. Preferir eventos locais; limitar polling a painel visível e no máximo uma chamada a cada 10 segundos, sem sobreposição; exportar diagnóstico sanitizado com IDs correlacionáveis e logs rotativos até 10 MiB.
- **Aceite vinculado:** A08, A09
<!-- oxe-task: {"id":"T12","wave":5,"type":"feature","files":["electron/main/mcp-internal/automation-tools.ts"],"done":false,"complexity":"M"} -->

### T13 — Medir disco e oferecer manutenção segura
- **Arquivos prováveis:** novos serviço/testes de armazenamento em `electron/main/services/memory/`, painel de configurações, `docs/PROJECT_MEMORY.md`.
- **Entrada/evidência:** quota da outbox não limita wiki/Git/SQLite; compactação lógica não garante liberação física.
- **Depende de:** T05, T12
- **Onda:** 5
- **Complexidade:** M
- **Verificar:** V11; acervo sintético crescente, disco quase cheio, arquivos abertos, symlinks e servidor conectado. Medir bytes antes/depois e recuperação de interrupção.
- **Implementar:** Inventariar categorias com varredura limitada/cache e apresentar ações de manutenção com prévia, escopo e backup. Só executar operações suportadas certificadas em T01; nunca apagar pendências ou podar histórico Git automaticamente, nem impor quota a acervo externo como se fosse propriedade do aplicativo.
- **Aceite vinculado:** A02, A09
<!-- oxe-task: {"id":"T13","wave":5,"type":"feature","files":["electron/main/services/memory/"],"done":false,"complexity":"M"} -->

### T14 — Habilitar perfil entre projetos por opção explícita
- **Arquivos prováveis:** `electron/main/services/memory/memory-runtime.ts`, `ai-memory.provider.ts`, `shared/types/memory.ts`, painel e testes de privacidade.
- **Entrada/evidência:** perfil upstream pode estar habilitado por padrão single-user; resultados globais precisam origem distinta.
- **Depende de:** T08, T12
- **Onda:** 5
- **Complexidade:** M
- **Verificar:** V13; opt-in/off, revisão/esquecimento, instrução atual conflitante e dois operadores no servidor de teste.
- **Implementar:** Expor configuração com alcance real do servidor, fontes separadas e revisão do conteúdo reutilizado. Não assumir que rebuild remove informação incorreta; certificar exclusão e nunca alterar configuração compartilhada a partir de toggle local sem suporte explícito.
- **Aceite vinculado:** A06, A10
<!-- oxe-task: {"id":"T14","wave":5,"type":"feature","files":["electron/main/services/memory/ai-memory.provider.ts"],"done":false,"complexity":"M"} -->

### T15 — Demonstrar ganho de produtividade e estabilidade
- **Arquivos prováveis:** novo corpus/harness em `tests/`, `docs/validation/ai-memory-productivity/benchmark.md`, evidências de UI limitadas.
- **Entrada/evidência:** baseline de T01 e metas da SPEC; nenhuma melhoria percentual foi medida ainda.
- **Depende de:** T11, T12, T13, T14
- **Onda:** 6
- **Complexidade:** L
- **Verificar:** V12, V14; executar pares, teste de 2 horas e piloto de 1 dia; comparar percentis e inspecionar falhas e consumo de disco.
- **Implementar:** Automatizar coleta enxuta e aplicar rubrica de relevância/repetição. Publicar valores brutos agregados, ambiente e limitações; corrigir regressões antes de liberar flags e marcar plataformas sem certificação como pendentes.
- **Aceite vinculado:** A03, A04, A09, A11
<!-- oxe-task: {"id":"T15","wave":6,"type":"validation","files":["tests/"],"done":false,"complexity":"L"} -->

### T16 — Certificar pacote e preparar lançamento progressivo
- **Arquivos prováveis:** `.github/workflows/ci.yml`, `package.json`, testes nativos, `docs/PROJECT_MEMORY.md`, notas de release.
- **Entrada/evidência:** testes nativos atuais podem pular sem `OXESPACE_AI_MEMORY_TEST_BINARY`; distribuição Windows/Linux existente.
- **Depende de:** T15
- **Onda:** 6
- **Complexidade:** M
- **Verificar:** V01–V14 conforme matriz; CI obrigatória sem skips nativos, build e instalação limpa/upgrade/rollback nos dois sistemas.
- **Implementar:** Adicionar gate que falha sem binário verificado, registrar matriz por plataforma/provedor e documentar troubleshooting/limites. Preparar beta com flags graduais, critérios de interrupção e rollback; publicar somente no fluxo de release autorizado para essa entrega futura.
- **Aceite vinculado:** A01, A02, A12
<!-- oxe-task: {"id":"T16","wave":6,"type":"delivery","files":[".github/workflows/ci.yml"],"done":false,"complexity":"M"} -->

## Riscos e recuperação

| Risco | Tratamento e condição de parada |
|---|---|
| Migração irreversível de dados | Snapshot consistente antes da troca; nunca abrir banco migrado com binário antigo. Após novas escritas, preservar o diretório novo para recuperação: restaurar snapshot não preserva automaticamente essas escritas |
| Dois produtores ou sessão errada | Binding explícito e feature flag por lançamento; conflito suspende captura com diagnóstico, sem impedir trabalho |
| Fila cheia/offline prolongado | Quota contabiliza WAL/auxiliares; parar admissão, preservar pendências e mostrar lacuna; replays fora da janela certificada exigem reconciliação |
| Política ou segredos na fila | Admissão antes de persistência, sanitização antes de truncamento, fixtures com segredos-canário e zero conteúdo bruto nos logs |
| Diferenças Windows/Linux/Claude/Codex | Certificação por célula; fixtures não substituem smoke real autenticado. Ausência de credencial mantém célula pendente |
| Handoff/perfil globais no servidor | Não simular preferência por projeto; detectar capacidade e apresentar alcance real, sem modificar servidor conectado |
| Contexto errado aumenta custo | Orçamento, proveniência, benchmark e opt-out; rollback da flag de contexto independente da captura |
| Retenção não libera disco | Medir ocupação física separadamente; não chamar compaction de limpeza física sem evidência |

## Hipóteses críticas

<hypothesis id="H1" checkpoint="T01" status="validated">
  <condition>O binário 2.6.2 distribuído oferece os contratos descritos necessários à integração.</condition>
  <validation>V01 em Windows e Linux, incluindo comportamento de erro e capacidades ausentes.</validation>
  <on_failure>Manter versão anterior e reduzir escopo ou corrigir adaptador; bloquear migração.</on_failure>
</hypothesis>
<hypothesis id="H2" checkpoint="T04" status="pending">
  <condition>Eventos de ambos os provedores permitem mapear sessão nativa e encerramento sem inferência ambígua.</condition>
  <validation>V04 e V07 em lançamentos reais e reconexões.</validation>
  <on_failure>Manter hooks nativos na célula afetada, registrar limitação e não habilitar captura externa.</on_failure>
</hypothesis>
<hypothesis id="H3" checkpoint="T15" status="pending">
  <condition>Contexto e handoff reduzem retrabalho sem aumentar latência ou erros.</condition>
  <validation>Benchmark pareado V12 e estabilidade V14.</validation>
  <on_failure>Manter flags experimentais e revisar ranking, orçamento ou UX antes da release.</on_failure>
</hypothesis>

## Avaliação e próximo passo

Confiança revista de **84 para 92/100 para iniciar a onda 2**, avaliação técnica histórica do plano, não probabilidade de sucesso nem certificação de release. Justificativas e riscos residuais em [fechamento da onda 1](../../validation/ai-memory-productivity/wave-1.md). H1 validada nos contratos exercitados em Windows/Linux; H2/H3 permanecem pendentes. T05/T06 e a integração de T07 estão implementadas. Próximo gate: Thread autenticada em Electron, matriz Code/Thread × Claude/Codex e Linux para fechar T07/V07; evidências e limites em [wave-3.md](../../validation/ai-memory-productivity/wave-3.md).

<confidence_vector>
  <dimension name="completude" score="24" weight="25">Requisitos e aceites mapeados; sequência corrigida para não exigir funcionalidades futuras em T01.</dimension>
  <dimension name="dependencias" score="15" weight="15">Outbox própria escolhida e contratos fixados; dependências das seis ondas explícitas.</dimension>
  <dimension name="risco_tecnico" score="18" weight="20">Pontuação histórica da onda 1; contratos de migração concluídos, mas a captura externa ainda requer o gate T07/V07.</dimension>
  <dimension name="impacto_codigo" score="14" weight="15">Omissão de ambiente reproduzida em subprocesso, wrapper corrigido e cliente validado; integração futura permanece isolada.</dimension>
  <dimension name="validacao" score="14" weight="15">Baseline bruto, teste de retomada e protocolo pareado disponíveis; benefício ainda não medido.</dimension>
  <dimension name="lacunas_externas" score="7" weight="10">Binários verificados e contratos Linux/Windows passam; CI hospedada e matriz autenticada completa pendentes em T16.</dimension>
  <global>92</global>
</confidence_vector>

Gates das ondas 1 e 2 aprovados para desenvolvimento da onda 3. Gates de produto permanecem **pendentes**, incluindo migração, matriz completa, metas de produtividade, CI obrigatória e piloto.
