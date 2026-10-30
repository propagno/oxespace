# Homologação 1.4.0

Registro da sessão de homologação (product manager + QA). Cada item do roadmap 1.4 entra aqui depois do merge na
`main`. Ele é percorrido como uma pessoa exigente usaria o app e confrontado com o aceite de
`docs/roadmap-1.4/*.md`. O item só conta como feito no roadmap depois de **mergeado e homologado**.

## Como é feita

- Build da `origin/main` numa worktree própria (`npx electron-vite build`), nunca a pasta principal nem o userData real.
- Perfil de teste: `e2e/helpers/launch.ts` (banco temporário em `OXESPACE_DB_PATH`, `OXESPACE_E2E_MOCK_NATIVE=1`,
  relógio fixo). Nada de login real nem credenciais.
- Roteiro repetível: `e2e/homologation/<onda>.spec.ts`, rodado com
  `npx playwright test --config playwright.tools.config.ts e2e/homologation/<onda>.spec.ts`. As capturas ficam em
  `e2e/screenshots/homologation/<onda>/`, que não é versionada: o caminho citado nos achados é dessa pasta, na build
  indicada.
- Matriz das telas: claro/escuro × en/pt-BR × compacta/confortável (6 combinações: as 4 compactas, claro-en
  confortável e escuro-pt-BR confortável).
- Vereditos: **Homologado**, **Homologado com ressalvas** (o aceite foi cumprido e as ressalvas viram tarefa da
  sessão dona), **Reprovado** (o aceite não foi cumprido).

## Onda 1

Build `ce62e277` (main de 30/10/2026, versão do pacote 1.3.3), Windows 11, homologada em 30/10/2026.

