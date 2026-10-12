# Onda 3 — captura externa durável para Thread

Data: 2026-10-10. Implementação local de T05–T07, sem publicação. Os testes usam diretórios e contas sintéticos; nenhuma memória pessoal foi migrada ou examinada.

## Comportamento entregue

- O Code conserva hooks nativos. Uma Thread com hooks nativos habilitados mantém o produtor nativo. Uma Thread sem hooks escolhe o produtor externo somente quando o runtime gerenciado é o binário 2.6.2 e a captura automática do projeto está ativa; caso contrário conserva apenas MCP, sem prometer captura. O subprocesso recebe `AI_MEMORY_CAPTURE_OWNER=oxespace.thread` diretamente do processo principal, não do ambiente herdado.
- O produtor externo usa o ID nativo da sessão, a identidade estável do checkout, marcador explícito e `ai-memory hook --check-capture` antes de gravar. Rejeita perfil de servidor diferente do gerenciado e política negada. Textos são limitados e padrões conhecidos de credenciais são redigidos antes do disco; saídas de ferramentas, anexos e payloads crus do assistente não entram na fila. O trecho final do assistente usa o protocolo versionado e limitado de `stop` do ai-memory 2.6.2. A redação por padrões não substitui revisão de privacidade para dados sensíveis desconhecidos.
- A outbox separada grava um arquivo privado por evento por troca atômica, com chave de ingestão derivada de identidade de evento e persistida. Recupera arquivos após reinício, conserva eventos não confirmados, conta arquivos auxiliares, limita 64 MiB e 10.000 eventos, e move eventos de mais de sete dias ou inválidos para quarentena sem reenvio automático. A contagem de recusas usa dois slots com checksum no arquivo de estado. O painel de memória mostra pendentes, quarentena, recusas e bytes usados ao atualizar.
- O worker envia no máximo dois grupos de sessão em paralelo e 64 itens por lote. Interpreta `accepted_indices` ou prefixo `accepted` inclusive em HTTP 429; reenfileira apenas sem ACK com a mesma chave. Diferencia armazenamento, replay, descarte de política e colisão/inválido; falha permanente com `failed_index` é isolada. Falhas sem progresso usam backoff exponencial limitado. Desabilitar captura pausa pendências; mudança do servidor com pendências é impedida para não redirecioná-las.
- `session-start` usa somente ID nativo; prompt do Codex aguarda `turn-accepted`, e Claude admite ao receber o ID nativo, pois não emite esse ACK. `stop` exige turno concluído. Interrupção, falha e perda de conexão não geram `session-end`. Sessões filhas não são finalizadas com o pai. O orquestrador chama o produtor sem aguardar rede.

## Validação executada

| Área | Evidência | Resultado |
|---|---|---|
| Outbox/entrega | Reinício, ordenação, chaves distintas para conteúdo igual, quota física com arquivo auxiliar, limite de eventos, quarentena, recusas persistentes, ACK não contíguo em 429, timeout, replay, colisão e índice permanente | Testes direcionados aprovados |
| Cliente HTTP | Resposta 429 com ACK preservado | Teste unitário aprovado |
| Serviço/Thread | Captura nativa negada no produtor externo; prompt e excerto redigidos; sessão pai/filho, interrupção, retomada e saída sem `session-end` fabricado; prompt Claude sem `turn-accepted` | Testes de integração aprovados |
| Binário 2.6.2 Windows x64 | Outbox reaberta e replay pela mesma chave; evento `stop` com excerto versionado; contratos nativos | 19/19, zero skips no runner de compatibilidade |
| Thread/Build | Testes de gerente/MCP, typecheck, lint direcionado, build e orçamento de bundle | Aprovados; build antecedeu ajustes finais pequenos na fila, rechecados por typecheck/testes. Uma execução paralela excedeu o timeout de 5 s de um teste de serviço já existente; a suíte isolada passou 9/9 sem alteração de timeout. |

## Limites e gate pendente

