# Validações — produtividade e memória

Status: ondas 1 e 2 concluídas; implementação da onda 3 entregue, com gate V07 pendente. [Evidências e limites da onda 3](../../validation/ai-memory-productivity/wave-3.md). Onda 2: [evidências e limites](../../validation/ai-memory-productivity/wave-2.md). Gate e limitações em [wave-1](../../validation/ai-memory-productivity/wave-1.md). Contratos Windows/Linux e testes direcionados registrados em [compatibilidade](../../validation/ai-memory-productivity/compatibility.md); medição inicial de recuperação e prontidão dos provedores em [baseline](../../validation/ai-memory-productivity/baseline.md). Base e metas: [SPEC](SPEC.md). Ordem e arquivos: [PLAN](PLAN.md).

## Matriz rastreável

| ID | Aceites | Camada e cenário | Aprovação / evidência mínima |
|---|---|---|---|
| V01 | A01, A12 | Contrato com binários reais 2.1.0/2.6.2 e servidor conectado com capacidades parciais | Versão/checksum, initialize/tools, API-only, autenticação, batch/handoff suportados; CI falha sem binário; relatório por SO |
| V02 | A01, A08 | Unitário/HTTP controlado: erros JSON-RPC, `isError`, timeout, resposta grande, formato não suportado, cancelamento | Erro tipado sanitizado, recursos encerrados e fallback explícito; nenhuma falha deixa chamada indefinida |
| V03 | A02 | Integração: instalação limpa, upgrade, falha no download/extract/migração/troca, rollback | Snapshot consistente restaurado e hashes de conteúdo esperado; hooks idempotentes; processo conectado permanece intacto |
| V04 | A03, A05 | Integração: ambiente real de Code/Thread, IDs nativos, worktrees, projetos, operadores e filhos | Zero cruzamento de dados; um produtor por sessão; bindings e política verificáveis; segredo-canário ausente de logs |
| V05 | A04, A09 | Outbox: crash antes/depois de commit, disco cheio, quota, eventos grandes, sanitização e quarentena | Pendências recuperáveis; envelope válido; quota inclui arquivos auxiliares; admissão suspensa/lacuna visível sem apagar pendências |
| V06 | A04, A08 | Entrega: ACK parcial, prefixo/índices, 429 com ACK, timeout pós-persistência, replay, colisão, offline | Reenvio só de não confirmados, mesma chave; zero duplicação dentro da janela certificada; resultados não armazenados corretamente classificados |
| V07 | A03, A04, A05 | Provedor real e fixtures: turnos, cancelamento, reconexão, shutdown, pai/filho, finalize e hooks | Não encerrar sessão no fim de turno; não finalizar filho por saída do pai; drenagem ordenada; sem dois produtores; agente segue sem memória |
| V08 | A04, A06, A11 | Busca e escrita: corpus rotulado, fontes, contexto hostil, dados corrigidos, opt-out, exclusão/cache | Top 5 relevante ≥90%; orçamento respeitado; sem mudança de permissões; idempotência por operação e invalidação demonstradas |
| V09 | A03, A07 | Integração/E2E: abrir Thread, listar ofertas, aceitar ID, concorrência e oferta obsoleta | Abrir não consome; ID enviado é o escolhido; conflito explica estado real; servidor antigo não aceita outra oferta por fallback |
| V10 | A06, A07, A08 | Electron/Playwright: UI de retomada/diagnóstico, teclado, zoom 200%, largura 800 px, textos longos, erro/offline | Composer utilizável; ações alcançáveis; estados diferentes para fila/persistência/consolidação; polling limitado e sem sobreposição; prints de estados essenciais |
| V11 | A02, A09 | Disco/manutenção: wiki, Git, DB, spool/cache, symlinks, servidor externo, interrupção | Prévia e backup; limites de propriedade; métricas físicas antes/depois; nenhuma promessa de bytes liberados por compactação lógica |
| V12 | A06, A11 | Benchmark pareado conforme SPEC | ≥25% redução mediana de retomada, ≥30% redução de repetição, dispersão e falhas publicadas; revisão humana de ações corretas |
| V13 | A03, A06, A10 | Perfil: default desligado gerenciado, opt-in/off, origem, revisão, esquecimento e multioperador | Nenhum contexto global sem habilitação prevista; fonte distinta; instrução atual prevalece; alcance global comunicado; exclusão comprovada |
| V14 | A03, A04, A09, A11, A12 | Carga 2 h, piloto 1 dia e pacote instalado Windows/Linux | Quotas respeitadas, sem bloqueios, sem vazamento, overheads dentro das metas, upgrade/rollback e smoke Code/Thread aprovados |

## Ambientes e dados

- Windows nativo e Linux nativo; versões e hardware registrados no relatório. O usuário autorizou posteriormente Docker para a certificação Linux, já executada com recursos limitados.
- Binários fixados com checksum e diretórios temporários separados por teste/versão. Usar repositórios sintéticos, sem copiar a memória pessoal.
- Matriz Code × Thread × Claude × Codex × Windows/Linux. Registrar cada célula como aprovada, falha ou pendente; fixtures não certificam autenticação/interação real.
- Fixtures com worktrees de um projeto, outro projeto, dois operadores, handoffs concorrentes, segredos-canário, textos extensos, notificações de background e correções de decisões.
- O teste de eventos distingue end-of-turn, session-end, session abandonada e child-session. Não sintetizar “sessão encerrada” somente porque o transporte perdeu conexão.

