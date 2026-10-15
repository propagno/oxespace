# OXESpace 1.0.0 — notas e evidências (rascunho do coordenador)

Atualizado em 2026-10-14. **Não publicado.** Este arquivo só passa a "pronto" quando cada linha de evidência abaixo apontar para um run, comando e SHA reais. Plano e portões: [COORDINATION.md](../plans/release-1.0/COORDINATION.md).

## O que muda para quem usa

**Novo visual (marca Mandacaru).** Modo claro e escuro de verdade, tokens de design, componentes compartilhados em todos os modos (Code, Thread e OxeQuery), interface inteira em inglês, confirmações com consequência dita, diálogos e painéis com Escape, foco preso e retorno de foco, rolagem e controles nativos que seguem o tema.

**Navegação.** O Team abre pelo botão da barra de título, pela paleta de comandos e pelo Tools hub, e diz por que está indisponível. A paleta e o hub usam o mesmo catálogo de ferramentas. Cabeçalho do Thread com Terminal, Changes e Browser e um menu "More actions". Painel lateral com abas que cabem em uma linha e menu "More panels". Selo no trilho de modos para o que precisa de você ou falhou, e um ponto calmo quando agentes estão trabalhando.

**Acessibilidade.** Árvores de arquivos com teclado e semântica ARIA, menu Tools com papel de menu, linha de conversa como região. Varredura com axe registrada em [a11y-axe-2026-10-14.md](a11y-axe-2026-10-14.md).

**Banco de dados.** Corrige um defeito presente nas versões 0.15.0 a 0.17.1: o banco alternava a versão do esquema a cada abertura (73 para 57 para 73), rotacionava os backups e, a cada dois lançamentos, devolvia o tema escolhido por workspace para `midnight`. A correção também evita que bancos que uma versão antiga deixou em 57 percam o tema mais uma vez no primeiro lançamento da 1.0. Ensaios de upgrade a partir de v0.16.0 e v0.17.1.

## Limites conhecidos (a declarar nas notas públicas)
- `mcp-sync` grava `env` e `headers` de servidores MCP em texto puro no `.mcp.json` de cada projeto.
- Os ensaios visuais por pixel são locais no Windows; não há baselines Linux nesta versão (a menos que o job de baselines Linux seja entregue).
- Limites de aprovação, /events, importação MCP e skills estão em docs/releases/1.0.0.md. Pendentes de registro: OxeQuery (G5) e memória (G4).

## Evidências (preencher com run, comando e SHA)
| Portão | Evidência | SHA |
|---|---|---|
| G1 build, typecheck, lint, vitest | runs 38788636623 e 38792967900: unit/integração, cobertura OxeQuery e build verdes em Windows e Linux; typecheck e lint locais limpos | 801c9c0 |
| G2 E2E Windows e Linux, 2 runs seguidos | runs 38788636623 e 38792967900 (workflow_dispatch, packaged_smoke_only): E2E smoke verde em Windows e Linux nos dois. Histórico: run 38784025503 (5c3c111) também verde; o `documentation-preview` intermitente no Linux era uma corrida do teste, corrigida em 35ec31b | 801c9c0 |
| G3 pacote Windows e Linux | runs 38788636623 e 38792967900: instalador e E2E do pacote verdes em Windows e Linux (aprovação `shellCheck` com `bash-grammar`; flag da memória desligada no binário real); job de publicação ignorado nesses runs | 801c9c0 |
| G4 compatibilidade da memória | run 38780310630 (memory-compatibility, release/1.0.0): 4/4 células verdes (Windows e Linux x 2.1.0 e 2.6.2), 21/21 testes no 2.6.2 sem skips. A memória segue desligada por padrão no build | 869ae0a |
| G5 OxeQuery | `oxequery-live` (podman, PG/Mongo/SSH/TLS) e `oxequery-live-versions` (PG e Mongo mais antigos e mais novos) verdes nos dois runs finais; E2E de OxeQuery verdes; axe sem achados nas telas varridas. Limite: o axe usa IPC simulado (vê estados vazios) e não houve revisão manual com dados reais | 801c9c0 |
| G6 regressão visual | **Limite declarado:** baselines win32 não foram regeradas no SHA final; a máquina de trabalho ficou sem memória (build local morto duas vezes pelo sistema). Os baselines anteriores seguem como estavam; não há baselines Linux | |
| G7 segurança | revisão `docs/validation/thread-command-approval-security-review.md`; `shellCheck` com parser `bash-grammar` provado no pacote Windows e Linux (run 38747710417). Pendente: revisão manual do cartão de aprovação com provedor real (usuário); se não ocorrer, fica como limite conhecido | 35ec31b |
| G8 upgrade a partir de v0.17.1 | `OXESPACE_UPGRADE_FROM=v0.17.1 node scripts/test-electron.mjs tests/integration/upgrade-rehearsal.native.test.ts`: 6/6; `migrations`, `db-replay`, `db-reopen`: 39/39 | 801c9c0 |
| G10 revisão manual 960×640 e axe | axe no CI (workflow `a11y-axe`, run 38784281844): 4 testes, 0 violações críticas ou sérias em 27 telas nos dois temas, Settings nos dois escopos. Revisão manual com dados reais não feita (limite) | 81ae6c4 |
