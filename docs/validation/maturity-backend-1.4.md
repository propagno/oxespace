# Maturidade do backend e da plataforma — OXESpace 1.4

> **Etapa 1 de 2** (Fases 1–2 e scorecard preliminar). A etapa 2 traz a análise módulo a módulo (Fase 3), a análise transversal e os fluxos críticos (Fase 4), o roadmap completo e as notas finais. As notas desta etapa são **preliminares**.

- **SHA avaliado:** `origin/main` `bab99b505c2f0296582aff583571311567771aff` (merge do PR #237).
- **Avaliador:** sessão independente de avaliação de BACKEND/PLATAFORMA, só leitura, num worktree próprio sem `node_modules`. Nada foi compilado, testado nem executado. O que só se prova rodando está marcado **"Não verificável aqui"**.
- **Escopo:** `electron/main`, `electron/preload`, `shared/`, `resources/`, scripts de build e `.github/workflows`. O renderer (`src/`) fica com o avaliador de FRONTEND (sessão `oxespace-c5`). O gateway remoto **não está na main** neste SHA (PRs #180, #204 e #225, todos rascunho). Por isso ele entra só como lacuna.

## 1. Resumo executivo (preliminar)

**Nota geral preliminar: 3,2 / 5 (Definido, com partes já Gerenciadas).**

Forças:
1. **Banco com recuperação séria.** Antes de migrar, o app faz um snapshot com `VACUUM INTO`, confere `integrity_check` e `user_version`, faz `fsync` e só então promove o arquivo. Sem backup, a migração não roda. Um banco mais novo que o app é recusado. A CI ensaia a atualização a partir do banco da versão estável anterior (`db/index.ts:102-132`, `ci.yml:284-291`).
2. **MCP interno com níveis e autoria.** Cada ação tem um nível fixo (read/write/confirm) que o modelo não escolhe. Uma execução autenticada é a autoridade. Quem chama sem execução só lê. A política `tool.use` é verificada no próprio `tools/call`, e a saída é delimitada e marcada como não confiável (`mcp-internal/domain-tool.ts:42-64`, `local-rpc-server.ts:167-172`).
3. **Cadeia de release verificável.** As actions estão fixadas por SHA. A instalação roda `npm ci --ignore-scripts`. Há três auditorias de dependência bloqueantes, SBOM SPDX por plataforma, checksums, atestação de proveniência e verificação do pacote publicado antes de torná-lo público (`ci.yml:206-221`, `462-503`, `717-806`).

Riscos:
1. **BE-M-01 (Alta) → B12.** Cerca de metade dos arquivos de IPC não verifica quem enviou a mensagem, e as páginas do Web Preview rodam com um preload que tem `ipcRenderer`. Um renderer de convidado comprometido alcançaria `terminal:write`, `fs:writeFile` e `mcp:create`.
2. **BE-M-02 (Média).** Nenhum fuse do Electron está configurado: integridade do asar, `OnlyLoadAppFromAsar`, `NODE_OPTIONS` e `--inspect` seguem nos padrões. Somado à falta de assinatura de código (já mapeada), o binário instalado é fácil de reaproveitar.
3. **S3/S4 não aplicados (Já mapeado: B6.1).** Não há sandbox do sistema operacional nem controle de rede para os comandos dos agentes. É o maior risco residual, e o próprio modelo de ameaça já o declara.

## 2. Stack e arquitetura de processos detectadas

| Item | Versão / forma | Evidência |
|---|---|---|
| Electron | `44.9.3` (fixado, devDependency, verificado na janela de suporte pela CI) | `package.json`; `ci.yml:223-227` |
| Node na CI | 22 | `ci.yml:189-190` |
| Build | electron-vite + Vite 6.4, TypeScript 5.7; o main é ESM (`"type": "module"`) | `package.json`, `electron.vite.config.ts` |
| SQLite | `better-sqlite3` ^13 (optionalDependency), WAL, `foreign_keys = ON` | `db/index.ts:61-64` |
| PTY | `node-pty` ^1.1 (optionalDependency); `@xterm/headless` 5.5 para o estado das sessões | `services/terminal.service.ts` |
| Drivers do OxeQuery | `pg`, `pg-cursor`, `mongodb`, `bson` e `ssh2`, empacotados no worker (`oxeBundledDependencies`) | `package.json`; `workers/oxequery-worker.ts` |
| Atualização | `electron-updater` ^6.8, feed do GitHub Releases, canais stable/beta, `allowDowngrade = false` | `updater.ts:144-149`; `electron-builder.yml` |
| Empacotamento | NSIS (Windows x64); AppImage e deb (Linux x64); `asar: true` com nativos desempacotados; sourcemaps do main fora do pacote | `electron-builder.yml` |
| Logs | `electron-log` com `redactSecrets` em cada linha | `services/log-redaction.ts`; `SECURITY_MODEL.md` |

**Processos e como se falam**

```text
Renderer (sandbox, contextIsolation, CSP 'self')
  └─ preload/index.cjs (contextBridge → window.oxeApi) ──IPC invoke/send──► main
Web Preview: <webview> e WebContentsView (partição em memória por dono)
  └─ preload/design-guest.cjs (ipcRenderer.send: só grab/cancel do Design Mode) ──► main
main (Electron, ESM)
  ├─ IPC: 39 arquivos *.ipc.ts, ~340 canais em shared/types
  ├─ services/ (~41,7 mil linhas) + vendor/codegraph (~42,9 mil linhas)
  ├─ worker_threads: oxequery-worker, semantic-worker, native-history-worker
  ├─ PTYs (node-pty), CLIs dos agentes (Claude via binário; Codex via process.execPath + ELECTRON_RUN_AS_NODE)
  └─ servidores locais:
       • MCP interno: HTTP em 127.0.0.1:<porta>, bearer fixo + token por execução (local-rpc-server.ts:275)
       • ganchos dos agentes: HTTP em 127.0.0.1:0, token por execução (agent-hooks/server.ts:75)
       • barramento RPC (F3): pipe nomeado / socket unix, bearer em tempo constante (runtime/rpc/transport.ts)
       • AI Memory (opcional): processo filho em 127.0.0.1 com token (memory/memory-runtime.ts:87-96)
       • túnel SSH do OxeQuery: 127.0.0.1:0 (oxequery/ssh-tunnel.ts:134)
Agent CLI ──stdio──► resources/mcp-bridge/oxespace-mcp.cjs ──HTTP+bearer──► MCP interno
```

**Endurecimento do Electron na janela principal** (`index.ts:749-875`): `contextIsolation`, `sandbox`, `nodeIntegration: false`. O `webviewTag` está ligado e é vigiado por `will-attach-webview`, que fixa o preload, força o sandbox, troca partições que não são da preview e só aceita `http(s)`. O handler de permissões só libera `media` e a área de transferência, e só para o frame principal. `will-navigate` e `will-redirect` mantêm a janela no app. `setWindowOpenHandler` nega e abre fora apenas URLs seguras. O `crashReporter` fica só local (`index.ts:78`). A CSP de produção é injetada no build: `default-src 'self'; connect-src 'self'; frame-src http: https: blob:` (`electron.vite.config.ts:216-232`). A avaliação da CSP fica com o FRONTEND.

**Banco:** 80 arquivos de migration, versão `LATEST_DB_VERSION = 83` (`db/index.ts:15`). Os números 016, 017, 059 e 081 não têm arquivo: 059 é feita em código (`migrateThreadProjects`), e 016/017/081 foram puladas. Há duas variantes da 046 (Windows e POSIX). As migrations não têm volta (só avançam, o que é documentado). Até a 045 elas rodam sem transação explícita, com guardas de autocorreção; da 047 em diante, cada uma roda numa transação.

**CI:** `ci.yml` unifica build e release em matriz Windows/Linux, nesta ordem: auditorias, notices, typecheck, lint (inclui o teto de 1.000 linhas por arquivo), cobertura, build com orçamentos, verificação dos nativos, ensaio de atualização, cobertura do OxeQuery, e2e smoke, porta de desempenho e empacotamento. Testes ao vivo do OxeQuery rodam contra PostgreSQL/MongoDB/SSH/TLS em várias versões (`ci.yml:525-627`). Workflows à parte cobrem axe, regressão e baselines visuais, compatibilidade da memória, contrato dos provedores e Android.

## 3. Scorecard (preliminar)

| Dimensão | Nota | Justificativa | Evidência principal |
|---|---|---|---|
| 1 Arquitetura e fronteiras | 3,5 | As fronteiras estão claras e documentadas (IPC → serviços, `ExecutionHost`, workers para drivers e indexação). O orquestrador de conversas é grande (1.282 linhas). | `docs/ARCHITECTURE.md`; `services/conversation/thread-orchestrator.ts` |
| 2 Contratos e versionamento | 3,5 | IPC tipado (`IPC_CHANNELS`/`OxeApi`) com testes de contrato e de preload; manifesto de cobertura do MCP; `schemaVersion` nas respostas das ferramentas; migrations só avançam. A validação de IPC ainda é escrita à mão (Já mapeado: README 1.4, lacunas). | `tests/integration/ipc-contracts.test.ts`; `shared/mcp-coverage.ts` |
| 3 Segurança e modelo de ameaça | 2,5 | Há muito controle bom (aprovações B10, OxeQuery, política, redação, caminhos canônicos), mas falta checar o remetente em metade do IPC (BE-M-01), não há fuses e não há sandbox do sistema operacional. | `ipc/terminal.ipc.ts:25-34`; `electron-builder.yml` |
| 4 Integridade e ciclo de vida dos dados | 4,0 | Backup verificado antes de migrar, recusa de downgrade, transações desde a 047, ensaio de atualização na CI e retenção de armazenamento. | `db/index.ts:60-132`; `ci.yml:284-291` |
| 5 Resiliência e recuperação | 3,5 | Retentativa limitada ao abrir o banco, política de recarga do renderer, PTYs que sobrevivem ao renderer, diário de incidentes. A limpeza da árvore de processos não é verificável aqui. | `index.ts:881-895`; `utils/process-cleanup.ts` |
| 6 Concorrência e paralelismo | 3,0 | `MAX_LIVE_PTYS = 24` com recuperação de sessões ociosas, fila de entrada por PTY, batching de saída e drivers em worker. Não há teto global de agentes nem de gastos (Já mapeado: ASI08). | `terminal.service.ts:109,671-680` |
| 7 Desempenho e recursos | 3,5 | Orçamentos de bundle e porta de desempenho de UI na CI; a saída de sessões sem view não atravessa o IPC. O main está perto do orçamento (Já mapeado: B8.1). | `scripts/verify-bundle-budgets.mjs`; `ci.yml:330-349` |
| 8 Integração com agentes e MCP | 3,5 | Uma ferramenta por domínio com `action` (lista curta), limites de saída, cerca de conteúdo não confiável e orçamento de custo testado. As ferramentas sob demanda estão em PR (Em PR #182). | `domain-tool.ts:70-107`; `tool-result-bound.ts` |
| 9 Plataformas | 3,5 | Windows e Linux com migration por plataforma, `verify:linux` em Docker, deb com tratamento do `chrome-sandbox` testado na CI. | `db/index.ts:430-439`; `ci.yml:418-441` |
| 10 Observabilidade e diagnóstico | 3,5 | Diário de incidentes, logs redigidos, crashReporter local, tempos de inicialização, sourcemaps privados para simbolizar. Painel e pacote de exportação em PR (Em PR #205). | `services/diagnostics/incident-sink`; `startup-timing.ts` |
| 11 Testes e qualidade | 3,5 | 409 arquivos de teste (14 nativos), 105 specs e2e, testes ao vivo de banco, cobertura com piso no OxeQuery. Faltam testes adversariais da borda de IPC (remetente). | `tests/`; `ci.yml:294-296` |
| 12 Build, empacotamento e cadeia de suprimentos | 3,0 | SBOM, proveniência, actions fixadas por SHA e auditorias. Sem assinatura de código (Já mapeado: Roadmap 2027, SignPath) e sem fuses (BE-M-02). | `ci.yml:462-503,717-724` |
| 13 CI/CD | 4,0 | Pipeline único, release só a partir do commit verificado, tag conferida e payload publicado verificado. | `ci.yml:636-806` |
| 14 Documentação e DX | 3,5 | SECURITY_MODEL, POLICY, PLATFORM_SPEC e o modelo de ameaça com referências testadas. Há imprecisões pontuais (BE-M-07). | `tests/threat-model-refs.test.ts` |

## 4. Inventário de módulos (Fase 2)

Gerado por Glob/Grep no SHA avaliado. As notas por módulo saem na etapa 2. Esta etapa registra a validação na borda e a autorização observadas.

**Legenda das colunas:**
- Validação: **P** = parsers dedicados (`validation.ts`, `ipc-guards.ts`, coerções por domínio); **A** = só `String()`/`typeof` pontual.
- Autorização (remetente): **F** = exige o frame principal da janela do app (`requireAppFrame` ou equivalente local); **—** = não verifica o remetente.

### 4.1 Borda: IPC (`electron/main/ipc`, 39 arquivos)

| Módulo | Tipo | Domínio | Caminho | Validação na borda | Autorização | Testes |
|---|---|---|---|---|---|---|
| thread (62 handlers) | Borda | Conversas | `ipc/thread.ipc.ts` | P | F (`sender()`, l.32) | sim (vários `thread-*.test.ts`) |
| thread-worktree | Borda | Conversas | `ipc/thread-worktree.ipc.ts` | P | F | sim |
| delegation, team | Borda | Coordenação | `ipc/delegation.ipc.ts`, `team.ipc.ts` | P | F | sim |
| oxequery, oxepod, oxepost (`*:call` com lista de ops) | Borda | Dados/HTTP | `ipc/oxequery.ipc.ts`, `oxepod.ipc.ts`, `oxepost.ipc.ts` | P (op-list) | F | sim (contratos de ops) |
| diagnostics, app-info, policy, notifications, voice, semantic, mcp-internal, oxe, agent-state, agentCredits, contextUsage | Borda | Plataforma | `ipc/*.ipc.ts` | P | F | sim |
| **terminal** | Borda | Terminais | `ipc/terminal.ipc.ts` | P (sem teto em `data`) | **—** | sim |
| **file-system** | Borda | Arquivos | `ipc/file-system.ipc.ts` | P + invariante do `FileSystemService` | **—** | sim (`fs-allowlist`, `path-safety`) |
| **mcp** (create/update/start/callTool) | Borda | MCP de terceiros | `ipc/mcp.ipc.ts` | P | **—** | sim |
| **workspace** (21) | Borda | Workspaces | `ipc/workspace.ipc.ts` | P | **—** | sim |
| **github** (43), **git** | Borda | Git/GitHub | `ipc/github.ipc.ts`, `git.ipc.ts` | P | **—** (1 verificação em 43 handlers) | sim |
| task, skill, session, integration, linear, automations, background, agent, agent-hooks, clipboard, search, memory, appearance, copilot, oxe-context | Borda | diversos | `ipc/*.ipc.ts` | P/A | **—** | parcial |
| app update | Borda | Atualização | `updater.ts:244-245` | — (sem entrada) | **—** | sim |

### 4.2 Borda: MCP interno e servidores locais

| Módulo | Tipo | Domínio | Caminho | Validação | Autorização | Testes |
|---|---|---|---|---|---|---|
| Servidor RPC do MCP interno | Borda | MCP | `mcp-internal/local-rpc-server.ts` | corpo ≤ 64 KiB, envelope JSON-RPC, nome de ferramenta | bearer em tempo constante; execução por `x-oxe-execution-token`; política `tool.use` | sim |
| Ferramentas de domínio (~88 nomes `oxespace_*`) | Borda | MCP | `mcp-internal/*-tools.ts`, `domain-tool.ts`, `tool-registry.ts` | `str`/`int`/`bool` com teto, `additionalProperties: false` | nível fixo por ação; sem execução = só leitura | sim (`mcp-coverage`, `tool-catalog`, `tool-result-bound`) |
| Ponte stdio | Borda | MCP | `resources/mcp-bridge/oxespace-mcp.cjs` | — | repassa o bearer do ambiente | parcial |
| Servidor de ganchos | Borda | Agentes | `services/agent-hooks/server.ts` | corpo ≤ 1 MiB | token por execução | sim |
| Barramento RPC (F3) | Borda | Runtime | `runtime/rpc/*` | linha ≤ 1 MiB | bearer em tempo constante, pipe/socket | sim |
| Gateway remoto (celular) | Borda | Mobile | **não está na main** (PRs #180, #204, #225) | — | — | — |

### 4.3 Serviços de domínio (amostra por domínio; lista completa na etapa 2)

| Domínio | Caminho | Tamanho aprox. | Observação |
|---|---|---|---|
| Runtime de conversas (Claude, Codex, orquestrador, histórico, checkpoints) | `services/conversation/**` (67 arquivos) | 9,6 mil linhas | maior domínio; `thread-orchestrator.ts` com 1.282 linhas |
| OxeQuery (gateway do agente, classificadores SQL/Mongo, DDL, túnel SSH, credenciais) | `services/oxequery/**` (37 arquivos) | 6,1 mil linhas | gateway único e classificador fechado em #237 |
| OxePod (containers), OxePost (HTTP) | `services/oxepod/**`, `services/oxepost/**` | — | OxePost é só da pessoa (sem ferramenta MCP neste SHA) |
| Terminais/PTY | `terminal.service.ts`, `pty-*.ts` | 1,1 mil linhas | dono do ciclo de vida do PTY |
| Aprovações e ações do agente | `services/agent-actions/**`, `shared/approval-rules.ts` | — | implementação B10 em PR (Em PR #238) |
| Política | `services/policy/**`, `shared/policy.ts`, `net-policy.ts`, `env-scrub.ts` | — | `net:` lido mas não aplicado (Já mapeado: POLICY, S4) |
| Memória, semântica, CodeGraph | `services/memory/**`, `semantic*.ts`, `vendor/codegraph` | — | worker para indexação |
| Diagnóstico | `services/diagnostics/**`, `runtime-diagnostics.ts` | — | painel em PR (Em PR #205) |

### 4.4 Infraestrutura e contratos compartilhados

| Módulo | Tipo | Caminho |
|---|---|---|
| Banco e migrations | Infraestrutura | `db/index.ts`, `db/migrations/*.sql` (80 arquivos) |
| Workers | Infraestrutura | `workers/oxequery-worker.ts`, `semantic-worker.ts`, `native-history-worker.ts` |
| Limpeza de processos | Infraestrutura | `utils/process-cleanup.ts`, `utils/safe-join.ts` |
| Atualizador | Infraestrutura | `updater.ts` |
| Contrato IPC | Contrato | `shared/types/ipc.ts` (807 linhas), `electron/preload/api.ts` |
| Mensagens C3 | Contrato | `shared/messages.ts`, `shared/locales/*/main.json` |
| Protocolo remoto C5 | Contrato | `shared/remote/**` (só tipos e testes de contrato neste SHA) |
| Aprovações B10 | Contrato | `shared/types/approvals.ts`, `shared/approval-rules.ts` |

## 5. Achados (até aqui)

| ID | Severidade | Dimensão | Módulo(s) | Problema | Evidência | Impacto | Recomendação | Esforço | Já mapeado/Em PR |
|---|---|---|---|---|---|---|---|---|---|
| BE-M-01 | **Alta** | 3 Segurança | `ipc/terminal`, `file-system`, `mcp`, `workspace`, `github`, `git` e outros ~14 | Cerca de 20 dos 39 arquivos de IPC registram handlers sem verificar o remetente nem o frame, e não existe guarda global. Os convidados do Web Preview (`<webview>` e `WebContentsView`) carregam um preload que importa `ipcRenderer`. | `ipc/terminal.ipc.ts:25-34`, `ipc/file-system.ipc.ts:23-33`, `ipc/mcp.ipc.ts:38-101`; `index.ts:782-800`; `services/browser-preview.service.ts:118`; `preload/design-guest.ts:1,172`. Não há `web-contents-created` nem filtro de remetente em `electron/main`. O `PLATFORM_SPEC.md:121` registra que só Thread/Team/Delegation verificam. | Um renderer de convidado comprometido (página aberta na preview, inclusive o servidor de desenvolvimento do próprio projeto) envia qualquer canal: escrever num terminal vivo é execução de código como o usuário, e criar ou ligar MCP é a confiança que só a pessoa dá. | Guarda central para todo canal (só a janela do app e o frame principal), com lista explícita das exceções (`DESIGN_MODE` grab/cancel); teste de contrato que percorre `IPC_CHANNELS`; teste com remetente falso. | P | **→ B12** (confirmado pelo coordenador). Fronteira com o FRONTEND (preload). |
| BE-M-02 | Média | 12 Cadeia de suprimentos / 3 | empacotamento | Nenhum fuse do Electron está configurado: `EnableEmbeddedAsarIntegrityValidation`, `OnlyLoadAppFromAsar`, `EnableNodeOptionsEnvironmentVariable`, `EnableNodeCliInspectArguments` e `RunAsNode` ficam nos padrões. O app depende de `ELECTRON_RUN_AS_NODE` para iniciar o Codex. | `electron-builder.yml` (sem `electronFuses`/`afterPack`); grep sem ocorrências de "fuse" em `scripts/`, `build/`, `package.json`; `services/conversation/process-transport.ts:37` | Qualquer processo do mesmo usuário reaproveita o binário instalado para rodar Node arbitrário (`NODE_OPTIONS`, `--inspect`) ou trocar o `app.asar` sem detecção. Com a assinatura chegando (SignPath), isso passa a ser um binário confiável que roda código alheio. | Ativar os fuses no `electronFuses` do electron-builder: integridade do asar e `OnlyLoadAppFromAsar` ligados; `NodeOptions` e `NodeCliInspect` desligados. Para desligar `RunAsNode`, iniciar o Codex por `utilityProcess` ou por um Node próprio em vez de `process.execPath`. Teste: ler os fuses do pacote na CI (`npx @electron/fuses read`). | M | Novo. Assinatura: Já mapeado (Roadmap 2027, SignPath). |
| BE-M-03 | Baixa | 4 Integridade | `db/index.ts` | As migrations 001–045 rodam com `db.exec` fora de transação. Uma queda no meio deixa o esquema parcialmente aplicado. Guardas de autocorreção (`hasColumn`/`hasTable`) e o backup pré-migração mitigam. | `db/index.ts:145-439` (transação só a partir da l.441) | Só afeta quem atualiza de uma versão muito antiga e cai no meio; a recuperação já existe. | Documentar que 001–045 estão congeladas e cobertas pelo ensaio de atualização; nada a mudar no código. | P | Novo (informativo). |
| BE-M-04 | Baixa | 3 / 7 | `ipc/validation.ts` | `terminal:write` aceita `data` de qualquer tamanho; os outros textos da borda têm teto. | `ipc/validation.ts:145-151` | Uma string enorme vinda do renderer passa inteira para a fila do PTY. | Teto (por exemplo 1 MiB) em `parseTerminalWriteInput`, com teste. | P | Novo. |
| BE-M-05 | Baixa | 3 | `mcp-internal/bootstrap.ts` | O bearer do MCP interno é único por instalação e reaproveitado entre reinícios. Ele fica em texto claro no banco e no `.mcp.json` de cada projeto, e só gira quando a pessoa pede. Com ele, um cliente sem execução lê qualquer workspace pelo cabeçalho (`resolveScope`). | `bootstrap.ts:39-42,229-241`; `domain-tool.ts:57-58` | Mesmo usuário do sistema operacional, então o risco é baixo. Um `.mcp.json` copiado para fora (backup, zip do projeto) leva um token que nunca expira. | Girar o bearer a cada início do app (os painéis já recebem o ambiente no início) ou guardá-lo com `safeStorage`; registrar o primeiro uso de um token antigo. | M | Parcial: `SECURITY_MODEL.md` (Secrets) trata o token como segredo local. |
| BE-M-06 | Baixa | 2 Contratos (C3) | `db/index.ts` | O main devolve frases em inglês ao abrir o banco: banco mais novo, backup que falhou. | `db/index.ts:69,130` | Fere a C3 (o main devolve código, não frase). | Converter para `MessageCode`. | P | Já mapeado: B8.1 (códigos de mensagem). |
| BE-M-07 | Baixa | 14 Documentação | `docs/SECURITY_MODEL.md` | O modelo diz que o barramento local escuta "nunca numa porta TCP". Isso vale para o F3, mas o MCP interno e os ganchos dos agentes escutam em `127.0.0.1` por TCP, protegidos por token, e o documento não os cita. | `SECURITY_MODEL.md` (Trust boundaries); `local-rpc-server.ts:275`; `agent-hooks/server.ts:75` | Um leitor do modelo subestima a superfície local. | Listar todos os listeners locais com transporte e autenticação. | P | Novo. |
| BE-M-08 | Média (a confirmar) | 5 / 6 | `utils/process-cleanup.ts`, `terminal.service.ts` | Para encerrar, o app só chama `pty.kill()`, sem matar a árvore de processos. Um CLI de agente que gera netos (servidores MCP, `npm run dev`) pode deixar órfãos ao fechar o painel ou o app. | `utils/process-cleanup.ts:5-12`; `terminal.service.ts:605-609`; `index.ts:490-520` | Processos órfãos segurando portas e arquivos; no Windows, também travam a atualização. | **Não verificável aqui.** Teste nativo que abre um painel com um filho que gera um neto, fecha e confere que nenhum dos dois sobrevive (Windows e Linux). Se falhar: matar a árvore (job object no Windows, grupo de processos no Linux). | M | Novo. |

## 6. Padrões positivos a preservar (até aqui)

- **Backup verificado antes de migrar e recusa de downgrade** (`db/index.ts:60-132`). Nunca apagar WAL/SHM para "recuperar" (`SECURITY_MODEL.md`, Database recovery).
- **`requireAppFrame` e os parsers de `ipc-guards.ts`** como base pronta para a guarda central do B12.
- **`will-attach-webview` reescrevendo preload, sandbox e partição sem confiar no renderer** (`index.ts:782-800`).
- **Política aplicada no próprio `tools/call`** e, para quem chama sem execução, a união das negações de todos os projetos (`tool-policy.ts:14-53`).
- **Uma ferramenta por domínio com `action` e nível fixo**, que mantém a lista curta e impede o modelo de escolher o nível (`domain-tool.ts:70-107`).
- **Release só a partir do commit verificado**, com SBOM, checksums, atestação e verificação do rascunho antes de publicar (`ci.yml:636-806`).

## 7. Roadmap (preliminar)

- **Quick wins (1.4):** B12 (BE-M-01); teto em `terminal:write` (BE-M-04); corrigir o SECURITY_MODEL (BE-M-07). Mira: segurança de 2,5 → 3,0.
- **Curto prazo (1.4, se couber):** fuses (BE-M-02, com a troca do início do Codex); teste nativo da árvore de processos (BE-M-08); girar o bearer (BE-M-05). Mira: cadeia de suprimentos de 3,0 → 3,5.
- **Estrutural:** S3/S4 (B6.1), assinatura (SignPath), validação de IPC gerada a partir dos tipos. Mira: 4 (Gerenciado) em segurança.

## 8. Lacunas (até aqui)

| O que | Por que não verificável aqui | Como verificar |
|---|---|---|
| Gateway remoto (TLS, pareamento, limites, comandos) | Não está na main neste SHA | Avaliar no merge de #180/#204/#225; teste de capacidades proibidas do C5 |
| Órfãos ao fechar PTY/app (BE-M-08) | Exige rodar processos | Teste nativo `tests/integration/*.native.test.ts` em Windows e Linux (`npm run test:electron`) |
| Fuses efetivos no pacote | Exige o instalador | `npx @electron/fuses read --app <pacote>` no job de empacotamento |
| Consumo com muitos agentes (CPU/memória do main) | Exige carga | `bench:ui`, `memory-footprint.spec.ts` na CI; teste de carga com 24 PTYs |
