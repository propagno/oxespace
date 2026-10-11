# Baseline e prontidão dos provedores

Data: 2026-10-10. Etapa de T01; **V12 ainda não aprovado**. Artefato bruto: [baseline-retrieval-2.1.0.json](baseline-retrieval-2.1.0.json). Corpus versionado: `tests/fixtures/memory-productivity.json`. Runner de medição: `tests/integration/memory-baseline.native.test.ts`.

## Medição executada

ai-memory 2.1.0, Windows x64, Electron 44.6.0/Node 24.21.0. Binário com SHA256 verificado, data-dir descartável, porta loopback dinâmica, embedding e scheduler desativados. Nenhuma inferência, transcrição pessoal, modelo remoto ou alteração de memória em uso. O serviço temporário foi encerrado e seus dados removidos.

12 consultas × 3 repetições; ordem invertida na segunda repetição. O corpus contém 11 casos positivos e um caso de exclusão de outro projeto. As notas são sintéticas e usam vocabulário literal das consultas; esse conjunto é um controle inicial, não uma avaliação abrangente de busca semântica.

| Métrica | Resultado |
|---|---|
| Amostras | 36 |
| Referência relevante no top 5 | 33/33 positivas |
| Exclusão de conteúdo do outro projeto | 3/3 |
| Busca: mediana / p95 | 2,01 / 3,69 ms |
| Composição de contexto: mediana / p95 | 2,19 / 3,42 ms |
| Orçamento de contexto | Até 4.000 caracteres, verificado por amostra |

A composição foi medida após a busca da mesma consulta; efeitos de cache são possíveis. Os tempos não incluem startup, UI, raciocínio do modelo ou latência de rede externa. Não são evidência do overhead p95 de despacho/início de turno especificado na SPEC. Não houve comparação pareada com implementação nova: não calcular percentual de ganho a partir destes resultados.

Para reproduzir em PowerShell, informar caminho absoluto do binário extraído de arquivo oficial verificado e um arquivo de saída novo:

```powershell
$env:OXESPACE_MEMORY_BASELINE_BINARY = 'C:\caminho\ai-memory.exe'
$env:OXESPACE_MEMORY_BASELINE_SHA256 = '2af6a668f1148a9b53c63cb64506d065de0ed89f260aa3700cb524db7e333e4a'
$env:OXESPACE_MEMORY_BASELINE_REPORT = 'C:\caminho\baseline-novo.json'
node scripts/test-electron.mjs tests/integration/memory-baseline.native.test.ts
```

O teste exige 2.1.0, valida o digest, recusa saída já existente e grava apenas IDs de cenários, contagens e tempos. Sem as variáveis, é opt-in e pode ser ignorado na suíte geral; **skip nunca conta como medição**.

## Provedores locais

| Provedor Windows | Verificação real | Limitação |
|---|---|---|
| Codex CLI 0.155.1 | `codex login status`: autenticado via ChatGPT; handshake App Server e consulta autenticada de uso aprovados | Não houve inferência nem retomada ponta a ponta de memória |
| Claude Code 2.1.292 | Autenticado; controles nativos e retomada com inferência pelo adaptador de produção aprovados | Apenas Windows/Thread; não certifica captura ai-memory nem UI |

Após o usuário conectar o Claude, `claude auth status` confirmou login. A suíte completa `OXESPACE_THREAD_SMOKE=1 node scripts/test-electron.mjs tests/conversation-process-smoke.test.ts` passou: **7/7**, sem skips, 37,37 s. Inclui catálogos, configuração, estado de conta, handshake e controles persistentes; esses sete testes não fazem inferência.

