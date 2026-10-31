# Maturidade do backend e da plataforma — OXESpace 1.4

- **SHA avaliado:** `origin/main` `bab99b505c2f0296582aff583571311567771aff` (merge do PR #237). O gateway remoto, que ainda não está na main, foi lido no PR #204 (`be/gateway/b9-m4-m5`, `0003345f`, que contém o #180) e no #225.
- **Avaliador:** sessão independente de avaliação de BACKEND/PLATAFORMA, só leitura, num worktree próprio sem `node_modules`. Nada foi compilado, testado nem executado. O que só se prova rodando está marcado **"Não verificável aqui"**, com o job ou teste que provaria.
- **Escopo:** `electron/main`, `electron/preload`, `shared/`, `resources/`, scripts de build e `.github/workflows`. O renderer (`src/`) fica com o avaliador de FRONTEND (sessão `oxespace-c5`). Na fronteira (preload/IPC), os achados citam a fronteira.
- **Etapas:** a etapa 1 (Fases 1–2 e scorecard preliminar) saiu no primeiro commit deste PR. Esta versão é o relatório completo.

## 1. Resumo executivo

**Nota geral: 3,2 / 5 (Definido, com partes Gerenciadas).** O app tem controles maduros nas portas que já foram atacadas (aprovações, OxeQuery, política, release). Ainda há uma lacuna estrutural na borda de IPC e um defeito de integridade no OxeQuery que só aparece quando a pessoa e um agente usam a mesma conexão.

Forças:
1. **Banco com recuperação séria.** Antes de migrar, o app faz um snapshot com `VACUUM INTO`, confere `integrity_check` e versão, faz `fsync` e só então promove o arquivo. Sem backup, a migração não roda. Um banco mais novo que o app é recusado. A CI ensaia a atualização a partir do banco estável anterior (`db/index.ts:102-132`, `ci.yml:284-291`).
2. **MCP interno com níveis e autoria.** O nível de cada ação é fixo, e o modelo não escolhe. A execução autenticada é a autoridade, e quem chama sem ela só lê. A política vale no próprio `tools/call`. As concessões ficam presas ao SHA-256 do texto exato, são de uso único e expiram (`domain-tool.ts:42-107`, `agent-actions/approval-broker.ts:49-60`).
3. **Cadeia de release verificável.** Actions fixadas por SHA, `npm ci --ignore-scripts`, três auditorias bloqueantes, SBOM SPDX, checksums, atestação de proveniência e verificação do payload publicado (`ci.yml:206-221`, `462-503`, `717-806`).

Riscos:
1. **BE-M-01 (Alta) → B12.** Cerca de metade dos arquivos de IPC não verifica o remetente, e os convidados do Web Preview têm `ipcRenderer` no preload.
2. **BE-M-09 (Alta) → B14.** Uma leitura de agente numa conexão de escrita fecha a sessão da pessoa no OxeQuery e desfaz a transação manual que ela tinha aberta. O que a pessoa roda depois cai em autocommit.
3. **S3/S4 não aplicados (Já mapeado: B6.1).** Não há sandbox do sistema operacional nem controle de rede para os agentes. Somam-se a falta de fuses e a falta de assinatura (BE-M-02 → B13; SignPath).

## 2. Stack e arquitetura de processos detectadas

| Item | Versão / forma | Evidência |
|---|---|---|
| Electron | `44.9.3` (fixado, devDependency, janela de suporte verificada na CI) | `package.json`; `ci.yml:223-227` |
| Node na CI | 22 | `ci.yml:189-190` |
| Build | electron-vite + Vite 6.4, TypeScript 5.7; main em ESM | `package.json`, `electron.vite.config.ts` |
| SQLite | `better-sqlite3` ^13 (optionalDependency), WAL, `foreign_keys = ON` | `db/index.ts:61-64` |
| PTY | `node-pty` ^1.1; `@xterm/headless` 5.5 | `services/terminal.service.ts` |
| Drivers do OxeQuery | `pg`, `pg-cursor`, `mongodb`, `bson`, `ssh2` empacotados no worker (`oxeBundledDependencies`) | `package.json`; `workers/oxequery-worker.ts` |
| Gateway remoto (PR) | `https` do Node, TLS ≥ 1.2, certificado EC P-256 próprio fixado pelo QR, `ws` sem compressão | PR #204 `services/remote/gateway.ts:340-348`, `certificate.ts`, `websocket.ts` |
| Atualização | `electron-updater` ^6.8, GitHub Releases, stable/beta, `allowDowngrade = false` | `updater.ts:144-149` |
| Empacotamento | NSIS (Windows x64); AppImage e deb (Linux x64); `asar: true`; sourcemaps do main fora do pacote | `electron-builder.yml` |
| Logs | `electron-log` com `redactSecrets` em cada linha | `services/log-redaction.ts` |

**Processos e como se falam**

```text
Renderer (sandbox, contextIsolation, CSP 'self')
  └─ preload/index.cjs (contextBridge → window.oxeApi) ──IPC──► main
Web Preview: <webview> e WebContentsView (partição em memória por dono)
  └─ preload/design-guest.cjs (ipcRenderer: grab/cancel do Design Mode) ──IPC──► main
main (Electron, ESM)
  ├─ IPC: 39 arquivos *.ipc.ts, ~340 canais (shared/types)
  ├─ services/ (~41,7 mil linhas) + vendor/codegraph (~42,9 mil)
  ├─ worker_threads: oxequery, semantic, native-history
  ├─ PTYs (node-pty); CLIs dos agentes (Claude: binário; Codex: binário nativo ou process.execPath + ELECTRON_RUN_AS_NODE)
  └─ servidores locais (todos com token):
       • MCP interno: HTTP 127.0.0.1:<porta>, bearer fixo + token por execução (local-rpc-server.ts:275)
       • ganchos dos agentes: HTTP 127.0.0.1:0, token por execução (agent-hooks/server.ts:75)
       • barramento RPC (F3): pipe nomeado / socket unix, bearer em tempo constante (runtime/rpc/transport.ts)
       • AI Memory (opcional): filho em 127.0.0.1 com token (memory/memory-runtime.ts:87-96)
       • túnel SSH do OxeQuery: 127.0.0.1:0 (oxequery/ssh-tunnel.ts:134)
       • [PR #204] gateway: HTTPS/WSS só em endereços privados, nunca loopback nem curinga (remote/network.ts)
Agent CLI ──stdio──► resources/mcp-bridge/oxespace-mcp.cjs ──HTTP+bearer──► MCP interno
```

**Endurecimento do Electron na janela principal** (`index.ts:749-875`):
- `contextIsolation`, `sandbox` e `nodeIntegration: false`.
- `webviewTag` ligado, vigiado por `will-attach-webview`: fixa o preload, força o sandbox, troca partições estranhas e só aceita `http(s)`.
- Permissões: só `media` e a área de transferência, e só no frame principal.
- `will-navigate`/`will-redirect` mantêm a janela no app; `setWindowOpenHandler` nega a abertura de janelas.
- `crashReporter` só local.
- CSP de produção injetada no build (`electron.vite.config.ts:216-232`). A CSP em si fica com o FRONTEND.

**Banco:**
- 80 arquivos de migration; `LATEST_DB_VERSION = 83`.
- 059 é feita em código; 016, 017 e 081 foram puladas; a 046 tem uma variante por plataforma.
- Até a 045 as migrations rodam sem transação, com guardas de autocorreção. Da 047 em diante, cada uma roda numa transação.

**CI:** a matriz Windows/Linux roda, nesta ordem:
- auditorias, notices, typecheck e lint (teto de 1.000 linhas);
- cobertura, build com orçamentos, nativos e ensaio de atualização;
- cobertura do OxeQuery, e2e, porta de desempenho e empacotamento;
- testes ao vivo do OxeQuery em várias versões de PostgreSQL e MongoDB.

## 3. Scorecard

| Dimensão | Nota | Justificativa | Evidência principal |
|---|---|---|---|
| 1 Arquitetura e fronteiras | 3,5 | Fronteiras claras (IPC → serviços, `ExecutionHost`, workers). O orquestrador de conversas é grande, e pessoa e agente compartilham a sessão do OxeQuery (BE-M-09). | `docs/ARCHITECTURE.md`; `thread-orchestrator.ts` (1.282 linhas) |
| 2 Contratos e versionamento | 3,5 | IPC tipado com testes de contrato e de preload; manifesto MCP; `schemaVersion` nas respostas; protocolo remoto versionado com JSON Schema (PR). A validação de IPC é escrita à mão (Já mapeado: README 1.4), e restam frases no main (BE-M-06, B8.1). | `tests/integration/ipc-contracts.test.ts`; `shared/mcp-coverage.ts` |
| 3 Segurança e modelo de ameaça | 2,5 | Controles fortes nas portas atacadas (B10, OxeQuery, política, redação, caminhos canônicos, gateway), mas sem verificação de remetente em metade do IPC (BE-M-01), sem fuses (BE-M-02) e sem sandbox do sistema operacional (B6.1). | `ipc/terminal.ipc.ts:25-34`; `electron-builder.yml` |
| 4 Integridade e ciclo de vida dos dados | 3,5 | Backup verificado, recusa de downgrade, transações desde a 047, ensaio de atualização. Perde meio ponto por BE-M-09, que perde a transação da pessoa. | `db/index.ts:60-132`; `oxequery-core.ts:211-215` |
| 5 Resiliência e recuperação | 3,5 | Retentativa limitada no banco, recarga do renderer com os PTYs vivos, worker do OxeQuery que reinicia com sonda e diário de incidentes. O PTY não mata a árvore de processos (BE-M-08). | `index.ts:881-895`; `oxequery/worker-client.ts:14-98` |
| 6 Concorrência e paralelismo | 3,0 | `MAX_LIVE_PTYS = 24`, filas por PTY, teto de 32 pedidos no worker, fila de aprovações (50) e limite de ações (30/min). Não há teto global de agentes ou gastos (Já mapeado: ASI08). A corrida de sessão está no BE-M-09. | `terminal.service.ts:109`; `worker-client.ts:36`; `agent-actions.ts:33` |
| 7 Desempenho e recursos | 3,5 | Orçamentos de bundle, porta de desempenho de UI, saída de sessão sem view fora do IPC, resultados com teto por linhas e bytes. O main está perto do orçamento (Já mapeado: B8.1). | `scripts/verify-bundle-budgets.mjs`; `ci.yml:330-349` |
| 8 Integração com agentes e MCP | 3,5 | Uma ferramenta por domínio, saída limitada e cercada, orçamento de custo testado. Ferramentas sob demanda em PR (Em PR #182). | `domain-tool.ts:70-107`; `tool-result-bound.ts` |
| 9 Plataformas | 3,5 | Migration por plataforma, `verify:linux` em Docker, `chrome-sandbox` do deb testado na CI; kill de árvore específico do Windows no transporte de conversas. | `db/index.ts:430-439`; `ci.yml:418-441`; `process-transport.ts:123-128` |
| 10 Observabilidade e diagnóstico | 3,5 | Diário de incidentes com códigos, logs redigidos, crashReporter local, tempos de inicialização, sourcemaps privados. Painel em PR (Em PR #205). | `services/diagnostics/*`; `startup-timing.ts` |
| 11 Testes e qualidade | 3,5 | 409 arquivos de teste (14 nativos), 105 specs e2e, banco ao vivo na CI, piso de cobertura no OxeQuery. Faltam testes da borda de IPC com remetente falso e da convivência pessoa + agente numa conexão. | `tests/`; `ci.yml:294-296,525-627` |
| 12 Build, empacotamento e cadeia de suprimentos | 3,0 | SBOM, proveniência, actions por SHA e auditorias, mas sem assinatura (Já mapeado: SignPath) e sem fuses (BE-M-02 → B13). | `ci.yml:462-503,717-724` |
| 13 CI/CD | 4,0 | Pipeline único, release só do commit verificado, tag conferida, payload verificado antes de publicar. | `ci.yml:636-806` |
| 14 Documentação e DX | 3,5 | SECURITY_MODEL, POLICY, PLATFORM_SPEC e o modelo de ameaça com referências testadas. Há imprecisões pontuais (BE-M-07). | `tests/threat-model-refs.test.ts` |

## 4. Inventário de módulos

**Legenda das colunas:**
- Validação: **P** = parsers dedicados (`validation.ts`, `ipc-guards.ts`, coerções por domínio); **A** = `String()`/`typeof` pontual.
- Autorização (remetente): **F** = exige o frame principal da janela do app; **—** = não verifica.

### 4.1 Borda: IPC (`electron/main/ipc`, 39 arquivos)

| Módulo | Tipo | Domínio | Caminho | Validação na borda | Autorização | Testes | Nota |
|---|---|---|---|---|---|---|---|
| thread (62 handlers), thread-worktree | Borda | Conversas | `ipc/thread.ipc.ts`, `thread-worktree.ipc.ts` | P | F (`sender()`, l.32) | sim | 4 |
| delegation, team | Borda | Coordenação | `ipc/delegation.ipc.ts`, `team.ipc.ts` | P | F | sim | 4 |
| oxequery, oxepod, oxepost (`*:call` com lista de ops) | Borda | Dados/HTTP | `ipc/oxequery.ipc.ts`, `oxepod.ipc.ts`, `oxepost.ipc.ts` | P (op-list) | F | sim | 4 |
| diagnostics, app-info, policy, notifications, voice, semantic, mcp-internal, oxe, agent-state, agentCredits, contextUsage | Borda | Plataforma | `ipc/*.ipc.ts` | P | F | sim | 3,5 |
| **terminal** | Borda | Terminais | `ipc/terminal.ipc.ts` | P (sem teto em `data`) | **—** | sim | 2 |
| **file-system** | Borda | Arquivos | `ipc/file-system.ipc.ts` | P + invariante do `FileSystemService` | **—** | sim (`fs-allowlist`, `path-safety`) | 2,5 |
| **mcp** (create/update/start/callTool) | Borda | MCP de terceiros | `ipc/mcp.ipc.ts` | P | **—** | sim | 2 |
| **workspace** (21), **github** (43), **git** | Borda | Workspaces/Git | `ipc/workspace.ipc.ts`, `github.ipc.ts`, `git.ipc.ts` | P | **—** | sim | 2,5 |
| task, skill, session, integration, linear, automations, background, agent, agent-hooks, clipboard, search, memory, appearance, copilot, oxe-context | Borda | diversos | `ipc/*.ipc.ts` | P/A | **—** | parcial | 2,5 |
| atualização do app | Borda | Atualização | `updater.ts:244-245` | (sem entrada) | **—** | sim | 3 |

### 4.2 Borda: MCP interno, servidores locais e gateway

| Módulo | Tipo | Domínio | Caminho | Validação | Autorização | Testes | Nota |
|---|---|---|---|---|---|---|---|
| Servidor RPC do MCP interno | Borda | MCP | `mcp-internal/local-rpc-server.ts` | corpo ≤ 64 KiB, envelope JSON-RPC | bearer em tempo constante; execução por `x-oxe-execution-token`; `tool.use` | sim | 4 |
| Ferramentas de domínio (~88 `oxespace_*`) | Borda | MCP | `mcp-internal/*-tools.ts`, `domain-tool.ts` | `str`/`int`/`bool` com teto; `additionalProperties: false` | nível fixo; sem execução = leitura | sim (`mcp-coverage`, `tool-catalog`) | 4 |
| Ações do agente e aprovações | Borda/Serviço | Segurança | `services/agent-actions/*`, `shared/approval-rules.ts` | texto ≤ revisável, senão recusa | concessão por execução + escopo + ferramenta + SHA-256, uso único, 5 min | sim (`approval-rules`, `approvals-contract`) | 4 |
| Ponte stdio | Borda | MCP | `resources/mcp-bridge/oxespace-mcp.cjs` | — | repassa o bearer do ambiente | parcial | 3 |
| Servidor de ganchos | Borda | Agentes | `services/agent-hooks/server.ts` | corpo ≤ 1 MiB | token por execução | sim | 4 |
| Barramento RPC (F3) | Borda | Runtime | `runtime/rpc/*` | linha ≤ 1 MiB | bearer, pipe/socket | sim | 4 |
| Gateway remoto | Borda | Mobile | PR #204 `services/remote/*` | frames ≤ 64 KiB, 60 comandos/min, `terminal.write` ≤ 4 KiB, textos com teto | token HMAC de 15 min + refresh com assinatura ECDSA do aparelho; revogação conferida a cada autenticação; `phoneWrite` por painel; `REMOTE_FORBIDDEN` | contratos (`remote-protocol-contract`, `remote-ipc-contract`) | 4 (pendente na main) |

### 4.3 Serviços de domínio e infraestrutura

| Módulo | Tipo | Domínio | Caminho | Testes | Nota |
|---|---|---|---|---|---|
| Runtime de conversas (Claude, Codex, orquestrador, histórico, checkpoints, rewind) | Serviço | Conversas | `services/conversation/**` (67 arquivos, 9,6 mil linhas) | muitos (`thread-*`, `claude-*`, `codex-*`, conformidade de adaptadores) | 3,5 |
| OxeQuery (gateway do agente, classificadores, DDL, túnel SSH, credenciais) | Serviço | Dados | `services/oxequery/**` (37 arquivos, 6,1 mil linhas) | unidade, integração e ao vivo na CI; piso de 60% | 3 (BE-M-09) |
| OxePod (containers) | Serviço | Dados | `services/oxepod/**` | unidade e contratos de ops | 3,5 |
| OxePost (HTTP da pessoa) | Serviço | HTTP | `services/oxepost/**` | unidade | 3,5 |
| Terminais/PTY | Infraestrutura | Terminais | `terminal.service.ts`, `pty-*.ts` | unidade, e2e | 3,5 |
| Política | Serviço | Segurança | `services/policy/**`, `shared/policy.ts` | `policy.test.ts`, `net-policy.test.ts` | 3,5 (`net:` não aplicado: B6.1) |
| Sistema de arquivos | Serviço | Arquivos | `file-system.service.ts`, `utils/safe-join.ts` | `fs-allowlist`, `path-safety` | 4 |
| Banco e migrations | Infraestrutura | Dados | `db/index.ts`, `db/migrations` (80) | `migrations.test.ts`, `upgrade-rehearsal.native.test.ts` | 4 |
| Workers | Infraestrutura | — | `workers/*.ts` | `native-history-worker.test.ts` | 3,5 |
| Atualizador | Infraestrutura | Atualização | `updater.ts` | `app-info.test.ts` | 3 (sem assinatura) |
| Diagnóstico | Serviço | Plataforma | `services/diagnostics/**` | `diagnostics-*.test.ts` | 3,5 |
| Contratos: IPC, C3, C5, B10 | Contrato | — | `shared/types/ipc.ts`, `shared/messages.ts`, `shared/remote/**`, `shared/types/approvals.ts` | testes de contrato de cada um | 3,5 |

## 5. Análise módulo a módulo (Fase 3, módulos obrigatórios)

### 5.1 Borda de IPC — nota 2,5
- **Bom:** parsers dedicados para quase toda entrada (`ipc/validation.ts`, `ipc-guards.ts`), sem caminhos vindos do renderer para import/export (o main abre o diálogo) e op-lists por domínio nos `*:call`.
- **Lacunas:** não há guarda de remetente central (BE-M-01 → B12) e `terminal:write` não tem teto (BE-M-04). A validação é escrita à mão, sem gerar a partir dos tipos (Já mapeado).
- **Testes:** contratos de canal e de preload; falta o teste com remetente falso.

### 5.2 MCP interno — nota 4
- **Bom:** bearer comparado em tempo constante e `/healthz` também autenticado (`local-rpc-server.ts:72-81,191-198`); corpo limitado; política no `tools/call` com a união das negações para quem chama sem execução (`tool-policy.ts:14-53`); saída limitada e marcada como não confiável; `approvals.admin` e as demais capacidades da pessoa nunca viram ferramenta (`mcp-coverage-1.4.md`).
- **Lacunas:** o bearer é fixo e fica em texto claro (BE-M-05). Sem execução, quem chama lê o workspace que nomeia no cabeçalho, mas isso é escolha documentada.
- **Testes:** cobertura, catálogo, limite de saída, escopo da preview.

### 5.3 Aprovações e ações do agente — nota 4
- **Bom:** o texto longo é recusado em vez de cortado (`agent-actions.ts:62`); a negação é lembrada por 60 s; "permitir nesta execução" existe só para leituras e expira em 4 h; as concessões são apagadas quando a execução termina (`approval-broker.ts:37-75`); limite de 30 ações por minuto.
- **Na main ainda vale o diálogo nativo:** o modal B10 está em PR (Em PR #238, nomes reservados em #247), e as regras puras do B10 já estão na main com testes. Nada novo além do que o SECURITY_MODEL já registra.

### 5.4 OxeQuery — nota 3
- **Bom:**
  - Classificador que, na dúvida, trata o comando como escrita (`sql-guard.ts:213`), com o caso do dollar quote fechado (#237).
  - Leituras do agente sempre numa conexão forçada a `readOnly`, com `BEGIN READ ONLY` no servidor (`agent-gateway.ts:210`, `oxequery-core.ts:269`).
  - Tempo máximo de 20 s, no máximo 200 linhas para o agente, mascaramento, auditoria só com o hash e o texto redigido.
  - Worker com sonda e reinício.
  - Testes ao vivo em várias versões.
- **Lacuna principal:** BE-M-09 → B14. As sessões do worker ficam numa chave por `connection.id`. Como `readOnly` faz parte da chave, a leitura do agente fecha a sessão da pessoa, e a da pessoa fecha a do agente. No MongoDB, a mesma troca interrompe uma importação, exportação ou mudança em lote em andamento (adendo enviado ao B14).
- **Agravante relacionado:** quando um pedido estoura o tempo, o worker inteiro reinicia, e isso derruba todas as conexões e túneis, inclusive a transação aberta da pessoa em outra conexão (`worker-client.ts:16-21,98`). O próprio código documenta isso. Cabe no B14 decidir se o tempo esgotado de um pedido do agente pode reiniciar o worker que atende a pessoa.

### 5.5 Terminais/PTY — nota 3,5
- **Bom:** o PTY pertence ao painel e sobrevive ao renderer; `attach` síncrono sem perder nem duplicar trechos; buffer circular de 256 KB; DEC modes rastreados; `MAX_LIVE_PTYS = 24`, recuperando só sessões desanexadas e ociosas há 30 s ou mais (`docs/ARCHITECTURE.md`, `terminal.service.ts:109,671-680`).
- **Lacunas:** para encerrar, só `pty.kill()` (BE-M-08 → B13), enquanto o transporte das conversas mata a árvore inteira (`process-transport.ts:85,123-128`). O teto de entrada está no BE-M-04.

### 5.6 Runtime de conversas — nota 3,5
- **Bom:**
  - Executável resolvido sem shell; scripts `.cmd`/`.ps1` arbitrários recusados no Thread; Codex iniciado pelo binário nativo quando possível (`process-transport.ts:25-58`).
  - Processo filho em grupo próprio (POSIX), morto com `taskkill /T /F` ou por grupo com SIGTERM e depois SIGKILL.
  - Recuperação de queda (`thread-crash-recovery.ts`), histórico em worker, eventos com `schemaVersion` (C2).
- **Lacunas:** o orquestrador tem 1.282 linhas, acima do teto de 1.000; está congelado na `scripts/file-size-baseline.json:3` e não pode crescer. Quando o iniciador `.cmd` do Codex é o único disponível, ele exige `RunAsNode` (BE-M-02).

### 5.7 Banco e migrations — nota 4
Ver Fase 1. A única ressalva é informativa: as migrations 001–045 rodam sem transação (BE-M-03).

### 5.8 Atualização e empacotamento — nota 3
- **Bom:** canais separados, sem downgrade, release só do commit verificado, SBOM e atestação.
- **Lacunas:**
  - Instaladores sem assinatura (Já mapeado: SignPath). Sem ela, a integridade da atualização depende do `sha512` do `latest.yml` no mesmo release, ou seja, da conta do GitHub.
  - A atestação existe, mas o atualizador não a verifica.
  - Sem fuses (BE-M-02 → B13).
  - Instalação automática ao sair é o padrão (`updater.ts:100-102`). É uma escolha razoável, mas reforça a necessidade de assinar.

### 5.9 Gateway remoto (pendente na main; lido no PR #204) — nota 4
- **Bom:**
  - Escuta só em endereços privados, nunca em loopback nem no curinga (`network.ts`).
  - TLS 1.2 ou mais, com `handshakeTimeout`, `maxHeaderSize` e `maxConnections`.
  - Certificado fixado pelo QR. Trocar o certificado revoga todos os aparelhos (`gateway.ts:325-327`).
  - Código de pareamento de 128 bits, de uso único, comparado por hash em tempo constante, com tentativas por endereço; a pessoa ainda confirma o pareamento na janela (`pairing.ts`).
  - Token de acesso HMAC de 15 min com o relógio do desktop; refresh com prova de posse ECDSA P-256 sobre um desafio; revogação conferida a cada autenticação (`tokens.ts`, `gateway.ts:474-505`).
  - Upgrade com `Origin` recusado (bloqueia páginas de navegador) e limite de escrita pendente de 4 MiB por leitor lento (`websocket.ts`).
  - Comandos com tetos de tamanho e taxa; `terminal.write` só em painel com `phoneWrite`; pedidos `guarded`, permissões, elicitação e perguntas secretas só no desktop; "aceitar para a sessão" nunca é oferecido ao celular (`filters.ts:103-114`, `commands.ts:164-189`); `REMOTE_FORBIDDEN` para OxeQuery, `mcp.confirm`, confiança, contas, segredos, política e execução.
- **Lacuna (Em PR #204):** BE-M-10. Se o comando ultrapassa 2.000 caracteres, o celular recebe o comando cortado, sem marca de corte, e ainda pode aceitar.

## 6. Achados

| ID | Severidade | Dimensão | Módulo(s) | Problema | Evidência | Impacto | Recomendação | Esforço | Já mapeado/Em PR |
|---|---|---|---|---|---|---|---|---|---|
| BE-M-01 | **Alta** | 3 | `ipc/terminal`, `file-system`, `mcp`, `workspace`, `github`, `git` e ~14 outros | Cerca de 20 dos 39 arquivos de IPC registram handlers sem verificar o remetente/frame, e não há guarda global. Os convidados do Web Preview carregam um preload com `ipcRenderer`. | `ipc/terminal.ipc.ts:25-34`, `file-system.ipc.ts:23-33`, `mcp.ipc.ts:38-101`; `index.ts:782-800`; `browser-preview.service.ts:118`; `preload/design-guest.ts:1,172`; `PLATFORM_SPEC.md:121` | Um renderer de convidado comprometido escreve num terminal (execução como o usuário) ou cria/liga MCP (confiança que só a pessoa dá). | Guarda central (janela do app + frame principal) com lista de exceções (`DESIGN_MODE` grab/cancel); teste que percorre `IPC_CHANNELS`; teste com remetente falso. | P | **→ B12**. Fronteira com o FRONTEND (preload). |
| BE-M-09 | **Alta** | 4 / 6 | `oxequery/oxequery-core.ts`, `agent-gateway.ts` | As sessões do worker ficam numa chave por `connection.id`, e o `readOnly` entra no hash; ao trocar a chave, `closeConnection` encerra o cliente sem olhar `tx` nem `running`. A leitura do agente força `readOnly: true`. | `oxequery-core.ts:113-117,211-215,1152-1157`; `agent-gateway.ts:210,251,324`; `oxequery/service.ts:162-163`; o reaper protege a tx (l.167), mas este caminho não | Uma leitura de agente numa conexão de escrita desfaz a transação manual aberta da pessoa, e o que ela roda depois cai em autocommit; no MongoDB, interrompe importação, exportação ou mudança em lote no meio. | Sessões separadas para pessoa e agente; nunca fechar uma sessão com tx aberta ou em uso (recusa `conflict`); teste ao vivo BEGIN + INSERT, leitura do agente e COMMIT. | P/M | **→ B14** (com adendo do MongoDB) |
| BE-M-02 | Média | 12 / 3 | empacotamento, `process-transport.ts` | Nenhum fuse do Electron configurado (integridade do asar, `OnlyLoadAppFromAsar`, `NodeOptions`, `NodeCliInspect`, `RunAsNode`). O Codex por `.cmd` depende de `ELECTRON_RUN_AS_NODE`. | `electron-builder.yml`; nenhuma ocorrência de "fuse" em `scripts/`, `build/` ou `package.json`; `process-transport.ts:37` | Qualquer processo do usuário reaproveita o binário (que será assinado) para rodar Node arbitrário ou trocar o `app.asar` sem detecção. | `electronFuses` no electron-builder; trocar o início do Codex por `.cmd` (`utilityProcess` ou só o binário nativo) para poder desligar `RunAsNode`; ler os fuses do pacote na CI. | M | **→ B13**. Assinatura: Já mapeado (SignPath). |
| BE-M-08 | Média (a confirmar) | 5 / 6 | `utils/process-cleanup.ts`, `terminal.service.ts` | Para encerrar um PTY, só `pty.kill()`, sem matar a árvore. O transporte de conversas já mata a árvore. | `process-cleanup.ts:5-12`; `terminal.service.ts:605-609`; contraste com `process-transport.ts:123-128` | Netos (servidores MCP, `npm run dev`) podem ficar órfãos, segurando portas e travando a atualização no Windows. | **Não verificável aqui.** Teste nativo com filho que gera neto, nos dois sistemas; se falhar, job object no Windows e grupo de processos no Linux. | M | **→ B13** |
| BE-M-10 | Média | 3 (B10) | PR #204 `remote/filters.ts`, `commands.ts`, `shared/remote/protocol.ts` | O comando de um pedido de aprovação vai ao celular cortado em `REMOTE_TEXT_LIMITS.detail` (2.000 caracteres), sem campo `truncated` em `RemotePendingRequest`. `isAnswerable` não considera o corte, então o celular aceita o que não viu inteiro. Os caminhos também são cortados em 100. | PR #204 `filters.ts:125-150` (`clean(..., detail)`), `protocol.ts:452-476`; `commands.ts:164-185` | Contraria a regra B10 "o que a pessoa vê é exatamente o que roda; texto cortado só oferece negar": um agente pode esconder o fim de um comando longo. | Marcar `truncated` (comando, detalhe e caminhos) e, quando houver corte, tornar o pedido não respondível no celular ou oferecer só negar; teste com comando de 2.001 caracteres. | P | **Em PR #204** |
| BE-M-03 | Baixa | 4 | `db/index.ts` | As migrations 001–045 rodam fora de transação. | `db/index.ts:145-439` | Uma queda no meio deixa o esquema parcial; as guardas e o backup mitigam. | Documentar que 001–045 estão congeladas e cobertas pelo ensaio de atualização. | P | Novo (informativo) |
| BE-M-04 | Baixa | 3 / 7 | `ipc/validation.ts` | `terminal:write` aceita `data` sem limite de tamanho; o gateway limita a 4 KiB. | `validation.ts:145-151` | Uma string enorme vai inteira para a fila do PTY. | Teto (por exemplo 1 MiB) com teste. | P | Novo |
| BE-M-05 | Baixa | 3 | `mcp-internal/bootstrap.ts`, `domain-tool.ts` | O bearer do MCP interno é único por instalação e reaproveitado entre reinícios, em texto claro no banco e no `.mcp.json`; sem execução, quem tem o bearer lê o workspace que nomear. | `bootstrap.ts:39-42,229-241`; `domain-tool.ts:57-58` | Mesmo usuário, risco baixo; um `.mcp.json` copiado leva um token que não expira. | Girar o bearer a cada início ou guardá-lo com `safeStorage`. | M | Parcial: `SECURITY_MODEL.md` (Secrets) |
| BE-M-06 | Baixa | 2 (C3) | `db/index.ts` | O main devolve frases em inglês ao abrir o banco. | `db/index.ts:69,130` | Fere a C3. | `MessageCode`. | P | Já mapeado: B8.1 |
| BE-M-07 | Baixa | 14 | `docs/SECURITY_MODEL.md` | O modelo diz que o barramento local "nunca" usa TCP; o MCP interno e os ganchos usam TCP em `127.0.0.1` (com token), e o documento não os lista. | `local-rpc-server.ts:275`; `agent-hooks/server.ts:75` | O leitor subestima a superfície local. | Listar todos os listeners locais com transporte e autenticação. | P | Novo |

## 7. Análise transversal (Fase 4)

1. **Arquitetura e fronteiras.** A regra "o main é dono do privilégio e o renderer só tem a ponte tipada" se cumpre. A fronteira mais fraca não fica entre renderer e main, e sim entre os convidados da preview e o main (BE-M-01). Dentro do main, o OxeQuery mistura pessoa e agente na mesma sessão (BE-M-09).
2. **Contratos.** IPC (C1), eventos (C2 com `schemaVersion`), mensagens (C3 em andamento), protocolo remoto (C5 com JSON Schema e capacidades proibidas) e migrations (C6) têm teste de contrato. Falta a regra "todo canal tem guarda" como contrato testado.
3. **Segurança.** A defesa em camadas é boa nas aprovações e nos dados. Faltam a guarda de IPC, os fuses e a assinatura, e o sandbox do sistema operacional (S3/S4) continua o maior risco residual, já declarado no modelo de ameaça.
4. **Integridade.** O banco do app está no nível 4; as transações da pessoa no OxeQuery ficam abaixo disso até o B14.
5. **Resiliência.** Recarga do renderer com terminais vivos, worker com sonda e reinício, retentativas limitadas. O reinício do worker é amplo demais: derruba todas as conexões.
6. **Concorrência.** Há tetos locais (PTYs, fila do worker, fila de aprovações, limite de ações e do gateway), mas não há teto global de agentes ou de gastos (Já mapeado: ASI08).
7. **Desempenho.** Orçamentos e portas na CI. O main perto do teto já é o B8.1. **Não verificável aqui:** memória com 24 PTYs e várias conversas.
8. **Agentes e MCP.** O custo de ferramentas é medido (`thread-mcp-budget`) e a lista é curta por domínio. As ferramentas sob demanda (B7.2) estão em PR.
9. **Plataformas.** Paridade razoável entre Windows e Linux. A diferença está no encerramento de processos (BE-M-08).
10. **Observabilidade.** Diário com códigos e sem conteúdo, logs redigidos e sourcemaps privados. O painel F11 está no PR #205.
11. **Testes.** Volume e variedade altos (unidade, integração nativa, ao vivo, e2e, contratos). Faltam testes adversariais de borda (remetente falso) e de convivência pessoa + agente.
12. **Build e cadeia de suprimentos.** SBOM, proveniência, auditorias e actions por SHA estão acima da média; faltam assinatura e fuses.
13. **CI/CD.** Nível 4: release só do commit verificado e payload verificado depois de publicado.
14. **Documentação e DX.** Boa e testada (`threat-model-refs`), com imprecisões pontuais (BE-M-07, `PLATFORM_SPEC.md:121`, que descreve a lacuna como se fosse uma propriedade).

### Fluxos críticos ponta a ponta

| Fluxo | Caminho | Onde quebra |
|---|---|---|
| Agente pede ação `confirm` → aprovação → execução | `tools/call` → `toolCallBlocked` → `resolveScope` (execução autenticada) → `AgentActions.run` → `ApprovalBroker.require` (hash do texto, uso único) → diálogo nativo na main (modal B10 em #238) → handler | Sem execução: recusado (bom). O texto acima do teto é recusado (bom). Ponto fraco: a resposta da pessoa chega por IPC, e o diálogo nativo não tem esse problema, mas o modal B10 precisa da guarda do B12 para não aceitar `approvals.respond` de outro remetente. O contrato já diz "só o frame principal"; conferir no #238. |
| OxeQuery: consulta e escrita | Pessoa: `oxeQuery:call` → worker `sql.run` na sessão de `connection.id`. Agente: `oxespace_db_query` → `guardSql` = read → conexão forçada a `readOnly` → mesmo worker | **BE-M-09**: a troca de chave fecha a sessão do outro; a transação manual da pessoa é desfeita, e a pessoa passa a rodar em autocommit. Um tempo esgotado reinicia o worker e derruba todas as conexões. |
| Terminal com agente e o renderer recarregando | `render-process-gone` → `RendererRecoveryPolicy` → recarga → o renderer assina e chama `terminal.attach` (síncrono) → replay do buffer circular ou bounce de tamanho em tela alternativa | Funciona por desenho. Ponto fraco: fechar o painel depois pode deixar netos (BE-M-08). **Não verificável aqui:** e2e de recarga com agente vivo. |
| Pareamento e sessão do celular | QR (código de 128 bits + impressão digital) → `/pair` (tentativas por IP) → pessoa confirma na janela → aparelho registrado com chave P-256 → WSS com token de 15 min → refresh por assinatura sobre desafio | Sólido. **BE-M-10**: aprovação com comando cortado. A resposta `answerPairing` vem pela janela por IPC e precisa da guarda do B12. |
| Atualização do app | verificação periódica → `latest.yml` (canal) → download → `sha512` → instalação ao sair | Sem assinatura, a confiança fica na conta do GitHub (Já mapeado: SignPath). A atestação não é verificada pelo atualizador. Sem fuses, o binário instalado pode ser reaproveitado (BE-M-02). |

## 8. Padrões positivos a preservar

- **Backup verificado antes de migrar e recusa de downgrade** (`db/index.ts:60-132`). Nunca apagar WAL/SHM para "recuperar".
- **`requireAppFrame` e os parsers de `ipc-guards.ts`**, base pronta para o B12.
- **`will-attach-webview` reescrevendo preload, sandbox e partição** sem confiar no renderer (`index.ts:782-800`).
- **Política no próprio `tools/call`** e a união das negações para quem chama sem execução (`tool-policy.ts:14-53`).
- **Uma ferramenta por domínio com nível fixo** (`domain-tool.ts:70-107`).
- **Concessão presa ao SHA-256 do texto, de uso único e expirável**, e texto longo recusado em vez de cortado (`approval-broker.ts`, `agent-actions.ts:62`).
- **Classificador SQL que, na dúvida, trata como escrita, e `BEGIN READ ONLY` imposto pelo servidor** (`sql-guard.ts:213`, `oxequery-core.ts:269`).
- **Kill da árvore de processos no transporte de conversas**, o modelo a copiar para os PTYs (`process-transport.ts:85,123-128`).
- **Gateway:** endereços só privados, certificado fixado, prova de posse no refresh, `Origin` recusado, `REMOTE_FORBIDDEN` testado.
- **Release só do commit verificado**, com SBOM, checksums, atestação e verificação do rascunho (`ci.yml:636-806`).

## 9. Roadmap

| Etapa | Itens | Nível que mira | Na 1.4? |
|---|---|---|---|
| Quick wins | **B12** (BE-M-01); **B14** (BE-M-09 + adendo Mongo); BE-M-10 no #204 antes do merge; teto em `terminal:write` (BE-M-04); corrigir SECURITY_MODEL e PLATFORM_SPEC (BE-M-07) | Segurança 2,5 → 3,0; integridade 3,5 → 4,0 | Sim |
| Curto prazo | **B13** (BE-M-02 fuses + troca do início do Codex; BE-M-08 árvore de processos); girar o bearer do MCP (BE-M-05); decidir no B14 se um tempo esgotado do agente pode reiniciar o worker da pessoa | Cadeia de suprimentos 3,0 → 3,5; resiliência 3,5 → 4,0 | B13 na onda 4; o resto se couber |
| Estrutural | S3/S4 (B6.1); assinatura (SignPath) e verificação da atestação no atualizador; validação de IPC gerada a partir dos tipos; teto global de agentes e gastos (ASI08) | Segurança 4 (Gerenciado) | Depois da 1.4, salvo B6.1 em modo auditar |

## 10. Lacunas ("Não verificável aqui")

| O que | Por que | Como verificar |
|---|---|---|
| BE-M-09 em execução real | Exige um banco | Teste ao vivo no job `oxequery-live` (BEGIN + INSERT, leitura do agente, COMMIT, conferir a linha) |
| Órfãos ao fechar PTY/app (BE-M-08) | Exige processos | Teste `*.native.test.ts` em Windows e Linux via `npm run test:electron` |
| Fuses efetivos no pacote | Exige o instalador | `npx @electron/fuses read --app <pacote>` no job de empacotamento |
| Gateway em rede real (TLS, revogação, reconexão) | Não está na main; exige aparelho | Homologação Android (PR #232) e e2e com o mock remoto depois do merge de #180/#204 |
| Consumo com muitos agentes | Exige carga | `bench:ui`, `memory-footprint.spec.ts`; teste de carga com 24 PTYs e várias conversas |
| Atualização ponta a ponta (download, verificação, instalação) | Exige release | Ensaio com um release beta em máquina limpa; conferir que o atualizador recusa um `sha512` alterado |
