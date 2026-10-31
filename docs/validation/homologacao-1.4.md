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
| F4 WCAG 2.2, partes 1 e 2 | #186 | FRONTEND | Pré-homologado (ressalvas corrigidas em 1ceaee6a, reverificado em a5d04da9) |
| R1 + A4 (splash na aparência salva; visualizador só em dev) | #190 | FRONTEND | Pré-homologado |
| F12 OxeCode/OxeChat | #188 + #189 | FRONTEND + BACKEND | Pré-homologado (ressalvas resolvidas na reverificação) |
| A4 worktree por conversa | #151 | FRONTEND | Homologado com ressalvas (na `main` 9e4a9307) |
| F8 gate visual | #193 | FRONTEND | Pré-homologado |
| F1 OfflineState + F2 About | #178 | FRONTEND (+ BACKEND no texto do OxePost) | Homologado com ressalvas (na `main`: offline e About ok; pendem "Sobre" na paleta em pt-BR e o detalhe do erro de rede, que dependem do #197) |
| F1 estados do OxeQuery | #171 | FRONTEND | Pré-homologado (a ressalva foi corrigida em a13868d7; conferir na `main`) |
| F1 estados de Settings | #176 | FRONTEND | Pré-homologado com ressalva |
| F1 estados do Code | #179 | FRONTEND | Pré-homologado |
| F1 estados de OxeChat, OxePod e OxePost | #173 | FRONTEND | Pré-homologado |
| Ajustes visuais do A4 | #207 | FRONTEND | Homologado (na `main` 277ce4bd) |
| F1 estados do Code | #179 (main) | FRONTEND | Homologado (na `main` a412f04b) |
| B1.1 respondPending | #166 | BACKEND | Homologado (contrato; na `main` a412f04b) |
| B8 conectividade e About (handlers) | #168 + #185 | BACKEND | Homologado (no e2e da `main` f211ca7f o About traz 1.3.3, a versão do pacote) |
| Risco de SQL (P1-13) + fixture de quarentena | #237 | BACKEND | Homologado (na `main` bab99b50): as sondas dão o mesmo resultado da pré-homologação, mais 8 casos de escape; 1 nota baixa, fechada no #253. Telas de quarentena avaliadas com a fixture: 2 achados (um virou o F25) |
| Escapes ambíguos de SQL | #253 | BACKEND | Pré-homologado (68cb4c93): 17 casos certos, sem alarme falso em caminhos, regex, `LIKE` e JSON |
| Payloads C5 (assinaturas e comandos, M4) | #187 | BACKEND | Homologado (contrato), com uma nota baixa |
| Protocolo C5 em Kotlin gerado | #165 | MOBILE | Homologado (job Android verde na `main` 14504372) |
| Tema Mandacaru e strings para o Android | #169 | MOBILE | Homologado (job Android verde na `main` 15e04898; visual depois do M4/M5) |
| Android 17 / API 37 com Compose | #170 | MOBILE | Aguardando o job Android na `main` |
| Esqueleto do app Android + CI | #164 | MOBILE | Homologado (na `main` c82cff0a) |
| Correção de segurança do `tool.use` | #212 + #223 | BACKEND | Homologado (na `main` f211ca7f: 25/25, com os casos adversariais como regressão) |
| B8.1 main minificado | #162 | BACKEND | Homologado (na `main` 9e4a9307) |
| Contrato `remote.*` (B9) | #174 | BACKEND | Homologado (contrato; na `main` 0809c08c) |
| Profundidade do quadro C5 + WebGL sob demanda | #226 | BACKEND + FRONTEND | Homologado (na `main` fc07f5e9/7e2dfdd5) |
| Contrato B10 `approvals.*` | #235 | BACKEND | Homologado (contrato; na `main` 7e2dfdd5), com nota sobre nomes de sistema |
| F19 split além dos presets | #240 | FRONTEND | Homologado (na `main` c4a4d84d) |
| Nomes reservados de SO e fornecedor | #247 | BACKEND | Pré-homologado (499ffbcd): ressalvas fechadas, sonda de 134 nomes |
| Raiz do workspace (B11) + aviso no assistente (F20) | #239 + #244 | BACKEND + FRONTEND | #239 homologado (na `main` feb692eb): vazio, espaços e aspas vazias voltam como `refusal:'empty'`; uma aspa sozinha volta como `notAbsolute`; um valor que não é texto lança erro genérico. #244 pré-homologado (3f3e2d66) |
| Teste com Postgres real da confirmação de produção | #266 | BACKEND | Homologado (na `main` feb692eb, CI): o `oxequery-live.test.ts` tem 11 testes, entre eles "production asks for the typed name before the flagged statements, with the guard codes, and nothing changes until then", e os 11 passam no job docker. Os 5 jobs live ficaram verdes (docker, podman, PG 12/14/17). O mock de e2e passou a usar o `guardSql` real |
| Toasts (F21) | #245 | FRONTEND | Homologado (na `main` b5270492): fusão em ×N, toast próprio para o caminho relativo, pausa, teclado, Escape e posição acima da barra de status, em pt-BR e en, sem erros |
| Checklist inicial e painel de contas sob demanda | #234 | FRONTEND | Homologado (na `main` b5270492): o checklist aparece em 310 ms e "Agent settings" abre Configurações › Agentes com a verificação de saúde, sem erros. O inglês no checklist em pt-BR já existia antes (igual à captura da auditoria), e fica com o #197 |
| Regras por ferramenta (B7.3) + `policy.json`/`oxe.yaml` protegidos | #208 | BACKEND | Pré-homologado com ressalvas (b0a399c8): a regressão do #212 passa e a edição por caminho está bem protegida, mas comandos (`git checkout`, `python -c`, `sh -c`, `curl -o`, `tar`, `yq -i`…) gravam no arquivo protegido e saem `allow`. O branch conflita com a `main` |
| Alvos de 24 px (F22) | #246 | FRONTEND | Homologado com ressalvas (na `main` c4cf680e): os alvos do P3-2 foram corrigidos nas duas densidades, mas sobram a caixa "Favorita" (16×16) e o seletor de escopo (20–21 px de altura). À parte, o forced-colors perde a opção escolhida dos segmentados e o interruptor "Somente leitura" (auditoria P3-6 a P3-8). Correção da minha medição: o alvo de 20 px era o botão do workspace na barra lateral do Code (as linhas do seletor de escopo têm 246×31), e na "Favorita" o alvo é o rótulo, de 67×24, aceito para a 1.4 |
| Alto contraste: marca de seleção e Switch (F31) | #271 | FRONTEND | Pré-homologado com 1 nota baixa (mesclado com a `main`, 4d058342): forced-colors emulado, pt-BR claro e escuro. Os 13 grupos (Nova conexão, OxePod, Aparência, Atualizações) mostram a opção escolhida em `Highlight` com ✓; o Switch aparece nos dois estados (2 px de borda; ligado em `Highlight`). A categoria atual na navegação de Configurações não tem marca visível |
| Contrato do chat lateral (B1.2) | #195 | BACKEND | Homologado (contrato; na `main` c1b5c030): `thread-side-chat-contract` e `messages-contract`, 12/12. O comportamento vem com o #220 |
| Confirmação de produção com as instruções + links que abrem para fora (F24) | #272 | FRONTEND | Pré-homologado com 3 notas baixas (mesclado com a `main`, 2f216505). P1-18 fechado: "Linha 1.302 · DELETE sem WHERE… · DELETE FROM users", mais o script inteiro, antes do nome; o `DROP` atrás de "-- somente leitura" é apontado; foco em Cancelar. Links do agente: o host real aparece ao lado do texto ("docs.github.com/settings (evil.example)", punycode no IDN); `usuário@host`, `javascript:` e `file:` viram texto; a confirmação mostra Site, Texto e Endereço completo, Cancel é o padrão, Enter não abre e nada abre sem confirmar (`shell.openExternal` trocado por gravador: 0 aberturas). Notas: (1) o aviso "o texto não é para onde vai" sai também em "the PR" → github.com, link legítimo; (2) "Linha 1.302" com separador de milhar; (3) `pageerror` "l.windows is not iterable" na tela do OxeChat, a confirmar se é do mock |
| Menu do divisor por `contextmenu` | #241 | FRONTEND | Homologado (na `main` 6666d723), com 1 nota baixa; achado à parte: o terminal prende o Tab (virou F23) |
| Indicadores do OxePod | #248 | FRONTEND | Homologado (na `main` 16d27efa): 8×8, redondos, em claro e escuro |
| Diagnóstico: medidas, incidentes, pacote, `oxespace_diagnostics` | #203 | BACKEND | Homologado (na `main` 04dcc451): nenhum segredo, caminho ou nome vazou; as 2 notas baixas foram fechadas no #252 (pré-homologado, 679fa231) |
| Gate visual (workflow) | #193 | FRONTEND | Homologado (na `main`): o fluxo completo funcionou; as 22 diferenças vêm de baselines antigas, e falta despachar as novas |

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

