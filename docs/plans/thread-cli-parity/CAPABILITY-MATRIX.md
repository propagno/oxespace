# Matriz de capacidades Code/Thread

Atualizada em 2026-09-20 contra Codex CLI 0.155.1, Claude Code 2.1.274, Windows x64 e autenticação por assinatura. Os estados abaixo descrevem evidência do checkout atual; catálogo ou nome de comando isolado não conta como suporte.

|ID|Capacidade|Codex Thread|Claude Thread|Evidência e limite atual|
|---|---|---|---|---|
|C01|Modelo, esforço, modo e perfil|Implementado; probe nativo|Implementado; probe nativo de catálogo/comando|Seletores permanentes e configuração por fronteira de turno. Perfis API alternativos não foram qualificados.|
|C02|Permissões, rede e approval policy|Implementado; fixture + settings nativo|Implementado; fixture|Read-only/workspace/full, rede e confirmação explícita. Managed requirements avançados continuam governados pelo runtime.|
|C03|Perguntas estruturadas|Implementado; fixture|Implementado; fixture|Formulários, múltipla escolha e texto livre persistem por request/generation. Falta piloto inferencial autenticado repetido.|
|C04|Aprovações, permissions e elicitation|Implementado; fixture|Implementado; fixture|Decisões têm escopo e resolução única. Dynamic host tool não registrado é recusado sem execução.|
|C05|Fila, steering, interrupção e recovery|Implementado; fila/steer nativos|Implementado; fila serial local|Codex usa queue/steer nativos; Claude não anuncia steering e usa fila explícita. Após restart, operações voláteis são encerradas e um envio sem ACK vira `unknown`, nunca replay automático.|
|C06|Histórico longo e paginação|Implementado com ressalva|Implementado com ressalva|10.020 eventos e >2 MiB passam; janela do renderer é limitada e âncora é preservada. O writer recusa projeções paginadas para impedir perda de histórico, mas o main ainda processa snapshots completos, com custo O(n).|
|C07|Imagens e inputs estruturados|Implementado; fixture|Implementado; fixture|Blob privado por Thread, MIME/limites, paste/drop, queue, retry e limpeza após sucesso/delete.|
|C08|Voz no compositor|Implementado|Implementado|OXEVoice escreve somente no draft focado; abort/dismiss não trava a conversa.|
|C09|Comandos e argumentos|Amplo; parcial|Amplo; parcial|Executor único cobre configuração, sessão, uso, MCP, apps/plugins, goal, hooks, ps e skills. Funções sem API integrada aparecem como indisponíveis, sem abrir CLI avançada.|
|C10|Sessão nativa e interoperabilidade CLI|Implementado|Implementado|Native ID, resume/link, recovery e lock de escritor impedem duas execuções locais na mesma sessão.|
|C11|Export, replay e revert|Parcial|Parcial|Export Markdown inclui configuração, mensagens, requests, tools, falhas e evidência redigida. Import offline e revert transacional do disco não existem; rewind informa que não desfaz arquivos.|
|C12|MCP OXESpace|Implementado; probe nativo Codex|Implementado; fixture|Bridge owner Thread, root/contexto, allowlist, leases e operações de memória, scripts, preview, documentação e delegação.|
|C13|MCP externo e OAuth|Implementado/parcial|Parcial|Codex lista, recarrega e inicia OAuth no navegador, registrando conclusão na Thread. Claude usa catálogo/comandos nativos; falta piloto OAuth real.|
|C14|Hooks, policy e instruções|Parcial|Implementado/parcial|Claude permite hooks apenas com escrita e confirmação. Codex inspeciona hooks, mas não edita configuração pela Thread.|
|C15|Apps, plugins e skills|Implementado experimental/parcial|Parcial|Codex lista apps e instala/remove/reconcilia plugins por app-server experimental; skills são inputs nativos. Claude depende dos comandos descobertos.|
|C16|Streaming, tools, progresso e usage|Implementado|Implementado|Deltas coalescidos, exitCode/erro real, planos, usage/reset com fonte e horário. Custos não fornecidos pelo provider não são inventados.|
|C17|Arquivos e autoria|Implementado|Implementado com autoria indeterminada|Codex usa patches nativos. Claude compara working tree antes/depois e marca observação sem atribuir autoria quando não comprovada.|
|C18|Git/diff/plan/activity do workbench|Implementado com ressalva|Implementado com ressalva|Session/Project changes, Source control, Files/editor, busca, scripts, jobs, Preview, Plan e Activity compartilham os serviços do Code e respeitam o root da Thread. O terminal de projeto permanece uma ação explícita fora do fluxo de conversa.|
|C19|Subagentes e delegação|Implementado/parcial|Parcial|Codex preserva `collabAgentToolCall` com IDs/status/modelo/esforço e mostra lifecycle na timeline, painel Agents e export. Delegação MCP também aparece no painel; cancel/retry individual de children e lifecycle nativo Claude ainda não possuem contrato headless comprovado.|
|C20|Múltiplas sessões e navegação|Parcial|Parcial|Várias Threads executam isoladamente, sidebar mostra projeto/branch/status/draft; apenas uma célula de conversa fica visível por vez.|
|C21|Providers adicionais do Code|Bloqueado|Bloqueado|Copilot, gh-copilot, Antigravity, Cursor, Grok e custom não possuem adapter Thread qualificado. Perfis filhos de Claude/Codex podem reutilizar o adapter quando o contrato de perfil for ligado à criação.|

## Resultado de paridade

- **Code ↔ Thread para conversa Claude/Codex (P1): paridade operacional ampla, ainda não certificada como total.** Os fluxos centrais de conversa, configuração, requests, anexos, voz, fila, sessões, MCP e evidência funcionam sem Advanced CLI tools.
- **Ferramentas próprias do aplicativo (P3): paridade ampla com ressalvas.** O workbench cobre os principais painéis do Code; terminal auxiliar, múltiplas células e controles individuais de children continuam fora da certificação.
- **Todos os providers do modo Code (P2): sem paridade.** Não existe protocolo headless comum que permita adaptar CLI custom arbitrário com segurança.

A evidência executada está em [EVIDENCE.md](EVIDENCE.md). Lacunas parciais ou bloqueadas permanecem fora de qualquer selo de paridade total.
