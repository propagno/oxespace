# OxeVoice 1.5 · Proposta de wiring dos hot files (NÃO APLICAR)

Status: proposta para o ASK do coordenador. Nenhum hot file foi editado. Aplicar depois que o B21 entrar na main, com rebase sobre o que ele deixar.

Contrato congelado: `shared/types/ipc/voice.ts` (F1). Entregas já prontas e não tocadas aqui:
`electron/main/ipc/voice-session.ipc.ts` (`registerVoiceIpc(options)`), `src/features/voice/VoiceDictationControl.tsx`, `src/features/voice/useVoiceDictation.ts`, `resources/voice/windows-dictation.ps1`.

Fatos verificados no código atual (base da proposta):

- `shared/types/ipc.ts:202-207` tem o domínio legado `voice` (`transcribe`, `getModelStatus`, `ensureModel`, `onModelProgress`) e `ipc.ts:586-600` a interface `VoiceApi` legada; `ipc.ts:716` tem `voice: VoiceApi`.
- `electron/preload/api.ts:303-312` implementa o `voice` legado.
- `electron/main/index.ts:24` importa `registerVoiceIpc` de `./ipc/voice.ipc` (legado) e `index.ts:377` chama `registerVoiceIpc()`.
- Não existe módulo de registro de domínios genérico. O padrão existente é um `register*Ipc` por domínio, chamado de `index.ts`, ou aninhado dentro de outro (`registerAppInfoIpc` chama `registerActivityIpc`; `thread.ipc.ts` chama `registerOxePostIpc`, `registerThreadWorktreeIpc`).
- `electron-builder.yml`: `extraResources` é por plataforma e completo; o bloco `win` tem `resources/whisper/win-x64 -> whisper` (legado).
- `ThreadComposerForm.tsx:82` tem o botão legado `thread-voice` (`useOxeVoice`) antes do envio (`thread-send`, linha 85).

---

## 1. `shared/types/ipc.ts`

Por quê: o renderer e o preload devem enxergar o contrato novo por um só ponto de entrada (`./ipc`), e os canais `voice:*` do B21 deixam de existir.

```ts
// topo do arquivo, junto dos outros re-exports/imports
import { VOICE_CHANNELS } from './ipc/voice'
import type { VoiceRendererApi } from './ipc/voice'
export * from './ipc/voice'

// IPC_CHANNELS (substitui o bloco voice: { transcribe, getModelStatus, ensureModel, onModelProgress })
  voice: VOICE_CHANNELS,

// substitui a interface VoiceApi (linhas 586-600)
export type VoiceApi = VoiceRendererApi
// ipc.ts:716 `voice: VoiceApi` permanece.
```

Notas: `./ipc/voice` resolve para o diretório `shared/types/ipc/` (não para o legado `shared/types/voice.ts`). A checar na aplicação: se `ipc.ts` já faz `export *` de outros módulos de `./ipc/*` e se há colisão de nomes com `shared/types/voice.ts` enquanto o legado existir.

## 2. `electron/preload/api.ts`

Por quê: `window.oxe.voice` passa a ser `VoiceRendererApi`, implementada só com `VOICE_CHANNELS`.

```ts
// substitui o bloco voice: { transcribe, ... } (linhas 303-312)
    voice: {
      getEngines: () => ipc.invoke(VOICE_CHANNELS.getEngines) as ReturnType<VoiceRendererApi['getEngines']>,
      start: input => ipc.invoke(VOICE_CHANNELS.start, input) as ReturnType<VoiceRendererApi['start']>,
      stop: sessionId => ipc.invoke(VOICE_CHANNELS.stop, sessionId) as ReturnType<VoiceRendererApi['stop']>,
      cancel: sessionId => ipc.invoke(VOICE_CHANNELS.cancel, sessionId) as ReturnType<VoiceRendererApi['cancel']>,
      setConsent: input => ipc.invoke(VOICE_CHANNELS.setConsent, input) as ReturnType<VoiceRendererApi['setConsent']>,
      openSpeechSettings: () => ipc.invoke(VOICE_CHANNELS.openSpeechSettings) as Promise<void>,
      onEvent: listener => subscribe<VoiceSessionEvent>(ipc, VOICE_CHANNELS.onEvent, listener)
    },
// import: import { VOICE_CHANNELS, type VoiceRendererApi, type VoiceSessionEvent } from '../../shared/types/ipc/voice'
```