## Comandos existentes e gates novos

Executar apenas após alterações correspondentes. Os comandos abaixo existem no projeto; novos testes e gates ainda precisam ser implementados nas tarefas indicadas.

```powershell
npm run typecheck
npm run lint
npm run test:electron -- tests/unit/memory.test.ts tests/integration/memory-project.test.ts tests/integration/memory-service.test.ts tests/integration/memory-tools.test.ts
npm run test:electron -- tests/integration/ai-memory.native.test.ts tests/integration/memory-runtime.native.test.ts tests/integration/memory-adapters.native.test.ts
npm run build
npm run test:e2e -- e2e/thread-view.spec.ts
```

Para os testes nativos, definir `OXESPACE_AI_MEMORY_TEST_BINARY` com caminho absoluto do binário verificado do ambiente de teste. Hoje sua ausência pode provocar skips: T16 deve acrescentar preflight obrigatório e checagem do resultado para impedir falso verde. Não usar binário de outra plataforma nem concluir que tipos/lint certificam MCP, captura ou migração.

Rodar testes direcionados durante cada tarefa; a suíte completa e gates oficiais do repositório entram na entrega T16. Não reconstruir dependências nativas indiscriminadamente em uma instalação em uso.

## Cenários do benchmark

1. Retomar correção após fechamento da Thread.
2. Retomar em outra Thread do mesmo projeto com oferta selecionada.
3. Continuar tarefa iniciada em Code dentro de Thread.
4. Continuar em outro worktree com identidade compartilhada.
5. Aplicar decisão arquitetural previamente registrada com fonte.
6. Respeitar uma decisão que foi corrigida posteriormente.
7. Recuperar um diagnóstico anterior sem repetir investigação já concluída.
8. Recusar contexto de outro projeto semanticamente parecido.
9. Continuar normalmente durante indisponibilidade de memória.
10. Escolher corretamente entre dois handoffs concorrentes.
11. Recuperar contexto após reinício com eventos ainda na fila.
12. Tratar notificação de background como evento, sem inventar nova solicitação do usuário.

Para cada cenário, definir antes do teste: informação mínima necessária, ação correta, fontes aceitas, eventos esperados, pergunta redundante e condição de término. Medir do mesmo ponto inicial; separar tempo humano, recuperação e geração. Usar 3 pares por cenário como triagem inicial, reportar tamanho da amostra e variabilidade; ampliar amostra se resultados forem inconclusivos. Não afirmar significância estatística com essa amostra pequena.

## Evidências e orçamento

Criar `docs/validation/ai-memory-productivity/` durante a implementação, com relatórios de compatibilidade, migração, benchmark e matriz de certificação. Registro agregado por teste: versão, SO, commit, cenário, duração, contagens, erro sanitizado e resultado. Não gravar conteúdo de memória, tokens ou streams completos.

Limitar evidências locais de cada execução a 20 MiB, com até 6 capturas dos estados principais e saída de teste resumida; artifacts adicionais de CI devem ter retenção curta configurada na tarefa de entrega. Logs operacionais do produto têm quota separada de 10 MiB. Guardar somente evidência necessária à revisão, sem repetição contínua de screenshots ou stdout.

## Critérios de bloqueio e rollout

Bloquear habilitação/release se houver vazamento de escopo, captura dupla, perda silenciosa de pendências, crash/bloqueio do agente, rollback inválido, consumo automático de handoff, binário sem verificação ou célula obrigatória pendente.

Ordem de ativação: fixtures → runtime novo opt-in → captura externa em Thread certificada → continuidade/handoff → piloto → expansão por plataforma/provedor. Perfil entre projetos permanece opt-in e pode ser adiado explicitamente. Não trocar o proprietário de captura no meio de sessão ativa; aplicar no próximo lançamento.

Ao desativar uma flag, preservar pendências e informar seu destino. Se rollback exigir restaurar snapshot, manter os dados posteriores à migração separados para recuperação: não prometer que a versão antiga os lerá. A aprovação deste plano não equivale a executar limpeza destrutiva nem publicar uma versão.

## Sequenciamento de baseline e carga (fechamento da onda 1)

T01 congela corpus e rubrica e mede recuperação 2.1.0. T15 coleta o controle ponta a ponta 2.1.0 e candidato com tarefas equivalentes, mesma configuração, três pares por cenário e ordem alternada; só então calcula os ganhos. Não usar os 36 tempos de HTTP como tempo de retomada ou ação correta. O controle deve usar a revisão base `588d6f4f51ce8ea8936a7c137e025a96f439968a`, runtime 2.1.0 e configurações registradas; qualquer diferença deve ser declarada. Não reutilizar memória ou conversas pessoais.

Carga local a implementar em V14: quatro sessões sintéticas (duas por provedor), duas em primeiro plano e duas em background; duas tarefas de entrega concorrentes no máximo. Emitir um evento de 1 KiB por sessão por segundo durante 2 h, com rajadas de 20 eventos por sessão a cada minuto; desligar a fixture de memória por 60 s a cada 10 min. Medir p95 de despacho e início de turno com relógio monotônico e separar tempo de inferência externa. Contabilizar outbox, WAL/auxiliares e logs em bytes físicos a cada minuto; testar limite de 10.000 eventos e 64 MiB separadamente, inclusive envelopes grandes. A carga é sintética, não implica milhares de chamadas pagas. Validar lifecycle nativo em amostra autenticada separada e piloto humano de um dia. Nenhum resultado de carga foi coletado nesta onda.
