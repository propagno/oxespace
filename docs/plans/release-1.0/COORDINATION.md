---
oxe_doc: plan
status: in_progress
updated: 2026-10-14
owner: coordinator (session revisar-design-modais-controles)
---

# Coordenação da versão 1.0

Objetivo: chegar a **um único commit candidato (RC)** que passe todos os portões abaixo, sem surpresas. Nada é publicado sem ordem explícita do usuário.

## Estado de partida (2026-10-14)
- `feat/redesign-wave-0`: 171 commits à frente do `main`. `feat/oxequery-2`: 245 à frente do `main`; contém `release/0.18.0`.
- O OxeQuery tem 80 commits que o redesign não tem; o redesign tem 6 que o OxeQuery não tem. Merge de teste: **1 conflito**, em `src/App.tsx`.
- `package.json` ainda diz `0.17.0`. Tags existentes: `v0.17.0`, `v0.17.1`. Branches de release: `0.17.1`, `0.17.2`, `0.18.0`.
- A árvore de trabalho é compartilhada entre sessões; há arquivos sem commit de várias frentes, e o build local já quebrou por edição em andamento de outra sessão.

## Estratégia de branches
1. A OxeQuery faz merge de `origin/feat/redesign-wave-0` em `feat/oxequery-2` e resolve `src/App.tsx` (mantém `useContributedCommands`, o registro de comandos e as entradas do OxeQuery).
2. Quando as duas pontas estiverem verdes, cria-se `release/1.0.0` a partir de `feat/oxequery-2`. A partir daí **só entram correções dos portões**.
3. Versão `1.0.0` no `package.json` entra num único commit do coordenador, no RC.

## Portões (todos no mesmo SHA)
| # | Portão | Evidência | Dono |
|---|---|---|---|
| G1 | typecheck, lint e build limpos; vitest unit, integração e arquivos soltos verdes | saída dos comandos no SHA | cada sessão para o seu código; coordenador consolida |
| G2 | E2E completo verde em Windows e Linux em **2 runs seguidos** | ids dos runs do `ci.yml` | coordenador |
| G3 | Pacote empacotado verde em Windows e Linux | run com `packaged_smoke_only=true` | coordenador |
| G4 | Gate de compatibilidade da memória verde (4 células) | job `memory-compatibility` | sessão ai-memory-1-0-readiness |
| G5 | OxeQuery: troca para `src/ui`, auditoria claro/escuro sem falhas de contraste, matriz PG 12-17 e Mongo 5-8 | runs do OxeQuery | sessão oxequery-beekeeper-parity-plan |
| G6 | Regressão visual: baselines por plataforma regenerados e estáveis | `playwright.visual.config.ts` verde 2 vezes | sessão plano-1-0-testes-visuais |
| G7 | Segurança: endurecimento da janela fixado por teste; segredos não armazenados em claro; aprovações | testes de segurança verdes | sessão port-vscode-safe-approval |
| G8 | Migrações: atualização a partir da versão estável anterior ensaiada | teste de upgrade | sessão ai-memory-1-0-readiness |
| G9 | Notas de release, CHANGELOG e documentação coerentes com o que foi entregue; memória marcada como beta opt-in | revisão do coordenador | coordenador |
| G10 | Revisão manual de Code, Thread e OxeQuery em 960×640 com dados reais | capturas e lista de achados | coordenador + dono de cada modo |

## Protocolo (vale para todas as sessões)
1. **Congelamento de recursos.** Novos recursos esperam a 1.0. Só correções que fecham portões.
2. **Commits só com caminhos explícitos.** Nunca `git add -A`, `git add src` ou `git add .`; conferir `git show --stat` depois. Arquivos de outra sessão ficam intocados.
3. **Não deixar a árvore compartilhada quebrada.** Edição que não compila não fica no disco: fazer a mudança, rodar `npm run typecheck` e commitar no mesmo turno. Se precisar de mais tempo, trabalhar num branch separado.
4. **Push.** Cada sessão pode dar push **só do seu próprio branch** (`feat/oxequery-2`). `feat/redesign-wave-0` e `release/1.0.0` são empurrados só pelo coordenador, e só quando o usuário mandar. Nunca force-push.
5. **CI.** Disparar `ci.yml` só com `packaged_smoke_only=true` ou sem entradas. **Nunca** `publish_release=true`, nunca criar tag: isso é do usuário.
6. **Evidência.** Cada portão é marcado como verde apenas com o id do run ou o comando e o SHA.
7. **Flakes.** Falha de E2E sem causa clara: guardar o trace (`e2e-traces-linux`), reexecutar uma vez e registrar aqui. Não "consertar" o teste sem evidência.
8. **Docker** só com autorização explícita do usuário. Testes de banco com `npm run test:electron`.
9. **Comunicação.** Responder ao coordenador no formato "Relatório" abaixo; mudanças que afetem outra sessão são avisadas antes.