Reverificação (a5d04da9 mesclado com a `main`): o divisor do grid abre com Enter o menu "Divisor entre colunas"
(Mover o divisor para a esquerda/direita), o menu do Splitter é "Largura da barra lateral: opções de tamanho", o
Escape devolve o foco e não há erros. Ressalvas fechadas.

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

### Payloads C5 (#187): Homologado (contrato)

Sonda de caixa-preta no `readRemoteFrame` da `main`, com 17 entradas de um celular malicioso ou com defeito:
- passa 64 KiB exatos e recusa 64 KiB + 1, contando bytes (multibyte incluso);
- recusa quadros que só o desktop envia (event, ack), comando desconhecido, caixa diferente e tipo com espaço;
- recusa array, `null`, BOM e `__proto__`;
- com chave repetida vale a última, e mesmo assim recusa (`command` duplicado com valor desconhecido).

Nota baixa para o BACKEND: um JSON aninhado em 20 mil níveis passa como `hello` válido. O leitor aguenta, mas um
código recursivo depois dele (redator, validação de `args`) pode estourar a pilha. Sugestão: limite de profundidade
no `readRemoteFrame` (por exemplo, 64 níveis), com teste.

### Conferências na `main` f211ca7f (#185, #168, #178, #212/#223)

- A1 fechado (#185): o OxeChat num perfil novo com workspace não mostra mais "Não foi possível carregar as pastas dos
  projetos".
- #168 + #185: o `about()` no e2e devolve 1.3.3, a versão do pacote, e não a do Electron.
- #178:
  - offline e OxePost certos, e "A requisição não saiu…" corrigido;
  - em pt-BR, "Sobre" na paleta ainda não acha o About (o PR curto do FRONTEND vem depois do #197);
  - o detalhe "The host name was not found…" continua em inglês: o #201 já manda o código, mas o renderer só o
    traduz com a F6 (#197).
- #212 + #223: `policy-tool-use-enforcement` com 25/25 na `main`, com os casos adversariais da homologação como
  regressão.

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

### Profundidade do quadro e WebGL sob demanda (#226): Homologado

- A profundidade do quadro foi conferida na `main` (a nota baixa do #187 está fechada).
- WebGL no primeiro foco, na `main` 7e2dfdd5 em dark/en: clicar no primeiro terminal e digitar `echo oi` desenha o
  texto na hora, com cursor e sem erro de console. São 9 canvases nos 4 painéis, sem linhas no DOM (renderização por
  canvas) e sem requisição separada do addon, que vai no bundle. Captura em `check-226.png`.

### Contrato B10 `approvals.*` (#235): Homologado (contrato)

- 5 arquivos de teste do PR: 72 aprovados e 27 `todo`. Os `todo` são o comportamento que chega com o #238 e o #243.
- Sonda de caixa-preta no `reservedNameIn`, com 38 nomes. Todas as imitações dos nomes do produto são pegas:
  - espaços e pontos ("O X E Space", "O.X.E.Space");
  - zero-width, soft hyphen e RLO;
  - homóglifos gregos e cirílicos, negrito matemático, letras circuladas e "Öxespace";
  - leetspeak ("0XE5PACE", "OXESp4ce", "0x3space");
  - "oxespace.com" e "Segurança do OXESpace".
- Também são pegos "Systém", "S y s t e m" e "Sistema.".
- Nota para o BACKEND/coordenador: os nomes genéricos só são pegos por igualdade, e não há nomes de sistema
  operacional. Passam:
  - "System Administrator", "Sistema operacional", "Administrador" e "Aplicação";
  - "Windows", "Windows Security", "Microsoft" e "Ubuntu";
  - "Thread", que é o nome de uma aba do próprio app.

  Com o modal nativo ainda existindo (P1-0), um agente chamado "Windows Security" que pede permissão parece vir do
  sistema operacional. Critério de aceite sugerido: nomes de SO e de fornecedor (Windows, Microsoft, Ubuntu, Linux,
  macOS, Apple) por contenção; "Sistema", "System", "Administrador" e "Administrator" como palavra inicial; e
  "Thread" reservado.

### F19 split além dos presets (#240): Homologado

- Pré-homologação no PR mesclado com a `main`, em pt-BR, no mock (dark) e no app real (light), em `pre-240`:
  - layout de 16 painéis, depois "Dividir à direita";
  - `Ctrl+Shift+\` 5 vezes;
  - "Dividir à direita" de novo, depois layout 1 e layout 16.

  A janela fica de pé, sem boundary e sem erro de console, e a paleta reabre. Com o layout dividido ligado, o split
  cresce para 17 e depois 23 painéis, igual à `main` anterior.
- Na `main` c4a4d84d, a sequência B (layout dividido desligado → 16 painéis → dividir à direita), que derrubava a
  janela, agora mantém os 16 painéis. Aparece o aviso traduzido "This pane cannot be split here · Every place in this
  layout is taken…", e a paleta reabre. Captura em `audit-menus/sequence-sequence-b.json-0-2.png`.
- Observações, sem bloquear:
  - Na pré-homologação, logo depois de voltar para 16 painéis, os títulos repetiam ("Terminal 3" três vezes) e os
    painéis vinham vazios. Depois de 4 s ficou igual à `main`, então era só a inicialização.
  - Numa das execuções, o painel 1 ficou em branco depois dos 4 s, enquanto na `main` mostrava o prompt. Aconteceu
    uma vez só; fica para observar.
  - O toast novo não é mais `[data-sonner-toast]`, e os roteiros de feedback precisam de um seletor por papel.

### Nomes reservados de SO e fornecedor (#247): Pré-homologado

A sonda tem 88 nomes, em `probes/reserved-names-probe.mts.txt` (rodar com `npx jiti`).
- Os 9 que passavam no #235 agora são pegos.
- As imitações de produto continuam pegas, e também:
  - "W i n d o w s", "Wind0ws" e "Windows" fullwidth;
  - "Microsoft-Teams", "MacOS Updater", "Linux kernel", "Sistema-op", "admin-bot" e "App Store".
- Passam corretamente, porque o critério é palavra inteira: Windowsill, Microsoftware, Linuxbrew, Apps, Appium,
  Codex, Codespace, Chatbot, Code Reviewer, Thread helper e My System.
- Ressalvas enviadas ao BACKEND:
  1. "Administração" passa, enquanto "Administrador" é pego (Admin* não se aplica com ç/ã).
  2. Debian, Fedora e "GNOME Keyring" passam.
  3. "root" e "sudo" passam, e são o pedido de privilégio clássico do Linux.
  4. "Security" e "Segurança" sozinhos passam.
  5. Nota baixa: "OxeBot" e "OXE" passam (prefixo da família de produtos).

Reverificação em 499ffbcd, com 134 nomes: as 5 ressalvas foram fechadas (Administração, Debian/Fedora/GNOME/KDE/
polkit, root/sudo, Security/Segurança, Oxe*). Pares juntados também são pegos ("Win dows", "Git Hub", "Mac OS",
"K D E"). Os 38 originais seguem iguais, e Claude, Anthropic, Codex, OpenAI, Gemini e Copilot continuam livres.
- Passam corretamente: Rooted, Rootless, Sudoku Bot, Securities Analyst, Kdenlive helper, Oxford tutor, Data Bot,
  Win Rate Bot, Code Review, Systems Engineer, AppSec, Thread pool, Chatty.
- Bloqueios por excesso, aceitáveis para o risco e registrados para o coordenador:
  - "Oxente" e "Oxente bot", uma interjeição nordestina comum, por causa do prefixo Oxe*;
  - "Security Reviewer", "Root Cause Analyst", "Admin Panel", "Adminer" e "Administrativo";
  - "Gnome lover", "Fedora fan" e "GitHub Copilot".
- Nota baixa: "OX E" passa, enquanto "OXE" é pego (só 2 letras soltas).

### Raiz do workspace e aviso no assistente (#239 + #244): Pré-homologado

App real em perfil descartável, pt-BR, com 14 caminhos digitados no assistente (`pre-239-244`).
- Recusados na hora, com a mensagem sob o campo, o campo marcado como inválido, o caminho mantido e nenhum workspace
  criado:

  | Caminho | Mensagem | Tempo |
  |---|---|---|
  | `meu-projeto` | "Use o caminho completo da pasta…" | 101 ms |
  | `.` | "Use o caminho completo da pasta…" | 65 ms |
  | `C:\nao\existe\pasta` | "A pasta … não existe. Crie a pasta ou escolha outra." | 64 ms |
  | um arquivo | "… é um arquivo, não uma pasta." | 547 ms |
  | `Q:\projeto` | "não existe" | 42 ms |
  | UNC inacessível | "não existe" | 1,3 s |
  | `C:\Windows\System32\config` | "não consegue abrir… Confira as permissões" | 566 ms |
  | `C:\Users\CON` | "não existe" | 51 ms |

  "Escolher outra pasta" aparece. A área da pasta fica vermelha, com o ícone de pasta cortada.
- Aceitos:
  - pasta com espaços e acentos ("Projetos São João\meu app ção");
  - o mesmo caminho com espaços no fim, que são removidos;
  - um caminho com `..`, que abre o workspace já existente, sem duplicar.
- Vazio ou só espaços: o botão "Criar o workspace" fica desabilitado, então o pedido nem sai pela interface. O código
  `notAbsolute` para vazio, chamado direto, ainda falta conferir.
- **Ressalva (atrapalha):** o caminho entre aspas, que é o que o Explorer copia em "Copiar como caminho", é recusado
  como "é um caminho relativo". Critério de aceite: tirar as aspas das pontas antes de validar (como já é feito com
  os espaços) ou, no mínimo, dizer "remova as aspas".
- Cosmético, a confirmar: logo depois de criar, os títulos dos painéis repetem ("Terminal 2" duas vezes) enquanto os
  shells iniciam. É o mesmo efeito visto no #240.
- A execução foi interrompida pelo sistema por falta de memória antes do en.

Reverificação com #239 751229ab + #244, em pt-BR e en:
- A ressalva das aspas foi fechada. `"C:\...\meu app ção"` colado no assistente cria o workspace com o caminho limpo.
  Aspas simples também são tiradas.
- Os 10 casos de recusa dão o mesmo resultado em en, com textos certos ("The folder … does not exist. Create it or
  choose another folder.", "… is a file, not a folder.", "OXESpace cannot open the folder…").
- Chamadas diretas ao `workspace.create`:

  | Entrada | Resposta |
  |---|---|
  | `""` (texto entre aspas vazias) | `notAbsolute` |
  | aspa só no começo | `notAbsolute` |
  | aspa só no fim | `notFound` |
  | aspas em volta de um arquivo | `notDirectory` |
  | aspas duplas em dobro | `notAbsolute` |
  | `"C:\nao\existe"` | `notFound` |

- **Nota baixa para o BACKEND:** o caminho vazio e o só de espaços não voltam como `notAbsolute`, como o BACKEND
  esperava. O IPC lança `Error: rootPath must not be empty`, cru e em inglês. Pela interface isso não aparece,
  porque o botão fica desabilitado, mas um agente ou um renderer antigo recebe um erro sem código C3. Corrigido
  depois pelo BACKEND com `refusal:'empty'`.
- Reverificação em #239 31564312 (já com a `main` 04dcc451; build limpo), por chamada direta, em `check-239-empty`:
  - `""`, `"   "`, `'""'`, `"''"`, `'" "'` e `"\t\n"` voltam como `{ok:false, refusal:'empty'}`, com o código
    `workspace.root.empty`: "Escolha a pasta deste workspace." / "Choose the folder for this workspace.";
  - uma aspa sozinha volta como `notAbsolute`;
  - `42` e `null` lançam "rootPath must be a string", um erro genérico de entrada malformada, como combinado. Uma
    pessoa não consegue mandar isso.

  A nota foi fechada.

### Toasts (#245): Pré-homologado

PR mesclado com a `main`, em pt-BR claro e en escuro, achando o toast pelo que se vê (cartão com botão de fechar), em
`pre-245`.
- Rajada de 5 "Copiar caminho": um cartão só, "Caminho copiado ×5" ("Path copied ×5"). A região educada anuncia
  "Repetida 5 vezes" ("Repeated 5 times") uma vez. O toast dura cerca de 7 s a partir do começo da rajada.
- 13 s com o mouse em cima: o toast continua lá.
- O toast não rouba o foco, que fica no arquivo.
- Pelo teclado, 5 Tabs alcançam "Dispensar notificação" ("Dismiss notification"). Escape fecha e devolve o foco para
  onde estava. Escape no editor fica com o editor, e o toast continua, como combinado com o FRONTEND.
- Sem erros de console nos dois idiomas. Uma execução pt-BR teve o clique do menu de contexto esgotando o tempo, e
  não se repetiu em 3 execuções.
- Ressalvas para o FRONTEND:
  1. **Atrapalha (baixo):** "Copiar caminho relativo" mostra o mesmo "Caminho copiado" que "Copiar caminho" e se funde
     com ele ("×4" depois de alternar). Não dá para saber qual dos dois foi copiado. Critério: "Caminho relativo
     copiado" / "Relative path copied" como toast próprio.
  2. **Cosmético:** a região viva lê "Caminho copiado×5", e o leitor de tela fala o sinal "×" colado. Critério: o
     contador escondido do leitor (`aria-hidden`), já que "Repetida 5 vezes" diz o mesmo.
  3. **Cosmético:** o toast cobre a ponta direita da barra de status ("4 painéis · terminal"), em 1280×860.
     Critério: ficar acima da barra de status.
- Reverificação em a40e1cba, nos dois idiomas, com as 3 ressalvas fechadas:
  - "Caminho relativo copiado" / "Relative path copied" é um toast próprio. Ao alternar, ficam 2 cartões
    ("Caminho copiado ×3" e o relativo).
  - O contador aparece como " ×N", com espaço, e fica fora do anúncio.
  - A pilha fica acima da barra de status, que continua legível. Captura em `en-US-mixed.png`.
  - Pausa, teclado, Escape e foco seguem iguais, sem erros.

### Menu do divisor por `contextmenu` (#241): Homologado

Na `main` 6666d723, no Windows, em pt-BR e en (`check-241`, `check-241b`).
- Os 4 divisores (barra lateral, colunas, linhas) têm `tabindex=0` e nome traduzido. As setas redimensionam (barra
  lateral de 280 para 320).
- O botão direito abre "Largura da barra lateral: opções de tamanho", com Menor / Maior / Restaurar o tamanho padrão.
- No divisor da grade, o `contextmenu` de origem de teclado (o que o Chromium gera para Shift+F10 e a tecla de menu)
  abre "Divisor entre colunas" com "Mover o divisor para a esquerda/direita". O foco vai ao primeiro item, ↓ passa
  ao segundo, e Escape fecha e devolve o foco ao divisor.
- Limite do teste: as teclas sintéticas do Playwright não geram o `contextmenu` nativo, então Shift+F10 e a tecla de
  menu "de verdade" não foram apertados aqui. O Linux fica com a CI.
- Nota baixa: Enter em "Mover o divisor para a esquerda" move (50 → 45), mas o menu continua aberto, com o foco no
  item. Num menu, ativar um item costuma fechá-lo e devolver o foco. Se ficar aberto de propósito para repetir, o
  item deveria dizer isso.
- **Achado à parte (atrapalha, F4/WCAG 2.1.2):**
  - Ao navegar com Tab a partir do filtro da barra lateral, o foco passa pelo divisor da barra lateral, entra no
    primeiro terminal e não sai mais em 120 Tabs.
  - F6, Ctrl+F6, Shift+F6, Alt+F6, Ctrl+Tab e Escape também ficam no terminal. Só os atalhos reservados (Ctrl+K,
    Ctrl+B, Ctrl+1…5) levam para fora.
  - Com isso, os divisores da grade, que são a alternativa de 2.5.7 para o arrasto, ficam inalcançáveis só com o
    teclado.
  - Critério de aceite: uma tecla documentada para sair do terminal (por exemplo F6 entre regiões, ou um modo "Tab
    move o foco" como o do VS Code), dita no leitor de tela ao entrar no terminal e listada em `wcag-2.2.md`.

### Diagnóstico (#203): Homologado

Na `main` 04dcc451, app real em perfil descartável (`check-203`). Todos os valores plantados eram falsos e estavam em:
- o ambiente: chave Anthropic, token GitHub, segredo AWS, `DATABASE_URL` com senha e host interno, Bearer JWT;
- um `main.old.log` antigo, no formato real do log, com 7 linhas adversariais:
  - URL com usuário e senha e `?token=`;
  - `ANTHROPIC_API_KEY=`;
  - caminho absoluto e e-mail;
  - `Authorization Bearer`;
  - uma senha em texto livre ("the password is …");
  - caminho UNC;
  - IPv4/IPv6 com máquina e usuário;
- o nome da pasta do workspace ("cliente-acme-confidencial");
- um remote git com token;
- um `workspace.create` com o token no caminho.

O que foi verificado:
- O pacote foi exportado com o diálogo de salvar respondido por um caminho temporário, sem diálogo nativo na tela.
  Foi aberto com o `tar` do Windows: 6 arquivos, 10 substituições contadas.
- A ferramenta `oxespace_diagnostics` foi chamada pelo MCP interno como um agente, e o `analysisSummary` pela IPC.
  As duas devolvem o mesmo texto.
- Buscas em todos os arquivos e nas duas saídas, por cada valor plantado, prefixos (`ghp_HMLFAKE`, `sk-ant-api03`),
  nome do usuário, nome da máquina, `C:\Users`, a pasta temporária, os IPs e `@`: **0 ocorrências**.
- O trecho do log é seguro por construção: só passam linhas cuja mensagem começa por uma entrada da lista permitida,
  cortada nela ("listening on …"). As 7 linhas adversariais foram descartadas inteiras e entraram na contagem.
- O incidente gravado (`incident.ipc.validationRejected`) traz só o hash de 8 caracteres no `subject`.

Notas baixas para o BACKEND:
1. A redação de IP pega a versão do V8 (`"v8": "[ip]-electron.0"`), porque 4 números de até 3 dígitos parecem um IPv4.
   O suporte perde a versão do V8. Critério: não redigir dentro de `versions`, ou exigir que não haja `-` ou letras
   colados.
2. Fora do pacote (`packaged: false`), `versions.json`, `snapshot.appVersion` e a ferramenta dizem "OXESpace 44.9.3",
   que é a versão do Electron, em vez de 1.3.3. É a mesma raiz já corrigida no About (#168/#185). Critério: usar a
   mesma fonte de versão do About.

As 2 notas foram fechadas no #252 (679fa231, já com a `main`), com a mesma sonda:
- `versions.json` traz `"v8": "15.2.124.43-electron.0"` inteiro e `"version": "1.3.3"`;
- `snapshot.appVersion` é 1.3.3, e `electronVersion` continua 44.9.3;
- a ferramenta diz "OXESpace 1.3.3 on win32".

Seguem 0 vazamentos nos 8 arquivos e saídas. As substituições passaram de 10 para 9 (a do V8 saiu).

### Gate visual (#193): Homologado

O `visual-regression.yml` roda a cada push na `main`, em Windows e Linux. Na execução 41154517991 (`main`
16d27efa), as duas plataformas seguiram o fluxo inteiro:
1. "Compare with the baselines" falha;
2. "Side-by-side review" roda o `scripts/visual-review.mjs`;
3. o artefato `visual-review-<plataforma>` é enviado (2,6 MB e 2,9 MB);
4. "Open or update the issue" abre a issue: #249 (windows) e #250 (linux), cada uma com 2 comentários de pushes
   seguintes.

A issue lista as superfícies, o link do artefato e o caminho para aceitar a mudança.

As 22 diferenças do Windows não são regressão:
- A baseline é antiga: a esperada tem 3 abas (Code, Thread, OxeQuery) e o estado vazio antigo; a atual tem as 5 abas,
  o novo estado vazio do F1 e "Abrir OxePod/OxePost". Na amostra conferida (`empty-light-desktop`), toda a diferença
  vem disso.
- 5 superfícies nunca tiveram baseline: pt-BR, confortável, forced-colors e o splash claro e escuro. A atual existe,
  mas a esperada não.

Pela regra de baselines por lote, falta despachar o `visual-baselines.yml` para as duas plataformas. Enquanto isso,
o gate continua vermelho em todo push e a issue acumula comentários.

### Risco de SQL na `main` (#237): Homologado

Na `main` bab99b50, `guardSql` foi chamado direto por `npx jiti`:
- A sonda original de 22 casos (`probes/sql-guard-probe.mts.txt`) dá o mesmo resultado da pré-homologação. Só
  `SELECT` simples e a string `$$…$$` ficam como leitura.
- Os casos extras seguem fechados:
  - `foo$a$` com `DELETE` depois → destructive;
  - `PREPARE … AS DELETE` → `destructiveInside`;
  - `COPY … FROM PROGRAM` → `copyProgram`;
  - `CALL` → `callProcedure`;
  - `FOR SHARE` → `rowLock`.
- Nova sonda de escapes (`probes/sql-guard-escapes-probe.mts.txt`, 8 casos):
  - `E'\''`, `e'\''` e `U&'…'` seguidos de `DELETE`/`DROP` dão 2 instruções, destructive. A string com escape do
    Postgres é lida certo.
  - Um comentário aninhado `/* a /* b */ DELETE … */ SELECT 1` fica como leitura, o que está certo no Postgres: o
    `DELETE` está dentro do comentário.
  - `'\''`, `"\""` e `[a';b]` seguidos de `DELETE` ficam como leitura, com 1 instrução. Seriam desvios em
    MySQL e SQL Server, mas o OxeQuery só fala SQL com Postgres (driver `pg`). No Postgres, com
    `standard_conforming_strings` ligado (o padrão desde a 9.1), `'\''` termina em erro de sintaxe, não num `DELETE`.
- **Nota baixa para o BACKEND:** num Postgres legado com `standard_conforming_strings = off`, `SELECT '\''; DELETE …`
  executaria o `DELETE` e seria classificado como leitura. Critério: uma string comum com `\'` dentro vale como
  "desconhecido" (pede confirmação). Outra opção é ler o `standard_conforming_strings` da conexão.
- As telas de quarentena com `OXESPACE_E2E_MCP_FIXTURE` ficaram pendentes: a máquina tinha menos de 1 GB livre e o
  build não rodou.

Nota fechada no #253 (68cb4c93), com a sonda de escapes mais 9 casos:
- Classificados como destructive:
  - `SELECT '\''; DELETE`;
  - `'a\''' ; DELETE`;
  - `SELECT 'x\'', 'y'; DROP TABLE t; --'`, com `ambiguousEscape`;
  - `$$\'$$; DELETE`.
- Continuam como leitura: `'C:\path'`, `'C:\path\'`, `'it''s'`, `~ '\d+'`, `LIKE '50\%' ESCAPE '\'` e o JSON
  `'{"a":"b\"c"}'`.
- `E''`, `U&''` e `$$` não mudaram.

### Telas de quarentena do MCP (fixture do #237)

Na `main` bab99b50, com `OXESPACE_E2E_MCP_FIXTURE=quarantine`, em pt-BR claro e en escuro, com 2 GB ou mais livres e
o bloqueio de processo pesado tomado (`check-quarantine*`, capturas em `quarantine/`).
- **Caminho:** o MCP não está nas Configurações (Geral … Diagnóstico). Abre pelo ícone "Abrir os servidores MCP" na
  barra do workspace, na aba "Catálogo". Os servidores ficam em "Instalados 4".
- **Lista:**
  - `docs-search` e `deploy-helper` aparecem "EM QUARENTENA", e `new-server` aparece "PRECISA DE REVISÃO" ("REVIEW
    REQUIRED").
  - Todos os botões têm nome acessível.
  - Sem erros de console.
- **Detalhe do `docs-search`** (expande na própria lista, sem diálogo à parte):
  - Explica bem: "Em quarentena: mudou depois de você confiar nele", "Ele adicionou upload_file", "não é oferecido
    aos agentes e não inicia".
  - Tem um bloco "Descrições de ferramentas com instruções para o modelo", com as categorias "Tenta substituir as
    instruções do agente" e "Pede ao agente que envie dados privados para outro lugar".
  - Mostra o comando e os argumentos, e a lista das ferramentas expostas com a descrição completa.
- Enter no cabeçalho da linha só expande ou recolhe, sem conceder confiança. Escape fecha o painel e devolve o foco ao
  ícone do MCP.
- **Achado 1 (atrapalha, virou F25):** nada fora da lista avisa que há 2 servidores em quarentena e 1 sem revisão. O
  ícone do MCP, o sino e "Sistemas 1/5" não têm marca, e a aba "Instalados" mostra só "4".
- **Achado 2 (atrapalha, segurança):**
  - O texto manda "use Testar para confiar nele de novo". O mesmo botão "Testar" serve para ver se o servidor responde
    e para devolver a confiança a um servidor cujas descrições tentam injetar instruções.
  - Quem quer só testar pode acabar confiando. Na sonda, o clique em "Testar" não mostrou confirmação nem mudou o
    status. Não ficou claro se o clique acertou o botão, então o efeito real fica para reconferir.
  - O coordenador leu o código: `test()` em `mcp.service.ts` recusa um servidor sem confiança e nunca devolve a
    confiança. O defeito é o texto que engana e a falta de um "Confiar de novo…" explícito com confirmação. Isso
    entrou no F25, junto com o chip de alerta e o plural. Foi conferido por leitura de código, não pela caixa-preta;
    reconferir pela interface quando o F25 chegar.
  - Critério de aceite: separar "Testar" (só verifica, sem conceder confiança) de "Confiar de novo…". O segundo abre
    uma confirmação que repete as instruções suspeitas e tem "Cancelar" como padrão.
- **Achado 3 (cosmético):** a quarentena usa o mesmo chip cinza dos outros estados, sem cor nem ícone de alerta, e a
  linha em quarentena tem o mesmo peso visual de uma confiável. Também aparece "0 ferramenta" em vez de "0 ferramentas".

### Regras por ferramenta e config protegida (#208 b0a399c8): Pré-homologado com ressalvas

- A regressão do #212 passa no branch (`hml-212.test.ts.txt` como teste de integração, junto com
  `protected-config-approval` e `protected-config`): 3 arquivos, 23 testes, pelo `test:electron`.
- O branch está **atrás da `main`** e conflita em `shared/mcp-coverage.ts`, `electron/main/e2e/mock-ipc.ts` e
  `docs/validation/mcp-coverage-1.4.md`. Por isso a sonda rodou no branch sozinho.
- A sonda (`probes/protected-config-probe.mts.txt`) chama o `evaluatePermission` e o `fullAccessPolicy` reais. As regras
  salvas permitem os programas comuns (`git`, `python`, `node`, `curl`, `sh`, `powershell`, `tar`, `yq`…) e editar `**`
  e `.*`, que é o cenário em que a proteção precisa valer.
- **Edição pela ferramenta (caminho):** tudo certo. Ficam `ask GUARDED` também com Acesso total:
  - `.oxespace/policy.json`, `.oxespace\policy.json`, `.OXESPACE\POLICY.JSON`;
  - o caminho absoluto, `./`, `sub/../`;
  - `oxe.yaml`, `OXE.YAML`.

  O `oxe.yml` passa, o que está certo: o app só lê `oxe.yaml`.
- **Comandos que gravam e são reconhecidos:** `cp … .oxespace/policy.json`, `Set-Content .oxespace\policy.json`,
  `Set-Content -Path .\oxe.yaml` e `jq … | tee .oxespace/policy.json` → `ask GUARDED`.
- **Ressalva (atrapalha, segurança): comandos que gravam no arquivo protegido e saem como `allow`** quando há regra
  salva para o programa:
  - `git checkout -- .oxespace/policy.json`, `git restore oxe.yaml` e `git apply evil.patch`. Um commit trazido do
    remoto com uma política frouxa volta com um simples checkout.
  - Interpretadores: `python -c "open('.oxespace/policy.json','w')…"` e `node -e "…writeFileSync('oxe.yaml')…"`.
  - Shell aninhado: `sh -c 'echo {} > .oxespace/policy.json'` e `powershell -c "Set-Content .oxespace\policy.json …"`.
  - Download e extração: `curl -o .oxespace/policy.json`, `tar xf p.tar .oxespace/policy.json` e `unzip -o p.zip`.
  - Editores no lugar: `yq -i … oxe.yaml` e `npx some-tool --write .oxespace/policy.json`.

  Critério de aceite: um comando que cita um arquivo protegido em qualquer posição, inclusive dentro de `-c`/`-e` e de
  shell aninhado, sai `ask GUARDED`. `git checkout/restore/apply/reset/stash pop/pull/merge` e extração de arquivo
  compactado valem como escrita em qualquer arquivo e nunca são aprovados por regra quando a pasta tem um arquivo
  protegido. Os casos desta sonda viram teste.
- **Notas baixas:**
  - Redirecionamento (`echo {} > .oxespace/policy.json`, `>> oxe.yaml`, `cd .oxespace && echo {} > policy.json`)
    chega à pessoa como `ask`, mas sem `guarded`. Sem o aviso de arquivo que comanda agentes, a pessoa pode receber a
    opção de lembrar ou de "para a sessão".
  - Os sinônimos de caminho do Windows (`policy.json.`, `policy.json::$DATA`, o nome curto `POLICY~1.JSO`, `oxe.yaml.`)
    também saem `ask` sem `guarded`. O Windows os resolve para o mesmo arquivo.

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
