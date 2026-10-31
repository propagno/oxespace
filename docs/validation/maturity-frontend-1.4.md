# Maturidade do frontend · OXESpace 1.4

Avaliação independente, só de leitura, do renderer (`src/`), das primitivas (`src/ui/`), dos tokens (`src/design/`) e do
preload no que a interface consome. `electron/main` e `mobile/` ficam com outras avaliações.

- **SHA avaliado:** `origin/main` `bab99b505c2f0296582aff583571311567771aff` (merge do #237, 30/10/2026).
- **Método:** leitura de código, `git` e `gh` (só leitura). Nada foi compilado nem executado: build, testes, e2e,
  Electron e benchmarks ficaram de fora por regra. O que só se prova rodando está marcado como **Não verificável aqui**,
  com o job ou o comando que provaria.
- **Etapa:** 1 de 2 (Fases 1 e 2 e scorecard preliminar). A etapa 2 traz a análise componente a componente (Fase 3), a
  transversal (Fase 4), o roadmap e as notas por componente.
- **Referências já lidas e não repetidas:** `docs/ARCHITECTURE.md`, `docs/roadmap-1.4/*` (F*, B*, M*, C1–C7),
  `docs/validation/redesign-audit-1.4.md` (PR #228, ainda em rascunho; lido do branch `docs/redesign-audit-1.4`),
  `wcag-2.2.md`, `offer-audit-1.4.md`, `screen-reader-1.4.md`, `mcp-coverage-1.4.md`, `docs/SECURITY_MODEL.md`.

## 1. Resumo executivo

Nota geral preliminar: **2,9 de 5 (Definido)**. O frontend tem processo e catracas acima da média para um app desse
tamanho, mas a experiência dos fluxos sensíveis e a observabilidade de falhas ainda não acompanham.

Forças:
1. Orçamentos de bundle e de boot verificados na CI, com folga mínima de 5% (`scripts/verify-bundle-budgets.mjs:24-31`),
   e modos inteiros carregados sob demanda (`src/components/Navigation/ModeViews.tsx:7-13`).
2. Catracas que só descem para tamanho de arquivo, `!important`, keyframes, vazios e alertas feitos à mão
   (`scripts/check-file-size.mjs:11`, `tests/design-lint.test.ts:72-122`).
3. Acessibilidade verificada por axe com `wcag22aa` em toda PR, em Linux e Windows (`docs/validation/wcag-2.2.md`).

Riscos:
1. Aprovações de agente ainda dependem do diálogo nativo e do cartão do OxeChat que esconde o comando (Já mapeado:
   #228 P1-0 a P1-8; Em PR #243 e #238).
2. Um crash de React em build empacotado não deixa rastro: o ErrorBoundary só escreve no console, e o main só repassa o
   console em dev (FE-M-01, novo).
3. Mais da metade dos botões não usa a primitiva (516 `<button>` contra 409 `<Button>`/`<IconButton>`), então correções
   feitas nas primitivas, como o alvo de 24 px do #246, não alcançam a maior parte da interface (FE-M-03, novo).

## 2. Stack detectada

Versões resolvidas no `package-lock.json` do SHA avaliado:

| Peça | Versão | Observação |
|---|---|---|
| React / React DOM | 19.3.1 | `use()` já é usado para catálogos lazy (`src/i18n/index.ts:46-60`) |
| TypeScript | 5.9.3 | `strict: true`, sem `allowJs` (`tsconfig.json`) |
| Zustand | 5.0.16 | 38 stores em `src/store/` |
| Vite / electron-vite | 6.4.4 / 5.0.0 | CSP de produção injetada no build (`electron.vite.config.ts:212-239`) |
| Electron | 44.9.3 | `contextIsolation` e `sandbox` ligados (`electron/main/index.ts:761-766`) |
| Radix | `radix-ui` 1.8.1 | proibido fora de `src/ui` por lint (`eslint.config.js`, `no-restricted-imports`) |
| cmdk | 1.1.1 | paleta de comandos |
| i18next / react-i18next | 26.5.11 / 17.1.9 | en e pt-BR; catálogos por chunk, namespaces lazy `oxequery`, `pods`, `post` |
| xterm / Monaco | 5.5.0 / 0.57.0 | WebGL do xterm como addon |
| Estilo | CSS global em camadas + 29 CSS Modules | cerca de 19 mil linhas de CSS; não há Tailwind no lockfile do SHA (o bootstrap Tailwind/shadcn do Orca não chegou à `main`) |
| Testes | Vitest 5.0.5 (jsdom), Testing Library, Playwright 1.64.1, `@axe-core/playwright` 4.14 | 215 arquivos em `tests/`, 85 specs em `e2e/` |
| Lint | ESLint 10, `typescript-eslint` 8, `eslint-plugin-react-hooks` 7 | regras do React Compiler só como aviso (`eslint.config.js:22-26`, "165 lugares") |

## 3. Fase 1 · Reconhecimento

**Estrutura.** `src/App.tsx` (1118 linhas) monta o shell, o seletor de modo e quase todos os modais. Os modos são
`code` (OxeCode), `thread` (OxeChat), `data` (OxeQuery), `pods` (OxePod) e `post` (OxePost). Os três últimos montam na
primeira visita e ficam montados escondidos (`ModeViews.tsx:29-42`), o que preserva conexões e rascunhos entre trocas.
Settings, a paleta, o MCP, Skills, Linear e o painel semântico são lazy (`App.tsx:25-79`).

**Volume.** 227 componentes `.tsx` e 185 módulos `.ts` em `src/`, cerca de 47,7 mil linhas. As maiores telas estão
congeladas pela catraca de 1000 linhas: `GitHubPanel.tsx` (1800), `SettingsModal.tsx` (1396), `SkillsBrowser.tsx`
(1391) e `App.tsx` (1120) (`scripts/file-size-baseline.json`).

**Design system.** Tokens em `src/design/tokens/` (`palette`, `semantic`, `scales`, `color`, `css`) geram
`src/styles/tokens.generated.css`; `docs/design/brand.md` e `motion.md` documentam marca e movimento. As primitivas
exportadas por `src/ui/index.ts` são: Button, IconButton, ButtonGroup, TextField, TextArea, Select, Checkbox, Switch,
SegmentedControl, Kbd, FieldError, ConfirmDialog, Dialog, Popover, Menu, AnchoredMenu, Tooltip, Badge, StatusDot,
Panel, Toolbar, EmptyState, ErrorState, SuccessState, OfflineState, Notice, LoadingState, Skeleton, Spinner, Separator,
Tabs, Meter, Avatar, BrandLoader, Toast, TitleTooltips, ToolPanel, Splitter, além de `useModalSurface` e `copyText`. O
catálogo vivo é `src/components/DesignSystem/DesignSystemPage.tsx`.

**Catracas de design** (`tests/design-lint.test.ts`): `!important` ≤ 59 (linha 74), spinners feitos à mão = 0 (94),
três keyframes (96), classes `-empty` ≤ 2 (107), `role="alert"` fora das primitivas ≤ 11 (110), durações fixas = 0 nos
CSS Modules (116). O aceite da F1 pede `-empty` = 0 e `role="alert"` = 0 (Já mapeado: F1).

**Testes e CI.** `ci.yml` roda, em Windows e Linux: auditoria de dependências, typecheck, lint (inclui a catraca de
tamanho), Vitest com cobertura, build com orçamentos, ensaio de upgrade, gate de cobertura do OxeQuery, e2e smoke, gate
de performance e2e e o pacote instalado. `a11y-axe.yml` roda axe por PR; `visual-regression.yml` e
`visual-baselines.yml` cuidam do visual por lote. A cobertura mínima é 35% de linhas e 25% de ramos, medida sobre
`src`, `electron/main` e `shared` juntos (`vitest.config.ts:17-19`), então não há número próprio do renderer.

**i18n.** O catálogo da interface vive em `src/i18n/locales/*.ts` e `shared/locales/*/*.json`. `tests/ui-copy.test.ts`
mantém a lista `MIGRATED` (31 arquivos de `src/`) que não pode ter texto fixo; o resto está na F6 (Já mapeado: F6, #197).

## 4. Fase 2 · Inventário de componentes

Gerado por script sobre o SHA avaliado (não à mão): cada `.tsx` de `src/` classificado pelo caminho e pelo conteúdo.

- **Tipo:** Primitiva = `src/ui/`; Página/modo = `*View`, `*Page`, `*Mode` e `App.tsx`; Modal/diálogo = usa `Dialog`,
  `ConfirmDialog`, `ModalSurface`, `useModalSurface` ou `role="dialog"`; Layout = navegação, grade, painéis, sidebar,
  workbench; Container = lê store ou chama a API do preload; Apresentacional = o resto.
- **Estados:** C carregando, V vazio, E erro, O offline, S sucesso (toast ou SuccessState), detectados pelo uso das
  primitivas ou de flags de carregamento. É indício, não prova de que o estado aparece na tela.
- **A11y:** número de atributos `aria-*` e `role=` no arquivo (densidade, não qualidade).
- **Testes:** arquivos de `tests/` e `e2e/` que citam o nome do componente.
- **i18n:** se o arquivo traduz (`useTranslation`, `t(`, `i18n.t(`); "literais" conta textos em inglês entre tags.
- A **nota** por componente sai na etapa 2, junto com a análise da Fase 3.

Totais: 227 componentes, sendo 12 primitivas, 8 páginas/modos, 52 modais e diálogos, 21 de layout, 70 containers e 64
apresentacionais. 78 não são citados por nenhum teste; 61 não traduzem, e 20 deles têm texto em inglês na marcação.

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

## 5. Scorecard preliminar

| Dimensão | Nota | Justificativa | Evidência principal |
|---|---:|---|---|
| 1 · Arquitetura e organização | 3 | Modos lazy e stores por domínio; o shell ainda concentra estado e modais num arquivo de 1118 linhas. | `src/App.tsx:25-79`, `ModeViews.tsx:29-42`, `file-size-baseline.json` |
| 2 · Componentização e reuso | 3 | Primitivas completas e Radix barrado por lint, mas 516 botões e 126 campos crus fora delas. | `src/ui/index.ts`, `eslint.config.js` (`no-restricted-imports`), FE-M-03 |
| 3 · Design system e consistência | 3 | Tokens gerados, documentação de marca e movimento e catracas; 19 mil linhas de CSS legado com só 29 CSS Modules. | `tests/design-lint.test.ts:72-122`, `src/design/tokens/` |
| 4 · UX dos fluxos críticos | 2 | Aprovar pedido de agente ainda engana ou esconde o texto; split pode derrubar a janela. Tudo já mapeado, com PRs abertos. | #228 P1-0 a P1-8, P2-5; #243, #251 |
| 5 · Acessibilidade | 3 | axe `wcag22aa` por PR e roteiro de leitor de tela escrito; o roteiro com pessoa ainda não foi registrado e há alvos abaixo de 24 px. | `wcag-2.2.md`, `screen-reader-1.4.md`, #228 P3-2 |
| 6 · Responsividade | 2 | 18 `@container` contra 34 `@media … max-width`; a matriz 960×640 a 4K é a F5, ainda em rascunho. | grep em `src/**/*.css`; #199 (rascunho) |
| 7 · Performance e bundle | 4 | Orçamentos de entrada e de boot com folga mínima na CI, gate e2e de performance, grade do OxeQuery em janela. | `verify-bundle-budgets.mjs:24-31,72-77`, `ResultGrid.tsx:28`, `ci.yml` (gate de performance) |
| 8 · Estado e dados | 3 | Seletores na grande maioria (161 com seletor, 6 sem); cache e deltas do OxeChat isolados. | `src/store/threadDelta.ts`, FE-M-05 |
| 9 · Erros e resiliência | 2 | ErrorBoundary por modo, painel e terminal, e OfflineState novo; o Code e as sidebars caem no limite da janela inteira. | `ErrorBoundary.tsx`, `App.tsx:865,935`, #228 P2-5 |
| 10 · Segurança no cliente | 3 | CSP de produção, sandbox, nenhum `dangerouslySetInnerHTML`, markdown sem HTML; links de agente escondem o destino e a CSP não tem teste. | `electron.vite.config.ts:212-239`, `ThreadMarkdown.tsx:33-35`, FE-M-02, FE-M-04 |
| 11 · i18n | 3 | i18next com catálogos lazy e teste de catálogo; 61 componentes ainda sem tradução (F6 em andamento). | `src/i18n/index.ts`, `tests/ui-copy.test.ts:27`, F6 |
| 12 · Testes e qualidade | 3 | Base ampla de unidade, e2e, axe e visual; cobertura mínima baixa e sem número do renderer, 78 componentes sem teste citado. | `vitest.config.ts:17-19`, inventário |
| 13 · Observabilidade no cliente | 2 | Marca de interatividade no boot e diário de incidentes no main; crashes de React não chegam a ele. | `src/lib/startupTiming.ts`, `diagnostics.ipc.ts:154-171`, FE-M-01 |
| 14 · DX e build | 4 | TypeScript estrito, lint com catraca de tamanho, orçamentos e CI em duas plataformas; as regras do React Compiler ainda só avisam. | `tsconfig.json`, `eslint.config.js:22-26`, `check-file-size.mjs` |

Média simples: 2,9.

## 6. Achados preliminares

Achados novos da etapa 1. Os já mapeados aparecem só quando há evidência ou gravidade nova. A etapa 2 completa a
tabela com a Fase 3.

| ID | Severidade | Dimensão | Componente(s) | Problema | Evidência | Impacto | Recomendação | Esforço | Já mapeado / Em PR |
|---|---|---|---|---|---|---|---|---|---|
| FE-M-01 | Média | Observabilidade, Erros | `ErrorBoundary`, shell | O ErrorBoundary só faz `console.error`, e o main só repassa o console do renderer em dev. Não há `window.onerror` nem `unhandledrejection`. Em build empacotado, um crash de React (como o P2-5) não chega ao log nem ao diário de incidentes, que só registra `render-process-gone`. | `src/components/common/ErrorBoundary.tsx:33-35`; `electron/main/index.ts:896-898` (`if (isDev && level >= 2)`); `diagnostics.ipc.ts:154-171` | O fluxo "diagnosticar um problema" fica cego para a falha mais comum do frontend: a pessoa vê "não foi possível mostrar", relata, e o pacote de diagnóstico não tem nada. | `componentDidCatch` e os handlers globais mandam código, componente (o `label`) e a pilha resumida ao diário (`incident.renderer.boundary`), sem o texto do erro se ele puder ter dado do usuário. Teste: um componente que lança aparece no diário. Fronteira com o BACKEND (canal do diário). | P | Novo. Toca a F11 (#205, diagnóstico) e o B8.3. |
| FE-M-02 | Média | Segurança no cliente, UX | `ThreadMarkdown`, `MarkdownPreview` | Links no texto do agente mostram só o texto escolhido pelo agente e abrem direto no navegador, sem `title` com a URL nem confirmação. `[docs.anthropic.com](https://outro.exemplo)` parece um link para a documentação. | `src/components/Threads/ThreadMarkdown.tsx:33-35` | Conteúdo de agente é não confiável. É phishing de baixo custo dentro de um app em que a pessoa confia no que lê. | Mostrar o host real ao lado do texto quando ele difere do host do `href` e pôr a URL completa no `title`; um teste com texto e destino diferentes. | P | Novo. |
| FE-M-03 | Média | Componentização, A11y | toda a interface, maiores ocorrências em `MongoWorkbench`, `WebPreviewPanel`, `ThreadConfigurationBar`, `TableEditor`, `PaneContainer`, `ChangesPanel` | 516 `<button>` crus contra 409 `<Button>`/`<IconButton>`, e 126 `<input>`/`<select>`/`<textarea>` crus. O lint barra Radix, mas não barra o elemento cru. Toda correção feita na primitiva (alvo de 24 px, foco, estados `loading`) deixa de fora mais da metade dos botões. | contagem por grep em `src/components` e `src/App.tsx`; `eslint.config.js` (só `radix-ui` é restrito) | O WCAG 2.5.8 depende do CSS de cada tela; o #246 corrige só as primitivas. A consistência visual fica por arquivo. | Uma catraca no `design-lint` com o número atual de `<button` e `<input` crus fora de `src/ui`, que só desce, e migração por área junto com a F1. | M | Relacionado: #228 P3-2, F4, Em PR #246 (só primitivas). |
| FE-M-04 | Baixa | Segurança no cliente, DX | `index.html`, build | A CSP de produção entra por `html.replace('<meta charset="UTF-8" />', …)`. Se essa linha mudar, a CSP some em silêncio, e nenhum teste ou verificação de bundle confere que `out/renderer/index.html` tem a CSP. | `electron.vite.config.ts:212-239`; nenhum resultado para `Content-Security-Policy` em `tests/`, `e2e/` e `scripts/` | O `docs/SECURITY_MODEL.md:57` conta com `connect-src 'self'`; perdê-la abre o renderer, que tem a API do preload, a qualquer script injetado. | `verify-bundle-budgets.mjs` (ou um teste) falha se `out/renderer/index.html` não tiver a meta CSP com `script-src 'self'` e `connect-src 'self'`; o plugin falha o build se não achar a linha. | P | Novo. |
| FE-M-05 | Baixa | Performance, Estado | `EditorPane`, `SettingsModal` (voz) | `useEditorStore()` sem seletor para pegar as ações: o painel com Monaco re-renderiza a cada mudança de qualquer workspace no store do editor. | `src/components/Editor/EditorPane.tsx:50-51`; `SettingsModal.tsx:683` | Re-render extra do editor enquanto outro workspace digita ou salva. O custo real é **Não verificável aqui** (`bench:ui` com dois workspaces e o editor aberto provaria). | Ler as ações com `useShallow` ou com `useEditorStore.getState()` nos handlers, como já faz `TerminalPane.tsx:34`. | P | Novo. |
| FE-M-06 | Baixa | UX | `ChangesPanel` (comentários de revisão) | O botão X da barra descarta todos os comentários de revisão do workspace num clique, sem confirmação e sem desfazer. | `src/components/Changes/ChangesPanel.tsx:293` | Perda de trabalho de revisão escrito à mão por um clique ao lado de "Enviar". | Toast com Desfazer (a primitiva Toast já aceita ação) ou ConfirmDialog quando houver mais de um comentário. | P | Novo. |
| FE-M-07 | Baixa | i18n | `App.tsx` (limites de erro, sidebar) | Os rótulos passados ao ErrorBoundary migrado são fixos em inglês ("the conversations", "this window") e entram na frase traduzida; `aria-label="Thread sidebar"` e as razões de "Team" também são fixas. Em pt-BR sai "Não foi possível mostrar the conversations". | `src/App.tsx:658,829,865,935` | Mensagem de erro e nome acessível misturando idiomas. | Entra na F6: `App.tsx` na lista `MIGRATED` com essas chaves. | P | Já mapeado: F6 (evidência nova). |

## 7. Lacunas da etapa 1

- Contraste real, foco visível e ordem de leitura: **Não verificável aqui**; `a11y-axe.yml` e o roteiro
  `screen-reader-1.4.md` com pessoa provariam.
- Custo de re-render e INP: **Não verificável aqui**; `npm run bench:ui` e o gate de performance e2e da `ci.yml`.
- Cobertura do renderer separada do main: **Não verificável aqui**; `npm run test:coverage` com `include: ['src/**']`.
- Número de avisos das regras do React Compiler hoje: **Não verificável aqui**; `npm run lint` (o comentário do
  `eslint.config.js` diz 165 na entrada).