## 3. Registro do IPC, sem linhas novas em `electron/main/index.ts` (ratchet 958)

Por quê: não há módulo de registro de domínios; o ponto existente é `index.ts:24` (import) e `index.ts:377` (chamada). A troca é de mesma contagem de linhas: só muda o caminho do import. A chamada `registerVoiceIpc()` permanece sem argumentos.

```ts
// electron/main/index.ts:24  (1 linha trocada por 1 linha; a 377 não muda)
- import { registerVoiceIpc } from './ipc/voice.ipc'
+ import { registerVoiceIpc } from './ipc/voice-bootstrap'
```

Novo arquivo `electron/main/ipc/voice-bootstrap.ts` (fora do ratchet): exporta `registerVoiceIpc(): () => void`, cria o `VoiceRegistry` e o `VoiceConsentStore` e chama `registerVoiceIpc({ registry, consent, sendToMainWindow, openSpeechSettings })` de `voice-session.ipc.ts` (renomeado na importação para evitar colisão). `sendToMainWindow` usa a janela principal já existente; os construtores de registry/consent devem ser conferidos em `electron/main/services/voice/` na aplicação. O retorno (função de desregistro) pode ser ligado a `app.once('before-quit', ...)` dentro do próprio bootstrap.

Alternativa sem tocar o `index.ts`: aninhar a chamada dentro de `registerAppInfoIpc` (precedente: `registerActivityIpc`). Recomendação: o bootstrap acima, por ser mais explícito.

Limpeza do legado (`voice.ipc.ts`, `voice.service.ts`, `useOxeVoice`, `VoiceHud`) fica fora desta proposta e depende do B21.

## 4. `shared/messages.ts` e `shared/locales/*/main.json`

Por quê: `VOICE_MESSAGE_CODES` já está no contrato; a janela só traduz códigos que existem em `MessageParams`/`MESSAGE_CODES`.

```ts
// MessageParams (antes do fecha-chaves, junto dos outros domínios)
  /** Voice: an engine that sends audio to the OS vendor's cloud needs the person's consent first. */
  'voice.consent.required': Record<string, never>
  'voice.engine.unavailable': Record<string, never>
  'voice.session.busy': Record<string, never>
  'voice.session.notFound': Record<string, never>
  'voice.os.speechPrivacyOff': Record<string, never>
  'voice.os.noMicrophone': Record<string, never>
  'voice.engine.crashed': Record<string, never>
  'voice.engine.failed': Record<string, never>

// MESSAGE_CODES (mesma ordem)
  'voice.consent.required',
  'voice.engine.unavailable',
  'voice.session.busy',
  'voice.session.notFound',
  'voice.os.speechPrivacyOff',
  'voice.os.noMicrophone',
  'voice.engine.crashed',
  'voice.engine.failed',
```

Parâmetros vazios: conferir contra o que `electron/main/services/voice/` envia de fato em `params`; se algum código levar dado (ex.: detalhe do erro), tipar aqui.

Textos para revisão do DESIGN, em `messages.<code>` do `main.json` (a estrutura aninhada segue o comentário de `shared/messages.ts`; confirmar o aninhamento no arquivo ao aplicar):

| Código | en | pt-BR |
|---|---|---|
| `voice.consent.required` | Dictation sends your audio to your operating system's cloud speech service. Allow it to continue. | O ditado envia seu áudio ao serviço de fala em nuvem do sistema operacional. Permita para continuar. |
| `voice.engine.unavailable` | Dictation is not available on this computer. | O ditado não está disponível neste computador. |
| `voice.session.busy` | A dictation is already in progress. | Já existe um ditado em andamento. |
| `voice.session.notFound` | This dictation has already ended. | Este ditado já terminou. |
| `voice.os.speechPrivacyOff` | Windows online speech recognition is turned off. Turn it on in Settings > Privacy > Speech. | O reconhecimento de fala online do Windows está desligado. Ative em Configurações > Privacidade > Fala. |
| `voice.os.noMicrophone` | No microphone was found or access is blocked. | Nenhum microfone foi encontrado ou o acesso está bloqueado. |
| `voice.engine.crashed` | The dictation engine stopped unexpectedly. Try again. | O mecanismo de ditado parou inesperadamente. Tente de novo. |
| `voice.engine.failed` | Dictation could not start. Try again. | Não foi possível iniciar o ditado. Tente de novo. |

