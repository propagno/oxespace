# Roadmap BACKEND 1.4.0

Padrão de cada item e DoD comum: ver [README](README.md).


O BACKEND orquestra até 2 subagentes ao mesmo tempo. Cada workstream tem um dono de arquivos exclusivo. Arquivos compartilhados só mudam por pedido de mudança de contrato (CCR, seção 4).

| WS | Subagente | Arquivos (dono) | Itens 1.4 |
|---|---|---|---|
| B1 Runtime de conversa e eventos | `be-runtime` | `services/conversation/**`, `ipc/thread.ipc.ts`, `shared/types/thread.ts` | A4, A5, A7, A12–A14*, M2, T2/T4/T5, aprovações agregadas |
| B2 Terminais e agentes | `be-terminal` | `terminal.service.ts`, `pty-*`, `agent-state/**`, `background.service.ts` | A10, X18/X19*, saída para o gateway |
| B3 Dados: OxeQuery e OxePod | `be-data` | `services/oxequery/**` → separar `services/oxepod/**`, worker | Q2–Q19 (1.4: Q2–Q7, Q15, Q16, Q19), P4, P7, P9 |
| B4 OxePost | `be-post` | `services/oxepost/**`, `shared/oxepost/**` | H4–H9, H12 |
| B5 Memória | `be-memory` | `services/memory/**`, `ipc/memory*` | M1, M6, M8–M11 |
| B6 Segurança e política | `be-security` | `services/policy/**`, `shared/{policy,net-policy,env-scrub}.ts`, `agent-actions/**`, `runtime/execution-host.ts` | S3, S4 aplicado, S7 cofre, S8, S10, S11, S13 |
| B7 MCP interno e cobertura | `be-mcp` | `mcp-internal/**`, `shared/mcp-coverage.ts`, `docs/validation/mcp-coverage-1.4.md` | P7/H8 tools, X21 gate. **Único que edita a cobertura** |
| B8 Plataforma | `be-platform` | `db/**`, `runtime-diagnostics`, `startup-timing`, `updater`, `index.ts`, scripts e CI | minificar o main, conectividade, About, códigos de mensagem (C3), X6, X8 |
| B9 Gateway remoto (mobile) | `be-gateway` | `services/remote/**` (novo), `shared/remote/**` | M1–M6 do mobile (seção 3) |

\* Itens com "Decisão sua" só entram depois da sua decisão.

Os itens de cada WS têm o mesmo formato da seção 1. Os de maior risco:

### B1.1 · Aprovações agregadas (M)
- **Objetivo:** listar e responder pedidos de todas as conversas; base do mobile e da central de atividade.
- **Escopo:** `thread.pendingRequestsAll` com resposta por `requestId` e `generation`.
- **Fora:** aprovações do OxeQuery e do `confirm` do MCP, que continuam no diálogo nativo do desktop.
- **Contratos:** C2.
- **Aceite:** resposta única por geração; uma resposta repetida é recusada.
- **Testes:** integração no registry.
- **Riscos:** corrida entre dois dispositivos → `ThreadRequestRegistry` já resolve uma vez só; teste de concorrência.

### B6.1 · S3 sandbox e S4 rede negada aplicados (GG)
- **Objetivo:** comandos do agente com escrita só no projeto e rede só para domínios liberados.
- **Escopo:** Landlock no Linux; AppContainer ou Job Objects no Windows; proxy local para `net:<domínio>`.
- **Fora:** macOS (X10 pendente).
- **Aceite:** e2e prova bloqueio de escrita fora do projeto e de rede não liberada; opt-out por política.
- **Riscos:** quebrar CLIs dos provedores → modo "auditar" antes de "negar", ligado por padrão só depois de 2 semanas no beta.

### B8.1 · Main minificado e códigos de mensagem (M)
- **Escopo:**
  - minificar o bundle do main com sourcemap privado, voltando o orçamento a ≤ 800 KiB;
  - `MessageCode` em `shared/messages.ts`: o main devolve código + parâmetros e o FE traduz (**C3**), começando pela quarentena de MCP e pelos diálogos nativos (`tMain`).
- **Aceite:** stack trace legível pelo sourcemap no relatório de problema.
- **Riscos:** crash ilegível → teste do mapeamento.

### B3.1 · Separar OxePod de OxeQuery (M)
- **Escopo:** `services/oxepod/**` e `oxePod:call` com lista de ops própria.
- **Objetivo:** fim do conflito entre os dois produtos.
- **Aceite:** testes de contrato de ops dos dois.

### Protocolo de handoff entre subagentes do BACKEND
1. Brief: WS, itens, contrato que consome e que produz, arquivos de que é dono.
2. Commits em branch própria `be/<ws>/<item>`.
3. O subagente devolve: PR aberto, testes rodados, catracas, mudanças de contrato.
4. O BACKEND revisa e pede validação ao coordenador. Nunca mergeia.
