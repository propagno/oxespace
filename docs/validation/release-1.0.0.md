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
- Itens ainda por registrar: OxeQuery, memória, aprovação de comandos, importação de MCP, /events e skills (dependem do fechamento dos portões G4, G5 e G7).

## Evidências (preencher com run, comando e SHA)
| Portão | Evidência | SHA |
|---|---|---|
| G1 build, typecheck, lint, vitest | _pendente_ | |
| G2 E2E Windows e Linux, 2 runs seguidos | _pendente_ | |
| G3 pacote Windows e Linux | run 38644678407 (cffef65) como pré-evidência; _refazer no RC_ | |
| G4 compatibilidade da memória | run 38734029908 (memory-compatibility, release/1.0.0): 4/4 células verdes, 21/21 testes no 2.6.2 sem skips | 41918c8 |
| G5 OxeQuery | _pendente_ | |
| G6 regressão visual | _pendente_ | |
| G7 segurança | _pendente_ | |
| G8 upgrade a partir de v0.17.1 | `OXESPACE_UPGRADE_FROM=v0.17.1 node scripts/test-electron.mjs tests/integration/upgrade-rehearsal.native.test.ts`: 6/6 passaram (schema 073 da tag v0.17.1 `876435c0db` para 076) | 6101ca2 |
| G10 revisão manual 960×640 e axe | axe: 6 elementos serious em 44 (ver relatório) | |
