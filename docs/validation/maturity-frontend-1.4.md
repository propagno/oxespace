# Maturidade do frontend · OXESpace 1.4

Avaliação independente, só de leitura, do renderer (`src/`), das primitivas (`src/ui/`), dos tokens (`src/design/`) e do
preload no que a interface consome. `electron/main` e `mobile/` ficam com outras avaliações. Quando um achado cruza a
fronteira com o main, isso está dito, com o item do BACKEND quando o coordenador já criou um.

- **SHA avaliado:** `origin/main` `bab99b505c2f0296582aff583571311567771aff` (merge do #237, 30/10/2026). Todas as
  linhas citadas são desse SHA.
- **Método:** leitura de código, `git` e `gh` (só leitura). Nada foi compilado nem executado: build, testes, e2e,
  Electron e benchmarks ficaram de fora por regra. O que só se prova rodando está marcado como **Não verificável aqui**,
  com o job ou o comando que provaria.
- **Etapas:** a etapa 1 trouxe as Fases 1 e 2 e o scorecard preliminar. Esta versão (etapa 2) acrescenta a análise
  componente a componente (Fase 3), a transversal (Fase 4), o roadmap e o mapeamento dos achados feito pelo coordenador.
- **Referências já lidas e não repetidas:** `docs/ARCHITECTURE.md`, `docs/roadmap-1.4/*` (F*, B*, M*, C1–C7),
  `docs/validation/redesign-audit-1.4.md` (PR #228, ainda em rascunho; lido do branch `docs/redesign-audit-1.4`),
  `wcag-2.2.md`, `offer-audit-1.4.md`, `screen-reader-1.4.md`, `mcp-coverage-1.4.md`, `docs/SECURITY_MODEL.md`.

## 1. Resumo executivo

Nota geral: **2,9 de 5 (Definido)**. O frontend tem processo e catracas acima da média para o tamanho do app, e as
primitivas de `src/ui` são boas (nota 4). O que puxa a nota para baixo são os fluxos sensíveis, que ainda dependem de
telas que escondem o que vai rodar, e a falta de rastro quando a interface quebra.

Forças:
1. Orçamentos de bundle e de boot verificados na CI com folga mínima de 5% (`scripts/verify-bundle-budgets.mjs:24-31`),
   e modos inteiros carregados sob demanda (`src/components/Navigation/ModeViews.tsx:7-13`).
2. Catracas que só descem (tamanho de arquivo, `!important`, keyframes, vazios e alertas feitos à mão) e axe com
   `wcag22aa` em toda PR, em Linux e Windows (`tests/design-lint.test.ts:72-122`, `docs/validation/wcag-2.2.md`).
3. Confirmações destrutivas bem feitas onde já usam a primitiva: o foco começa no botão seguro, e o main também barra a
   ação (OxePod, SQL de produção com nome digitado, Settings com Ficar/Descartar/Salvar).

Riscos:
1. Decisões sensíveis às cegas: aprovação de agente (Já mapeado: #228 P1-0 a P1-8, Em PR #243/#238), escrita Mongo em
   produção com um clique (FE-M-09, **Alta**, B15) e confirmação de SQL que não mostra o comando (FE-M-12).
2. Nenhum link externo vindo de conteúdo de agente passa por confirmação, e o texto do link esconde o destino (FE-M-02,
   F24). Os links do terminal, pela leitura do código, nem abrem (FE-M-08).
3. Falhas invisíveis: um crash de React no build empacotado não deixa rastro (FE-M-01), e fechar a janela com edições não
   salvas no editor não pergunta nada (FE-M-10).

## 2. Stack detectada

Versões resolvidas no `package-lock.json` do SHA avaliado:

| Peça | Versão | Observação |
|---|---|---|
| React / React DOM | 19.3.1 | `use()` já é usado para catálogos lazy (`src/i18n/index.ts:46-60`) |
| TypeScript | 5.9.3 | `strict: true`, sem `allowJs` (`tsconfig.json`) |
| Zustand | 5.0.16 | 38 stores em `src/store/`, `persist` só para preferências e listas de ids |
| Vite / electron-vite | 6.4.4 / 5.0.0 | CSP de produção injetada no build (`electron.vite.config.ts:212-239`) |
| Electron | 44.9.3 | `contextIsolation` e `sandbox` ligados (`electron/main/index.ts:761-766`) |
| Radix | `radix-ui` 1.8.1 | proibido fora de `src/ui` por lint (`eslint.config.js`, `no-restricted-imports`) |
| cmdk | 1.1.1 | paleta de comandos |
| i18next / react-i18next | 26.5.11 / 17.1.9 | en e pt-BR; catálogos por chunk, namespaces lazy `oxequery`, `pods`, `post` |
| xterm / Monaco | 5.5.0 / 0.57.0 | `@xterm/addon-web-links` 0.11.0 com o handler padrão |
| Estilo | CSS global em camadas + 29 CSS Modules | cerca de 19 mil linhas de CSS. Não há Tailwind no lockfile deste SHA: o bootstrap Tailwind/shadcn do Orca não chegou à `main` |
| Testes | Vitest 5.0.5 (jsdom), Testing Library, Playwright 1.64.1, `@axe-core/playwright` 4.14 | 215 arquivos em `tests/`, 85 specs em `e2e/` |
| Lint | ESLint 10, `typescript-eslint` 8, `eslint-plugin-react-hooks` 7 | regras do React Compiler só como aviso (`eslint.config.js:22-26`, "165 lugares") |

## 3. Fase 1 · Reconhecimento

**Estrutura.** `src/App.tsx` (1118 linhas) monta o shell, o seletor de modo e quase todos os modais. Os modos são
`code` (OxeCode), `thread` (OxeChat), `data` (OxeQuery), `pods` (OxePod) e `post` (OxePost). Os três últimos montam na
primeira visita e depois ficam montados, escondidos (`ModeViews.tsx:29-42`), o que preserva conexões e rascunhos entre
trocas. Settings, a paleta, o MCP, Skills, Linear e o painel semântico são lazy (`App.tsx:25-79`).

**Volume.** 227 componentes `.tsx` e 185 módulos `.ts` em `src/`, cerca de 47,7 mil linhas. As maiores telas estão
congeladas pela catraca de 1000 linhas: `GitHubPanel.tsx` (1800), `SettingsModal.tsx` (1396), `SkillsBrowser.tsx`
(1391) e `App.tsx` (1120) (`scripts/file-size-baseline.json`).

**Design system.** Os tokens em `src/design/tokens/` (`palette`, `semantic`, `scales`, `color`, `css`) geram
`src/styles/tokens.generated.css`. `docs/design/brand.md` e `motion.md` documentam marca e movimento. `src/ui/index.ts`
exporta: Button, IconButton, ButtonGroup, TextField, TextArea, Select, Checkbox, Switch, SegmentedControl, Kbd,
FieldError, ConfirmDialog, Dialog, Popover, Menu, AnchoredMenu, Tooltip, Badge, StatusDot, Panel, Toolbar, EmptyState,
ErrorState, SuccessState, OfflineState, Notice, LoadingState, Skeleton, Spinner, Separator, Tabs, Meter, Avatar,
BrandLoader, Toast, TitleTooltips, ToolPanel e Splitter, além de `useModalSurface` e `copyText`. O catálogo vivo é
`src/components/DesignSystem/DesignSystemPage.tsx`.

**Catracas de design** (`tests/design-lint.test.ts`): `!important` ≤ 59 (linha 74), spinners feitos à mão = 0 (94),
três keyframes (96), classes `-empty` ≤ 2 (107), `role="alert"` fora das primitivas ≤ 11 (110), durações fixas = 0 nos
CSS Modules (116). O aceite da F1 pede `-empty` = 0 e `role="alert"` = 0 (Já mapeado: F1).
`tests/a11y-static.test.ts` cobre outline de foco e spinners sem rótulo, e não há nenhum `div`/`span` clicável sem papel
nem teclado em `src/` (grep por `<(div|span|li|td|tr)[^>]*onClick=` sem `role=`/`onKeyDown`: zero).

**Testes e CI.** `ci.yml` roda, em Windows e Linux: auditoria de dependências, typecheck, lint (inclui a catraca de
tamanho), Vitest com cobertura, build com orçamentos, ensaio de upgrade, gate de cobertura do OxeQuery, e2e smoke, gate
de performance e2e e o pacote instalado. `a11y-axe.yml` roda axe por PR; `visual-regression.yml` e
`visual-baselines.yml` cuidam do visual por lote. A cobertura mínima é 35% de linhas e 25% de ramos, medida sobre
`src`, `electron/main` e `shared` juntos (`vitest.config.ts:17-19`). Não há número próprio do renderer.

**i18n.** O catálogo da interface vive em `src/i18n/locales/*.ts` e `shared/locales/*/*.json`. `tests/ui-copy.test.ts`
mantém a lista `MIGRATED` (31 arquivos de `src/`), que não pode ter texto fixo; o resto está na F6 (Já mapeado: F6,
#197). Datas e números saem pelo idioma da interface, não pelo da máquina (`src/utils/formatTime.ts:4-14`).

## 4. Fase 2 · Inventário de componentes

O inventário foi gerado por script sobre o SHA avaliado, não à mão: cada `.tsx` de `src/` classificado pelo caminho e
pelo conteúdo.

- **Tipo:** Primitiva = `src/ui/`; Página/modo = `*View`, `*Page`, `*Mode` e `App.tsx`; Modal/diálogo = usa `Dialog`,
  `ConfirmDialog`, `ModalSurface`, `useModalSurface` ou `role="dialog"`; Layout = navegação, grade, painéis, sidebar,
  workbench; Container = lê store ou chama a API do preload; Apresentacional = o resto.
- **Estados:** C carregando, V vazio, E erro, O offline, S sucesso (toast ou SuccessState), detectados pelo uso das
  primitivas ou de flags de carregamento. É indício, não prova de que o estado aparece na tela.
- **A11y:** número de atributos `aria-*` e `role=` no arquivo (densidade, não qualidade).
- **Testes:** arquivos de `tests/` e `e2e/` que citam o nome do componente.
- **i18n:** se o arquivo traduz (`useTranslation`, `t(`, `i18n.t(`); "literais" conta textos em inglês entre tags.
- **Nota:** dada na Fase 3 (seção 5) aos componentes obrigatórios e à amostra.

Totais: 227 componentes, sendo 12 primitivas, 8 páginas/modos, 52 modais e diálogos, 21 de layout, 70 containers e 64
apresentacionais. 78 não são citados por nenhum teste. 61 não traduzem, e 20 deles têm texto em inglês na marcação.

| Modo | Primitiva | Página/modo | Modal | Layout | Container | Apresentacional |
|---|---:|---:|---:|---:|---:|---:|
| Shell | — | 1 | 1 | 6 | 1 | 6 |
| Design system | 12 | 1 | — | — | 1 | 2 |
| Paleta e comandos | — | — | 1 | — | 1 | — |
| OxeCode | — | 1 | 18 | 9 | 33 | 16 |
| OxeChat | — | 1 | 9 | 1 | 21 | 26 |
| OxeQuery | — | 2 | 13 | 3 | 1 | 8 |
| OxePod | — | 1 | 3 | 1 | 2 | — |
| OxePost | — | 1 | 2 | 1 | 2 | — |
| Settings | — | — | 2 | — | 5 | 1 |
| Ajuda | — | — | 3 | — | 3 | 5 |

<details>
<summary>Inventário completo (227 componentes)</summary>

#### Shell (15)

| Componente | Tipo | Caminho | LOC | Estados | A11y | Testes | i18n |
|---|---|---|---:|---|---:|---:|---|
| ErrorBoundary | Apresentacional | `src/components/common/ErrorBoundary.tsx` | 53 | E | 0 | 3 | sim |
| ViewportTooltip | Apresentacional | `src/components/common/ViewportTooltip.tsx` | 145 | — | 3 | 1 | não |
| ActivityDot | Apresentacional | `src/components/Indicators/ActivityDot.tsx` | 40 | — | 1 | 0 | não |
| VoiceHud | Apresentacional | `src/components/Voice/VoiceHud.tsx` | 38 | C | 6 | 1 | não |
| RichText | Apresentacional | `src/i18n/RichText.tsx` | 10 | — | 0 | 1 | não |
| main | Apresentacional | `src/main.tsx` | 44 | — | 0 | 413 | não |
| ActivityCenter | Container | `src/components/Activity/ActivityCenter.tsx` | 86 | V | 6 | 1 | **não (1 literais)** |
| AppMenuBar | Layout | `src/components/Navigation/AppMenuBar.tsx` | 44 | — | 4 | 1 | sim |
| DetailList | Layout | `src/components/Navigation/DetailList.tsx` | 7 | — | 0 | 1 | não |
| ModeSwitch | Layout | `src/components/Navigation/ModeSwitch.tsx` | 47 | — | 8 | 1 | sim |
| ModeViews | Layout | `src/components/Navigation/ModeViews.tsx` | 67 | C | 2 | 0 | sim |
| NavigationChrome | Layout | `src/components/Navigation/NavigationChrome.tsx` | 92 | — | 15 | 1 | sim |
| SearchField | Layout | `src/components/Navigation/SearchField.tsx` | 15 | — | 4 | 0 | sim |
| UsageModal | Modal/diálogo | `src/components/Usage/UsageModal.tsx` | 120 | C | 2 | 0 | **não (2 literais)** |
| App | Página/modo | `src/App.tsx` | 1118 | CS | 8 | 168 | **não (9 literais)** |

#### Design system (16)

| Componente | Tipo | Caminho | LOC | Estados | A11y | Testes | i18n |
|---|---|---|---:|---|---:|---:|---|
| GithubIcon | Apresentacional | `src/components/Brand/GithubIcon.tsx` | 18 | — | 0 | 0 | não |
| OxeLogo | Apresentacional | `src/components/Brand/OxeLogo.tsx` | 48 | — | 3 | 1 | **não (1 literais)** |
| ThemeProvider | Container | `src/components/Theme/ThemeProvider.tsx` | 64 | — | 0 | 2 | não |
| DesignSystemPage | Página/modo | `src/components/DesignSystem/DesignSystemPage.tsx` | 198 | CVEOS | 5 | 0 | **não (17 literais)** |
| BrandLoader | Primitiva | `src/ui/BrandLoader.tsx` | 31 | C | 2 | 2 | sim |
| Button | Primitiva | `src/ui/Button.tsx` | 43 | C | 5 | 12 | não |
| CommandPalette | Primitiva | `src/ui/CommandPalette.tsx` | 86 | — | 1 | 1 | sim |
| ConfirmDialog | Primitiva | `src/ui/ConfirmDialog.tsx` | 37 | CE | 1 | 0 | sim |
| Display | Primitiva | `src/ui/Display.tsx` | 196 | CVEOS | 31 | 8 | sim |
| Field | Primitiva | `src/ui/Field.tsx` | 124 | E | 18 | 7 | não |
| Modal | Primitiva | `src/ui/Modal.tsx` | 21 | — | 0 | 7 | não |
| Overlay | Primitiva | `src/ui/Overlay.tsx` | 187 | — | 8 | 5 | sim |
| Splitter | Primitiva | `src/ui/Splitter.tsx` | 72 | — | 7 | 3 | sim |
| TitleTooltips | Primitiva | `src/ui/TitleTooltips.tsx` | 73 | — | 1 | 1 | não |
| Toast | Primitiva | `src/ui/Toast.tsx` | 64 | S | 2 | 4 | sim |
| ToolPanel | Primitiva | `src/ui/ToolPanel.tsx` | 29 | — | 4 | 1 | não |

#### Paleta e comandos (2)

| Componente | Tipo | Caminho | LOC | Estados | A11y | Testes | i18n |
|---|---|---|---:|---|---:|---:|---|
| CommandMenu | Container | `src/components/CommandMenu/CommandMenu.tsx` | 328 | C | 0 | 2 | **não (1 literais)** |
| SlashOverlay | Modal/diálogo | `src/components/SlashOverlay/SlashOverlay.tsx` | 198 | V | 12 | 0 | **não (4 literais)** |

#### OxeCode (77)

| Componente | Tipo | Caminho | LOC | Estados | A11y | Testes | i18n |
|---|---|---|---:|---|---:|---:|---|
| MonacoDiff | Apresentacional | `src/components/Changes/MonacoDiff.tsx` | 77 | — | 0 | 0 | não |
| RefPicker | Apresentacional | `src/components/Changes/RefPicker.tsx` | 69 | V | 14 | 0 | sim |
| ConflictDiff | Apresentacional | `src/components/Editor/ConflictDiff.tsx` | 30 | — | 1 | 0 | sim |
| EditorTabs | Apresentacional | `src/components/Editor/EditorTabs.tsx` | 193 | — | 23 | 1 | sim |
| McpServerSafety | Apresentacional | `src/components/MCP/McpServerSafety.tsx` | 63 | — | 5 | 1 | sim |
| BinaryPreview | Apresentacional | `src/components/Preview/BinaryPreview.tsx` | 62 | CVE | 1 | 2 | sim |
| MarkdownPreview | Apresentacional | `src/components/Preview/MarkdownPreview.tsx` | 46 | — | 0 | 0 | sim |
| ReviewFileTree | Apresentacional | `src/components/Review/ReviewFileTree.tsx` | 286 | V | 16 | 1 | não |
| ReviewToolbar | Apresentacional | `src/components/Review/ReviewToolbar.tsx` | 179 | — | 18 | 0 | **não (2 literais)** |
| WorkspaceBackgroundPanel | Apresentacional | `src/components/Workspace/WorkspaceBackgroundPanel.tsx` | 45 | — | 7 | 1 | não |
| WorkspaceIntegrationPanel | Apresentacional | `src/components/Workspace/WorkspaceIntegrationPanel.tsx` | 51 | — | 5 | 0 | não |
| WorkspaceReviewPanel | Apresentacional | `src/components/Workspace/WorkspaceReviewPanel.tsx` | 68 | C | 7 | 1 | não |
| WorkspaceScriptsPanel | Apresentacional | `src/components/Workspace/WorkspaceScriptsPanel.tsx` | 40 | — | 7 | 1 | não |
| WorkspaceSearchPanel | Apresentacional | `src/components/Workspace/WorkspaceSearchPanel.tsx` | 39 | — | 7 | 0 | não |
| WorkspaceWebPreviewPanel | Apresentacional | `src/components/Workspace/WorkspaceWebPreviewPanel.tsx` | 40 | — | 7 | 1 | não |
| WorkspaceWorktreePanel | Apresentacional | `src/components/Workspace/WorkspaceWorktreePanel.tsx` | 71 | — | 7 | 0 | não |
| BackgroundJobsPanel | Container | `src/components/Background/BackgroundJobsPanel.tsx` | 283 | CVES | 19 | 1 | sim |
| ChangesPanel | Container | `src/components/Changes/ChangesPanel.tsx` | 334 | CVE | 56 | 2 | sim |
| EditorPane | Container | `src/components/Editor/EditorPane.tsx` | 449 | CVE | 16 | 3 | sim |
| FileBrowser | Container | `src/components/Editor/FileBrowser.tsx` | 189 | CVE | 17 | 1 | sim |
| GitControlPanel | Container | `src/components/GitHub/GitControlPanel.tsx` | 125 | CVE | 12 | 1 | sim |
| GitHubPanel | Container | `src/components/GitHub/GitHubPanel.tsx` | 1801 | CVE | 110 | 2 | sim |
| PrStatusBar | Container | `src/components/GitHub/PrStatusBar.tsx` | 121 | CVE | 20 | 1 | sim |
| HandoffInbox | Container | `src/components/Integration/HandoffInbox.tsx` | 348 | VE | 9 | 1 | **não (1 literais)** |
| IntegrationPanel | Container | `src/components/Integration/IntegrationPanel.tsx` | 567 | CVE | 42 | 0 | **não (10 literais)** |
| MemberEditor | Container | `src/components/Integration/MemberEditor.tsx` | 160 | — | 7 | 1 | **não (3 literais)** |
| LinearPanel | Container | `src/components/Linear/LinearPanel.tsx` | 201 | CVE | 11 | 0 | **não (3 literais)** |
| McpCatalog | Container | `src/components/MCP/McpCatalog.tsx` | 87 | CV | 11 | 1 | sim |
| McpImportPanel | Container | `src/components/MCP/McpImportPanel.tsx` | 71 | CVE | 1 | 1 | sim |
| DiffCard | Container | `src/components/Review/DiffCard.tsx` | 357 | — | 16 | 1 | não |
| ReviewPane | Container | `src/components/Review/ReviewPane.tsx` | 250 | CV | 4 | 1 | não |
| ScriptsPanel | Container | `src/components/Scripts/ScriptsPanel.tsx` | 210 | CVE | 9 | 1 | sim |
| SearchPanel | Container | `src/components/Search/SearchPanel.tsx` | 188 | CE | 15 | 1 | sim |
| SemanticActivityPanel | Container | `src/components/Semantic/SemanticActivityPanel.tsx` | 247 | V | 21 | 1 | **não (5 literais)** |
| SkillsBrowser | Container | `src/components/Skills/SkillsBrowser.tsx` | 1392 | CVE | 15 | 2 | sim |
| TeamMessages | Container | `src/components/Teams/TeamMessages.tsx` | 64 | CE | 1 | 0 | **não (1 literais)** |
| AgentCreditsStatus | Container | `src/components/Terminal/AgentCreditsStatus.tsx` | 82 | — | 1 | 0 | sim |
| ContextUsageStatus | Container | `src/components/Terminal/ContextUsageStatus.tsx` | 69 | — | 1 | 1 | sim |
| CopilotCreditsStatus | Container | `src/components/Terminal/CopilotCreditsStatus.tsx` | 86 | — | 1 | 1 | sim |
| AppStatusBar | Container | `src/components/Workspace/AppStatusBar.tsx` | 87 | O | 6 | 1 | sim |
| IntegrationsStatusChips | Container | `src/components/Workspace/IntegrationsStatusChips.tsx` | 224 | — | 16 | 0 | não |
| PaneBranchBadge | Container | `src/components/Workspace/PaneBranchBadge.tsx` | 29 | — | 3 | 1 | não |
| PanelScopeBadge | Container | `src/components/Workspace/PanelScopeBadge.tsx` | 55 | — | 3 | 0 | não |
| UsagePopover | Container | `src/components/Workspace/UsagePopover.tsx` | 50 | C | 3 | 0 | não |
| UsageStatus | Container | `src/components/Workspace/UsageStatus.tsx` | 74 | C | 3 | 3 | não |
| WorkspaceEditorPanel | Container | `src/components/Workspace/WorkspaceEditorPanel.tsx` | 64 | — | 11 | 1 | não |
| WorkspaceGitHubPanel | Container | `src/components/Workspace/WorkspaceGitHubPanel.tsx` | 69 | — | 11 | 1 | não |
| WorkspaceMemorySettings | Container | `src/components/Workspace/WorkspaceMemorySettings.tsx` | 177 | CVE | 6 | 1 | sim |
| WorkspaceSurface | Container | `src/components/Workspace/WorkspaceSurface.tsx` | 733 | C | 19 | 2 | sim |
| WorkspaceGrid | Layout | `src/components/Grid/WorkspaceGrid.tsx` | 129 | — | 0 | 4 | sim |
| WorkspaceSplitGrid | Layout | `src/components/Grid/WorkspaceSplitGrid.tsx` | 348 | — | 7 | 3 | sim |
| PaneContent | Layout | `src/components/Panes/PaneContent.tsx` | 42 | C | 0 | 3 | sim |
| AgentProviderIcon | Layout | `src/components/Sidebar/AgentProviderIcon.tsx` | 42 | — | 2 | 0 | não |
| PaneSessionRow | Layout | `src/components/Sidebar/PaneSessionRow.tsx` | 264 | — | 14 | 0 | sim |
| Sidebar | Layout | `src/components/Sidebar/Sidebar.tsx` | 335 | V | 8 | 14 | sim |
| SidebarIntegrationRow | Layout | `src/components/Sidebar/SidebarIntegrationRow.tsx` | 69 | V | 5 | 0 | sim |
| WorkbenchPanelMenu | Layout | `src/components/Workbench/WorkbenchPanelMenu.tsx` | 39 | — | 3 | 1 | sim |
| DefaultShellSettings | Layout | `src/components/Workspace/DefaultShellSettings.tsx` | 55 | E | 11 | 1 | sim |
| AgentConfigModal | Modal/diálogo | `src/components/Agents/AgentConfigModal.tsx` | 200 | CE | 2 | 3 | **não (3 literais)** |
| DelegatedWorkDialog | Modal/diálogo | `src/components/Delegation/DelegatedWorkDialog.tsx` | 98 | E | 4 | 0 | **não (8 literais)** |
| DelegationCreateDialog | Modal/diálogo | `src/components/Delegation/DelegationCreateDialog.tsx` | 158 | CE | 3 | 0 | **não (14 literais)** |
| PaneContainer | Modal/diálogo | `src/components/Grid/PaneContainer.tsx` | 383 | — | 37 | 4 | não |
| ProviderSessionFinder | Modal/diálogo | `src/components/Grid/ProviderSessionFinder.tsx` | 77 | CVE | 8 | 0 | não |
| McpPanel | Modal/diálogo | `src/components/MCP/McpPanel.tsx` | 847 | CVE | 51 | 4 | sim |
| TerminalPane | Modal/diálogo | `src/components/Panes/TerminalPane.tsx` | 554 | CVE | 22 | 3 | não |
| WorkspaceGroup | Modal/diálogo | `src/components/Sidebar/WorkspaceGroup.tsx` | 386 | — | 21 | 0 | sim |
| TeamDialog | Modal/diálogo | `src/components/Teams/TeamDialog.tsx` | 58 | E | 5 | 0 | **não (3 literais)** |
| DesignGrabSheet | Modal/diálogo | `src/components/WebPreview/DesignGrabSheet.tsx` | 88 | — | 6 | 0 | sim |
| NativePreviewHost | Modal/diálogo | `src/components/WebPreview/NativePreviewHost.tsx` | 60 | — | 2 | 0 | sim |
| WebPreviewPanel | Modal/diálogo | `src/components/WebPreview/WebPreviewPanel.tsx` | 364 | CVE | 48 | 3 | sim |
| NewWorkspaceModal | Modal/diálogo | `src/components/Workspace/NewWorkspaceModal.tsx` | 437 | CVE | 18 | 3 | sim |
| WorkspaceDelegationSettings | Modal/diálogo | `src/components/Workspace/WorkspaceDelegationSettings.tsx` | 114 | VE | 5 | 1 | sim |
| WorkspaceMemoryNotes | Modal/diálogo | `src/components/Workspace/WorkspaceMemoryNotes.tsx` | 154 | CVE | 7 | 1 | sim |
| WorkspaceSettingsModal | Modal/diálogo | `src/components/Workspace/WorkspaceSettingsModal.tsx` | 357 | E | 27 | 2 | sim |
| WorktreeCleanupPanel | Modal/diálogo | `src/components/Worktree/WorktreeCleanupPanel.tsx` | 178 | CVE | 5 | 1 | sim |
| WorktreePanelBody | Modal/diálogo | `src/components/Worktree/WorktreePanelBody.tsx` | 773 | CVE | 29 | 0 | sim |
| TerminalView | Página/modo | `src/components/Terminal/TerminalView.tsx` | 979 | — | 9 | 4 | sim |

#### OxeChat (58)

| Componente | Tipo | Caminho | LOC | Estados | A11y | Testes | i18n |
|---|---|---|---:|---|---:|---:|---|
| ThreadActivityGroup | Apresentacional | `src/components/Threads/ThreadActivityGroup.tsx` | 121 | C | 0 | 2 | sim |
| ThreadAnnouncer | Apresentacional | `src/components/Threads/ThreadAnnouncer.tsx` | 43 | — | 3 | 1 | sim |
| ThreadApprovalDetails | Apresentacional | `src/components/Threads/ThreadApprovalDetails.tsx` | 46 | — | 0 | 1 | sim |
| ThreadConversationActions | Apresentacional | `src/components/Threads/ThreadConversationActions.tsx` | 29 | — | 5 | 0 | sim |
| ThreadDeliveryNote | Apresentacional | `src/components/Threads/ThreadDeliveryNote.tsx` | 23 | C | 1 | 1 | sim |
| ThreadDockPlan | Apresentacional | `src/components/Threads/ThreadDockPlan.tsx` | 43 | C | 5 | 1 | sim |
| ThreadDockRewind | Apresentacional | `src/components/Threads/ThreadDockRewind.tsx` | 27 | — | 3 | 1 | sim |
| ThreadEmptyState | Apresentacional | `src/components/Threads/ThreadEmptyState.tsx` | 41 | V | 8 | 2 | sim |
| ThreadFailureCard | Apresentacional | `src/components/Threads/ThreadFailureCard.tsx` | 134 | CVE | 5 | 3 | sim |
| ThreadFindBar | Apresentacional | `src/components/Threads/ThreadFindBar.tsx` | 69 | — | 8 | 1 | sim |
| ThreadHistoricalQuestions | Apresentacional | `src/components/Threads/ThreadHistoricalQuestions.tsx` | 11 | — | 1 | 1 | sim |
| ThreadHunkReview | Apresentacional | `src/components/Threads/ThreadHunkReview.tsx` | 61 | CVE | 3 | 1 | sim |
| ThreadMarkdown | Apresentacional | `src/components/Threads/ThreadMarkdown.tsx` | 40 | E | 3 | 1 | sim |
| ThreadMcpServerList | Apresentacional | `src/components/Threads/ThreadMcpServerList.tsx` | 48 | V | 2 | 1 | sim |
| ThreadModelPicker | Apresentacional | `src/components/Threads/ThreadModelPicker.tsx` | 29 | — | 4 | 0 | sim |
| ThreadPatch | Apresentacional | `src/components/Threads/ThreadPatch.tsx` | 18 | — | 4 | 1 | sim |
| ThreadPlan | Apresentacional | `src/components/Threads/ThreadPlan.tsx` | 13 | C | 0 | 0 | sim |
| ThreadPromptNavigator | Apresentacional | `src/components/Threads/ThreadPromptNavigator.tsx` | 83 | — | 1 | 1 | sim |
| ThreadReasoning | Apresentacional | `src/components/Threads/ThreadReasoning.tsx` | 40 | — | 2 | 1 | sim |
| ThreadRequestCard | Apresentacional | `src/components/Threads/ThreadRequestCard.tsx` | 146 | E | 10 | 3 | sim |
| ThreadRewindControl | Apresentacional | `src/components/Threads/ThreadRewindControl.tsx` | 37 | — | 6 | 1 | sim |
| ThreadRichText | Apresentacional | `src/components/Threads/ThreadRichText.tsx` | 14 | — | 0 | 0 | não |
| ThreadSubagentActivity | Apresentacional | `src/components/Threads/ThreadSubagentActivity.tsx` | 21 | — | 6 | 1 | sim |
| ThreadTimeline | Apresentacional | `src/components/Threads/ThreadTimeline.tsx` | 43 | — | 0 | 2 | não |
| ThreadTurnFold | Apresentacional | `src/components/Threads/ThreadTurnFold.tsx` | 57 | — | 3 | 1 | sim |
| ThreadTurnTiming | Apresentacional | `src/components/Threads/ThreadTurnTiming.tsx` | 22 | — | 0 | 0 | sim |
| ThreadChangesPanel | Container | `src/components/Threads/ThreadChangesPanel.tsx` | 57 | CV | 6 | 1 | sim |
| ThreadComposerForm | Container | `src/components/Threads/ThreadComposerForm.tsx` | 87 | E | 12 | 0 | sim |
| ThreadDockChanges | Container | `src/components/Threads/ThreadDockChanges.tsx` | 109 | CE | 11 | 1 | sim |
| ThreadDockRequests | Container | `src/components/Threads/ThreadDockRequests.tsx` | 73 | E | 7 | 0 | sim |
| ThreadEventsPanel | Container | `src/components/Threads/ThreadEventsPanel.tsx` | 92 | CVE | 5 | 1 | sim |
| ThreadFileActivity | Container | `src/components/Threads/ThreadFileActivity.tsx` | 120 | CE | 11 | 3 | sim |
| ThreadHeader | Container | `src/components/Threads/ThreadHeader.tsx` | 78 | — | 10 | 1 | sim |
| ThreadLiveActivity | Container | `src/components/Threads/ThreadLiveActivity.tsx` | 146 | C | 5 | 1 | sim |
| ThreadMcpDiagnose | Container | `src/components/Threads/ThreadMcpDiagnose.tsx` | 61 | — | 2 | 1 | sim |
| ThreadMcpHealth | Container | `src/components/Threads/ThreadMcpHealth.tsx` | 34 | — | 2 | 2 | sim |
| ThreadMessageRow | Container | `src/components/Threads/ThreadMessageRow.tsx` | 84 | — | 11 | 1 | sim |
| ThreadPermissionsPanel | Container | `src/components/Threads/ThreadPermissionsPanel.tsx` | 85 | CVE | 6 | 1 | sim |
| ThreadProjectSemantic | Container | `src/components/Threads/ThreadProjectSemantic.tsx` | 50 | E | 1 | 1 | sim |
| ThreadProjectTerminal | Container | `src/components/Threads/ThreadProjectTerminal.tsx` | 65 | E | 16 | 0 | sim |
| ThreadTimelineEntry | Container | `src/components/Threads/ThreadTimelineEntry.tsx` | 116 | C | 0 | 0 | sim |
| ThreadTurnReview | Container | `src/components/Threads/ThreadTurnReview.tsx` | 79 | CVE | 3 | 1 | sim |
| ThreadUsagePanel | Container | `src/components/Threads/ThreadUsagePanel.tsx` | 101 | CVE | 5 | 1 | sim |
| ThreadUsageRing | Container | `src/components/Threads/ThreadUsageRing.tsx` | 78 | — | 6 | 0 | sim |
| ThreadWorkPanel | Container | `src/components/Threads/ThreadWorkPanel.tsx` | 70 | CVE | 1 | 1 | sim |
| useFileMentions | Container | `src/components/Threads/useFileMentions.tsx` | 90 | — | 5 | 1 | sim |
| useThreadCommands | Container | `src/components/Threads/useThreadCommands.tsx` | 181 | CVE | 6 | 1 | sim |
| ThreadGrid | Layout | `src/components/Threads/ThreadGrid.tsx` | 36 | — | 2 | 0 | sim |
| ProviderAccountsPanel | Modal/diálogo | `src/components/Threads/ProviderAccountsPanel.tsx` | 70 | CE | 0 | 0 | sim |
| ThreadCommandDialog | Modal/diálogo | `src/components/Threads/ThreadCommandDialog.tsx` | 115 | CVE | 5 | 1 | sim |
| ThreadConfigurationBar | Modal/diálogo | `src/components/Threads/ThreadConfigurationBar.tsx` | 90 | CVE | 21 | 0 | sim |
| ThreadDialogs | Modal/diálogo | `src/components/Threads/ThreadDialogs.tsx` | 120 | VE | 4 | 2 | sim |
| ThreadProjectSettingsDialog | Modal/diálogo | `src/components/Threads/ThreadProjectSettingsDialog.tsx` | 77 | E | 1 | 0 | sim |
| ThreadPromptQueue | Modal/diálogo | `src/components/Threads/ThreadPromptQueue.tsx` | 37 | — | 12 | 2 | sim |
| ThreadReviewHost | Modal/diálogo | `src/components/Threads/ThreadReviewHost.tsx` | 49 | — | 1 | 0 | sim |
| ThreadSidebar | Modal/diálogo | `src/components/Threads/ThreadSidebar.tsx` | 212 | CVE | 20 | 1 | sim |
| ThreadWorktreeFinishDialog | Modal/diálogo | `src/components/Threads/ThreadWorktreeFinishDialog.tsx` | 88 | CES | 0 | 1 | sim |
| ThreadView | Página/modo | `src/components/Threads/ThreadView.tsx` | 340 | CVE | 8 | 3 | sim |

#### OxeQuery (27)

| Componente | Tipo | Caminho | LOC | Estados | A11y | Testes | i18n |
|---|---|---|---:|---|---:|---:|---|
| ActivityPanel | Apresentacional | `src/components/OxeQuery/ActivityPanel.tsx` | 65 | VE | 7 | 2 | sim |
| CellValue | Apresentacional | `src/components/OxeQuery/CellValue.tsx` | 64 | — | 7 | 1 | sim |
| CollectionFacts | Apresentacional | `src/components/OxeQuery/CollectionFacts.tsx` | 91 | CE | 11 | 0 | sim |
| LibraryMenu | Apresentacional | `src/components/OxeQuery/LibraryMenu.tsx` | 91 | VES | 12 | 0 | sim |
| MongoPanels | Apresentacional | `src/components/OxeQuery/MongoPanels.tsx` | 49 | — | 8 | 0 | sim |
| QueryError | Apresentacional | `src/components/OxeQuery/QueryError.tsx` | 39 | E | 1 | 8 | sim |
| SchemaTree | Apresentacional | `src/components/OxeQuery/SchemaTree.tsx` | 260 | CES | 29 | 0 | sim |
| StructureParts | Apresentacional | `src/components/OxeQuery/StructureParts.tsx` | 161 | — | 8 | 1 | sim |
| ReconnectBar | Container | `src/components/OxeQuery/ReconnectBar.tsx` | 28 | E | 3 | 0 | sim |
| OxeQuerySidebar | Layout | `src/components/OxeQuery/OxeQuerySidebar.tsx` | 43 | — | 5 | 0 | sim |
| ResultGrid | Layout | `src/components/OxeQuery/ResultGrid.tsx` | 230 | — | 31 | 4 | sim |
| WorkbenchPanels | Layout | `src/components/OxeQuery/WorkbenchPanels.tsx` | 93 | — | 13 | 1 | sim |
| AskAgent | Modal/diálogo | `src/components/OxeQuery/AskAgent.tsx` | 53 | — | 2 | 0 | sim |
| ConnectionDialog | Modal/diálogo | `src/components/OxeQuery/ConnectionDialog.tsx` | 372 | CE | 33 | 1 | sim |
| ConnectionList | Modal/diálogo | `src/components/OxeQuery/ConnectionList.tsx` | 77 | VE | 25 | 0 | sim |
| ImportDialog | Modal/diálogo | `src/components/OxeQuery/ImportDialog.tsx` | 147 | ES | 11 | 1 | sim |
| MongoDialogs | Modal/diálogo | `src/components/OxeQuery/MongoDialogs.tsx` | 124 | CE | 5 | 0 | sim |
| MongoInsights | Modal/diálogo | `src/components/OxeQuery/MongoInsights.tsx` | 79 | CE | 12 | 0 | sim |
| MongoWorkbench | Modal/diálogo | `src/components/OxeQuery/MongoWorkbench.tsx` | 299 | CVE | 45 | 1 | sim |
| NewDatabaseDialog | Modal/diálogo | `src/components/OxeQuery/NewDatabaseDialog.tsx` | 52 | CE | 5 | 0 | sim |
| PreferencesDialog | Modal/diálogo | `src/components/OxeQuery/PreferencesDialog.tsx` | 74 | CE | 1 | 1 | sim |
| ServerPanel | Modal/diálogo | `src/components/OxeQuery/ServerPanel.tsx` | 103 | CE | 3 | 0 | sim |
| SqlWorkbench | Modal/diálogo | `src/components/OxeQuery/SqlWorkbench.tsx` | 501 | CVES | 32 | 1 | sim |
| StructureEditor | Modal/diálogo | `src/components/OxeQuery/StructureEditor.tsx` | 178 | CE | 7 | 1 | sim |
| TableEditor | Modal/diálogo | `src/components/OxeQuery/TableEditor.tsx` | 251 | CES | 24 | 1 | sim |
| ExplainView | Página/modo | `src/components/OxeQuery/ExplainView.tsx` | 51 | — | 12 | 0 | sim |
| OxeQueryView | Página/modo | `src/components/OxeQuery/OxeQueryView.tsx` | 58 | V | 12 | 0 | sim |

#### OxePod (7)

| Componente | Tipo | Caminho | LOC | Estados | A11y | Testes | i18n |
|---|---|---|---:|---|---:|---:|---|
| ContainerTabs | Container | `src/components/OxePod/ContainerTabs.tsx` | 157 | CVE | 9 | 0 | sim |
| EngineBar | Container | `src/components/OxePod/EngineBar.tsx` | 54 | — | 1 | 1 | sim |
| OxePodSidebar | Layout | `src/components/OxePod/OxePodSidebar.tsx` | 98 | — | 10 | 1 | sim |
| ContainerCards | Modal/diálogo | `src/components/OxePod/ContainerCards.tsx` | 120 | CE | 6 | 0 | sim |
| ContainerDetail | Modal/diálogo | `src/components/OxePod/ContainerDetail.tsx` | 112 | E | 14 | 0 | sim |
| ResourcesPanel | Modal/diálogo | `src/components/OxePod/ResourcesPanel.tsx` | 91 | VES | 9 | 0 | sim |
| OxePodView | Página/modo | `src/components/OxePod/OxePodView.tsx` | 79 | CVE | 6 | 1 | sim |

#### OxePost (6)

| Componente | Tipo | Caminho | LOC | Estados | A11y | Testes | i18n |
|---|---|---|---:|---|---:|---:|---|
| RequestEditor | Container | `src/components/OxePost/RequestEditor.tsx` | 147 | CS | 24 | 0 | sim |
| ResponsePanel | Container | `src/components/OxePost/ResponsePanel.tsx` | 63 | CVEOS | 8 | 0 | sim |
| OxePostSidebar | Layout | `src/components/OxePost/OxePostSidebar.tsx` | 71 | CE | 9 | 0 | sim |
| EnvironmentsDialog | Modal/diálogo | `src/components/OxePost/EnvironmentsDialog.tsx` | 132 | CES | 15 | 0 | sim |
| ImportDialog | Modal/diálogo | `src/components/OxePost/ImportDialog.tsx` | 75 | CES | 6 | 1 | sim |
| OxePostView | Página/modo | `src/components/OxePost/OxePostView.tsx` | 56 | CVE | 2 | 0 | sim |

#### Settings (8)

| Componente | Tipo | Caminho | LOC | Estados | A11y | Testes | i18n |
|---|---|---|---:|---|---:|---:|---|
| UpdatePreferences | Apresentacional | `src/components/Settings/UpdatePreferences.tsx` | 33 | — | 0 | 1 | sim |
| AgentActivitySettings | Container | `src/components/Settings/AgentActivitySettings.tsx` | 57 | E | 8 | 1 | sim |
| AppearanceSettings | Container | `src/components/Settings/AppearanceSettings.tsx` | 126 | — | 14 | 4 | sim |
| AutomationsSettings | Container | `src/components/Settings/AutomationsSettings.tsx` | 225 | E | 8 | 0 | sim |
| KeyboardSettings | Container | `src/components/Settings/KeyboardSettings.tsx` | 81 | — | 7 | 1 | sim |
| PolicySettings | Container | `src/components/Settings/PolicySettings.tsx` | 49 | E | 5 | 0 | sim |
| SettingsCenter | Modal/diálogo | `src/components/Settings/SettingsCenter.tsx` | 161 | C | 15 | 2 | sim |
| SettingsModal | Modal/diálogo | `src/components/Settings/SettingsModal.tsx` | 1397 | CE | 64 | 4 | sim |

#### Ajuda (11)

| Componente | Tipo | Caminho | LOC | Estados | A11y | Testes | i18n |
|---|---|---|---:|---|---:|---:|---|
| AboutHost | Apresentacional | `src/components/About/AboutHost.tsx` | 19 | — | 0 | 0 | não |
| ReportProblemHost | Apresentacional | `src/components/Diagnostics/ReportProblemHost.tsx` | 19 | — | 0 | 0 | não |
| KeyChord | Apresentacional | `src/components/Keyboard/KeyChord.tsx` | 24 | — | 1 | 0 | sim |
| ShortcutGuideHost | Apresentacional | `src/components/Keyboard/ShortcutGuideHost.tsx` | 21 | — | 0 | 0 | não |
| AgentCliOnboarding | Apresentacional | `src/components/Onboarding/AgentCliOnboarding.tsx` | 44 | — | 4 | 1 | sim |
| FirstRunChecklist | Container | `src/components/Onboarding/FirstRunChecklist.tsx` | 161 | — | 9 | 1 | **não (7 literais)** |
| AppUpdateIndicator | Container | `src/components/Updates/AppUpdateIndicator.tsx` | 31 | C | 2 | 1 | **não (2 literais)** |
| UpdateBanner | Container | `src/components/Updates/UpdateBanner.tsx` | 39 | C | 3 | 1 | não |
| AboutDialog | Modal/diálogo | `src/components/About/AboutDialog.tsx` | 83 | C | 4 | 1 | sim |
| ReportProblem | Modal/diálogo | `src/components/Diagnostics/ReportProblem.tsx` | 54 | CES | 2 | 2 | sim |
| ShortcutGuide | Modal/diálogo | `src/components/Keyboard/ShortcutGuide.tsx` | 33 | — | 1 | 1 | sim |

</details>

## 5. Fase 3 · Análise componente a componente

Entram todos os modos, todas as primitivas, os modais de aprovação e de confirmação destrutiva, a paleta e os
containers dos fluxos críticos. Entre os demais, a amostra foi escolhida pelo risco: os que abrem links, guardam dados
ou descartam trabalho.

### 5.1 Primitivas (`src/ui`)

| Componente | Responsabilidade e API | Estados e UX | A11y | i18n | Testes | Nota | Justificativa |
|---|---|---|---|---|---|---:|---|
| `Button` / `IconButton` / `ButtonGroup` | Uma API para cinco variantes e três tamanhos; `IconButton` exige `label` (`Button.tsx:28-36`) | `loading` mostra spinner e bloqueia clique | `aria-busy`, nome obrigatório no ícone. `loading` usa `disabled`, e o botão com foco perde o foco do teclado durante a ação (FE-M-14) | sem texto próprio | `ui-primitives.test.tsx` | 4 | API pequena e segura; só o `disabled` no carregamento destoa. |
| `Field` (TextField, TextArea, Select, Checkbox, Switch, SegmentedControl, FieldError) | Rótulo, dica e erro ligados por `useId` (`Field.tsx:15-55`) | erro com `role="alert"`, `aria-invalid` | `htmlFor`, `aria-describedby`, `role="switch"` e `radiogroup` com roving tabindex (`Field.tsx:79-107`) | sem texto próprio | `ui-primitives`, `ui-states` | 4 | Correto e completo; o alvo de 24 px do segmentado está Em PR #246 (#228 P3-2). |
| `Dialog`, `Popover`, `Menu`, `Tooltip` (`Overlay`) | Radix por baixo, com foco de saída que se recupera se o gatilho sumiu (`Overlay.tsx:44-52`) | rodapé com ação principal por último | foco preso, Escape, rótulo do fechar traduzido; colisão com a barra de título | `ui.close` | `ui-primitives`, `ui-modal-surface` | 4 | Boa recuperação de foco, que é onde diálogos costumam falhar. |
| `ConfirmDialog` | Pergunta, consequência obrigatória, `danger`, `busy`, `confirmDisabled` (`ConfirmDialog.tsx:6-24`) | foco começa no Cancelar; erro inline | herda o `Dialog` | rótulo padrão traduzido | sim | 4 | Exige a consequência por tipo, o que já evita confirmações vazias. Com `busy`, Cancelar fica desabilitado (FE-M-14). |
| `CommandPalette` | cmdk dentro de um Dialog Radix, com retorno de foco cuidadoso (`CommandPalette.tsx:21-37`) | vazio por `CommandEmpty` | título e descrição só para leitor de tela | sim | `command-menu` (e2e) | 4 | Rótulos dos comandos: Já mapeado #228 P2-1 a P2-5, Em PR #242. |
| `Display` (Badge, StatusDot, Panel, EmptyState, ErrorState, SuccessState, OfflineState, Notice, LoadingState, Skeleton, Spinner, Tabs, Meter, Avatar) | Os seis estados da F1 existem (`Display.tsx:48-153`) | `ErrorState` com retry, `OfflineState` com padrão traduzido | `Spinner` com rótulo ou decorativo | padrões por `i18n.t` | `ui-states.test.tsx` | 4 | Primitivas prontas; o que falta é migrar as telas (Já mapeado: F1). |
| `Toast` | Fila de até 4, intenção, ação opcional (`Toast.tsx:9-27`) | 5 s para info, `danger` fica até fechar | a região viva só nasce junto com o primeiro toast (`Toast.tsx:58-61`), o que pode calar o primeiro aviso no NVDA | `ui.dismiss` | sim | 3 | Já mapeado #228 P2-7; Em PR #245, que mantém a região montada. |
| `Splitter` | Arrastar com alternativa de teclado e de clique (`Splitter.tsx:41-63`) | — | `role="separator"` com valores e `aria-keyshortcuts` | sim | `ui-splitter.test.tsx` | 4 | Atende 2.5.7. |
| `ToolPanel` + `useModalSurface` | Painel de altura cheia com scrim e foco preso (`ToolPanel.tsx:21-27`, `useModalSurface.ts:12-40`) | Escape e clique fora | `aria-modal`, Tab preso; a lista de focáveis não descarta elementos escondidos por CSS e o fundo não fica `inert` (FE-M-13) | rótulo do chamador | `ui-modal-surface.test.tsx` | 3 | Funciona no caso comum, mas é uma armadilha de foco feita à mão ao lado do Radix. |
| `TitleTooltips` | Dica para `title` nativo | — | `role="tooltip"` | — | `ui-title-tooltips.test.tsx` | 4 | Pequeno e testado. |
| `BrandLoader` | Loader da marca, parado com movimento reduzido (`BrandLoader.tsx:7-12`) | — | `role="status"` com rótulo, ou decorativo | rótulo do chamador | sim | 4 | Respeita o movimento reduzido. |

### 5.2 Modos e páginas

| Componente | Estados | UX | A11y | i18n | Testes | Nota | Justificativa |
|---|---|---|---|---|---|---:|---|
| Shell (`App.tsx`) | carregamento por Suspense; limites só na janela e no OxeChat (`App.tsx:865,935`) | avisos fixos em inglês ("Workspace has unsaved editor changes…", `App.tsx:513`) | `aria-label="Thread sidebar"` fixo (829) | fora do `MIGRATED` | e2e de shell | 2 | 1118 linhas com estado, modais e textos fixos; uma falha nas sidebars derruba a janela (FE-M-15). |
| OxeCode (`WorkspaceSurface`, `WorkspaceSplitGrid`, `PaneContainer`, `TerminalPane`) | limites por grade, painel e terminal (`WorkspaceSurface.tsx:460,596`, `TerminalPane.tsx:409`) | o split após trocar o layout derruba a janela (Já mapeado #228 P2-5, Em PR #251) | menus de painel e alternativas ao arrastar (`wcag-2.2.md`) | `WorkspaceSurface` traduz; 14 dos 22 componentes de `Workspace/` não | 16 de 22 citados | 3 | Isolamento de falha por painel é bom; i18n e o P2-5 puxam para baixo. |
| `TerminalView` | erro do WebGL contido | links detectados no terminal não abrem (FE-M-08) | xterm fora do axe, coberto pelo roteiro de leitor de tela | sim | sim | 3 | Terminal robusto; o handler de link padrão não combina com a política de janelas do main. |
| `EditorPane` | árvore com carregando, erro e retry | fechar a janela com edição não salva não pergunta (FE-M-10) | Monaco com modo de leitor de tela próprio | sim | sim | 3 | Assina o store inteiro do editor (FE-M-05). |
| OxeChat (`ThreadView`, `ThreadGrid`, `ThreadTimeline`, `ThreadComposerForm`) | timeline virtualizada (`ThreadTimeline.tsx`), anunciador (`ThreadAnnouncer.tsx`) | Enter no composer não aprova pedido (#228 P1-9) | região viva, `scroll-padding-top` (2.4.11) | 56 de 58 traduzem | 43 de 58 citados | 3 | O modo mais maduro; o cartão de aprovação é o ponto fraco. |
| `ThreadRequestCard` (aprovações, perguntas, elicitação) | rascunho em memória sem segredos (`ThreadRequestCard.tsx:13,49-54`), envio duplo barrado por `inFlight` (62-70), erro com `humanizeError` | comando recolhido e Approve em destaque (Já mapeado #228 P1-8, Em PR #243) | `aria-label` no cartão, `legend` nas perguntas | sim; mas decide "alterações de arquivo" comparando o título em inglês vindo do main (`request.title === 'Approve file changes'`, linha 97; FE-M-11) | sim | 2 | Mecânica de envio sólida; a apresentação da decisão é a do P1-8. |
| `ThreadMarkdown` | erro ao copiar com `ErrorState` | links abrem direto, com o destino escondido (FE-M-02) | tabelas roláveis com `role="region"` e `tabIndex` | sim | sim | 3 | Sem HTML e sem imagens remotas (só o `alt`), o que está certo; falta o destino dos links. |
| OxeQuery (`SqlWorkbench`) | erro de consulta por código, grade em janela (`ResultGrid.tsx:28`) | produção pede o nome digitado, e o main confere (`SqlWorkbench.tsx:381-391`, `oxequery-guard.ts:56`); a confirmação lista os motivos mas não o comando (FE-M-12) | grade com teclado completo (`ResultGrid.tsx:120-145`) | motivos vindos do main em inglês (C3, F6) | 13 de 27 citados | 3 | O fluxo de produção é bom no SQL; falta mostrar o que vai rodar. |
| OxeQuery (`MongoWorkbench`) | vazio e erro pelas primitivas | escrita em produção com um clique, sem nome digitado (FE-M-09, **Alta**) | 20 `<button>` crus (FE-M-03) | sim | parcial | 2 | Inconsistente com a política declarada para produção. |
| OxePod (`ContainerDetail`) | ocupado durante a ação | remover diz se roda, lista volumes e que é definitivo; o main exige `confirmed` (`ContainerDetail.tsx:56,103-105`) | nome acessível com o container (`actions.removeNamed`) | sim | 3 de 7 citados | 4 | Confirmação destrutiva exemplar. |
| OxePost (`OxePostView`, `RequestEditor`) | resposta, erro, vazio | produção com foco em Cancelar e Ctrl+Enter também confirmando (#228 P1-11); URL sem resolver na confirmação (Já mapeado #228 P1-10) | — | sim | 1 de 6 citados | 3 | Bom fluxo; poucos testes citam os componentes. |
| Settings (`SettingsCenter`, `SettingsModal`) | sair com mudanças pergunta Ficar, Descartar ou Salvar (`SettingsCenter.tsx:48,66,135-144`) | — | — | sim | 6 de 8 citados | 4 | Um dos poucos lugares com proteção de rascunho; `SettingsModal` tem 1396 linhas. |
| Ajuda (`ReportProblem`, `AboutDialog`, Diagnóstico) | carregando, falha com retry | o relato é editável antes de sair (`ReportProblem.tsx:47-50`), com aviso de corte | — | sim | sim | 4 | Boa prévia do que sai do app. Diagnóstico completo: Em PR #205 (F11). |
| Pareamento do celular | — | não existe tela neste SHA | — | — | — | — | Em PR #221 (F9); avaliar quando chegar à `main`. |

### 5.3 Amostra: abrir links, guardar dados, descartar trabalho

| Componente | Achado | Nota |
|---|---|---:|
| `ChangesPanel` | Descartar todos os comentários de revisão com um clique, sem desfazer (FE-M-06, `ChangesPanel.tsx:293`) | 3 |
| `GitHubPanel`, `PrStatusBar`, `LinearPanel` | Abrem URLs vindas da API sem confirmação (`GitHubPanel.tsx:825,978,1020,1380`; `PrStatusBar.tsx:106,116`; `LinearPanel.tsx:181`); risco menor que o do agente, mas o mesmo caminho | 3 |
| `MarkdownPreview` | Mesmo comportamento de links do `ThreadMarkdown` para arquivos do repositório, que um agente pode ter escrito (`MarkdownPreview.tsx:22-28`) | 3 |
| Stores com `persist` | Guardam só preferências, ids e abas, nunca o conteúdo dos arquivos (`editor.store.ts:383-387`, `command-history.store.ts:7-22`); os comentários de revisão ficam em `localStorage` (`diff-comments.store.ts:44`) | 4 |

## 6. Fase 4 · Análise transversal

**1 · Arquitetura e organização (3).** Os modos são chunks separados e ficam montados quando escondidos, o que é a
escolha certa para conexões abertas. O shell concentra o estado de navegação, uns 20 modais e textos fixos num arquivo
de 1118 linhas (`App.tsx`), e a catraca de tamanho só impede que ele cresça.

**2 · Componentização e reuso (3).** As primitivas cobrem tudo o que as telas precisam, e Radix só entra por elas. Mas
516 `<button>` e 126 `<input>`/`<select>`/`<textarea>` crus convivem com 409 `<Button>`/`<IconButton>` (FE-M-03), e o
lint não impede o elemento cru.

**3 · Design system e consistência (3).** Tokens gerados, marca e movimento documentados, três keyframes, nenhuma cor
literal no CSS legado. Ainda há 19 mil linhas de CSS global contra 29 CSS Modules, 59 `!important`, e hex em
`ChangesPanel.tsx` (18) e `TerminalView.tsx` (8), este último pelo tema do xterm.

**4 · UX dos fluxos críticos (2).**
- *Abrir um workspace com agentes em paralelo:* o assistente cria o workspace com uma pasta que não existe (Já mapeado
  #228 P2-6, Em PR #244 e #239). Cada painel tem seu limite de erro, mas o split após trocar o layout derruba a janela
  (P2-5, Em PR #251). Fechar o workspace com edição pendente é barrado com um aviso em inglês, e fechar a janela não
  pergunta nada (FE-M-10).
- *Aprovar um pedido de agente:* no OxeChat o comando fica recolhido e "Approve" em destaque (P1-8); fora dele, o pedido
  vai para o diálogo nativo (P1-0 a P1-5). A mecânica de resposta é sólida (envio único, rascunho sem segredos). Em PR
  #243 (F18) e #238 (B10).
- *Consultar e alterar um banco no OxeQuery:* a grade aguenta 10 mil linhas, e o SQL de produção exige o nome digitado,
  conferido no main. Mas a confirmação não mostra o comando (FE-M-12), e a escrita Mongo em produção é um clique
  (FE-M-09, B15).
- *Parear o celular:* não há tela neste SHA (Em PR #221).
- *Diagnosticar um problema:* o relato tem prévia editável, mas um crash de React não aparece no diário nem no log do
  build empacotado (FE-M-01), e o Diagnóstico completo está Em PR #205.

**5 · Acessibilidade (3).** axe com `wcag22aa` por PR, alternativas a todo arrasto, foco que volta ao lugar certo,
nenhum elemento clicável sem teclado. Abaixo de 4 por três motivos: o roteiro com leitor de tela ainda não tem
registro com pessoa, há alvos de 22 px (Em PR #246, que não alcança os botões crus) e há uma armadilha de foco feita à
mão (FE-M-13).

**6 · Responsividade (2).** 18 `@container` contra 34 `@media … max-width`. A matriz de 960×640 a 4K é a F5, ainda em
rascunho (#199). O #228 P3-1 mediu zero rolagem horizontal nas 29 superfícies, o que mostra que o caso comum já
funciona.

**7 · Performance e bundle (4).** Orçamentos com folga para entrada, boot, CSS e o chunk do OxeQuery, gate e2e de
performance em duas plataformas, timeline e grade em janela, catálogos de idioma por chunk. Sobra uma assinatura do
store inteiro no editor (FE-M-05). INP e long tasks são a F7 (Em PR #251).

**8 · Estado e dados (3).** 161 assinaturas com seletor contra 6 sem; `persist` só guarda o que é seguro e pequeno;
nenhum listener sem remoção no inventário (`addEventListener` e `removeEventListener` batem em todo arquivo).

**9 · Erros e resiliência (2).** Há limites por modo, painel, terminal e workspace, `OfflineState` e `useConnectivity`
existem, e as falhas de IPC passam por `humanizeError`. Mas as sidebars caem no limite da janela (FE-M-15), o crash não
deixa rastro (FE-M-01) e não há guarda de saída para edição não salva (FE-M-10).

**10 · Segurança no cliente (3).** Pontos fortes: CSP de produção com `script-src 'self'` e `connect-src 'self'`,
`sandbox` e `contextIsolation`, nenhum `dangerouslySetInnerHTML`, markdown sem HTML e sem imagem remota, o main só deixa
abrir `http`, `https` e `mailto` (`utils/external-url.ts:1-10`) e nunca abre janela nova. Fraquezas:
- nenhum link externo vindo de conteúdo de agente passa por confirmação, e o texto pode esconder o destino (FE-M-02);
- a CSP depende de uma troca de string sem teste (FE-M-04);
- um agente pode carregar qualquer URL `http(s)` no preview interno pelo MCP sem confirmação
  (`tool-handlers.ts:273-281`; lado do main, B15).

**11 · i18n (3).** Infraestrutura boa (catálogos lazy, `use()` sem flash, datas e números pelo idioma da interface,
teste de catálogo). Só 31 arquivos estão na lista `MIGRATED`, e os motivos de confirmação do OxeQuery chegam do main em
inglês, contra o C3 (F6).

**12 · Testes e qualidade (3).** 215 arquivos de unidade, 85 specs e2e, axe e visual por lote. A cobertura mínima é
baixa e mistura renderer e main (FE-M-16), e 78 componentes não são citados por nenhum teste, entre eles
`DelegationCreateDialog`, `DelegatedWorkDialog`, `TeamDialog`, `LinearPanel`, `UsageModal` e `SlashOverlay`.

**13 · Observabilidade no cliente (2).** Há marca de interatividade no boot (`src/lib/startupTiming.ts`) e diário de
incidentes no main, mas nada do que quebra na interface chega lá (FE-M-01).

**14 · DX e build (4).** TypeScript estrito, alias `@/`, lint com catraca de tamanho, orçamentos, CI em Windows e Linux,
mocks de IPC para e2e (`e2e/mock-ipc.ts`). As regras do React Compiler ainda só avisam.

## 7. Scorecard

| Dimensão | Nota | Justificativa | Evidência principal |
|---|---:|---|---|
| 1 · Arquitetura e organização | 3 | Modos lazy e stores por domínio; o shell concentra estado e modais em 1118 linhas. | `src/App.tsx:25-79`, `ModeViews.tsx:29-42`, `file-size-baseline.json` |
| 2 · Componentização e reuso | 3 | Primitivas completas e Radix barrado; 516 botões e 126 campos crus fora delas. | `src/ui/index.ts`, `eslint.config.js`, FE-M-03 |
| 3 · Design system e consistência | 3 | Tokens gerados, documentação e catracas; 19 mil linhas de CSS legado contra 29 CSS Modules. | `tests/design-lint.test.ts:72-122`, `src/design/tokens/` |
| 4 · UX dos fluxos críticos | 2 | Aprovar pedidos e alterar banco em produção ainda acontece sem ver o que vai rodar. | #228 P1-0 a P1-8, P2-5; FE-M-09, FE-M-12 |
| 5 · Acessibilidade | 3 | axe `wcag22aa` por PR e alternativas ao arrasto; leitor de tela sem registro com pessoa e alvos abaixo de 24 px. | `wcag-2.2.md`, `screen-reader-1.4.md`, #228 P3-2 |
| 6 · Responsividade | 2 | Poucas container queries; a matriz de telas ainda é rascunho. | grep em `src/**/*.css`; #199 |
| 7 · Performance e bundle | 4 | Orçamentos e gate de performance na CI, grade e timeline em janela. | `verify-bundle-budgets.mjs:24-31,72-77`, `ResultGrid.tsx:28` |
| 8 · Estado e dados | 3 | Seletores quase sempre, `persist` mínimo e seguro. | `editor.store.ts:383-387`, FE-M-05 |
| 9 · Erros e resiliência | 2 | Limites por modo e painel; sidebars sem limite, crash sem rastro, saída sem guarda. | `ErrorBoundary.tsx`, `App.tsx:829,935`, FE-M-01, FE-M-10, FE-M-15 |
| 10 · Segurança no cliente | 3 | CSP, sandbox, markdown seguro; links de agente sem confirmação e CSP sem teste. | `electron.vite.config.ts:212-239`, `ThreadMarkdown.tsx:33-35`, FE-M-02, FE-M-04 |
| 11 · i18n | 3 | Infraestrutura boa; 31 de 227 componentes travados contra texto fixo. | `src/i18n/index.ts`, `tests/ui-copy.test.ts:27` |
| 12 · Testes e qualidade | 3 | Base ampla; cobertura mínima baixa e misturada, 78 componentes sem teste citado. | `vitest.config.ts:17-19`, inventário |
| 13 · Observabilidade no cliente | 2 | Marca de boot e diário no main; a interface não manda nada para o diário. | `startupTiming.ts`, `diagnostics.ipc.ts:154-171`, FE-M-01 |
| 14 · DX e build | 4 | Tipos estritos, catracas, orçamentos e CI em duas plataformas. | `tsconfig.json`, `eslint.config.js:22-26`, `check-file-size.mjs` |

Média simples: 2,9.

## 8. Achados

Só entram aqui achados novos, ou já mapeados quando trazem evidência ou gravidade nova. O mapeamento para itens do
roadmap foi feito pelo coordenador em 30/10/2026: **F24** é o item novo de segurança e resiliência do frontend, **F26**
o de não perder nada ao fechar, **F27** o de acabamento da onda 4, e **B15** o item novo do BACKEND.

| ID | Severidade | Dimensão | Componente(s) | Problema | Evidência | Impacto | Recomendação | Esforço | Já mapeado / Em PR |
|---|---|---|---|---|---|---|---|---|---|
| FE-M-09 | **Alta** | UX, Segurança | `MongoWorkbench`; `mongo.write` no main | Uma escrita Mongo (inserir, substituir, apagar) numa conexão de produção pede só um clique em "Confirmar". O SQL exige o nome digitado, que o main confere. `typedConfirmation` vale para toda conexão de produção, mas o caminho Mongo não o lê. Os motivos chegam como frases em inglês do main. | `shared/oxequerySafety.ts:34`; `oxequery-guard.ts:56` e `SqlWorkbench.tsx:383-390` (SQL); `service.ts:388-398` só confere `input.confirmed`; `MongoWorkbench.tsx:264-268` | Apagar ou substituir um documento de produção com um clique, contra a política declarada. | O main recusa `mongo.write` em produção com `confirm-name` sem o nome certo. O `MongoWorkbench` pede o nome como o `SqlWorkbench`, e os motivos vêm como códigos C3. Testes: unidade no main para os dois casos e e2e no mock de Mongo de produção. | P | **B15** (main) e **F24** (tela). Comunicado ao coordenador em 30/10. |
| FE-M-02 | Média | Segurança, UX | `ThreadMarkdown`, `MarkdownPreview` | Links no texto do agente mostram só o texto escolhido pelo agente e abrem direto no navegador, sem `title` com a URL nem confirmação. `[docs.anthropic.com](https://outro.exemplo)` parece um link para a documentação. Não há confirmação em nenhum caminho: `window.open` → `setWindowOpenHandler` → `shell.openExternal`, filtrando só o protocolo. | `ThreadMarkdown.tsx:33-35`; `MarkdownPreview.tsx:22-28`; `electron/main/index.ts:858-861`; `utils/external-url.ts:1-10` | Phishing barato dentro de um app em que a pessoa confia no que lê. | Mostrar o host real ao lado do texto quando ele difere do host do `href` e pôr a URL completa no `title`. Abrir um host novo pede confirmação com o host em destaque e a opção de lembrar o domínio. Teste com texto e destino diferentes. | P | **F24**. |
| FE-M-08 | Média | UX, Segurança | `TerminalView` | O terminal carrega `WebLinksAddon` com o handler padrão, que chama `window.open()` sem URL e só depois troca o endereço. O main nega toda janela nova e só repassa URLs `http(s)`, então, pela leitura do código, clicar num link do terminal não abre nada. Também não exige Ctrl, e um conserto ingênuo abriria qualquer URL que um agente imprimir com um clique simples. | `TerminalView.tsx:216`; handler padrão em `@xterm/addon-web-links` 0.11.0 (`window.open()` e depois `location.href`); `index.ts:858-861` | Recurso quebrado em silêncio. Quando consertado, vira o mesmo vetor do FE-M-02. | Passar um handler próprio que exige Ctrl/Cmd+clique, mostra o host e usa o mesmo caminho de confirmação do FE-M-02. Um e2e clica num link do terminal e confere a chamada de `openExternal` no mock. **Não verificável aqui** sem rodar. | P | **F24**. |
| FE-M-12 | Média | UX | `SqlWorkbench` (confirmação) | A confirmação de destrutivo e de produção lista os motivos, mas não mostra o comando que vai rodar. Num editor com várias instruções, "rodar a atual" ou um trecho selecionado é confirmado sem ver qual instrução é. | `SqlWorkbench.tsx:381-391` (só `pending.reasons`; `pending.text` não aparece) | Decisão às cegas no fluxo humano, a mesma que o #228 P1-1 descreve para o agente. | Mostrar o texto exato em bloco monoespaçado e rolável, com a posição no editor, acima dos motivos. Teste com duas instruções e o cursor na segunda. | P | **F24** (as confirmações de SQL e Mongo mostram o comando que vai rodar). Relacionado: #228 P1-1/P1-2. |
| FE-M-01 | Média | Observabilidade, Erros | `ErrorBoundary`, shell | O ErrorBoundary só faz `console.error`, e o main só repassa o console do renderer em dev. Não há `window.onerror` nem `unhandledrejection`. Em build empacotado, um crash de React (como o P2-5) não chega ao log nem ao diário de incidentes, que só registra `render-process-gone`. | `ErrorBoundary.tsx:33-35`; `electron/main/index.ts:896-898` (`if (isDev && level >= 2)`); `diagnostics.ipc.ts:154-171` | O fluxo "diagnosticar um problema" fica cego para a falha mais comum do frontend. | `componentDidCatch` e os handlers globais mandam código, componente e pilha resumida ao diário (`incident.renderer.boundary`), sem o texto do erro quando ele puder ter dado do usuário. Teste: um componente que lança aparece no diário. | P | **F24**. Fronteira com B8.3 e F11 (#205). |
| FE-M-10 | Média | Erros, UX | `EditorPane`, shell | Fechar a janela ou sair do app com edição não salva no editor não pergunta nada. Fechar o workspace é barrado (com aviso em inglês), mas não há `beforeunload` no renderer nem consulta do main antes de fechar. | `App.tsx:512-515` (só o workspace); nenhum `beforeunload` em `src/`; `electron/main/index.ts:490-505` (`before-quit` sem consultar a janela); `editor.store.ts:380-381` (`hasDirtyEditor` existe) | Perda silenciosa de trabalho. | Antes de fechar, o main pergunta à janela; com edição pendente, o app mostra Salvar tudo, Descartar ou Cancelar (como Settings). Teste e2e com um arquivo sujo. | M | **F26** (nada se perde ao fechar; CCR com o BACKEND sobre o ciclo de saída). |
| FE-M-03 | Média | Componentização, A11y | toda a interface; mais em `MongoWorkbench` (20), `WebPreviewPanel` (15), `ThreadConfigurationBar` (14), `TableEditor` (14), `PaneContainer` (13), `ChangesPanel` (13) | 516 `<button>` crus contra 409 `<Button>`/`<IconButton>`, e 126 campos crus. O lint barra Radix, mas não o elemento cru. Correções feitas na primitiva (alvo de 24 px, foco, `loading`) deixam de fora mais da metade dos botões. | grep em `src/components` e `src/App.tsx`; `eslint.config.js` | O 2.5.8 depende do CSS de cada tela; o #246 corrige só as primitivas. | Catraca no `design-lint` com o número atual de `<button` e `<input` crus fora de `src/ui`, que só desce; migração por área junto com a F1. | M | **F22** (catraca de `<button>` cru). Relacionado: #228 P3-2, Em PR #246. |
| FE-M-04 | Baixa | Segurança, DX | `index.html`, build | A CSP entra por `html.replace('<meta charset="UTF-8" />', …)`. Se essa linha mudar, a CSP some em silêncio, e nenhum teste confere que `out/renderer/index.html` a tem. | `electron.vite.config.ts:212-239`; nenhum resultado para `Content-Security-Policy` em `tests/`, `e2e/`, `scripts/` | O `SECURITY_MODEL.md:57` conta com `connect-src 'self'`. | `verify-bundle-budgets.mjs` falha sem a meta CSP com `script-src 'self'` e `connect-src 'self'`; o plugin falha o build se não achar a linha. | P | **F24**. |
| FE-M-11 | Baixa | i18n, Arquitetura | `ThreadRequestCard` | O cartão decide se o pedido é de alterações de arquivo comparando o título em inglês vindo do main (`request.title === 'Approve file changes'`). Quando o título virar código C3, a prévia de arquivos some sem erro. | `ThreadRequestCard.tsx:97` | Regressão silenciosa no cartão de aprovação. | Um campo tipado no pedido (`approvalKind: 'fileChanges'`) e o título só para exibição. Teste de contrato. | P | Corrigir no próprio #243 (F18), pelo código ou tipo do pedido, nunca pelo título. |
| FE-M-05 | Baixa | Performance, Estado | `EditorPane`, `SettingsModal` (voz) | `useEditorStore()` sem seletor para pegar as ações: o painel com Monaco re-renderiza a cada mudança de qualquer workspace no store. | `EditorPane.tsx:50-51`; `SettingsModal.tsx:683` | Re-render extra; o custo real é **Não verificável aqui** (`bench:ui` com dois workspaces). | Ações por `useShallow` ou `getState()` nos handlers, como em `TerminalPane.tsx:34`. | P | **F7**. |
| FE-M-06 | Baixa | UX | `ChangesPanel` | O X da barra descarta todos os comentários de revisão do workspace num clique, sem confirmação e sem desfazer. | `ChangesPanel.tsx:293` | Perda de revisão escrita à mão, ao lado de "Enviar". | Toast com Desfazer (a primitiva aceita ação) ou ConfirmDialog com mais de um comentário. | P | **F24**. |
| FE-M-13 | Baixa | A11y | `useModalSurface` (MCP, Skills, Scripts, Linear, Semantic, Web Preview) | A armadilha de foco feita à mão descarta só `[hidden]` e `[inert]`; elementos escondidos por CSS entram na lista e o Tab pode cair num controle invisível. O fundo não fica `inert`. | `useModalSurface.ts:3,22-28`; `ToolPanel.tsx:23` | Foco perdido em painéis com seções recolhidas; o leitor de tela pode sair do painel pelo cursor virtual. **Não verificável aqui** (roteiro NVDA/Orca). | Trocar pelo `ModalSurface` (Radix) ou filtrar por `checkVisibility()` e marcar o resto da janela com `inert`. | P | **F27** (onda 4). |
| FE-M-14 | Baixa | A11y | `Button`, `ConfirmDialog` | `loading` vira `disabled`: o botão com foco perde o foco do teclado enquanto a ação roda, e no `ConfirmDialog` com `busy` até o Cancelar fica desabilitado. | `Button.tsx:22-23`; `ConfirmDialog.tsx:29-30` | Quem usa teclado ou leitor de tela perde a posição no meio da ação. | `aria-disabled` com clique ignorado durante `loading`, mantendo o foco. | P | **F27** (onda 4). |
| FE-M-15 | Baixa | Erros | `Sidebar`, `ThreadSidebar`, `DataSidebar` | As sidebars não têm limite de erro próprio; uma falha nelas cai no limite da janela inteira. | `App.tsx:829-835` (sidebars) contra `App.tsx:935` (janela) e `ModeViews.tsx:39` (só a área de trabalho) | Uma lista quebrada derruba o app inteiro, como no P2-5. | Um `ErrorBoundary compact` em cada sidebar. | P | **F27** (onda 4). Relacionado: #228 P2-5 (Em PR #251). |
| FE-M-16 | Baixa | Testes | cobertura | O mínimo de cobertura (35% de linhas, 25% de ramos) mede renderer, main e `shared` juntos; não há número nem piso do renderer. | `vitest.config.ts:14-19` | A cobertura da interface pode cair sem quebrar a CI. **Não verificável aqui** (o número atual sai de `npm run test:coverage`). | Piso por pasta (`thresholds['src/**']`) com o valor atual, como catraca. | P | **F27** (onda 4). |
| FE-M-07 | Baixa | i18n | `App.tsx` | Rótulos passados ao ErrorBoundary migrado ("the conversations", "this window"), `aria-label="Thread sidebar"`, as razões de "Team" e o aviso de workspace são fixos em inglês. Em pt-BR sai "Não foi possível mostrar the conversations". | `App.tsx:513,658,829,865,935` | Erro e nome acessível misturando idiomas. | `App.tsx` na lista `MIGRATED` com essas chaves. | P | **F6** / #197 (evidência nova). |

## 9. Padrões positivos a preservar

- **Confirmação com consequência obrigatória.** `ConfirmDialog` exige `description` por tipo e põe o foco no botão
  seguro (`ConfirmDialog.tsx:9-10,29`). O OxePod mostra volumes e que a remoção é definitiva, e o main exige
  `confirmed` (`ContainerDetail.tsx:56,103-105`).
- **Defesa nas duas pontas.** O SQL de produção pede o nome na tela e o main confere de novo (`oxequery-guard.ts:56`).
  É o modelo que o FE-M-09 pede para o Mongo.
- **Rascunhos sem segredos.** O cartão de pedido guarda as respostas em memória, nunca as marcadas como secretas, com
  limite de 100 (`ThreadRequestCard.tsx:13,49-54`); o editor não persiste conteúdo (`editor.store.ts:383-387`).
- **Recuperação de foco.** `Dialog` e a paleta devolvem o foco ao gatilho, ou ao campo principal da tela se ele sumiu
  (`Overlay.tsx:44-52`, `CommandPalette.tsx:21-37`).
- **Modos montados e escondidos.** Conexões, abas e rascunhos sobrevivem à troca de modo (`ModeViews.tsx:29-42`).
- **Catracas que só descem** para tamanho de arquivo, `!important`, keyframes, estados feitos à mão e orçamentos.
- **Markdown seguro por padrão.** Sem HTML, sem imagem remota e só `http(s)` em links (`ThreadMarkdown.tsx:28-37`).
- **Datas e números pelo idioma da interface** (`formatTime.ts:4-14`) e catálogos sem flash com `use()`.
- **Prévia editável do relato** antes de sair do app (`ReportProblem.tsx:47-50`).

## 10. Roadmap

**Quick wins (até 2 semanas), mira: nível 3 em todas as dimensões, cabe na 1.4.**
- FE-M-09 (B15 + F24): nome digitado para escrita Mongo em produção, nos dois lados.
- FE-M-12: o comando exato na confirmação do SQL.
- FE-M-02 e FE-M-08 (F24): host visível, confirmação para host novo e handler próprio no terminal.
- FE-M-01 (F24): crashes de React no diário de incidentes.
- FE-M-04 (F24): verificação da CSP no `verify:bundle`.
- FE-M-06, FE-M-14, FE-M-15, FE-M-11: um PR pequeno cada.
- Fechar os PRs já abertos que tiram a nota 2 dos fluxos críticos: #243/#238 (aprovações), #251 (P2-5), #244/#239
  (pasta inexistente), #245 (toasts), #246 (alvos).

**Curto prazo (1 a 2 meses), mira: 3 → 4 em A11y, Erros, Observabilidade e Testes.**
- FE-M-10: guarda de saída para edição não salva, com o main consultando a janela.
- FE-M-03 (F22): catraca de botões e campos crus e migração por área junto com a F1.
- FE-M-13: uma só armadilha de foco (Radix) para os ToolPanels.
- FE-M-16: piso de cobertura do renderer como catraca.
- F6 completa (`MIGRATED` cobrindo `src/**`) e registro do roteiro NVDA/Orca com pessoa (F4).

**Estrutural (trimestre), mira: 4 em Arquitetura, Design system e Responsividade.**
- Quebrar `App.tsx` em shell, roteador de modo e host de modais, abaixo de 1000 linhas, e fazer o mesmo com
  `SettingsModal`, `GitHubPanel` e `SkillsBrowser`.
- Migrar o CSS global para CSS Modules por área, com catraca de linhas de CSS legado.
- F5 com a matriz de telas como gate de lote, e container queries nos painéis.
- Regras do React Compiler como erro, área por área.

## 11. Lacunas: o que ficou "Não verificável aqui"

| Item | Como verificar |
|---|---|
| Links do terminal não abrem (FE-M-08) | e2e que imprime uma URL no terminal mock, clica com e sem Ctrl e confere `openExternal` |
| Contraste real, foco visível, ordem de leitura | `a11y-axe.yml` e o roteiro `screen-reader-1.4.md` com pessoa (NVDA e Orca) |
| Armadilha de foco nos ToolPanels (FE-M-13) | roteiro NVDA/Orca no painel MCP com uma seção recolhida |
| Custo de re-render do editor (FE-M-05) e INP | `npm run bench:ui` com dois workspaces e o editor aberto; F7 com `OXESPACE_PERF_GATE=1` |
| Cobertura do renderer separada do main (FE-M-16) | `npm run test:coverage` com `include: ['src/**']` |
| Avisos das regras do React Compiler hoje | `npm run lint` (o `eslint.config.js` diz 165 na entrada) |
| Que crashes de React somem no build empacotado (FE-M-01) | e2e do pacote (`ci.yml`, "E2E packaged …") forçando um erro de render e lendo o diário |
| Perda de edição ao fechar a janela (FE-M-10) | e2e com um arquivo sujo e `app.close()` |
| Pareamento do celular | avaliar quando o #221 chegar à `main` |
