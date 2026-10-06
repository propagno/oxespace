# Diagnóstico compacto de execução

Implementado em 2026-10-06. Código local; requer novo build instalado para registrar incidentes futuros.

## Uso

Settings → Diagnostics → Export report. O arquivo Markdown contém versão/plataforma, estados dos checks e eventos estruturados. Pode ser revisado antes do compartilhamento. O painel também mostra disponibilidade do registro e espaço livre no disco do userData (alerta abaixo de 512 MiB).

## Volume e privacidade

- Registro automático em `<userData>/diagnostics/runtime.{0,1,2}.jsonl`: três arquivos de até 512 KiB, total máximo de 1,5 MiB.
- Expiração de eventos com mais de sete dias, verificada no início, a cada minuto e na exportação. Também expira registros antigos dentro de um arquivo ainda ativo.
- Até 120 combinações distintas de evento/metadados por janela de um minuto. Repetições geram primeiro registro e resumo com contador/último horário; eventos excedentes geram contador de supressão. A estrutura em memória é limitada.
- Gravação imediata dos primeiros eventos; resumos a cada minuto, na exportação e no encerramento normal. Encerramento abrupto pode perder o contador parcial, mas não exige esperar um minuto pelo primeiro registro.
- Sem transcrições, prompts, stdout/stderr, argumentos, variáveis de ambiente, títulos de ferramentas ou conteúdo de arquivos. Identificadores de conversa/turno/tarefa/pane são hashes. Executável é classificado por lista permitida e hash do caminho real; nomes customizados não são gravados literalmente. Instalações Claude em `claude/versions/<versão>` preservam somente a versão numérica.
- Falha de escrita desativa novas gravações nessa execução, sem console, retries ou propagação de erro para o agente. O painel indica indisponibilidade.
- Exportação não inclui o log geral nem detalhes livres de erros de saúde/MCP. Isso evita depender apenas de regex para remover segredos de texto arbitrário.

O electron-log preexistente tem limiar de rotação reduzido para 512 KiB, mantendo seu arquivo anterior conforme a biblioteca, e não duplica mais mensagens no console. Esse log geral é separado do teto de 1,5 MiB do novo registro; caches, banco, Crashpad, históricos nativos e logs do SO não fazem parte desse teto. O limite da biblioteca é verificado antes da próxima escrita, não é teto rígido para uma mensagem individual.

## Eventos disponíveis

- Início/fim do aplicativo com ID de execução e versão.
- Spawn, falha, encerramento e solicitação de parada de processos gerenciados: PID, PID pai no lançamento, identidade do executável, código de saída; duração no transporte stdio.
- Code PTYs, PTYs próprios da Thread, TUI nativa da Thread e transporte stdio de provedores. A conexão principal da Thread inclui correlação de conversa/geração.
- Envio, aceitação, conclusão, interrupção, continuação e desconexão da Thread; transições de ferramentas, subagentes e pedidos humanos. Não registra cada token ou heartbeat.
- Falhas de subprocessos Electron, incluindo GPU, e renderer: tipo, motivo e código de saída.

Um evento `process-stop` registra intenção, não comprova saída. Da mesma forma, conclusão de turno não comprova resultado de subagente: são eventos distintos.

## Limites

Não intercepta processos externos nem reconstrói processos filhos não expostos pelo protocolo do agente. Não atribui uma tarefa arbitrária a um PID sem evidência. Eventos resumidos/suprimidos limitam a completude em grandes rajadas. Não adiciona auto-restart nem encerra sessões com base em silêncio. Não promete conter mensagens nativas Chromium capturadas diretamente por journald/rsyslog: o incidente Linux precisa de validação separada.

## Validação

- Testes de armazenamento: privacidade por schema, 10.000 repetições, limite de eventos distintos, rotação, leitura após reinício, expiração em arquivo ativo e falha de armazenamento.
- Teste do transporte: spawn/saída com PID e código, sem persistir stderr.
- Regressões de DiagnosticsService, ThreadManager e TerminalManager: 85 testes distintos passaram, considerando a execução inicial e a repetição dos dez testes afetados pela correção do fixture de armazenamento.
- Typecheck, lint direcionado, build e limites dos bundles passaram.
- E2E Electron de terminal real, 1.000 notificações GPU simuladas, reinício e exportação passou (5,6 s). Relatório abaixo de 20 KiB; contador de 999 repetições e primeiro registro preservados. Não simula falha real de driver.
