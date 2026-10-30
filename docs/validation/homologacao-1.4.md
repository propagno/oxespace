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
| Contrato de pareamento C5 (B9) | #172 | BACKEND | Homologado com ressalvas (contrato; sem tela) |

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
o host público continua sendo regra só do app. Falta reverificar na `main` depois do merge, para fechar a ressalva.

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
