# Evidências — Thread profissional v2

## Milestone de fundação

Estado: em andamento

- [x] Contrato de SLO e invariantes documentado.
- [x] Fault corpus determinístico para restart/shutdown sobre turn, tool, request, approval, diff, subagente e fila.
- [x] Envelope de evento v2 e estados monotônicos de operação.
- [x] Migração 055 com identidade estável e journal durável.
- [x] Escrita incremental por cauda e cache host para o hot path de streaming.
- [x] Recovery extraído do `ThreadManager`; operações sem confirmação terminam em `unknown`.
- [x] Export Markdown inerte/redigido extraído para `ThreadExportService` e coberto pelo fluxo de integração.
- [x] Supervisor de conexão com `starting/connected/degraded/reconnecting/closed`, heartbeat por atividade, backoff e circuit breaker sem replay automático.
- [x] Canvas responsivo compartilhado por timeline e compositor; prosa mantém medida de leitura independente.
- [x] Primeiro contrato da timeline semântica: turns/rows com chaves estáveis, agrupamento de tools e remoção de eventos de protocolo antes da renderização.
- [ ] `ThreadManager` reduzido a fachada de até 300 linhas.
- [ ] Supervisor com heartbeat e reconciliação nativa por provider.
- [ ] Timeline virtualizada com no máximo 80 rows montadas.
- [x] Baseline do benchmark de 100 mil eventos registrado no host de referência.

## Validação atual

Em 2026-09-20:

- `npm run typecheck`: aprovado.
- `npm run lint`: 0 erros; 32 avisos preexistentes no checkout.
- `npm run test:electron`: 156 arquivos aprovados, 5 ignorados; 966 testes aprovados, 23 ignorados.
- `npm run build`: aprovado com budgets em 904/904 kB main, 31/40 kB preload, 490/500 kB renderer e 417/500 kB CSS.
- `npx playwright test e2e/thread-view.spec.ts`: aprovado; timeline de 19.825 px rolável dentro de viewport de 600 px e contrato responsivo da coluna validado.
- Testes direcionados após a extração de export, API explícita de persistência e row model: 58/58 aprovados.
- Inspeção visual: `test-results/thread-wide-layout-1440.png` confirma timeline e compositor ocupando a área útil, alinhados ao mesmo eixo.

Benchmark de 100 mil eventos, Electron ABI 125: 2.691 operações/s, média 0,3715 ms, p99 0,9990 ms para append + remoção incremental da cauda (5.386 amostras). O resultado passa a meta de append p95 ≤ 15 ms; a comparação formal 1 mil/100 mil e os gates completos permanecem pendentes até o fechamento do milestone.

O budget do processo principal passa no limite exato e precisa recuperar pelo menos 5% de margem antes do gate final T15.

## Disposição do quality controller

O controlador encontrou evidência para os seis critérios desta entrega, porém manteve `FAIL` heurístico por `CONTRACT_CONSUMERS_UNCHANGED`: o checkout agregado possui 258 arquivos alterados e 584 consumidores de contratos fora do diff. A análise exaustiva anterior localizou os consumidores de `ConversationThread`/`ThreadEvent`; os novos campos são opcionais e a compatibilidade foi verificada por typecheck, suíte Electron completa, build e E2E. O alerta permanece registrado porque o controlador não consegue isolar esta fatia do restante do worktree não commitado.

## Milestone de fluidez da timeline — 2026-09-21

- [x] Modal `Add project` do Thread reduzido a seleção de pasta; não expõe mosaicos nem agentes do Code e cria apenas o contexto mínimo inativo necessário aos serviços compartilhados.
- [x] Quality controller carregado sob demanda, recuperando o budget do processo principal, com escopo explícito de arquivos e análise de declarações tocadas.
- [x] Bridge MCP repete apenas operações de leitura idempotentes e informa `infrastructure`, `retryable`, tentativas e estado de entrega; mutações não são repetidas.
- [x] Timeline semântica virtualizada por linha com medição dinâmica, overscan e teto rígido de 80 nós para 10 mil rows no teste de contrato.
- [x] Âncora visual preservada quando linhas acima mudam de altura; crescimento no fim mantém follow-bottom; superfícies ocultas não sobrescrevem medições nem provocam loop de render.
- [x] Cache LRU de quatro snapshots permite pintura imediata ao trocar de Thread e reconciliação protegida por generation em segundo plano.
- [x] Diagnósticos de tools distinguem validação, infraestrutura e falha, mantendo payload grande recolhido.

Validação incremental:

- `npm run typecheck`: aprovado.
- Testes direcionados de timeline/store/view/atividade: 30 testes aprovados.
- `npm run build`: aprovado após split do quality controller; 897/904 kB main, 31/40 kB preload, 496/500 kB renderer e 419/500 kB CSS.
- `npx playwright test e2e/thread-view.spec.ts`: aprovado no bundle reconstruído; 300 rows semânticas com no máximo 80 montadas, âncora preservada durante streaming e alternância Code/Thread.
- `npm run test:electron -- tests/integration/coordination.workflow.test.ts`: 6/6 aprovado isoladamente; o timeout anterior foi contenção da execução paralela.

Pendência de gate: os budgets passam, mas main/renderer ainda não possuem os 5% de margem exigidos por T15.

## Fechamento do plano — 2026-09-21

Estado: implementação concluída.

- [x] `ThreadManager` é uma fachada estável de 7 linhas; a orquestração e os serviços de histórico, requests, sessão, recovery, export e checkpoints ficam em módulos próprios.
- [x] Persistência normal escreve apenas a cauda alterada; rewrites completos são explícitos. Migrações 055/056 mantêm journal, envelopes e checkpoints.
- [x] Supervisor aplica heartbeat por atividade, estados de conexão, circuit breaker e backoff exponencial com jitter estável, sem replay automático de operações incertas.
- [x] Timeline semântica mantém no máximo 80 rows montadas. O E2E final exercita 10.002 rows e preserva âncora, follow-bottom e scroll por conversa.
- [x] Cache LRU de quatro snapshots pinta a troca imediatamente e reconcilia em background com proteção de generation.
- [x] Compositor impede double-submit e preserva draft/anexos. Follow-up removido da fila retorna texto, anexos e configuração ao draft; entrega `unknown` só pode ser descartada explicitamente.
- [x] Edit/retry Codex informa que o histórico será rebobinado e que o disco permanece; checkpoints oferecem restore separado e verificável.
- [x] Checkpoints capturam preimages/hashes, preservam dirty state e índice Git, bloqueiam conflitos e symlinks, restauram via temp+rename e permitem retry depois que o conflito é resolvido.
- [x] Workbench possui Session Changes, Project Changes live, Files, Source control, Search, Scripts, Jobs, Preview, terminal contextual e diagnósticos, todos vinculados ao root da Thread.
- [x] Export/import portátil usa schema, checksums, limites, paths validados, redação e import inerte.
- [x] Duas conversas podem ficar lado a lado com snapshots, drafts, anexos, scroll, review e foco isolados; voz/hotkeys seguem a célula ativa e fechar a célula não interrompe a execução.
- [x] Manifesto de capacidades registra transporte e versões quando o handshake fornece evidência. A suíte comum impede flags incoerentes.
- [x] Subagentes Codex permanecem observáveis. Controles independentes ficam explicitamente indisponíveis para Codex/Claude porque os protocolos qualificados não oferecem operações idempotentes; nenhuma CLI ou prompt aproximado é usado.
- [x] Providers sem protocolo headless documentado e subscription auth compatível permanecem Code-only.
- [x] Painel de diagnósticos copia relatório sem prompts, eventos privados ou credenciais.

### Evidência de performance

`npm run bench:thread` gerou `benchmark.json` versionado no diretório do plano:

|Carga persistida|Média|p99|Amostras|
|---|---:|---:|---:|
|1.000 eventos|0,2441 ms|0,7184 ms|8.193|
|100.000 eventos|0,2378 ms|0,7152 ms|8.412|

A razão média 100k/1k foi 0,974x, dentro da meta de até 2x e muito abaixo do SLO de append p95 de 15 ms.

### Gate final

- `npm run typecheck`: aprovado.
- `npm run lint`: 0 erros; 33 avisos preexistentes ou não bloqueantes.
- `npm run test:electron`: 991 testes aprovados, 23 ignorados, 160 arquivos aprovados e 5 ignorados na execução final limpa.
- Testes direcionados de adapters, capacidades, store, view, fila, migrations, manager e restore: aprovados.
- `npm run build`: aprovado.
- Budgets com gate mínimo de 5%: main 481/904 kB (46,8%), preload 32/40 kB (20,7%), renderer 457/500 kB (8,6%) e CSS 420/500 kB (15,9%).
- `npx playwright test e2e/thread-view.spec.ts --repeat-each=5`: 5/5 aprovados, incluindo 10.002 rows, duas células, comandos, voz, workbench, sidebar e troca Code/Thread.
- Piloto nativo executado três vezes: 24/24 cenários aprovados sobre Codex 0.155.1 e Claude Code 2.1.274, cobrindo handshake, catálogo, modelos/esforço, usage/reset, conta subscription sanitizada, comandos locais e lifecycle da TUI sem inferência.

O gate não afirma suporte a controles de child que os providers não expõem, nem habilita providers adicionais por simples descoberta de executável. Essas indisponibilidades fazem parte do contrato publicado.