| Item | PR | Dono | Veredito |
|---|---|---|---|
| F3 Motion | #159 | FRONTEND | Homologado |
| F2 Marca, parte 1 | #160 | FRONTEND | Homologado com ressalvas |
| B3.1 OxePod separado do OxeQuery | #161 | BACKEND | Homologado |
| Correção OxePost (#520) | #167 | FRONTEND | Homologado |
| Contratos da onda 1 | #158 | BACKEND | Homologado (contrato; sem tela ainda) |
| Contrato de pareamento C5 (B9) | #172 + #183 | BACKEND | Homologado (contrato; a ressalva foi fechada pelo #183, na `main` c3685b90) |

### F3 Motion (#159): Homologado

Aceite: nenhuma duração fixa; com Reduzido, nada acima de 0 ms além do spin lento; spec com tabela de tokens.

- Settings › Aplicativo › Aparência › **Movimento** tem Sistema / Reduzido / Completo, com dica em pt-BR. Ao escolher
  Reduzido, o efeito é imediato: `data-motion=reduce`, `--motion-shift: 0px` e nenhuma animação com 1 ms ou mais
  na tela. Capturas: `motion-settings-pt-BR.png` e `motion-settings-pt-BR-reduced.png`.
- O visualizador do design system tem a seção **Motion**, com a tabela de tokens Completo/Reduzido, os loops nos
  dois modos e os botões "Open a dialog" e "Show a toast" funcionando (`*-ds-5-Motion.png`).
- `docs/design/motion.md` existe, com a tabela de tokens.
- `e2e/motion.spec.ts`: 4 de 4 verdes na repetição (ver "Execuções").
- Observação, não bloqueia: o visualizador está só em inglês no pt-BR. Ele depende da decisão "visualizador do
  design system na paleta (sugerido: só em dev)", que ainda está com você. Se ficar visível para todos, o texto
  entra na F6.

### F2 Marca, parte 1 (#160): Homologado com ressalvas

Aceite: lista de pontos de contato em `docs/design/brand.md`, todos marcados e com captura.

- **Splash:** com scripts desligados, a janela mostra o ícone centralizado no fundo do modo. Com o sistema claro, o
  fundo é `rgb(246,248,247)`; com o sistema escuro (emulado), `rgb(13,16,14)`. Capturas:
  `splash-emulated-light.png` e `splash-emulated-dark.png`.
- **Favicon:** na build ele vira `assets/icon-*.svg` e carrega (200).
- **Ícones:** `resources/icons/16…1024`, `icon.png` e `icon.ico` presentes.
- **Marca no app:** a barra de título, a seção Brand do visualizador e o loader de marca aparecem coerentes em
  claro e escuro (`*-ds-1-Brand.png`, `*-mode-*.png`).
- **ErrorState brand:** visto no visualizador (States). O crash de raiz (`ErrorBoundary page`) só tem cobertura por
  teste de unidade, porque não há como provocá-lo pela interface.
- **Pendentes, como o próprio PR declara:** About, ícone nas notificações e diálogo nativo de crash (parte 2,
  depende do BE B8).

Ressalvas para o FRONTEND:
1. **O splash ignora a aparência escolhida no app.** O splash segue só o tema do sistema operacional. Quem escolhe
   Escuro no app com o Windows claro vê o splash claro e depois o app escuro, um clarão a cada abertura (o mesmo vale
   para Claro com o sistema escuro). Esperado: o splash no modo que o app vai abrir. Uma saída é o main repassar a
   aparência salva para a janela antes da primeira pintura.
2. **Smoke do pacote não feito:** não há build empacotada da `main` atual na máquina. Ícones no instalador e no menu
   Iniciar ficam para o smoke empacotado da CI (perna de release) ou para a próxima build local.
3. **Capturas do lote pendentes:** os baselines `brand-touchpoints.spec.ts/splash-*` e
   `design-system-motion` citados em `brand.md` ainda não existem em `e2e/visual/__screenshots__`. Esperado: no
   lote visual da onda.

### B3.1 OxePod separado do OxeQuery (#161): Homologado

Aceite: testes de contrato de ops dos dois (na CI do PR). Na tela:

- **O OxePod funciona sozinho.** Com Ctrl+4 a partir do Code, ele lista os containers por projeto Compose, com
  motor, filtro, detalhes, logs ao vivo e o cartão "Banco detectado". O OxeQuery não chega a ser montado
  (`.oxequery-host` = 0). Capturas: `pt-BR-oxepod-alone.png`, `pt-BR-oxepod-pg-dev.png` e `en-US-oxepod-*`.
- **O OxeQuery conecta pelo OxePod.** Em OxePod › pg-dev, "Conectar no OxeQuery" abre o OxeQuery já conectado, com
  schemas, tabelas, editor e o selo "somente leitura" (`pt-BR-oxequery-from-pod.png` e `en-US-oxequery-from-pod.png`).
- Nenhum `pageerror` nem erro de console nos dois idiomas.

### Correção #167 (OxePost #520): Homologado

- O OxePost abre (Ctrl+5) e envia um GET a um servidor local. A resposta 200 aparece com tempo, tamanho, corpo
  formatado, cabeçalhos e cookies, em en e pt-BR, sem `pageerror` (`*-oxepost-open.png` e `*-oxepost-sent.png`).
- `e2e/oxepost.spec.ts` repetido 4 vezes: ver "Execuções".

### Contratos #158: Homologado (contrato)

- `window.oxe.app.about()` responde no mock com nome, versão, canal, commit, versões de runtime, plataforma,
  licença e repositório, sem caminhos nem nomes de máquina. `app.connectivity()` responde
  `{ state: 'online', checkedAt }`.
- Ainda não há tela de About nem de conectividade (F1/F2 parte 2), como previsto.
- Atenção para o B8: no mock, a `version` vem igual à do Electron (`44.9.3`), porque o app roda sem empacotar. O
  handler real precisa usar a versão do pacote (`1.3.3`/`1.4.0`). Vale um teste no B8. Encaminhado: o handler real
  está no #168, com teste contra o `package.json`, e o mock passa a usar a versão do pacote no #185.

### Contrato de pareamento C5 (#172): Homologado com ressalvas

Build `4a092399`. Só contrato: `shared/remote/protocol.ts` e o teste dele. O PR não traz mock nem tela.

- `tests/remote-protocol-contract.test.ts`: 12 de 12 verdes na `main`.
- `pairingVerification`: os vetores fixos (`ZZZZZZ`, `000000`, `28T5CY`) são os mesmos no teste do Android
  (`PairingVerificationTest.kt`, worktree `oxespace-mobile-proto`). `28T5CY` confere com a conta feita à mão (os 30
  primeiros bits de `0x12345678` em Crockford base32).
- `pairingUri` codifica espaço no nome como `+`, e o leitor Kotlin (`URLDecoder`) decodifica de volta. Os dois
  lados concordam.

Ressalva para o BACKEND (dono do contrato), com cópia para o MOBILE: `readPairingUri` aceita QR que o leitor do
Android recusa, embora o Kotlin diga ter "a mesma aceitação, mais a regra de rede local". Verificado chamando
`readPairingUri` em cada caso:

| Entrada | TS (`readPairingUri`) | Kotlin (`PairingQrs.read`) |
|---|---|---|
| `code` repetido (`&code=AAA…&code=BBB…`) | aceita e fica com o primeiro | recusa: dois leitores veriam códigos diferentes |
| porta `0x1D13` ou `%207443` | aceita (`Number()`) | recusa |
| `v=2` | aceita | recusa (versão sem suporte) |
| `v=1e0` | aceita | recusa |
| controle C1 no nome (`%C2%85`) | aceita | recusa (`isISOControl`) |
| host público `8.8.8.8` | aceita | recusa: regra própria do app, diferença intencional |

Esperado: o contrato ser a fonte da regra mais estrita, já que o cabeçalho diz que o `RemoteProtocol.kt` é gerado a
partir dele. Ou seja: recusar chave repetida, aceitar só números decimais, exigir `v === REMOTE_PROTOCOL_VERSION` (ou
documentar outra política de versão) e recusar também os controles C1. Também vale incluir esses casos no teste de
contrato dos dois lados. O risco hoje é baixo: quem gera o QR é o próprio desktop, e o `readPairingUri` não está
num caminho de entrada. Mas a divergência vai crescer quando o gateway (B9) passar a ler o mesmo formato.

Correção no #183 (`618c479f`), pré-verificada na branch com a mesma sonda e mais 6 entradas (`+7443`, `v=01`, DEL,
quebra de linha e `name` repetido no nome): todas são recusadas; o QR válido e o nome com espaço continuam aceitos;
o host público continua sendo regra só do app. Reverificado na `main` (c3685b90): as 14 entradas da sonda se comportam igual à branch, e o teste de contrato traz
"reads a QR as strictly as the Android reader". Ressalva fechada.