## Relatório pedido a cada sessão
```
Sessão:
Eu sou dono de (arquivos/pastas):
Sem commit agora (lista de caminhos, e se compila):
Feito para a 1.0:
Falta para a 1.0 (com o portão G# que fecha):
Riscos/bloqueios:
Vou fazer push/CI? (o quê, quando):
```

## Estado dos portões (2026-10-14, após os relatórios das sessões)
| # | Estado | O que falta |
|---|---|---|
| G1 | parcial | Árvore compartilhada compila (typecheck e build passaram). Falta um run único no SHA do RC. `fs-allowlist` ganhou `rtk-checksum.ts` por pedido do CI; o dono do arquivo deve confirmar |
| G2 | **pendente** | Últimos runs do redesign: 38644678407 verde; 38648100596 falhou por `thread-view` (corrigido em `acd3087`), `oxequery.spec` e `documentation-preview` são intermitentes. Precisa de 2 runs verdes seguidos no SHA do RC |
| G3 | verde parcial | Windows e Linux passaram no run 38644678407 (`cffef65`); refazer no RC |
| G4 | pendente | 4/4 verdes em `dffabe0`; reexecutar no head final |
| G5 | pendente | Merge de `feat/redesign-wave-0` em `feat/oxequery-2` (1 conflito em `src/App.tsx`), troca para `src/ui`, auditoria. Mensagem do coordenador ainda retida na sessão |
| G6 | pendente | Local no Windows: baselines regenerados no SHA do RC e 2 execuções verdes seguidas (42 baselines hoje, validados num build anterior). Linux/CI visual fica pós-1.0 |
| G7 | pendente | Testes de segurança já commitados (`9b3f43a`, `5f39d3e`). O trabalho de aprovação de comandos sai da 1.0 |
| G8 | pendente | Ensaio com banco v0.17.1 e migrações 074–076 do OxeQuery depois do merge; `4e6dd82` (banco alternava 73→57→73) só está no redesign |
| G9 | pendente | Notas de release e CHANGELOG; riscos conhecidos abaixo |
| G10 | pendente | Revisão manual com dados reais e varredura axe (informativa) |

## Decisões
- **Congelamento de recursos.** Saem da 1.0 e vão para `feat/thread-approval-safety` (branch próprio): aprovação de comandos (`shell-parse`, `shell-risk`, regras padrão), painel `/events`, importação de MCP e skills. Motivo: mudam a postura de segurança e o parser nunca rodou no app empacotado.
- **Migrações:** o OxeQuery adiciona 074–076; a próxima livre é **077**. Nenhuma migração nova sem reservar o número com o coordenador.
- **Regressão visual:** gate local no Windows na 1.0; baselines Linux e CI visual ficam pós-1.0.
- **Dependência `@axe-core/playwright`:** só entra com `npm ci`, `security:audit:tools` e `notices:check` verdes; senão fica fora.
- **Build:** mensagens de erro com a palavra `import` entre aspas podem quebrar o shim do `electron-vite`; rodar `npm run build` antes de commitar.

## Riscos conhecidos para as notas de release
- Memória: **beta opt-in**; sem piloto na janela do Electron, benchmark pareado nem carga de 2 h.
- `mcp-sync` grava `env` e `headers` em texto puro no `.mcp.json` de cada projeto.
- Banco: o defeito 73→57→73 afetou as versões 0.15.0 a 0.17.1; corrigido em `4e6dd82`. Decisão do usuário: patch 0.17.2 só com essa correção?
- E2E intermitentes: `documentation-preview` (Linux) e `oxequery.spec` (Windows).

## Registro de decisões e achados
- 2026-10-14: `thread-view.spec` falhava por causa de `role="treeitem"` nos file trees (corrigido em `acd3087`); os valores de `--frame-gap` eram tentativas do `expect.poll`.
- 2026-10-14: `documentation-preview` (Linux) e `oxequery.spec` (Windows) são intermitentes; pacote Windows e Linux passaram no run 38644678407.
