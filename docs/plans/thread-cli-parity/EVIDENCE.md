# Evidência de implementação e paridade Code/Thread

Data: 2026-09-20
Checkout: `de31471`, branch `feat/worktree-wave-0`, com mudanças locais preservadas
Ambiente: Windows 10.0.26200 x64, Node 22.17.1, OXESpace 0.13.0
Runtimes: Codex CLI 0.155.1, Claude Code 2.1.274

## Resultado executivo

O modo Thread executa os fluxos centrais de Claude e Codex pelo transporte headless nativo, dentro da conversa, sem abrir Advanced CLI tools. Modelo/esforço, permissões, requests, fila, anexos, voz, sessão, MCP, comandos integrados, usage e evidência de arquivos possuem implementação e testes. Isso estabelece **paridade operacional ampla para P1**, mas não autoriza declarar paridade total entre todos os recursos de Code e Thread.

Três blocos permanecem fora da certificação total:

1. P3 agora embute Source control, Files/editor, busca, scripts, jobs, Preview e lifecycle visual Codex. Ainda faltam terminal auxiliar dedicado, cancel/retry individual de children Claude/OXE e duas/quatro células simultâneas.
2. Export não possui import offline e rewind não desfaz o disco de forma transacional.
3. P2 não tem adapters qualificados para Copilot, gh-copilot, Antigravity, Cursor, Grok e CLI custom arbitrário. Também faltam os 3 pilotos inferenciais repetidos por cenário/provider previstos no plano.

## Implementação verificada

- Request registry com geração, expiração, resposta única e invalidação em interrupt/exit.
- Codex: App Server, queue/steer, perguntas, permission requests, MCP elicitation, approvals, model/settings, sessions, goal, usage, background processes, MCP OAuth/reload, apps e plugins.
- Claude: processo headless persistente, can-use-tool, perguntas, fila serial, modelos, comandos descobertos e hooks opt-in somente com escrita.
- Compositor: imagens privadas, paste/drop, chips, retry com retenção após falha, limpeza após sucesso/delete e OXEVoice focado.
- Histórico: SQLite por evento/turno/artefato, cursor, janela limitada, prepend com âncora e fixture de 10.020 eventos acima de 2 MiB.
- Recovery de reinício: turnos, tools, diffs, subagentes, requests e approvals voláteis são encerrados de forma determinística. Entradas que estavam em envio viram `unknown`, com explicação e remoção local explícita, sem reenvio automático. A timeline preserva a causa da interrupção e o writer recusa salvar uma projeção paginada como histórico completo.
- Sessões: native ID, resume/link, fork/rename/archive/delete quando suportado e lock contra dois escritores locais.
- MCP OXESpace: owner Thread, root/workspace/generation, allowlist e ferramentas de contexto, memória, scripts, preview, documentação e delegação.
- Transparência: patches Codex com autoria do provider; diff observado Claude marcado como autoria indeterminada; tool failures usam erro/exitCode reais.
- UI: sidebar por projeto/branch, workbench Session changes/Project changes/Source control/Files/Search/Scripts/Background jobs/Preview/Agents/Plan/Activity, Markdown GFM, falhas de auth/quota com reset, controles permanentes e layout Code.
- Subagentes Codex: eventos `collabAgentToolCall` preservam ação, parent/child IDs, estado, modelo, esforço, instrução e resultado; dynamic tools também deixam de ser descartadas. O lifecycle aparece na timeline, painel Agents e export.

## Validação executada

