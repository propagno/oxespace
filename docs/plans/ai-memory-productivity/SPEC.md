---
oxe_doc: spec
status: approved
updated: 2026-10-09
---

# Produtividade com memória e continuidade

## Objetivo e referência

Reduzir a repetição de contexto entre Code e Threads, permitir retomadas explícitas e tornar falhas de memória diagnosticáveis sem bloquear o trabalho. Base: OXESpace `0.16.0-beta.8`, commit `588d6f4f51ce8ea8936a7c137e025a96f439968a`; integração gerenciada atualmente fixa ai-memory `2.1.0`. Alvo de avaliação: ai-memory `2.6.2`, sem acompanhar automaticamente `main` ou `latest`.

Este documento especifica trabalho futuro. A leitura de código não certifica comportamento em execução. O planejamento não altera a versão instalada, não publica release e não substitui a trilha ativa em `.oxe/STATE.md`.

## Problemas sustentados pela leitura

- `electron/main/services/memory/memory-runtime.ts` fixa a versão antiga e inicia o serviço com `--enable-web`. O novo modo API precisa ser certificado antes da troca.
- `electron/main/services/conversation/process-transport.ts` permite `OXESPACE_MEMORY_RUN_ID`, mas omite `OXESPACE_MEMORY_RUN`, utilizado por `resources/memory/agent-hook.cjs`. Hipótese: ferramentas de memória podem funcionar enquanto a captura nativa de Thread permanece inativa. Exige reprodução.
- `ai-memory.provider.ts` aceita o próximo handoff elegível sem fornecer um ID escolhido. O usuário precisa poder selecionar a retomada exata.
- O estado disponível em `automation-tools.ts` distingue pouco a persistência e a consolidação: ambas podem aparecer como `not_observable`. “Serviço pronto” não comprova que um evento foi persistido.
- Contexto, sessão e resultado têm tipos reduzidos em `shared/types/memory.ts`; faltam proveniência e estados suficientes para explicar uma retomada.

Não há evidência suficiente para atribuir o incidente anterior de disco cheio ao ai-memory. Também não se presume que atualizar a memória resolva permissões MCP, autenticação dos provedores ou execução de jobs.

## Requisitos e aceites

| Requisito | Resultado esperado | Aceite verificável |
|---|---|---|
| R01 — Compatibilidade | Instalação reproduzível de 2.6.2 e contratos detectados por capacidade | A01: contratos usados passam com binário real e checksum verificado em Windows e Linux; capacidade ausente gera degradação explícita |
| R02 — Atualização reversível | Atualização gerenciada com snapshot consistente e hooks regenerados | A02: restauração de binário, configuração e snapshot validada; serviço conectado nunca é atualizado ou encerrado pelo aplicativo |
| R03 — Identidade e isolamento | Projeto, execução, sessão nativa e produtor corretamente vinculados | A03: worktrees compartilham a identidade prevista; projetos distintos não vazam dados; uma sessão tem um único produtor; bindings sobrevivem a reinício conforme contrato |
| R04 — Captura confiável | Entrega assíncrona durável, sanitizada e limitada | A04: queda, ACK parcial e repetição não duplicam eventos admitidos dentro da janela certificada; overflow é visível; nenhum evento pendente desaparece silenciosamente |
| R05 — Continuidade de ciclo de vida | Code e Thread capturam eventos com semântica correta | A05: fim de turno não encerra sessão; término de pai não encerra filho; sessão encerrada drena eventos anteriores antes do fechamento |
| R06 — Contexto útil | Contexto com fonte, escopo, orçamento e controle do usuário | A06: contexto automático respeita opt-out e limite total inicial de 8.000 caracteres; fonte pode ser inspecionada; entrada de memória nunca concede permissão |
| R07 — Retomada explícita | Oferecer handoffs e aceitar o selecionado | A07: abrir Thread não consome oferta; aceitar transmite o ID exato; duas janelas concorrentes mostram o resultado real sem dupla aceitação |
| R08 — Diagnóstico acionável | Separar captura, fila, persistência e consolidação | A08: UI mostra atraso, pendências, falha e capacidade desconhecida; retomada/cancelamento do trabalho continua disponível durante falha de memória |
| R09 — Armazenamento limitado | Limitar recursos próprios e medir os externos | A09: limites de fila e logs comprovados; relatório discrimina wiki, Git, SQLite, spool e cache; limpeza informa bytes reais recuperados e respeita propriedade dos dados |
| R10 — Perfil entre projetos | Reutilização opcional com isolamento claro | A10: perfil desativado explicitamente no runtime gerenciado inicial; habilitação é informada, mostra origem e oferece revisão/esquecimento; falhas não misturam escopos |
| R11 — Produtividade mensurável | Comparar continuidade com baseline equivalente | A11: benchmark pareado mede tempo de retomada, repetição e relevância; piloto satisfaz metas e não introduz regressões funcionais |
| R12 — Entrega certificada | Gates e evidências reproduzíveis | A12: CI exige binário real, testa Windows/Linux e bloqueia skips indevidos; pacote instalado passa smoke test e rollback antes da publicação |

