# Maturidade do app Android — OXESpace 1.4

- **Base avaliada:**
  - `origin/main` `bab99b50` (M0: projeto `mobile/android`, `scripts/android`, protocolo, tokens e textos gerados).
  - A cadeia de PRs M2–M9: #213 `96fdd67e` → #214 `1b418f6a` → #215 `ec199651` → #216 `d324d616` → #217 `ecde9cb1` → #222 `434f5153` → #229 `bf0ee1eb` → #231 `7d0274dd` → #236 `0da19cf8`, e #218 `39637c7c`.
  - A leitura foi feita na ponta da cadeia (#236), que contém todos os anteriores. Cada achado diz o PR em que o código entrou.
- **Avaliador:** sessão independente (a mesma que fez a avaliação do backend, PR #255), só leitura. Nada de Gradle, emulador, adb ou APK. O que só se prova rodando está marcado **"Não verificável aqui"**, com o teste ou job que provaria.
- **Já mapeado (não repetido):** itens M0–M9, B9 e B9.2 (`docs/roadmap-1.4/mobile.md`) e o roteiro de homologação (`docs/validation/mobile-1.4.md`, PR #232). O lado desktop do gateway está avaliado em `maturity-backend-1.4.md` (§5.9).

## 1. Resumo executivo

**Nota geral: 3,7 / 5 (Definido, com segurança perto de Gerenciado).** É um app pequeno e cuidadoso, com cerca de 5,5 mil linhas de código de produção e 2,5 mil de testes. As escolhas de segurança são as certas para um companheiro de rede local. O que falta é coerência no modelo de risco das ações e prova automática do build de release.

Forças:
1. **Identidade e transporte bem feitos.**
   - Chave P-256 no Keystore (StrongBox quando existe), que nunca sai do aparelho e é apagada na revogação.
   - Nenhum token gravado em disco.
   - TLS que confia em um único certificado, pela impressão digital do QR, com `RESTRICTED_TLS`, sem redirecionamentos e com o pin conferido de novo no hostname verifier (`PinnedTls.kt`, `DeviceKeys.kt`, `PairedDesktop.kt`).
2. **Privacidade por padrão.**
   - Backup e transferência de dispositivo excluídos.
   - `usesCleartextTraffic="false"`.
   - `FLAG_SECURE` nas telas de pedido, terminal e pareamento.
   - Notificações `VISIBILITY_PRIVATE`.
   - Só endereços privados, inclusive o digitado à mão.
   - Nenhum `Log` no código de produção.
3. **Contrato gerado e testado.**
   - Protocolo, tokens de tema e textos en/pt-BR gerados do desktop por `npm run android:generate`.
   - Teste no desktop (`tests/android-generated.test.ts`) que falha se o Kotlin divergir ou se uma capacidade proibida entrar num enum.
   - 109 capturas Paparazzi e 5 testes instrumentados.

Riscos:
1. **MB-M-01 (Média):** aprovar exige biometria, mas digitar num terminal compartilhado ou mandar mensagem e direcionar o agente não exige nada além do celular desbloqueado, e essas ações são mais poderosas que uma aprovação.
2. **MB-M-02 (Média) → BE-M-10:** o pedido chega cortado (2.000 caracteres) sem marca de corte, e a tela o apresenta como "inteiro" e permite aceitar.
3. **MB-M-03 (Média):** o APK de release é minificado pelo R8, mas nenhum teste roda sobre ele. A CI de PR só monta o debug.

## 2. Stack e arquitetura detectadas (Fase 1)

| Item | Versão / forma | Evidência |
|---|---|---|
| Módulos Gradle | `:app` (Android) e `:protocol` (Kotlin JVM puro: frames C5, cliente TLS fixado, sessão, buffers) | `settings.gradle.kts`; `protocol/build.gradle.kts` |
| Ferramentas | AGP 9.4.1, Kotlin 2.3.21, Gradle 9.6.1 (wrapper com `distributionSha256Sum`), bytecode Java 17 | `gradle/libs.versions.toml`; `gradle/wrapper/gradle-wrapper.properties` |
| SDK | `minSdk 28`, `targetSdk`/`compileSdk 37` | `app/build.gradle.kts` |
| UI | Compose BOM 2026.09.00, Material 3, tema gerado dos tokens (`OxeTokens.kt`, `OxeTheme.kt`) | `ui/theme/*` |
| Estado | ViewModels + `StateFlow`; `DesktopSessionController` como fonte única do estado da conexão; repositórios de listas ao vivo | `session/*`, `protocol/live/*` |
| DI | manual (sem Hilt/Koin); dependências passadas por construtor | `OxeApplication.kt`, `MainActivity.kt` |
| Navegação | estado no `MainActivity` (sem Navigation Compose); deep link por extras da notificação | `MainActivity.kt:160-167` |
| Rede | OkHttp 5.4 (HTTPS para `/pair`, WSS para a sessão), kotlinx.serialization 1.11 | `protocol/session/RemoteConnection.kt` |
| Armazenamento | uma `SharedPreferences` privada com o desktop pareado (sem segredo); chave no Keystore | `PairedDesktop.kt`, `DeviceKeys.kt` |
| Câmera/QR | CameraX 1.6.2 + ZXing core 3.5.4, decodificado no aparelho | `pairing/QrDecoder.kt`, `ui/pairing/QrScanner.kt` |
| Segundo plano | serviço em primeiro plano `connectedDevice`, não exportado | `AndroidManifest.xml`, `notify/SessionService.kt` |
| Build e CI | `android.yml`: `lint` (avisos como erro), `verifyPaparazziDebug`, `:protocol:test`, `assembleDebug`; actions fixadas por SHA. #218: instrumentados num emulador, sob pedido. #231: `android-release.yml` assina com segredos do repositório e verifica com `apksigner` (v2/v3), além do `.sha256` | `.github/workflows/android.yml`; PR #231, #218 |

## 3. Scorecard

| Dimensão | Nota | Justificativa | Evidência principal |
|---|---|---|---|
| Arquitetura | 4,0 | Separação limpa entre protocolo JVM testável e app; controlador único da sessão; estado por `StateFlow`. A navegação manual vai pesar se o app crescer. | `protocol/*`; `DesktopSessionController.kt` |
| Segurança | 3,5 | Keystore, pin TLS, revogação que apaga a chave, sem tokens em disco, LAN apenas, `FLAG_SECURE`. Perde por MB-M-01 e MB-M-02. | `PinnedTls.kt`; `DesktopSessionController.kt:170-177` |
| Privacidade | 4,0 | Sem backup, sem logs, notificações privadas, segredos redigidos pelo desktop antes de sair. | `data_extraction_rules.xml`; `Notifications.kt:79` |
| Acessibilidade | 3,5 | `heading()`, `liveRegion`, papéis e descrições (37 usos de semântica), capturas com escala de fonte (`AccessibilitySnapshotTest`). O alvo de 48 dp não é verificado automaticamente. | `ui/live/*`; `test/.../AccessibilitySnapshotTest.kt` |
| Resiliência | 4,0 | Backoff exponencial com jitter (1–60 s), pausa fora da LAN, nova tentativa imediata ao voltar, `clientId` contra envio duplicado, retomada por cursor, estados próprios para revogado, incompatível e não aceito. | `Backoff.kt`; `DesktopSessionController.kt:186-205` |
| Desempenho e bateria | 3,0 | Canal silencioso do serviço e WSS único. Sem medição de bateria nem de recomposição. **Não verificável aqui.** | `SessionService.kt` |
| i18n | 4,0 | en e pt-BR gerados do catálogo do desktop (154 chaves cada), idioma por app (`locales_config.xml`). | `values*/strings.xml`; `scripts/android/strings-xml.mjs` |
| Testes | 3,5 | Unidade no protocolo e no app, Paparazzi de cada tela, instrumentados de chave, biometria, sessão, notificação e `FLAG_SECURE`. Os instrumentados não rodam em todo PR (#218 sob pedido), e o build R8 não é testado. | `app/src/test`, `app/src/androidTest`; PR #218 |
| Build, release e assinatura | 3,5 | Wrapper com hash, lint estrito, assinatura só no workflow, keystore apagado no fim, `apksigner verify`. Sem atestação de proveniência (o desktop tem), e `--clobber` troca um APK já publicado. | PR #231 `android-release.yml` |
| Observabilidade | 2,5 | Nenhum registro local de falhas (de propósito: sem logs). Para diagnosticar, só o desktop (auditoria por dispositivo). | — |
| DX | 4,0 | README e RELEASING, geração por um comando, erros de geração que falham em vez de perder campo. | `mobile/android/README.md`, `RELEASING.md` |

## 4. Inventário (Fase 2)

| Módulo / tela | Tipo | Caminho | PR | Testes | Nota |
|---|---|---|---|---|---|
| Protocolo C5 (frames, limites, comandos) | Contrato gerado | `protocol/.../RemoteProtocol.kt` (696 linhas), `RemoteFrames.kt` | main + #213 | `protocol/src/test`; `tests/android-generated.test.ts` | 4,5 |
| QR e verificação de pareamento | Módulo | `protocol/.../pairing/PairingQr.kt`, `PairingVerification.kt`, `LanAddress.kt` | #213 | `PairingQrTest`, `PairingVerificationTest` | 4,5 |
| Cliente de pareamento + TLS fixado | Rede | `PairingClient.kt`, `PinnedTls.kt` | #213 | `PairingClientTest` (MockWebServer com TLS) | 4,5 |
| Chave do aparelho | Segurança | `pairing/DeviceKeys.kt` | #214 | `DeviceKeysOnDeviceTest` | 4,5 |
| Tela de pareamento + leitor de QR | Tela | `ui/pairing/PairingScreen.kt`, `QrScanner.kt` | #214 | Paparazzi | 4 |
| Sessão autenticada (hello/auth/refresh) | Rede | `protocol/.../session/*`, `session/DesktopSessionController.kt` | #215 | `SessionProtocol` tests, `SessionOnDeviceTest` | 4 |
| Listas ao vivo, conversa, terminal | Telas | `ui/live/LiveHome.kt`, `ThreadScreen.kt`, `TerminalScreen.kt`, `protocol/live/*` | #216 | `ThreadTimeline`, `TerminalBuffer`, Paparazzi | 3,5 |
| Agir: enviar, direcionar, parar, responder | Ações | `ThreadScreen.kt`, `RequestScreen.kt`, `approval/*` | #217 | `RequestResponder` test, `NoFrameWithoutBiometricsTest` | 3 (MB-M-01, MB-M-02) |
| Segundo plano e notificações | Serviço | `notify/*` | #222 | `AlertWatcher` test, `NotificationsOnDeviceTest` | 4 |
| Visual, capturas, TalkBack | UI | `ui/theme/*`, `test/.../*SnapshotTest.kt` | #229 | 109 capturas | 4 |
| Release assinado | Build | `.github/workflows/android-release.yml`, `RELEASING.md` | #231 | `apksigner verify` no job | 3,5 |
| Recents e capturas protegidos, idioma por app | Segurança/UI | `ui/SecureScreen.kt`, `locales_config.xml` | #236 | `SecureAndLanguageOnDeviceTest` | 4 |
| Instrumentados no emulador | CI | workflow do #218 | #218 | — | 3 (sob pedido) |

## 5. Análise por tela e módulo (Fase 3)

### 5.1 Pareamento (#213, #214) — 4,5
- **Bom:**
  - QR estrito: impressão digital de 64 hex, código de 22 caracteres base64url, host como literal, campo repetido recusado, nome sem caracteres de controle (`PairingQr.kt:37-73`).
  - Só endereços privados, sem DNS (`LanAddress.kt`).
  - Código de verificação mostrado nos dois lados e tela de pareamento sob `FLAG_SECURE`.
  - Frames da câmera decodificados no aparelho e nunca gravados.
- **Estados:** QR inválido, expirado, já usado, recusado na janela do desktop, desktop inalcançável (firewall). Já mapeado no roteiro, itens 0.x.

### 5.2 Sessão e conexão (#215) — 4
- **Bom:**
  - Token só em memória, renovado com a chave do aparelho.
  - `revoked` apaga a chave e o desktop guardado (`DesktopSessionController.kt:170-177`).
  - Versão incompatível e erro de protocolo param a reconexão em vez de insistir.
  - Endereço novo é gravado só depois que o pin confere.
- **Lacuna:** nenhuma de segurança. Observabilidade: falhas de conexão não deixam rastro no celular (ver §6, MB-M-05).

### 5.3 Listas ao vivo, conversa e terminal (#216) — 3,5
- **Bom:** retomada por cursor sem duplicar; terminal com buffer limitado, ANSI → cores, "Carregando…" em vez de "sem saída" (roteiro 3.5); segredos redigidos pelo desktop antes de sair (roteiro 3.3); terminal só leitura sem `phoneWrite`.
- **Lacuna:** sem medição de recomposição e de memória com conversa longa. **Não verificável aqui:** Macrobenchmark ou o Layout Inspector na homologação.

### 5.4 Agir pelo celular (#217) — 3
- **Bom:**
  - `RequestResponder` aplica antes de enviar as mesmas regras do desktop: só pedidos `answerable`, só decisões oferecidas, nunca `acceptForSession`, e biometria forte ou credencial do aparelho (`approval/RequestResponder.kt:31-53`).
  - O desktop confere id e geração de novo.
  - `clientId` evita mensagem repetida.
  - Teste instrumentado garante que nenhum frame sai sem biometria (`NoFrameWithoutBiometricsTest`).
- **Lacunas:**
  - MB-M-01: ações sem biometria.
  - MB-M-02: comando cortado.
  - A biometria é só uma porta local: o desktop não recebe prova de que ela ocorreu, porque a chave não exige autenticação (por desenho, para o serviço renovar o token com a tela apagada, `DeviceKeys.kt:59`). Ver MB-M-04.

### 5.5 Segundo plano e notificações (#222) — 4
- **Bom:** serviço `connectedDevice` não exportado com ação "Desconectar"; canais separados (o do serviço com importância mínima); `PendingIntent` imutáveis; notificação privada na tela bloqueada; toque abre o pedido certo.
- **Lacuna:** **Não verificável aqui:** consumo em Doze e o atraso da notificação (aceite do M6). A homologação mede; a CI não.

### 5.6 Visual e acessibilidade (#229) — 4
- **Bom:** tema gerado dos tokens do desktop (C4), claro e escuro; capturas em en e pt-BR, nos dois modos e com fonte grande; `heading()`, `liveRegion`, papéis e descrições; ícones decorativos com `contentDescription = null` só ao lado de rótulo (`LiveHome.kt:151-154`).
- **Lacuna:** o alvo de 48 dp e o contraste não têm verificação automática. A ATF (Accessibility Test Framework) no Espresso ou `composeTestRule` com checagens de acessibilidade cobriria os dois.

### 5.7 Release (#231) — 3,5
Ver MB-M-03 e MB-M-06.

### 5.8 Proteção de tela e idioma (#236) — 4
- **Bom:** `FLAG_SECURE` com contagem para telas aninhadas; a exceção de homologação (`allow_capture`) só existe em build debug (`SecureScreen.kt:57-66`); teste instrumentado.
- **Observação (Baixa):** o `MainActivity` exportado (é o launcher) aceita os extras `thread`/`request` vindos de qualquer app e abre a tela correspondente. Isso não responde nada, porque responder exige biometria, mas permite que outro app leve a pessoa direto a um pedido. Ver MB-M-07.

## 6. Achados

| ID | Severidade | Dimensão | Módulo(s) | Problema | Evidência | Impacto | Recomendação | Esforço | Já mapeado/Em PR |
|---|---|---|---|---|---|---|---|---|---|
| MB-M-01 | Média | Segurança | `ui/live/TerminalScreen.kt`, `ThreadScreen.kt` | Aprovar exige biometria, mas `terminal.write` (num painel com `phoneWrite`), `thread.send` e `thread.steer` saem sem confirmação nenhuma, e o app não tem bloqueio próprio. Escrever num terminal é rodar comandos no desktop. Mandar uma mensagem a um agente com acesso total também. | `TerminalScreen.kt:106,197-204`; `ThreadScreen.kt:240-284`; comparar com `RequestResponder.kt:46` | Quem pega o celular desbloqueado (ou um app de acessibilidade malicioso) age no desktop sem a prova que se exige para uma aprovação menor. | Pedir biometria/credencial ao abrir um terminal com `phoneWrite` e ao enviar a primeira mensagem, com validade curta (por exemplo 5 min, renovada ao usar); ou um bloqueio do app com o mesmo prazo. Teste instrumentado como o `NoFrameWithoutBiometricsTest` para `terminal.write` e `thread.send`. | M | Novo → #217 (M5). M5 pede biometria só para aprovações. |
| MB-M-02 | Média | Segurança (B10) | `ui/live/RequestScreen.kt`; protocolo | A tela diz mostrar o pedido "inteiro" antes de responder, mas o desktop corta `command` em 2.000 caracteres, `paths` em 100 e `detail` também, sem campo `truncated`. O app não tem como saber e oferece aceitar. | `RequestScreen.kt:62,115`; PR #204 `filters.ts:125-150`, `protocol.ts:452-476` | Um agente pode esconder o fim de um comando longo de quem aprova pelo celular. | Com o campo `truncated` vindo do desktop (BE-M-10): mostrar "cortado, veja no computador" e oferecer só recusar. Captura Paparazzi do estado. | P | **→ BE-M-10** (BACKEND #204) e #217 (M5) |
| MB-M-03 | Média | Build/Testes | `app/build.gradle.kts`, CI | O release é minificado (`isMinifyEnabled`, `isShrinkResources`), mas a CI de PR monta só o debug. O job de release roda `testReleaseUnitTest` (JVM, sem R8) e publica. Nenhum teste exercita o APK minificado contra um gateway. O `proguard-rules.pro` diz que as regras dos frames "vêm com o módulo protocol", mas o módulo não tem `consumer-rules.pro`. | `app/build.gradle.kts` (`buildTypes.release`); `app/proguard-rules.pro`; `protocol/build.gradle.kts`; PR #231 `android-release.yml:100` | Um frame que o R8 renomeie ou remova só aparece no APK publicado. As regras embutidas do kotlinx.serialization cobrem o caso comum, mas não há prova. | Rodar `assembleRelease` (sem assinar) e os instrumentados sobre ele (`testBuildType = "release"` num job do #218) antes de publicar; corrigir o comentário ou adicionar `consumer-rules.pro`. | M | Novo → #231 (M8) / #218 |
| MB-M-04 | Baixa | Segurança | `approval/BiometricApprovalGate.kt`, `DeviceKeys.kt` | A biometria não usa `CryptoObject`, e a resposta não carrega prova verificável pelo desktop. Um app adulterado num aparelho com root responde sem biometria. | `BiometricApprovalGate.kt:30-50`; `DeviceKeys.kt:59` | Baixo: exige o aparelho comprometido. O desktop continua aplicando `answerable`, as decisões e a geração. | Segunda chave com `setUserAuthenticationRequired(true)` só para assinar respostas (`requestId` + `generation` + decisão), verificada pelo desktop; a chave de sessão continua sem autenticação. Avaliar para depois da 1.4. | M | Novo → depois da 1.4 |
| MB-M-05 | Baixa | Observabilidade | `session/*` | Falhas de conexão, R8 ou revogação não deixam nenhum rastro no celular; para diagnosticar, só o desktop. | ausência de log/diário em `app/src/main` | Suporte depende de reproduzir com o desktop ao lado. | Diário local pequeno de códigos (sem conteúdo), exportável pela tela "Sobre", no espírito do B8.3. | P | Novo → depois da 1.4 |
| MB-M-06 | Baixa | Release | PR #231 `android-release.yml` | O APK não tem atestação de proveniência, ao contrário do desktop, e `gh release upload --clobber` substitui um APK já publicado. A impressão digital do certificado é conferida à mão (roteiro 9.2), não pelo job. | PR #231 `android-release.yml:106-125` | Um re-run troca o binário de um release sem rastro. | `actions/attest-build-provenance` no APK; recusar `--clobber` quando o asset já existe; conferir o SHA-256 do certificado contra um valor fixo no repositório. | P | Parcial: roteiro 9.1–9.2 → #231 (M8) |
| MB-M-07 | Baixa | Segurança | `MainActivity.kt` | O launcher exportado aceita `thread`/`request` de qualquer intent e navega até lá. | `MainActivity.kt:160-167` | Outro app pode levar a pessoa a um pedido verdadeiro num momento escolhido (engenharia social); não responde nada sozinho. | Aceitar esses extras só de `PendingIntent` próprio (por exemplo um token aleatório por notificação, conferido ao abrir). | P | Novo → #222 / M9 |

## 7. Análise transversal (Fase 4)

- **Arquitetura.** O protocolo em JVM puro é o maior acerto: o teste usa o mesmo cliente que o app, e o desktop gera e confere o Kotlin. A DI manual e a navegação por estado bastam no tamanho atual.
- **Segurança.** Transporte e identidade estão no nível 4. As ações estão no nível 3 por não ter uma regra única para quando pedir biometria (MB-M-01) e por depender do desktop para dizer o que foi cortado (MB-M-02).
- **Privacidade.** Nada sai do aparelho além da sessão com o desktop: sem nuvem, sem backup, sem logs. Os segredos são redigidos no desktop.
- **Acessibilidade.** Semântica e capturas com fonte grande existem; falta verificação automática de alvo e contraste.
- **Resiliência.** Backoff com jitter, estados claros e retomada por cursor. Doze e troca de rede só se provam rodando.
- **Desempenho e bateria.** Sem medição. **Não verificável aqui.**
- **i18n.** Gerada do catálogo do desktop, sem texto fixo no código das telas lidas.
- **Testes.** Boa pirâmide (unidade, captura, instrumentado), mas o instrumentado é sob pedido e o release não é testado (MB-M-03).
- **Build, release e assinatura.** Bom: segredos só no workflow, keystore apagado e verificação v2/v3. Faltam proveniência e imutabilidade (MB-M-06).
- **Observabilidade.** Inexistente no celular por escolha; um diário de códigos resolveria sem ferir a privacidade (MB-M-05).
- **DX.** Um comando gera tudo, e a CI do desktop pega a divergência.

## 8. Padrões positivos a preservar

- Chave no Keystore com StrongBox quando existe, apagada na revogação; nenhum token em disco.
- `PinnedTrustManager` sem CA, com o pin repetido no hostname verifier e `RESTRICTED_TLS`.
- Só endereços privados como literais, sem DNS.
- `FLAG_SECURE` com contagem e exceção só em debug.
- `RequestResponder` repetindo localmente as regras do desktop antes de mandar qualquer frame.
- Protocolo, tokens e textos gerados, com o teste que barra capacidades proibidas no Kotlin.

## 9. Roadmap

| Etapa | Itens | Nível que mira | Na 1.4? |
|---|---|---|---|
| Quick wins | MB-M-02 junto com o BE-M-10; corrigir o comentário de R8 (MB-M-03, parte); MB-M-07 | Segurança 3,5 → 4 | Sim |
| Curto prazo | MB-M-01 (biometria com prazo para terminal e envio); MB-M-03 (instrumentados sobre o release antes de publicar); MB-M-06 (proveniência e sem `--clobber`) | Testes e release 3,5 → 4 | Sim, se couber no M5/M8 |
| Estrutural | MB-M-04 (resposta assinada com chave autenticada); MB-M-05 (diário de códigos); ATF de acessibilidade; medição de bateria | Segurança 4,5; observabilidade 3 | Depois da 1.4 |

## 10. Lacunas ("Não verificável aqui")

| O que | Como verificar |
|---|---|
| APK minificado funcionando contra o gateway | Job do #218 com `testBuildType = "release"` e o gateway falso do `SessionOnDeviceTest` |
| Doze, troca de rede e atraso da notificação | Roteiro de homologação (#232, M6) num aparelho real; `adb shell dumpsys deviceidle force-idle` no emulador |
| Bateria e recomposição | Macrobenchmark / Battery Historian em uma sessão de 1 h com uma conversa ativa |
| Alvos de 48 dp e contraste | ATF em `composeTestRule` ou Espresso `AccessibilityChecks.enable()` nos instrumentados |
| TalkBack de ponta a ponta | Roteiro 6.2 (#232), já mapeado |