O teste com servidor real certifica o contrato de lote e excerto, mas ainda não é um piloto de Thread autenticada dentro do Electron. O teste de pai/filho comprova isolamento e ausência de finalização inventada; a Thread não inventa IDs nativos de subagentes quando o provedor só publica IDs lógicos. Nesses casos não há captura própria do filho externo. A certificação Linux da revisão desta onda e a matriz autenticada Code/Thread × Claude/Codex ficam pendentes. O Docker Desktop permanece desligado nesta rodada porque seu início anterior reativou contêineres k3d pesados; a workflow de compatibilidade está preparada para executar os novos contratos em Linux quando a revisão for enviada.

O gate T07/V07 não deve ser interpretado como certificação de release até esses cenários passarem. O baseline e o piloto de produtividade continuam em T15/T16.

## Continuação — robustez e campanha autenticada

Revisão local adicional em 2026-10-10:

- A ordem da outbox passou a usar sequência persistida de admissão. Empates de milissegundo e recuos do relógio deixam de reordenar eventos após reinício. Arquivos legados conservam a ordenação anterior e precedem novas admissões.
- Falha de gravação/troca atômica contabiliza o arquivo parcial imediatamente como quarentena, mesmo antes de reiniciar. Não remove pendências para admitir novos eventos.
- Backoff agora pertence a cada sessão, inclusive em ACK parcial/429. Progresso em outra sessão não acelera o reenvio da sessão que falhou; seleção justa conserva concorrência máxima de dois lotes. Uma admissão durante a conclusão de uma varredura vazia agenda outra verificação.
- A campanha autenticada nova usa `ThreadManager → MemoryService → hook --check-capture → outbox → /hook/batch`, com os adaptadores e contas reais, em `ELECTRON_RUN_AS_NODE`. Exercita dois turnos na mesma conexão, interrupção, reinício dos serviços e retomada do ID nativo. Consulta também o SQLite sintético em modo somente leitura para conferir quantidade de observações e persistência do excerto do assistente. A criptografia do token sintético é substituída na fixture; não é certificação de `safeStorage` nem da UI do Electron.
- O teste de contrato 2.6.2 passou a habilitar `capture_assistant` e conferir o excerto no banco, além do ACK HTTP.
- A campanha detectou `no active turn to interrupt` no Codex mesmo após confirmação do ID nativo. O cancelamento agora trata somente essa resposta com até cinco tentativas no mesmo turno e espera total de até 1,5 s entre tentativas; término, troca de turno e descarte do adaptador interrompem as tentativas. Outros erros são propagados. Não reenvia o prompt nem sintetiza sucesso de cancelamento.
- CI de compatibilidade e script Linux passaram a incluir regressões de outbox/captura. A configuração de CI foi alterada localmente; não foi executada no GitHub nesta rodada.

Nas primeiras execuções, a fixture sem repositório Git isolado deixou verificações de `git status` penduradas; a fixture passou a executar `git init`. Também houve timeout de sondagem Git sob carga em testes de serviço e uma falha de encerramento do runtime. Erros secundários de limpeza no Windows ocultavam a falha primária da campanha; o harness agora preserva o erro original e registra somente código/caminho da fixture sintética. Esses resultados não foram classificados como testes aprovados.

Comando da campanha (contas locais conectadas e binário 2.6.2 verificado):

```powershell
$env:OXESPACE_NATIVE_PROVIDERS = 'codex,claude'
$env:OXESPACE_AI_MEMORY_V26_TEST_BINARY = Join-Path $env:TEMP 'oxespace-memory-runtime-2.6.2\ai-memory.exe'
node scripts/test-electron.mjs tests/integration/memory-thread.native.test.ts --maxWorkers=1
```

Ainda ficam pendentes o piloto visual autenticado na janela do Electron, a revisão Linux desta onda e a matriz completa Code/Thread × provedor × SO. T07/V07 permanece aberto até essas evidências existirem.