## Onda 2 e fila (pré-homologação)

A pedido do coordenador, os PRs abertos são pré-homologados na própria branch, mesclada localmente com a `main`.
O veredito é **Pré-homologado**. Depois do merge, basta uma conferência rápida na `main`. Os roteiros ficam em
`e2e/homologation/pre-<PR>.spec.ts`, e as capturas em `e2e/screenshots/homologation/pre-<PR>/`.

| Item | PR | Dono | Veredito |
|---|---|---|---|
| Roadmap 1.4 (documentação) | #157 | coordenador | Homologado (na `main` 8e1d8c14) |
| F1 primitivas | #163 | FRONTEND | Homologado (na `main` 7c8cb949) |
| F4 WCAG 2.2, partes 1 e 2 | #186 | FRONTEND | Pré-homologado com ressalvas |
| R1 + A4 (splash na aparência salva; visualizador só em dev) | #190 | FRONTEND | Pré-homologado |
| F12 OxeCode/OxeChat | #188 + #189 | FRONTEND + BACKEND | Pré-homologado (ressalvas resolvidas na reverificação) |
| A4 worktree por conversa | #151 | FRONTEND | Homologado com ressalvas (na `main` 9e4a9307) |
| F8 gate visual | #193 | FRONTEND | Pré-homologado |
| F1 OfflineState + F2 About | #178 | FRONTEND (+ BACKEND no texto do OxePost) | Pré-homologado com ressalvas |
| F1 estados do OxeQuery | #171 | FRONTEND | Pré-homologado (a ressalva foi corrigida em a13868d7; conferir na `main`) |
| F1 estados de Settings | #176 | FRONTEND | Pré-homologado com ressalva |
| F1 estados do Code | #179 | FRONTEND | Pré-homologado |
| F1 estados de OxeChat, OxePod e OxePost | #173 | FRONTEND | Pré-homologado |
| Ajustes visuais do A4 | #207 | FRONTEND | Pré-homologado (regressão corrigida em 8a2437f8) |
| F1 estados do Code | #179 (main) | FRONTEND | Homologado (na `main` a412f04b) |
| B1.1 respondPending | #166 | BACKEND | Homologado (contrato; na `main` a412f04b) |
| B8 conectividade e About (handlers) | #168 | BACKEND | Homologado (teste de unidade; e2e depois do #185) |
| Esqueleto do app Android + CI | #164 | MOBILE | Homologado (na `main` c82cff0a) |
| Correção de segurança do `tool.use` | #212 | BACKEND | Pré-homologado (0da8d604): os dois desvios estão fechados |
| B8.1 main minificado | #162 | BACKEND | Homologado (na `main` 9e4a9307) |
| Contrato `remote.*` (B9) | #174 | BACKEND | Homologado (contrato; na `main` 0809c08c) |