|Validação|Resultado|
|---|---|
|`npm run typecheck`|Passou|
|`npm run lint`|Passou com 32 warnings preexistentes, zero erros|
|Suíte Electron completa|152 arquivos passaram; 953 testes passaram; 23 foram ignorados por gates ambientais; zero falhas|
|Testes direcionados de histórico/recovery/fila/changes/UI|60/60 passaram|
|Probes nativos sem inferência|9/9 passaram: handshake, usage/reset, model/settings, catálogos, auth sanitizada, TUI isolada e MCP allowlist|
|`npm run build` + budgets|Passou; main 904/904 kB, preload 31/40 kB, renderer 490/500 kB, CSS 417/500 kB|
|Playwright `e2e/thread-view.spec.ts`|Passou em 20,0 s; cobre Code↔Thread, 900/1280/1440, comandos, configuração, auth, quota, Markdown, histórico longo, arquivo real, Source control e Agents|
|Consumidores de contratos Thread/IPC|39/39 passaram em preload API, IPC contracts, migrations, command manifest, capability manifest e change rendering|

As capturas produzidas pelo E2E foram inspecionadas: sidebar, timeline, compositor, tabela/code block e cartão de usage respeitam o mesmo conjunto de tokens, bordas, tipografia e densidade do modo Code. A timeline de 19.825 px permaneceu rolável dentro de uma viewport de 600 px, com compositor totalmente visível.

## Critérios A01–A32

|Critérios|Estado|Observação|
|---|---|---|
|A01–A10|Implementados; fixture/nativo conforme aplicável|Baseline 0.155.1, configuração, requests, queue/steer/interrupt e recovery completo de estados voláteis após restart, sem replay incerto.|
|A11–A18|Implementados; fixture/E2E|Anexos, pending requests, comandos integrados, sessão/lock, histórico, limites e voz. O writer ainda processa snapshot completo no main.|
|A19|Parcial|Export rico e inerte existe; import offline/roundtrip ainda não.|
|A20|Parcial|Rollback de conversa é distinto e explicado; revert seguro de arquivos ainda não.|
|A21–A23|Implementados; MCP nativo Codex e testes de isolamento/voz|Mutação continua sujeita às autorizações do main/provider.|
|A24|Parcial|Claude hooks e Codex apps/plugins funcionam; edição de hooks Codex e piloto Claude de extensões faltam.|
|A25–A26|Implementados|Usage/status/tool errors e evidência/autoria possuem fonte explícita.|
|A27|Implementado com ressalva|Source control, diff/review, Files/editor, busca, scripts/jobs, Preview, plan e activity integrados. Terminal auxiliar dedicado permanece explícito e separado da conversa.|
|A28|Parcial|Lifecycle Codex e delegação MCP aparecem na timeline/painel/export; cancel/retry individual e lifecycle nativo Claude ainda faltam.|
|A29|Parcial|Sessões isoladas e sidebar existem; múltiplas células visíveis faltam.|
|A30–A31|Implementados em fault fixtures/E2E/build|Inclui auth, quota, malformed stream, shutdown, design system e regressão Code.|
|A32|Pendente|Campanha inferencial real, 3 repetições por cenário/provider, não foi executada automaticamente.|

## Decisão de certificação

- **P1 Claude/Codex:** candidato de paridade operacional, com ressalvas C06/C09/C11/C13–C15. Ainda sem selo total por A19/A20/A24/A27–A29/A32.
- **P2 providers adicionais:** bloqueado por ausência de adapters/protocolos qualificados.
- **P3 ferramentas OXESpace:** ampla com ressalvas; principais painéis Code estão integrados, mas terminal auxiliar, múltiplas células e controles individuais de children ainda não.

Nenhuma lacuna acima é convertida em “não aplicável” para melhorar artificialmente o resultado.

## Disposição da auditoria heurística

O quality controller encontrou um HIGH de consumidores exatos inalterados porque o checkout já contém um conjunto amplo de mudanças locais e contratos compartilhados alcançam muitos consumidores. A compatibilidade foi verificada com typecheck global, os 953 testes Electron executados, o build completo, o E2E Code↔Thread e testes direcionados aos contratos `shared/types/ipc.ts`, `shared/types/thread.ts`, preload, handlers IPC e migrações. Não foi necessário alterar consumidores cujo contrato estrutural continuou compatível. O alerta de blast radius permanece registrado porque o verificador é heurístico e agrega também mudanças locais preexistentes fora deste plano; os critérios fornecidos ao quality controller possuem evidência no diff.