## Metas propostas, ainda não medidas

Benchmark: 12 cenários fixos, 3 execuções pareadas por cenário, mesmo modelo/configuração, tarefas equivalentes, corpus sintético versionado e ordem alternada. Registrar dispersão e falhas, não apenas média.

- Reduzir em pelo menos 25% a mediana do tempo entre abrir a retomada e a primeira ação correta, comparado ao controle ponta a ponta 2.1.0 coletado em T15, antes da comparação, usando o protocolo e corpus congelados em T01. O baseline de recuperação de T01 é uma métrica separada e não substitui esse controle.
- Reduzir em pelo menos 30% as solicitações de contexto já disponível. Medir por rubrica humana explícita; não confundir texto mais curto com produtividade.
- Recuperar evidência relevante no top 5 em pelo menos 90% dos casos rotulados; zero vazamento entre projetos/operadores nos cenários negativos.
- Sob carga local definida em T01, overhead p95 do despacho de eventos de memória menor que 50 ms e aumento p95 no início de turno menor que 100 ms com serviço indisponível. Captura não aguarda rede no caminho crítico.
- Recursos propostos: fila própria até 64 MiB incluindo arquivos auxiliares, até 10.000 eventos; logs próprios até 10 MiB; verificação em teste de 2 horas e piloto de 1 dia. Não são limites para todo o acervo do ai-memory.

Se uma meta não for atingida, registrar o resultado e ajustar implementação ou aprovar formalmente uma revisão da meta; não reinterpretar o teste como aprovado.

## Escopo e limites

Primeira entrega: runtime local nativo Windows/Linux, Code/Threads existentes, memória por projeto, filas e UI enxutas. Flags independentes para runtime novo, captura externa e retomada explícita permitem piloto progressivo. Perfil entre projetos vem depois da certificação do núcleo.

Fora desta entrega: servidor remoto, WSL misturado com caminhos Windows, sincronização em nuvem, substituição do orquestrador por `ai-memory run`, mudanças de cobrança/modelos. Docker foi posteriormente autorizado pelo usuário para certificação Linux isolada, já executada; isso não amplia o escopo para WSL híbrido ou migração de dados pessoais. Memória é contexto não confiável, subordinado às instruções atuais e às regras do repositório.

## Fontes

Contratos congelados no tag: [release 2.6.2](https://github.com/akitaonrails/ai-memory/releases/tag/v2.6.2), [API programática](https://github.com/akitaonrails/ai-memory/blob/v2.6.2/docs/programmatic-memory.md), [ciclo externo](https://github.com/akitaonrails/ai-memory/blob/v2.6.2/docs/external-lifecycle.md), [handoff](https://github.com/akitaonrails/ai-memory/blob/v2.6.2/docs/design-handoff-offer-not-claim.md), [perfil](https://github.com/akitaonrails/ai-memory/blob/v2.6.2/docs/cross-project-profile.md), [operação](https://github.com/akitaonrails/ai-memory/blob/v2.6.2/docs/lifecycle-ops.md). Recursos descritos em propostas upstream só serão utilizados após confirmação no binário.