Teste adicional opt-in: `OXESPACE_CLAUDE_SESSION_SMOKE=1 node scripts/test-electron.mjs tests/integration/claude-session.native.test.ts`: **1/1 aprovado**, 11,62 s. Dois turnos reais pelo `ClaudeConversationAdapter` e `AgentProcessTransport`: primeiro registra um marcador aleatório; o adaptador é descartado e o subprocesso fechado; outro adaptador usa `--resume` com o ID nativo e recupera o marcador sem recebê-lo no segundo prompt. Modelo padrão da instalação, acesso read-only, hooks e MCP externos desativados pelo adaptador. Cada turno tem limite de 60 s, sem retries. `npm run typecheck`, lint do novo teste e `git diff --check` também passaram.

O diretório de trabalho temporário foi removido. A transcrição sintética permanece no armazenamento nativo do Claude para comprovar a retomada; não se remove nem copia histórico pessoal. Nenhuma configuração de conta foi alterada e nenhum token foi registrado. A matriz Code/Thread × provedor × SO permanece parcial: esta execução não mede ai-memory, interface, cancelamento, filhos ou continuidade Code → Thread. Não reutilizar credenciais Windows em contêiner Linux.

## Rubrica para a medição de produtividade completa

Os IDs abaixo correspondem aos 12 cenários da VALIDATION. Os dados de recuperação B01–B12 são apenas insumos; não simulam os comportamentos de UI/ciclo de vida descritos nesta tabela.

| Cenário | Primeira ação correta observável | Pergunta redundante / erro | Evidência necessária |
|---|---|---|---|
| 1 — Reabrir Thread | Executar a verificação de expiração de cursor indicada na sessão anterior | Pedir novamente qual parte da paginação falta | Sessão encerrada, nova abertura, timestamps e decisão |
| 2 — Nova Thread | Selecionar a oferta de retry de fatura e preservar a chave | Pedir o resumo já presente na oferta | ID oferecido/aceito e ação subsequente |
| 3 — Code → Thread | Continuar o teste SameSite a partir da decisão HttpOnly | Reiniciar decisão de autenticação sem motivo | IDs nativos distintos e fonte recuperada |
| 4 — Outro worktree | Recuperar a mesma decisão do repositório, no checkout correto | Tratar worktree como projeto sem memória | Identidade canônica e cwd de execução |
| 5 — Decisão anterior | Manter evento/recibo na mesma transação | Pedir política de atomicidade já registrada | Fonte citada e alteração/verificação adequada |
| 6 — Decisão corrigida | Usar limite atual de 64 MiB | Aplicar proposta anterior de 128 MiB | Duas versões reais e ligação de substituição |
| 7 — Diagnóstico anterior | Verificar cwd do subprocesso | Repetir investigação já documentada sem nova evidência | Fonte de diagnóstico e comando escolhido |
| 8 — Projeto distinto | Não utilizar canário de outro projeto | Citar fonte do projeto estrangeiro | Escopo dos resultados e resposta |
| 9 — Memória offline | Continuar tarefa pelo composer sem espera de memória | Bloquear turno ou pedir permissões para falha de memória | Latência do turno e estado do transporte |
| 10 — Duas ofertas | Aceitar exatamente a oferta escolhida | Consumir a outra oferta ou ambas | IDs e estados antes/depois |
| 11 — Reinício com fila | Recuperar pendências sem trocar IDs | Perder ou duplicar evento | Estado durável antes/depois do crash |
| 12 — Background | Continuar solicitação original | Tratar notificação como novo pedido | Eventos classificados e ação subsequente |

Registrar três pares por cenário com modelo/configuração iguais, ordem alternada e corpus idêntico. Início do cronômetro: usuário abre a retomada com oferta disponível; término: primeira ação verificada correta. Separar latência de recuperação, geração e tempo humano. Julgamento humano deve informar fonte esperada, perguntas redundantes e falhas, inclusive resultados inconclusivos.

Permanecem pendentes: primeira ação correta, redução de repetição, benchmark pareado, matriz completa de sessões autenticadas, falhas de outbox ainda não implementada e piloto. Não elevar confiança ou concluir T01 com base exclusivamente em consultas sintéticas fáceis.