### #157 Roadmap 1.4: Homologado

Os seis documentos de `docs/roadmap-1.4/` estão na `main`, sem links relativos quebrados. Duas sugestões de texto
para o coordenador: o "DoD comum" do README não diz que um item só conta como feito depois de mergeado e
homologado; e a F11 ainda fala em "abre um Thread", que vira OxeChat com a F12.

### #163 F1 primitivas: Pré-homologado

- No visualizador, a seção States tem Empty, Loading, Failed, Succeeded, Offline, Notices e Unavailable, nos dois
  modos. Os rótulos padrão estão traduzidos no pt-BR: "Você está sem conexão", "Verificar de novo", "Tentar de
  novo" e "Detalhes".
- Papéis: aviso e erro (Notice warning/danger, FieldError, ErrorState) são `alert`; info, sucesso e offline são
  `status`.
- Nenhum erro de console. Prints: `pre-163/light-pt-BR-states-3.png` e `-4.png`.
- Fora do PR (F6): o placeholder da paleta, "Search files and commands…", continua em inglês no pt-BR.

### #186 F4 WCAG 2.2: Pré-homologado com ressalvas

Passada só com teclado, em pt-BR:
- O divisor da barra lateral abre com Enter o menu Menor / Maior / Restaurar. "Maior" mantém o menu aberto
  (280→288), e o Escape devolve o foco ao separador.
- Na árvore de arquivos, Shift+F10 abre "Copiar caminho" e "Copiar caminho relativo".
- Com `prefers-contrast: more`, as bordas e o texto muted ficam mais fortes nos dois modos (claro: borda
  `#cdd8d0`→`#bbc9bf`; escuro: muted `#9ea7a1`→`#c4cdc7`).

Ressalvas para o FRONTEND:
1. **Divisor do grid de painéis:**
   - ele recebe foco e as setas o movem (50%→52%), mas Enter, Espaço e Shift+F10 não abrem o menu "Mover o
     divisor", diferente do divisor da barra lateral;
   - é um `separator` focável sem `aria-valuenow`;
   - o nome é "Resize columns"/"Resize rows", em inglês no pt-BR.
2. **Nome do menu:** sai "Tamanho de Largura da barra lateral". Sugestão: "Tamanho da barra lateral".

### #190 R1 + A4: Pré-homologado

- **Splash:** com o bundle bloqueado, ele abre na aparência salva nas 6 combinações (Escuro/Claro/Sistema × sistema
  claro/escuro). Com "Sistema", segue o sistema. Com a configuração corrompida, o boot continua (`pre-190/notes.json`).
