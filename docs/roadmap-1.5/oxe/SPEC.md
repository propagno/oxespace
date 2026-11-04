---
oxe_doc: spec
status: ready
updated: 2026-11-04
inputs:
  - playground/ (PR #577 @ 718ddfcf, aprovado pelo usuário em 04/11)
  - playground/HANDOFF-1.5.md, playground/FIDELITY.md
  - docs/design/plan-1.5-ui.md (U1–U14, T58-a..k, A1–A7)
  - docs/roadmap-1.5/ccr-t71-task-places.md (#580)
  - .claude/roadmap-1.4/team/plans/1.5.0-backend-sequence.md
  - .claude/roadmap-1.4/team/reviews/1.5-redesign/round-0..5
  - .claude/roadmap-1.4/team/board-1.4.json (T57–T90)
---

# OXE — Especificação: OXESpace 1.5.0

## Objetivo

Entregar a 1.5.0 do OXESpace: o redesign aprovado no playground (direção B leve), aplicado sobre a estrutura da 1.4. Junto vêm o suporte real a quem trabalha com várias worktrees e terminais que trocam de branch, as aprovações com impacto visível, o Agora, a viagem no tempo, a barra de comando e a identidade visual nova. Inclui também a correção do pareamento do celular.

## Outcome esperado

- **Usuário principal:** quem programa com vários agentes (Claude Code, Codex) em várias worktrees ao mesmo tempo, no desktop (Windows, macOS, Linux) e com o celular pareado.
- **Resultado observável:** o app da 1.5.0 fica igual ao playground aprovado em cada tela marcada "1.5.0" no `FIDELITY.md`, sem perder nenhuma função da 1.4.
- **Medida de sucesso:** os cenários da HML no app real com passos ≤ 1.4.1, nenhum achado major aberto na homologação final e a CI da main verde.

## Contexto

- **Repositório:** propagno/oxespace (Electron + React + TS, Android em Kotlin). A main está depois da v1.4.1 (b737cfa9).
- **Tipo de demanda:** mixed (feature + redesign + bugfix).
- **Restrições técnicas obrigatórias:**
  - **Estrutura de workspaces:** adicionar e mostrar workspaces no OxeCode e no OxeChat fica **igual à 1.4**, incluindo o NewWorkspaceModal com layouts de 1 a 16 e as linhas de agentes (decisão do usuário).
  - **Protocolo do celular:** `shared/remote/protocol.ts` não muda na 1.5.0, exceto o contrato C5 já aprovado (#585). Todo PR que tocar o protocolo roda `android:generate`.
  - **Entrada do renderer ≤ 284 kB** (hoje 278 kB). Agora, histórico, barra de comando, parser e ícones são lazy, e a identidade é CSS em `data-ws`.
  - **Governança:** `design-lint` (ratchets), `fs-allowlist`, `i18n-catalog`, `mcp-coverage` e a cobertura de IPC por MCP (leitura/escrita/proibido).
  - **Migrações:** sempre o próximo número livre no momento do PR. A ordem é T85 → T72 PR1 → T64 → T75.
  - **Aprovações:** Negar vem focado, o que é irreversível exige segurar ou confirmar, e aprovar nunca pode ser feito por MCP.
- **Evitado:** inventar dados no app (todo campo vem do main), texto de terminal no read model e ação nova acessível por MCP sem nível declarado.

## Público e experiência

- **Público-alvo primário:** dev avançado, usuário diário de agentes.
- **Contexto de uso:** desktop, com o celular pareado para aprovações.
- **Padrão de experiência:** o playground aprovado, com Mandacaru 1.5 e o verde caatinga como destaque no tema escuro. Movimento só em mudança de estado, e AA nos dois temas.

## Escopo

### Dentro do escopo

- **R1** — Base Mandacaru 1.5, contrato C4:
  - tokens novos, com caatinga no tema escuro, `attn`, `k-*`, `syn-*`, `term-*`, `z-*` e motion;
  - a paleta `--ws-1..8` com `--ws-N-fg`;
  - as 22 mudanças da U4;
  - as baselines visuais refeitas uma vez só.
- **R2** — Primitivos e migrações:
  - os diálogos que faltam no contrato U1 (U5a/b/c);
  - Callout (U6), regras de Menu (U7), Settings nas páginas U2 (U8), loading estável (U9) e botões de adicionar (U10);
  - SectionLabel para os usos restantes de maiúsculas, área por área.
- **R3** — Identidade visual (T85):
  - ícones Mandacaru próprios, em módulos por ícone;
  - peso display;
  - cor por workspace, em `workspaces.color` com hash estável como padrão, levada a todo lugar.
- **R4** — Atividade dos agentes:
  - um read model com `source` (U12-be);
  - uma página única de atividade (U12);
  - o OxePost para agentes, com acesso por coleção, aprovação e auditoria (T64);
  - a lista "o que os agentes fizeram" em cada modo.
- **R5** — Worktrees e lugares por tarefa (T72, PRs 1–4, mais T79 e T73):
  - lugares por conversa e base por lugar;
  - Alterações agrupadas por lugar;
  - deriva de branch com Voltar/Seguir/Ignorar;
  - pastas de fora do repositório abertas só para leitura;
  - um resolvedor de caminho único, que substitui o T70;
  - cwd passivo por OSC;
  - branch por painel no OxeCode;
  - as abas Terminal, Containers e PR da tarefa.
- **R6** — Conversa (T58 a–k, B leve):
  - cabeçalho da conversa como tarefa, com linha "agora" (T90) e abas só do que foi usado;
  - painel de impacto;
  - ferramentas dobradas;
  - composer com chips;
  - "Enviar agora" e "Direcionar com isto" (T76);
  - shell em segundo plano (T77);
  - side chat;
  - detalhes e menu "View" (U14);
  - regras de janela curta (U13);
  - ferramentas ao lado da conversa (U11);
  - conversas lado a lado (o modelo do ThreadGrid).
- **R7** — Aprovações:
  - prévia de impacto, aprovação que vem até você (cartão ou toast) e fila;
  - segurar ou confirmar para o irreversível, com caminho sem hold;
  - Sempre permitir com a regra do provedor (T74);
  - snapshot antes de aprovar, Mongo e Postgres (T75);
  - risco crítico para o celular (T78).
- **R8** — Agora (T82): centro de controle com os 7 estados do S7.1, ações no lugar, linhas de delegação e trabalho, e aviso de fonte parcial.
- **R9** — Viagem no tempo (T83): arquivos por checkpoint, Restaurar (rewind) e Ramificar para uma worktree nova, com cartão no OxeCode e fork por provedor.
- **R10** — Barra de comando (T84): o padrão combobox completo, comandos sobre ações existentes, `/approve` só na janela e botões de reserva.
- **R11** — Modos:
  - OxeCode: laterais 1.4, cartões com painéis, divisores, presets 1–16 e dock, além de A2;
  - OxeQuery: A5 e Q-*;
  - OxePod: A3;
  - OxePost: A4, junto com o T64;
  - primeiro uso: A1, com conexão de agente real;
  - A6 e A7.
- **R12** — Correções da linha 1.4.x que entram na 1.5.0:
  - pareamento T86 (#594, #595 via #601);
  - tela de falha do banco T87 (#597);
  - T88/T89 (#602), FL-16 (#600) e os lows do T81;
  - S7.1 (#531, #441), C5 (#585, #526) e a aba Agents no celular (#521).
- **R13** — Endurecimento da release:
  - xterm 6 com os addons e o bench do terminal;
  - vite 8 só se o electron-vite suportar oficialmente;
  - homologação no app real, orçamentos (bundle, perf e memória), axe e notas de versão.

### Fora do escopo (não objetivos)

- A B completa: uma entidade Tarefa com várias conversas e agentes, que exige mudar o protocolo. Fica para depois da 1.5.0.
- Agrupar por cor de workspace no celular (precisa de campos C5). Vai para a 1.5.x.
- Voz nativa no macOS.
- Wrapper de prompt opt-in para shells que só fazem `cd`. Vai para a 1.5.x.

## Critérios de aceite

| ID | Critério | Como verificar |
|----|----------|----------------|
| A1 | Os tokens do Mandacaru 1.5 estão em `src/design`: caatinga no tema escuro, attn, k-*, syn-*, term-*, z-*, ws-1..8 e ws-N-fg, com AA ≥ 4.5:1 para o texto de chip em todo estado de linha nos dois temas. | teste de contraste em `tests/design-tokens*.test.ts`; `design-lint` |
| A2 | Todo estado selecionado lê `var(--fill-selected)`, e o ratchet da U4 cai de 44 para ≤ 22. | `design-lint` (ratchet) |
| A3 | As baselines visuais foram refeitas uma vez na main, depois do C4, e o verify passa nas duas plataformas. | `visual-baselines.yml` linux + windows |
| A4 | Todos os diálogos usam `ui/Dialog` com `size`. O ratchet de `className` no Dialog fica em 0 para os diálogos migrados (U5a/b/c). | `design-lint`; testes de unidade do Dialog |
| A5 | O Callout (info/warning/danger) existe e é usado em Contas, Ambientes, falha de login no OxeChat e Policy. | unit + e2e de smoke |
| A6 | Os menus seguem a U7: largura 200–320, grupos em sentence case, destrutivo por último e divisão acima de 12 itens. | `design-lint` regra de menu + unit |
| A7 | As páginas de Settings usam SettingRow/Section (U8): aplicam na hora, com toast de desfazer nos itens da lista de risco e confirmação no que é irreversível. | `tests/settings-*.test.tsx`; e2e de settings |
| A8 | A cor do workspace fica em `workspaces.color` (1–8, nula = hash estável) via `workspace:update-settings`, é editável no menu do workspace e aparece em cartões, cabeçalhos de painel, cabeçalho da conversa, Agora e barra de status. | integração da migração + unit do renderer + e2e |
| A9 | Os ícones próprios são módulos por ícone, e a entrada do renderer fica ≤ 284 kB. | `verify:bundle` (orçamento) |
| A10 | O read model de atividade expõe `source` (changes/databases/containers/post) com paginação e filtros no servidor, e o renderer nunca junta listas. | unit + integração do serviço |
| A11 | Settings › Atividade dos agentes lista todas as fontes com as mesmas colunas, filtros e modal de detalhe (T63). | e2e `agent-activity*.spec` |
| A12 | O OxePost para agentes tem ferramenta MCP, acesso por coleção, aprovação para escrita e tabela de auditoria. Os segredos aparecem como •••• (NAME). | integração + e2e; revisão SECURITY |
| A13 | Uma conversa registra os lugares (checkout, worktree, pasta de fora) a partir das evidências das ferramentas, com base por lugar capturada no primeiro toque (até 32 lugares + 16 pastas de fora). | integração `thread-places*.test.ts` |
| A14 | Alterações agrupa por lugar, cada um contra a própria base. Uma troca de branch feita por um terminal não muda a diff da tarefa. | integração + e2e `task-changes-places.spec` |
| A15 | A deriva de branch emite um evento com "provavelmente o seu terminal X". Voltar é recusado em árvore suja ou HEAD destacado; Seguir move a base; Ignorar separa a lista. Todos pedem confirmação com Cancelar focado. | integração + e2e `branch-drift.spec` |
| A16 | O resolvedor único resolve na ordem: absoluto → cwd do turno → checkoutRoot → worktree da tarefa → raiz do projeto → outros lugares → worktrees irmãs. Responde found, ambiguous (pergunta) ou missing (com onde procurou). | unit do resolvedor |
| A17 | Um arquivo de fora do repositório abre só para leitura, em aba própria, e só quando é um lugar vindo de evidência. Não há salvar, renomear nem "Abrir no editor"; `thread:place-read` é proibido ao MCP. | integração + e2e; revisão SECURITY |
| A18 | O OxeCode mostra a branch de cada painel e avisa "trocou de X" quando ela muda (T73). O cwd passivo por OSC 7/633/9;9/1337 coloca o terminal na aba Terminal da tarefa (T79). | unit + e2e |
| A19 | O cabeçalho da conversa mostra projeto, branch, agente, modelo, acesso, custo, tempo e a linha "agora" (campo `activity` T90, só para conversas). As abas aparecem só para as ferramentas usadas. | unit + e2e `conversation-header.spec` |
| A20 | As chamadas de ferramenta dobram numa linha por grupo, com barra de 3 px por tipo; o horário aparece no hover. | e2e + baseline visual |
| A21 | O composer mostra os chips de modelo real, esforço e permissões, sem saúde do MCP. Há "Direcionar com isto" e "Enviar agora" (T76), com o texto do direcionamento vindo de `canSteer`. | unit + e2e |
| A22 | O shell em segundo plano mostra rodando/parado e as últimas linhas, ou "estado desconhecido desde…" quando o sinal se perde, nunca "rodando" para sempre (T77). | integração com fixtures de sinal de parada |
| A23 | As ferramentas abrem ao lado da conversa (≥ 320 px, redimensionáveis, maximizáveis). Duas conversas lado a lado ficam em células fixas, e o ✕ fecha o lado certo. | e2e `chat-split.spec`, `chat-tools.spec` |
| A24 | Um pedido de aprovação chega como cartão na conversa em foco e como toast em qualquer outro lugar. Negar e aprovar levam ≤ 2 passos. | e2e `approvals-anywhere.spec` (contagem de passos) |
| A25 | A prévia de impacto mostra onde roda, linhas antes e depois (amostra), se dá para desfazer e o SQL ou a diff. O irreversível exige segurar 1,2 s ou caixa de confirmação; Negar vem focado e não há Desfazer. | unit + e2e |
| A26 | "Sempre permitir" grava só a regra do provedor (Claude: regra de permissão do projeto; Codex: só a sessão), nunca é oferecido para comandos destrutivos ou de rede e aparece revogável em Settings. | integração + revisão SECURITY |
| A27 | O snapshot antes de aprovar copia as linhas afetadas para um armazenamento local criptografado (até 10 mil linhas / 32 MiB) e restaura pelos Checkpoints. A prévia do Postgres usa `UPDATE … RETURNING` com rollback; Mongo usa o filtro. A prévia fica desligada em produção por padrão. | integração com Postgres/Mongo de teste; revisão SECURITY |
| A28 | Uma aprovação irreversível vai como `risk: 'critical'` para o celular, que aplica o mesmo atraso (T78). | unit do gateway |
| A29 | O Agora (Ctrl+Shift+G) mostra primeiro o que precisa de você, depois as linhas por workspace com os 7 estados do S7.1 nas palavras do celular, mais delegação, trabalho e aviso de fonte parcial. ↑↓/J/K movem entre cartões; A e D agem no cartão em foco; um cartão de pergunta leva ao Responder. O Agora só monta quando está aberto. | unit + e2e `agora.spec`; perf com 60 agentes |
| A30 | A viagem no tempo (Ctrl+H) mostra arquivos por checkpoint e "só a conversa" entre checkpoints. Restaurar = rewind. Ramificar cria uma worktree a partir do commit do checkpoint, com as pré-imagens, registra uma worktree própria, cria e seleciona o cartão do workspace e faz o fork do provedor. O aviso "não dá para voltar, pelo menos" aparece sempre. | integração + e2e `time-travel.spec`; revisão SECURITY leve |
| A31 | A barra de comando (Ctrl+K) passa no axe com o padrão combobox e anuncia "N resultados". Todo comando mapeia para uma ação IPC existente e tem botão de reserva; `/approve` só funciona na janela e Enter abre a prévia. | unit + axe + teste de contrato de IPC |
| A32 | As laterais do OxeCode e do OxeChat e o NewWorkspaceModal são idênticos à 1.4.1 (layouts 1–16, agentes, textos, Abrir workspace existente). "Novo terminal em <worktree>" vai para o cartão daquela worktree. | e2e de fidelidade contra a 1.4.1 (HML) |
| A33 | A divisão do OxeCode (linhas e colunas, arrastar, menu do divisor, presets 2×5/2×7, regras de espaço), Foco com abas que mantém os painéis montados, maximizar e o dock redimensionável funcionam em 1440 e 900. | e2e `oxecode-layout.spec` |
| A34 | Os modos OxeQuery, OxePod e OxePost (A3/A4/A5) e o primeiro uso (A1) seguem o playground, e o primeiro uso exige um agente pronto antes da primeira conversa. | e2e por modo + baselines |
| A35 | Pareamento: o "Parear este celular?" aparece em qualquer tela; o reload mostra o pedido pendente; as falhas, incluindo `no-contact`, aparecem em Dispositivos; o perfil de rede Pública é avisado; o celular mostra "Conectando…" antes do POST. | e2e `remote-pairing-anywhere.spec`; testes Android; checagem no AVD |
| A36 | Uma falha ao abrir o banco mostra uma tela bloqueante (abrir a pasta de backups, copiar detalhes, sair), sem handlers pela metade. | e2e com banco em `user_version` futuro |
| A37 | xterm 6 com headless e todos os addons, e o bench do terminal dentro do orçamento. O vite 8 só entra se o electron-vite o suportar oficialmente; caso contrário, fica registrado como adiado. | `bench:terminal`; `verify:bundle` |
| A38 | Homologação final no app empacotado: os 6 cenários da HML e os 3 da rodada 4 com passos ≤ 1.4.1, nenhum major aberto e axe limpo nas telas novas. | relatório HML `docs/validation/homologacao-1.5.md`; sign-off do usuário |
| A39 | **Condições de corte da release.** Todas precisam valer ao mesmo tempo:<br>• trem vazio e um run **concluído** da CI da main verde no commit exato da tag;<br>• nenhum flake com 2 falhas nos últimos 3 runs da main;<br>• baselines refeitas depois do último PR de UI;<br>• PR de versão (package.json/lock + `1.5.0.md` en/pt-BR) passando pelo trem;<br>• toda string de UI citada nas notas conferida em `shared/locales`;<br>• revisões SECURITY de F5-T5/T6 e F6-T3 registradas nos PRs;<br>• seção de limites conhecidos escrita a partir dos achados da HML no app empacotado. | `runtime ci --attach`; checklist do coordenador em `docs/releases/1.5.0.md` |
| A40 | **Atualização e volta no app empacotado.**<br>• Partindo da 1.4.1 com dados, a atualização automática (latest.yml) leva à 1.5.0, roda todas as migrações da 1.5.0 e cria o backup vNN sem perder dados.<br>• Voltar à 1.4.1 mostra a tela T87, nunca um app vazio.<br>• O `candidate_version` do `install-over.yml` está em 1.5.0. | HML no app empacotado; `install-over.yml` |
| A41 | **Compatibilidade do celular** (o C5 muda o protocolo).<br>• APK 1.4.1 com desktop 1.5.0, e APK 1.5.0 com desktop 1.4.1: cada par recusa de forma limpa ou continua funcionando.<br>• Pareamento com celular real numa rede real, incluindo o perfil Público.<br>• O run `android-release` fica verde, com sha256 e digest do apksigner conferidos contra as notas. | HML + MOBILE com o celular do usuário; coordenador |

## Setup externo e pré-condições

- **Node:** as dependências pedem `^22.22.2 || ^24.15`, e a máquina tem 22.17.1 (OXB). É preciso atualizar o Node antes de qualquer execução local, ou usar `project_env_check: warn` com dono.
- **Postgres/Mongo de teste** para o T75: o CI já tem os jobs de testes ao vivo do OxeQuery.
- **AVD** para o celular: o emulador precisa de ≥ 4 GB livres.
- **Execução pelo OXE (claude -p):** é paga. Só com orçamento aprovado pelo usuário, por fase.

## Conteúdo e fluxos obrigatórios

- **Estados obrigatórios** em toda tela nova: loading, empty, error e success. Toda ação tem caminho por teclado; tema claro e escuro; 1440 e 900.
- **Exemplos concretos:** os do playground (Cajuí Pagamentos) viram fixtures dos e2e onde fizer sentido.

## Entradas visuais e interpretação

- **Status:** ready.
- **Artefato visual:** `playground/` (#577), executável com `npm run dev` (porta 5199).
- **Fonte de verdade por tela:** `FIDELITY.md` (o que é 1.5.0 e o que fica para depois) e `HANDOFF-1.5.md` (primitivos, tokens e onda de dependência).