## 5. `ThreadComposerForm.tsx` (`src/components/Threads/`)

Por quê: o controle novo entra no rodapé do composer, antes do envio, sem custo de carga inicial (lazy import).

```tsx
// topo
import { lazy, Suspense } from 'react'
const VoiceDictationControl = lazy(() =>
  import('../../features/voice/VoiceDictationControl').then(m => ({ default: m.VoiceDictationControl })))

// props: acrescentar  onDictate(text: string): void   (o pai insere no draft na posição do cursor)

// no <footer>, imediatamente antes do <button type="submit" className="thread-send ...">
      {snapshot && <Suspense fallback={null}><VoiceDictationControl api={window.oxe.voice} onInsert={onDictate} /></Suspense>}
```

Decisão para o coordenador: o composer hoje não expõe um setter de texto; `onDictate` precisa ser fornecido pelo componente pai (que detém `draft` e `textarea`). O botão legado `thread-voice` (linha 82) e o `VoiceHud` (linha 62) saem junto com o legado, depois do B21.

## 6. `electron-builder.yml`

Por quê: `windows-dictation.ps1` precisa estar em disco no app empacotado. Só o bloco `win` (engine `windows-winrt`); `linux` não leva nada nesta fase.

```yaml
  # bloco win > extraResources (o bloco é completo; acrescentar a entrada)
    - from: resources/voice
      to: voice
```

Fica em `<resourcesPath>/voice/windows-dictation.ps1`. O caminho em runtime deve vir de `process.resourcesPath` (empacotado) e de `resources/voice` (dev); conferir no serviço. A entrada `whisper` sai junto com o legado.

## 7. Abertura de `ms-settings:privacy-speech`

O `openExternalOrRecord` (`electron/main/utils/external-open.ts`) passa a URL por `externalUrlRefusal`, que foi escrito para links web/mail; é provável que recuse `ms-settings:` (a conferir em `electron/main/utils/external-url.ts`). Proposta: o `voice-bootstrap.ts` entrega a `openSpeechSettings` uma função que chama `shell.openExternal('ms-settings:privacy-speech')` com a constante fixa, no mesmo estilo de `thread.ipc.ts:92` (`openExternal: url => shell.openExternal(url)`). A URL não vem do renderer (o canal `voice:open-speech-settings` não recebe argumento), então não há superfície nova. Se o coordenador preferir manter um único opener, a alternativa é uma exceção explícita e fixa para esse esquema em `external-url.ts`, o que é um hot file adicional.

---

## Roteiro de UAT do A8 (Windows)

Pré-condição: Windows 10/11, microfone funcionando, build com o wiring acima aplicado, perfil de usuário limpo (sem consentimento salvo).

1. Abrir uma thread: o controle de ditado aparece no rodapé do composer, antes do envio.
2. Clicar no controle: aparece o pedido de consentimento (opt-in) informando que o áudio vai à nuvem do sistema operacional. Recusar mantém o controle desligado e nada é gravado.
3. Aceitar o consentimento e clicar de novo: estado "ouvindo"; falar uma frase em pt-BR.
4. Parciais aparecem durante a fala; ao parar, o texto final é inserido no composer, na posição do cursor. Enviar não é automático.
5. Revogar o consentimento (configuração do controle): a próxima tentativa volta a pedir consentimento.
6. Desligar em Configurações do Windows > Privacidade > Fala o reconhecimento de fala online e tentar ditar: aparece a mensagem `voice.os.speechPrivacyOff` com o botão que abre `ms-settings:privacy-speech`; clicar abre a página do Windows e o app não altera a configuração.
7. Religar a privacidade e repetir o passo 3: volta a funcionar sem reiniciar o app.
8. Negar o microfone no Windows: aparece `voice.os.noMicrophone`.
9. Conferir que nenhum agente/MCP enxerga o ditado (cobertura MCP marca como proibido) e que não há chamadas de rede do app durante o ditado além do serviço do SO.

Critério de aceite A8: passos 1 a 7 sem erro e com os textos de `main.json` aprovados pelo DESIGN.
