# Fechamento da onda 1

Data: 2026-10-10. **T01 e T02 concluídas no escopo revisado abaixo; liberado o desenvolvimento de T03/T04.** Runtime gerenciado permanece 2.1.0. Não houve publicação nem migração de memória pessoal.

## Escopo e correção do sequenciamento

T01 entrega contratos certificados, decisão de arquitetura, baseline de recuperação, protocolo de produtividade e reprodução da falha de ambiente. T02 entrega cliente tipado e estados distintos. Os registros anteriores adicionaram ao gate de T01 o benchmark comparativo e a matriz completa de captura. Isso criava dependência de T07–T11 antes de essas tarefas serem implementadas.

O fechamento explicita essa revisão: **a coleta do controle ponta a ponta também foi adiada de T01 para T15**, antes de comparar com o candidato, mantendo 2.1.0 e a revisão base como referência. Não se apresenta o baseline HTTP existente como substituto. V12, V14 e os aceites de produto permanecem pendentes. Este é um ajuste de sequenciamento para executar o plano, não evidência de que as metas foram atingidas.

## Evidências do gate

| Critério da onda | Evidência | Resultado |
|---|---|---|
| Binários fixos e contratos reais em dois sistemas | [Compatibilidade](compatibility.md), [Linux](linux-docker.md); checksums e runner que rejeita skips | Windows e Linux: 12/12 em 2.1.0 e 17/17 em 2.6.2 |
| Capacidades novas e limitações conhecidas | API-only, identidade, política/owner, ACK, replay, leitura incremental, aceitação exata de handoff | Contratos exercitados aprovados; SSE efetivo explicitamente não suportado |
| Relay ou outbox | Decisão documentada em compatibility.md | Outbox própria escolhida; implementação em T05 |
| Baseline recuperável e limitado | [36 amostras brutas](baseline-retrieval-2.1.0.json), [rubrica e limites](baseline.md) | 33/33 positivos top 5, 3/3 negativos isolados; sem alegação de ganho de produtividade |
| Omissão de ambiente reproduzida | `tests/integration/memory-thread-environment.test.ts` | Subprocesso real recebe run ID mas não config path; wrapper retorna vazio |
| Contas e transporte nativo Windows | `tests/conversation-process-smoke.test.ts` | 7/7; sem inferência |
| Continuidade Claude pelo adaptador de produção | `tests/integration/claude-session.native.test.ts` | 1/1; dois turnos reais e retomada em novo processo pelo ID |
| Cliente tipado e integração | Cliente, manager, wrapper, serviço, ferramentas, diagnóstico, transporte e novo probe | 35/35 em duas execuções no fechamento; zero skips |
| Verificação estática do fechamento | `npm run typecheck`, ESLint do novo probe e `git diff --check` | Aprovados |

As 35 verificações foram executadas como 30 testes em seis arquivos e cinco em dois arquivos. A primeira invocação também citou por engano `tests/automation-tools.test.ts`, caminho inexistente; não foi contada como cobertura dessa suíte. A segunda executou o caminho correto `tests/integration/automation-tools.test.ts` junto a `tests/conversation-process-transport.test.ts`, completando a cobertura. A suíte de compatibilidade nativa já certificada não foi repetida: nenhum código dos seus contratos foi alterado nesta etapa. Timeouts transitórios Linux anteriores continuam registrados no relatório Linux.

## Confiança e condições para a onda 2

Avaliação de planejamento **92/100**, acima do limiar 90: completude 24/25, dependências 15/15, risco técnico 18/20, impacto 14/15, validação 14/15, lacunas externas 7/10. A melhora sobre 84 decorre de binários/contratos executados nos dois sistemas, decisão de outbox, baseline bruto e reprodução real do transporte. A pontuação é julgamento técnico documentado, não medição estatística de confiabilidade. Não elimina riscos de migração ou captura.

- T03: testar migração/rollback e interrupções em fixtures antes de ativar atualização gerenciada; nunca reabrir banco migrado com binário antigo.
- T04/T07: corrigir propagação somente junto à definição do produtor. O teste de caracterização do defeito atual deve ser substituído pelo contrato de binding desejado quando essa implementação estiver pronta.
- T15: controle ponta a ponta e benchmark pareado, metas de 25%/30%, carga de 2 h e piloto de um dia. Protocolo de carga definido na VALIDATION, ainda não executado.
- T16: CI hospedada obrigatória, matriz completa Code/Thread × Claude/Codex × Windows/Linux, pacote instalado e release. Login Windows não certifica essas células.

Nenhuma dessas pendências foi marcada como aprovada. H1 está validada apenas para os contratos exercitados; H2 (identidade/ciclo) e H3 (produtividade) continuam pendentes.