- **Visualizador:** some da paleta quando a URL do renderer está dentro de `.asar`. O `electron-builder.yml` tem
  `asar: true` e não desempacota o renderer, então a regra vale para o app publicado. Na build de teste o
  visualizador continua visível, como esperado. Conferir no smoke empacotado.

### F12 OxeCode/OxeChat (#188 + #189): Pré-homologado com ressalvas

Main mesclada localmente com as duas branches. O #188 conflita com a `main` em `src/App.tsx` (fallback do Suspense
do thread-host); resolvi só para testar. Roteiro: `e2e/homologation/pre-f12.spec.ts`, uma varredura de texto visível,
`aria-label`, `title` e `placeholder` no início vazio, nos 5 modos, no menu, na paleta (85 itens), no guia de
atalhos e nas 10 categorias de Settings, em en e pt-BR.

- O seletor, a paleta, Settings e o onboarding já dizem OxeCode e OxeChat. Nenhum erro de console.
- Ressalvas para o FRONTEND (literais em `src/App.tsx` que o `mode-names.test` não alcança):
  - botão "Open Thread" na tela inicial (linha 921);
  - title do botão Team: "…shared by Code and Thread" (linha 817);
  - títulos de Team desabilitado: "Team is available in Code and Thread" e "Select a Thread project…" (linha 661).
