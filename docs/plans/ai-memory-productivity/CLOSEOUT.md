---
oxe_doc: plan
status: in_progress
updated: 2026-10-14
inputs:
  - PLAN.md
  - VALIDATION.md
---

# Plano de fechamento dos bloqueios da memória (rumo à 1.0)

Objetivo: levar a integração ai-memory de "opt-in experimental" a "estável", fechando os bloqueios identificados em 2026-10-14. Reaproveita as tarefas T07–T16 do [PLAN](PLAN.md); aqui só se define **ordem, atalhos e critérios de saída**. Nenhuma publicação ou tag faz parte deste plano.

## Restrições herdadas
- Docker só com autorização explícita do usuário (já causou travamentos); usar 1 CPU / 1 GiB quando autorizado e desligar ao final.
- Testes de DB/nativos: `npm run test:electron`, nunca `npm test`. Binário 2.6.2 verificado por checksum em `OXESPACE_AI_MEMORY_V26_TEST_BINARY`.
- Dados sintéticos apenas; sem migrar a memória pessoal. Commitar somente hunks próprios (árvore compartilhada com outras sessões).
- Skip nunca conta como evidência.

## Trilhas e ordem

### Trilha A — Fechar o gate de captura (T07 / V07) — bloqueio 2
1. Piloto autenticado na janela Electron (Windows): Thread Codex e Thread Claude, 2 turnos, interrupção, reinício do app, retomada por ID nativo; conferir observações no SQLite sintético. Saída: relatório em `docs/validation/ai-memory-productivity/wave-3.md` (seção piloto) com screenshots ≤ 6.
2. Paridade Code (hooks nativos) × Thread: provar ausência de dupla captura por sessão.
3. Certificação Linux da revisão atual (requer autorização de Docker): contratos 2.6.2 + outbox + campanha sem provedores autenticados; provedores Linux ficam "pendente" se sem credencial.
4. Atualizar a matriz Code/Thread × Claude/Codex × SO (aprovada/falha/pendente por célula).
**Saída:** T07 `done`, H2 `validated`.

### Trilha B — CI como gate (bloqueio 4, parte de T16) — pode rodar em paralelo à A
1. Empurrar a workflow `Memory compatibility` num branch e rodar as 4 células (Win/Linux × 2.1.0/2.6.2); corrigir o que falhar.
2. Torná-la obrigatória na release (`ci.yml`), com falha sem binário e sem skips nativos.
**Saída:** workflow verde no GitHub, citada nas notas de release.

### Trilha C — Observabilidade (T12) — bloqueio 5
1. Expor no painel: pendentes, idade da mais antiga, quarentena, última entrega, última consolidação ("desconhecido" quando não observável).
2. Polling só com painel visível, ≤ 1 chamada/10 s sem sobreposição; exportar diagnóstico sanitizado; logs ≤ 10 MiB.
3. Testes: fila atrasada, auth falha, consolidação ausente, operação interrompida. (V10 parcial)
**Saída:** usuário distingue enfileirado × entregue × persistido × consolidado.

### Trilha D — Funcionalidade de retomada (T08–T11) — bloqueio 1
Ordem estrita: T08 (contexto com proveniência) → T09 (remember idempotente/substituição) → T10 (handoff por ID exato) → T11 (UI de retomada). Cada uma com seu teste V08/V09; T11 com Playwright (teclado, zoom 200%, 800 px, loading/vazio/erro).
**Saída:** V08, V09, V10 aprovados.

### Trilha E — Higiene e escopo (T13, T14)
- T13 (medição de disco/manutenção com prévia e backup): pode ser reduzida a **inventário somente leitura + export**; sem ações destrutivas na 1.0.
- T14 (perfil entre projetos): **adiar explicitamente**; permanece desligado (o PLAN permite). A10 fica parcial e documentado.

### Trilha F — Prova de valor e entrega (T15, T16) — bloqueios 3 e 6
1. Harness do benchmark pareado: 12 cenários × 3 pares, ordem alternada, controle = revisão base 588d6f4 + runtime 2.1.0; publicar valores brutos, dispersão e falhas. Metas: ≥ 25% menos tempo de retomada, ≥ 30% menos repetição.
2. Carga sintética 2 h (4 sessões, rajadas, memória indisponível 60 s a cada 10 min) + piloto humano de 1 dia.
3. Pacote instalado Win/Linux: instalação limpa, upgrade 2.1.0→2.6.2, rollback, smoke Code/Thread.
4. Documentar limites que permanecem (Windows experimental upstream, sem WSL/SSH, token em arquivo, busca lexical, Codex sem resposta final nativa, sem reset de memória) em `docs/PROJECT_MEMORY.md` e nas notas.
**Saída:** V12 e V14 aprovados ou, se a meta não for batida, a feature segue com rótulo beta e flags experimentais (decisão do usuário).

## Andamento (2026-10-14)
- **B:** concluída (gate no release; 4 células verdes em run 38601799574).
- **C:** concluída localmente (T12: pipeline, idade da fila, última entrega, diagnóstico exportável).
- **A:** campanha autenticada Claude+Codex aprovada no Windows pelos adaptadores reais; pendentes o piloto dentro da janela do Electron e Linux com provedores autenticados. Linux sem autenticação coberto pela workflow de compatibilidade.
- **M1 (beta opt-in):** liberado com rótulo Beta e limites em docs/PROJECT_MEMORY.md; D–F seguem para o rótulo estável.

## Cronograma sugerido (dependências)
`A ∥ B` → `C` → `D (T08→T11)` → `E` → `F`. A e B desbloqueiam a decisão "1.0 com memória beta" já ao fim de A+B+C; D–F são necessários só para rotular como estável.

## Marcos de decisão
| Marco | Critério | Decisão |
|---|---|---|
| M1 | A + B + C verdes | Pode entrar na 1.0 como **beta opt-in** com limites documentados |
| M2 | D + E (reduzido) verdes | Retomada/handoff utilizáveis; ainda beta |
| M3 | F verde (V12 metas, V14) | Remover rótulo beta (estável) |

## Verificação por trilha
- `npm run typecheck` · `npm run lint` · `npm run test:electron -- tests/unit/memory.test.ts tests/integration/memory-*.test.ts`
- `node scripts/test-memory-compatibility.mjs --binary <ai-memory> --version 2.6.2 --sha256 <hash>`
- Campanha: `OXESPACE_NATIVE_PROVIDERS=codex,claude node scripts/test-electron.mjs tests/integration/memory-thread.native.test.ts --maxWorkers=1`
- `npm run build` (inclui `verify:bundle`) e `npm run test:e2e` para a UI.

## Riscos
- Autenticação indisponível (Claude já falhou antes) → célula permanece pendente; não declarar M1 sem ao menos Codex+Claude no Windows.
- Meta de produtividade pode não ser atingida → manter beta; não reduzir metas retroativamente.
- Dependência de projeto upstream (akitaonrails/ai-memory) → pin 2.6.2 com checksum; revisar a cada upgrade.