- Fora da F12 (F6): no pt-BR, a tela inicial e o FirstRunChecklist continuam em inglês (`pre-f12/pt-BR-start.png`).
- Reverificação (main + #188 atualizado + #189, `253e32f9`): a mesma varredura não acha nenhum nome antigo em pt-BR.
  Em en, o único resultado é "Vendored code intelligence", com "code" como substantivo comum. Paleta com 85
  itens; nenhum erro de console.

### A4 worktree por conversa (#151): Homologado com ressalvas

Roteiro `e2e/homologation/a4.spec.ts`, em pt-BR/escuro e en/claro, com o main substituído por um stub (o Git real
está no teste de integração do PR):
- A opção "Trabalhar em uma worktree isolada" vem desligada.
- Com o projeto sujo, a criação é recusada com DIRTY_BASE: a mensagem diz o que fazer, e há "Criar mesmo assim" (que
  envia `allowDirtyBase: true`) e "Usar a pasta do projeto".
- O cabeçalho mostra a branch e o selo "worktree", com title explicativo.
- Ao arquivar uma conversa cuja worktree tem trabalho (2 arquivos alterados, 1 novo, 1 commit sem push), a pergunta
  lista o que há e oferece Cancelar, Abrir no Code, Arquivar e manter, e "Descartar o trabalho e remover…". Descartar
  pede uma segunda confirmação, e o main recebe `['t1','archive','discard']`.
- Nenhum `pageerror`. Prints em `a4/`.

Ressalvas visuais para o FRONTEND (`a4/pt-BR-refused-dirty-base.png` e `a4/pt-BR-archive-ask.png`):
1. O checkbox da opção fica numa linha sozinho, acima do próprio rótulo, em vez de ao lado dele.
2. O placeholder de "Começar de" corta: "Padrão do repositório (ex.: origin/mai".
3. A recusa é texto solto, não um `Notice` warning da F1. Sem ícone nem cor, perde destaque.
4. O estado vazio da conversa diz "No que o Claude deve trabalhar em feature-a4-cd34?", com o nome da pasta e o
   sufixo aleatório. Para quem lê, faz mais sentido a branch (`feature/a4`) ou o projeto (`repo`).
5. Com a F12, "Abrir no Code" passa a ser "Abrir no OxeCode".

### F8 gate visual (#193): Pré-homologado

- Com uma baseline trocada (`empty-light-desktop`), a comparação falhou. O `scripts/visual-review.mjs` gerou a revisão
  com baseline, esta execução e a diferença lado a lado, e marcou as 6 variações novas (pt-BR, comfortable e
  forced-colors × empty/workspace) como "none: a new surface without a baseline".
- As variações estão corretas. No forced-colors, bordas e anéis aparecem, e o ponto de status continua visível.
- Observações:
  - a baseline pt-BR vai registrar "Team" e a tela inicial em inglês se entrar antes do #197 (F6). Convém casar a
    ordem;
  - o título de cada superfície na revisão leva o slug do Playwright (cosmético).

### F1 OfflineState + F2 About (#178): Pré-homologado com ressalvas

- About (en/claro): marca, versão, canal, commit, runtimes, sistema, 4 links, e os botões Relatar, Copiar detalhes e
  Fechar. "Copiar detalhes" não leva caminho, conta nem nome de máquina. A versão `44.9.3` é do mock e é corrigida
  no #185.
- Com `OXESPACE_E2E_OFFLINE=1`, "Você está sem conexão" aparece na barra do OxeCode e do OxeChat e some com o
  push online.
- No OxePost, sem rede, um host inválido mostra o OfflineState ("Enviar de novo"). Com rede, mostra "Não foi possível
  alcançar o servidor". Uma requisição local responde mesmo com o app em offline: o app não afirma offline sem saber.
- Ressalvas:
  1. FRONTEND: em pt-BR, "Sobre" na paleta não encontra o About (rótulo literal `About OXESpace`). A verificar no
     #197.
  2. FRONTEND: `post.json` em pt-BR diz "O request não saiu…". Sugestão: "A requisição…".
  3. BACKEND: o detalhe do erro de rede do OxePost vem em inglês do main (`oxepost/send.ts`, "The host name was not
     found…"). Deveria passar por um código C3.

### F1 estados do OxeQuery (#171): Pré-homologado com ressalva

- `design-lint`, `ui-copy` e `ui-states`: 27/27 com a branch mesclada à `main`.
- `e2e/homologation/states-area.spec.ts` em pt-BR/escuro e en/claro: no OxeQuery, nenhum `role="alert"` solto nem
  `-empty` feito à mão. Nenhum `pageerror`.
- Ressalva para o FRONTEND: o vazio da barra lateral ainda diz "Clique em Conectar num contêiner de banco de dados…",
  mas desde o B3.1 os containers ficam no OxePod. O vazio central já diz isso certo (`pre-oxequery-states/pt-BR-mode-3.png`).

### F1 estados de Settings, Code e OxeChat/OxePod/OxePost (#176, #179, #173)

Cada branch foi mesclada com a `main`, montada e testada sozinha, em primeiro plano dentro da trava:
- `design-lint` + `ui-copy` + `ui-states`: 27/27 (#176 e #179) e 28/28 (#173).
- `states-area.spec.ts` em pt-BR/escuro e en/claro: nenhum `role="alert"` solto nem `-empty` feito à mão na área de
  cada PR, e nenhum `pageerror`.
- O alerta que sobra no OxeChat ("Could not load project directories") vem da primitiva `ErrorState`
  (`src/ui/Display.tsx`). O texto é o erro do mock do A1, corrigido no #185.
- Ressalva do #176 para o FRONTEND (`pre-settings-states/pt-BR-settings-2.png`): Settings › Agentes, sem provedores,
  repete a mesma coisa três vezes:
  - o cartão "Nenhum provedor ainda · Use Verificar…";
  - o EmptyState "Nenhum provedor encontrado · Use Verificar…" com o botão "Verificar agentes";
  - o botão "VERIFICAR" do cabeçalho, em caixa alta, diferente dos outros botões.
  
  Além disso, "Novo agente personalizado" é um segundo botão primário de largura inteira logo abaixo. Esperado: uma
  mensagem e uma ação principal.

### Ajustes visuais do A4 (#207): Reprovado na pré-homologação

Os quatro itens da ressalva do A4 estão corrigidos (roteiro `a4.spec.ts`, pt-BR e en):
- o checkbox fica ao lado do rótulo;
- o placeholder "Padrão (ex.: origin/main)" aparece inteiro;
- a recusa vem num `Notice` warning com o conselho e as duas ações;
- o estado vazio usa a branch.

Regressão nos cartões Claude Code e Codex da Nova conversa: o ícone vai para uma faixa própria, e os dois cartões
ficam desalinhados. Causa: o seletor novo `.thread-create-dialog label:not(:has(> input[type='checkbox']))` ganha
especificidade com o `:not(:has(...))` e vence a regra própria dos cartões, que são `label` com rádio. Enviado ao
FRONTEND, com a sugestão de usar uma classe ou `:where(...)`.

Reverificação com 8a2437f8 (regra com `:where(...)`): o roteiro passou em pt-BR e en, e os cartões voltaram ao lugar,
com o ícone à esquerda e os dois alinhados (`a4/en-US-new-with-worktree.png`). Pré-homologado.

### Esqueleto do app Android (#164): Homologado

- O job `android.yml` (lint, testes de unidade e `assembleDebug`) passou na `main` (run 41110737104).
- Backup desligado: `allowBackup="false"`, e `data_extraction_rules.xml` e `backup_rules.xml` excluem todos os domínios
  (root, file, database, sharedpref, external), na nuvem e na transferência entre aparelhos. Ainda não há
  funcionalidade de produto.

### Correção de segurança do `tool.use` (#212): Pré-homologado

Testes adversariais (`tests/integration/hml-212.test.ts`, só local) sobre a primeira versão (3e1b8fa9):
- um deny com curinga (`mcp__oxespace-delegation__*`) e um deny com outra caixa bloqueiam no `tools/call`;
- dois desvios, confirmados pelo BACKEND:
  1. a raiz vem do `X-OXE-Workspace-Id`, que o agente controla (`OXESPACE_WORKSPACE_ID` no ambiente dele). Sem token de
     execução, um agente no projeto A que se declare no B escapa do deny de projeto de A;
  2. um deny no servidor inteiro (`mcp__oxespace-delegation`, a sintaxe do Claude) bloqueia no Claude, mas não casa
     no `tools/call` nem no Codex.

O coordenador voltou o PR para rascunho. O veredito desta homologação é condição para o merge.

Correção 0da8d604, mesclada com a `main`:
- 27/27 com a suíte do PR e os 6 adversariais;
- os mesmos adversariais na versão antiga (3e1b8fa9) falham nos três pontos dos dois desvios, o que prova que o teste
  detecta os dois: "header B" (false), "tools/call blocked by a server-level deny" (false) e "codex turns the server
  off" (sem `enabled=false`).

Efeito esperado: sem token de execução, o deny de qualquer projeto vale para a chamada. É o lado seguro, e convém
dizer isso na documentação de política. Sugestão: incorporar os dois casos ao teste do PR.

### Conferências na `main` a412f04b (#179, #166, #168)

- #179: a varredura de estados na `main` não acha alerta solto nem vazio feito à mão no OxeCode e na tela inicial, em
  pt-BR e en. Nenhum `pageerror`.
- #166 + #168: `thread-pending-response` e `app-info` passam com 12/12 (`test:electron`, pela trava).
  - #166: de duas respostas concorrentes ao mesmo pedido, uma é entregue e a outra recusada, assim como qualquer
    resposta posterior. Geração antiga e pedido desconhecido são recusados.
  - #168: a versão vem do `package.json`, nunca do Electron. Sem caminho, conta ou host. Offline vem com código de
    mensagem.
- No e2e, `about().version` ainda vale `44.9.3` porque o mock responde no lugar do handler; a correção do mock é o #185.
- Incidente da homologação: um comando com glob vazio rodou o `test:electron` inteiro por cerca de 6 minutos dentro
  da trava. O processo foi encerrado, e o `hml-heavy.sh` agora recusa suíte sem arquivo explícito.

### B8.1 main minificado (#162): Homologado

- `out/main/index.js` tem 575 KiB, e todo o main soma 1977 KiB com os chunks.
- 76 `.map` em `out/main`, gerados como `hidden`: nenhum `.js` traz `sourceMappingURL`. O `electron-builder.yml`
  exclui `out/**/*.map` do pacote, e não há mapa no renderer nem no preload.
- Abertura em 3 execuções: janela em 2,5 s / 1,0 s / 1,1 s (a primeira fria), interface pronta em 2,8 s / 1,05 s /
  1,1 s e workspace aberto em 3,9 s / 2,0 s / 2,1 s. Sem `pageerror` (`b8-1/boot.json`).
- O código `mcp.quarantine.configChanged` tem texto em en e pt-BR.
- Não conferido localmente: o pacote em si (sem build empacotada). A exclusão dos mapas fica para o smoke da CI.

### Contrato `remote.*` (#174): Homologado (contrato)

- `remote-ipc-contract` + `remote-protocol-contract`: 16 de 16.
- Pelo `window.oxe.remote`, contra o mock:
  - `status` e `devices` (Pixel 8);
  - porta 80 recusada com `remote.port.privileged {port: 80}`;
  - na porta 47000, o gateway escuta só em 192.168.0.10;
  - `startPairing` devolve uma URI aceita pelo `readPairingUri`;
  - o pedido "Pixel 8 Pro" chega com a verificação `28T5CY`, e aceitar adiciona o aparelho;
  - `rename` recusa 65 caracteres e aceita "Celular do trabalho";
  - `revoke` remove o aparelho, e um id desconhecido é recusado.
- Notas em `b9-174/notes.json`.

### Achados fora dos itens da onda

Coisas vistas durante a passada. Não reprovam itens da onda 1, mas têm dono.

| # | Onde | O que se vê | Dono | Encaminhamento |
|---|---|---|---|---|
| A1 | Thread, workspace aberto num perfil novo (en e pt-BR) | A barra lateral mostra em vermelho "Could not load project directories." e, logo abaixo, "Add a project to start a conversation.". `window.oxe.thread.projects()` devolve `undefined` no perfil de teste, e a store então cai no `catch`. Captura: `light-en-US-comfortable-mode-2-Thread.png` | BACKEND (mock e2e) | Causa confirmada pelo BACKEND: o mock não tinha handler para `thread:projects` e respondia `null`. O produto está certo. Correção no #185 (aberto); reverificar depois do merge |
| A2 | Barra de título em pt-BR | Botão "Team" e a dica "Project roles and messages shared by Code and Thread" em inglês (`src/App.tsx:817`, `TeamDialog`) | FRONTEND | F6 / F12 |
| A3 | OxePost em pt-BR | O nome padrão da requisição nova é "New request" (`shared/oxepost/format.ts:112`) | FRONTEND | F6 |
| A4 | Paleta em pt-BR | "Design System: Open Viewer / Tokens and components in light and dark" em inglês (`src/commands/code.commands.ts:78`) | FRONTEND, depois da sua decisão | Se ficar só em dev, some da paleta de produção; senão, F6 |
| A5 | Thread em en | "Filter threads" e "Create a thread to get started…" | FRONTEND | Já está no escopo da F12 (OxeChat/conversa) |

### Propostas de descarte

Nenhuma nesta onda. Toda entrada nova (Movimento na Aparência, seção Motion e botões do visualizador, "Conectar no
OxeQuery") tem efeito visível e se justifica.

### Execuções

| Data | Build | O quê | Resultado |
|---|---|---|---|
| 30/10/2026 | ce62e277 | `e2e/homologation/wave1.spec.ts` (matriz de 6 + motion + OxePod/OxeQuery/OxePost em 2 idiomas + contratos) | 11 verdes |
| 30/10/2026 | 4a092399 | `tests/remote-protocol-contract.test.ts` + sonda de `readPairingUri` com 8 entradas | 12 de 12 verdes; 6 divergências com o Kotlin (acima) |
| 30/10/2026 | ce62e277 | `e2e/oxepost.spec.ts` + `e2e/motion.spec.ts`, `--repeat-each=4` | 12 de 12 verdes (a falha intermitente do #520 não voltou) |
