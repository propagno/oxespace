# Android homologation script for 1.4 (OXESpace for Android)

The end-to-end pass of the phone companion against a real desktop, run **before each beta** by HOMOLOGAÇÃO, once on the
`oxespace-test` AVD and once on a real phone the user holds. It follows a person's path: pair by QR → session →
lists → act from the phone → background and notifications → the desktop going away. Plan and scope:
[docs/roadmap-1.4/mobile.md](../roadmap-1.4/mobile.md).

Automated first. Every run of the Android CI job covers the JVM tests and screenshots (`verifyPaparazziDebug`), and
`android-emulator.yml` (on request) covers the instrumented tests: Keystore key, pinned TLS on Conscrypt, WSS session
and revocation, notifications, and no answer leaving the phone without biometrics. A failure there is fixed before
this pass. This script covers what needs a real desktop, a real network and a person: what is seen, heard and
felt on the phone.

Record each run in the table at the end. A step fails if the expected result is missing or different, if something
sensitive shows where it shouldn't, or if the app needs a restart to recover. File an issue for each failure and
link it in the table.

## Setup

| | AVD | Real phone (user) |
|---|---|---|
| Device | `oxespace-test` (API 36, 8 GB), through the machine's heavy-lock; shut it down at the end (`adb emu kill`) | Android 9 or later, on the same Wi-Fi as the desktop |
| App | debug APK from the PR or the release APK (step 9) | the release APK, checked as in step 9 |
| Desktop | the beta build with the gateway (B9), Settings › Devices | same |
| Network | the emulator reaches the host's LAN address through its NAT; mobile data is simulated with `adb shell svc wifi disable` | home or office Wi-Fi; mobile data for step 7 |
| Biometrics | enroll a fingerprint in the AVD's Settings, then touch with `adb -e emu finger touch 1` | the phone's own fingerprint or face |
| Camera (QR) | Extended controls › Camera › Virtual scene with the QR image as a poster, or skip 2.1 and mark it "device only" | the back camera pointed at the desktop's screen |

Evidence for each step: a screenshot from the phone (`adb exec-out screencap -p > step-N.png`), and when a step names
it, a desktop screenshot or the desktop audit entry (Settings › Devices › activity). On a crash, also
`adb logcat -d -b crash`. Keep them in `e2e/screenshots/mobile-homologation/<date>/`, which git ignores: phone and
desktop screenshots can show paths, command lines or tokens. Never attach them to a public issue unredacted.

Who can run it: **A** = AVD is enough; **D** = needs the real phone (the user); **A/D** = both, the real phone confirms.
Nothing is installed for this pass: the tools are the OS's own (`Get-NetTCPConnection`, `ss`), Git for Windows'
`openssl`, and the SDK's `adb`.

## 0. Before pairing

| # | Step | Expected | Who | Evidence |
|---|---|---|---|---|
| 0.1 | With the gateway off (the default), list what OXESpace listens on. Windows: `Get-NetTCPConnection -State Listen \| ? { (Get-Process -Id $_.OwningProcess).ProcessName -like 'OXESpace*' } \| select LocalAddress,LocalPort`. Linux: `ss -ltnp \| grep -i oxespace` | Nothing, or only `127.0.0.1` / a pipe: no LAN address | A | command output |
| 0.2 | Turn the gateway on in Settings › Devices, the first time on this machine | Windows shows the Defender Firewall prompt for OXESpace. The desktop explains, before or with it, that only private networks are needed. Allow on private networks only | A/D | desktop screenshot |
| 0.3 | List again; then `openssl s_client -connect <ip>:<port> </dev/null` from Git Bash | One LAN port. TLS only: s_client shows the self-signed certificate; plain HTTP to it gets no answer | A | command output |
| 0.4 | Deny the firewall prompt instead (or block the port), then try to pair or connect | The phone says it can't reach the desktop ("Não deu para falar com…"). The desktop says the firewall blocks the phone and how to allow it | A/D | both screenshots |
| 0.5 | Open the app for the first time, pt-BR and then en | "Seu computador no bolso" / "Your desktop, in your pocket", one "Pair" button | A | screenshot |

## 1. Pair by QR

| # | Step | Expected | Who | Evidence |
|---|---|---|---|---|
| 1.1 | Tap "Parear com o computador". The camera explanation shows, then "Permitir câmera" | The system asks for the camera; after allowing, the camera view appears | A/D | screenshot |
| 1.2 | Deny the camera once | The app says the camera is off and offers "Abrir configurações"; nothing crashes | A | screenshot |
| 1.3 | Point at the QR in Settings › Devices | The phone shows "Confirme no computador" with a 6-character code; the desktop asks "Pair <phone>?" with **the same code** | D (A with virtual scene) | both screenshots, codes side by side |
| 1.4 | Accept on the desktop | Phone: "Pareado", then the live home with the desktop's name. Desktop: the phone listed with its last access | A/D | both screenshots |
| 1.5 | Show a QR, wait more than 2 minutes, scan it | "O código expirou…"; nothing paired | D | screenshot |
| 1.6 | Scan the same QR again after a pairing used it | "Esse código já foi usado…" | D | screenshot |
| 1.7 | Decline on the desktop | "O pareamento foi recusado no computador."; the phone keeps no key (pairing again starts from the camera) | A/D | screenshot |
| 1.8 | A QR from another app, a URL, or one pointing to a public address | The camera keeps looking and says why ("não é um código de pareamento", "aponta para fora da sua rede local"); no request leaves the phone | A | screenshot |
| 1.9 | With 5 devices already paired, pair a sixth | "Seu computador já tem 5 aparelhos pareados…" | A | screenshot |

## 2. Session

| # | Step | Expected | Who | Evidence |
|---|---|---|---|---|
| 2.1 | After pairing, close the app (swipe away) and open it again | Connects without asking anything; "Conectado a <desktop>" in the persistent notification | A/D | screenshot |
| 2.2 | Restart OXESpace on the desktop (its token key changes) | The phone reconnects by itself within seconds, with no new pairing | A/D | screenshot (no pairing screen); the desktop lists the same device, last access updated |
| 2.3 | Change the desktop's IP (renew DHCP or another Wi-Fi), then type the new address via ⋮ › "Informar o endereço do computador" | Connects; a public address or a name is refused with "Use o endereço do computador na sua rede local" | A | screenshot |
| 2.4 | In Settings › Devices, remove the phone while it's connected | In under 1 s: the phone shows "<desktop> removeu este celular…" and the home with "Parear"; the persistent notification goes away; the desktop's audit records the removal | A/D | screen recording (`adb shell screenrecord`), audit entry |

## 3. Lists and live output

| # | Step | Expected | Who | Evidence |
|---|---|---|---|---|
| 3.1 | Open each tab: Conversas, Pedidos, Terminais, Tarefas | The same conversations, requests, panes and jobs the desktop shows, newest first; the Pedidos badge counts the requests waiting | A | screenshots |
| 3.2 | Start a turn on the desktop and open that conversation on the phone | Messages appear as the agent writes them (under 300 ms behind the desktop on the LAN); tools show their state; "Carregar anteriores" brings older items | A/D | screen recording beside the desktop |
| 3.3 | In a terminal pane, `echo TOKEN=ghp_` followed by 36 letters | The phone shows the line with the value hidden and "1 valor secreto escondido pelo seu computador." | A | screenshot |
| 3.4 | Count the conversation's items. Airplane mode for 30 s while the agent keeps working. Back | "A conexão caiu. Reconectando…", then the conversation with every new item **once**: no gap, no repeated message (compare with the desktop) | D (A with `svc wifi`) | screenshots before/after, item counts |
| 3.5 | Open a busy terminal right after it starts | "Carregando…" for up to a second, then the output (never "Ainda sem saída" while it's printing) | A | screenshot |

## 4. Act from the phone

| # | Step | Expected | Who | Evidence |
|---|---|---|---|---|
| 4.1 | In an idle conversation, send "oi" | The message shows on the desktop once; the field empties | A/D | both screenshots |
| 4.2 | While a turn runs, send with "Direcionar" (Claude), then "Parar" | Steer reaches the running turn; Stop interrupts it on the desktop | A/D | both screenshots |
| 4.3 | Send while the Wi-Fi drops mid-way (disable it right after tapping) | "O computador não respondeu…"; when the Wi-Fi is back the message is sent by itself and arrives **once** | D (A with `svc wifi`) | desktop conversation |
| 4.4 | Open a waiting approval from Pedidos (or the conversation's request card) | The whole request: command, folder, files, risk colour and its words, warnings, hidden values; "Aprovar" and "Recusar" only as the desktop offers | A/D | screenshot |
| 4.5 | Approve and confirm with the fingerprint | The system prompt names the request; after the fingerprint the desktop continues; the audit records the answer with this phone's name | D (A with `emu finger`) | screenshot of the prompt, audit entry |
| 4.6 | Approve, then cancel the fingerprint prompt | "Não enviado: a confirmação neste celular foi cancelada."; the desktop still waits; **no** audit entry | A/D | screenshot, audit (none) |
| 4.7 | Decline with a reason | The agent gets the reason; the request leaves both screens | A/D | desktop conversation |
| 4.8 | Answer a request on the desktop while it's open on the phone, then answer on the phone | "Ele já foi respondido ou não espera mais."; nothing applied twice | A | screenshot |
| 4.9 | A request only the desktop may answer (guarded file, MCP, secret question) | "Só o seu computador pode responder este." and no buttons | A | screenshot |
| 4.10 | A terminal without "allow from phone" | Read-only, no keyboard | A | screenshot |
| 4.11 | Turn "allow from phone" on for a pane, type `ls` and Enter | The command runs in that pane on the desktop | A | both screenshots |
| 4.12 | Turn it off on the desktop while the phone is typing, send | "A digitação pelo celular está desligada neste terminal…" | A | screenshot |
| 4.13 | Never reachable from the phone: OxeQuery approvals, MCP confirm, sign-in, secrets, MCP trust, policy, host commands | No screen, button or notification offers them | A | note |

## 5. Background and notifications

| # | Step | Expected | Who | Evidence |
|---|---|---|---|---|
| 5.1 | On Android 13+, first live home | The system asks to allow notifications once | A | screenshot |
| 5.2 | App in the background, the agent asks for an approval | "Precisa de você: <title>" (channel "Precisa de você"); on the lock screen without the command; tapping it opens that request | A/D | screenshots (lock screen and opened) |
| 5.3 | Answer it on the desktop | The notification goes away | A | screenshot |
| 5.4 | A turn finishes; another fails | "Concluído: <conversation>" and "Falhou: <conversation>"; each opens its conversation | A/D | screenshots |
| 5.5 | App on screen while the same happens | No notification (the badge and the lists show it) | A | screenshot |
| 5.6 | Deny notifications in the phone's settings | No alerts; everything still shows in the app; no crash | A | screenshot |
| 5.7 | Doze: `adb shell dumpsys deviceidle force-idle`, have the agent ask for an approval, then `adb shell dumpsys deviceidle unforce` (on the real phone: screen off for an hour) | The "Precisa de você" notification arrives on waking, once | A/D | notification shade |
| 5.8 | Persistent notification › "Desconectar" | The session ends and the notification goes away; opening the app connects again | A | screenshots |
| 5.9 | Settings › Apps › OXESpace › Notifications | Four channels: "Conexão com o computador", "Precisa de você", "Concluído", "Falhou"; each can be turned off alone | A | screenshot |

## 6. Large text and TalkBack

| # | Step | Expected | Who | Evidence |
|---|---|---|---|---|
| 6.1 | Font size and display size at their largest | Nothing clipped or overlapping; tab labels on one line | A | screenshots |
| 6.2 | TalkBack on, go through home, a conversation, a request and the terminal | Every control named with its role ("botão", "guia"); the Pedidos tab reads "1 pedido esperando"; the verification code is read character by character; status changes are announced | D | notes |

## 7. The desktop goes away

| # | Step | Expected | Who | Evidence |
|---|---|---|---|---|
| 7.1 | Put the desktop to sleep | "Não deu para falar com <desktop>…" and "Tentando de novo em N segundos" with growing waits; "Tentar de novo" tries at once | A/D | screenshots |
| 7.2 | Wake it | Reconnects by itself, lists up to date | A/D | screenshot |
| 7.3 | Turn the gateway off in Settings › Devices | Same as 7.1, never "removed" | A | screenshot |
| 7.4 | Phone from Wi-Fi to mobile data | "Este celular não está na Wi-Fi…"; no attempts meanwhile (the desktop sees no connection); back on Wi-Fi it reconnects at once | D (A with `svc wifi`) | screenshots |
| 7.5 | Quit OXESpace on the desktop | Phone as in 7.1; when it comes back, 2.2 | A/D | screenshot |

## 8. Unpair

| # | Step | Expected | Who | Evidence |
|---|---|---|---|---|
| 8.1 | ⋮ › "Desparear" on the phone | Back to "Parear"; the key is gone (pairing again needs a new QR); the desktop still lists the phone until removed there | A | screenshot |

## 9. Release APK (when a release exists)

| # | Step | Expected | Who | Evidence |
|---|---|---|---|---|
| 9.1 | Download `oxespace-android-vX.Y.Z.apk` and its `.sha256` from the release; `sha256sum -c` | OK | A | terminal output |
| 9.2 | `apksigner verify --print-certs` | The certificate SHA-256 matches the fingerprint the project published ([RELEASING.md](../../mobile/android/RELEASING.md)) | A | terminal output |
| 9.3 | Install over the previous release | Updates in place, pairing kept | D | screenshot |

## 10. Hard cases

| # | Step | Expected | Who | Evidence |
|---|---|---|---|---|
| 10.1 | **Someone else at the desktop's address.** Turn the gateway off and, on the same port, run a TLS server with another certificate: `openssl req -x509 -newkey rsa:2048 -nodes -keyout k.pem -out c.pem -days 1 -subj /CN=impostor` then `openssl s_server -accept <port> -cert c.pem -key k.pem -www`. Scan a fresh QR first (pairing), then, already paired, reopen the app | Pairing: "Outro aparelho respondeu nesse endereço, não o seu computador. Nada foi enviado." Session: never "Conectado"; it keeps saying it can't reach the desktop. s_server logs a failed handshake and never an HTTP request (no code, no key, no token reached it). Delete `k.pem` and `c.pem` afterwards | A | s_server output, screenshots |
| 10.2 | **Two phones, one request.** AVD and real phone paired; both open the same waiting request; approve on one with the fingerprint, then on the other | The first answer is applied; the second gets "Ele já foi respondido ou não espera mais."; the desktop audit has one answer | D (with A) | both screenshots, audit |
| 10.3 | **Token past its 15 minutes.** Keep a conversation open for 20 min, and separately leave the phone asleep for 20 min | Open: renewed by itself around minute 12, no interruption. After sleep: reconnects with the device key, no pairing screen, lists up to date | A/D | screenshots with the clock |
| 10.4 | **60 commands a minute.** In a pane with "allow from phone", paste about 70 KB of text and send (it goes in 1,000-character pieces) | After about 60 pieces: "Ações demais em um minuto. Tente de novo daqui a pouco."; only the part not yet sent stays in the field (sending again doesn't repeat what went through); the desktop stays responsive | A | screenshot, desktop terminal |
| 10.5 | **App killed while pairing.** On "Confirme no computador", `adb shell am force-stop com.oxespace.mobile`, then accept on the desktop | The phone opens on "Parear" (not paired). The desktop lists a device that never connects: remove it there. See "Not implemented" | A | both screenshots |
| 10.6 | **App killed while answering.** With the fingerprint prompt open, force-stop | Nothing sent: the desktop still waits, no audit entry. Reopen: the request is still there | A | screenshot, audit (none) |
| 10.7 | **Killed right after the answer left.** Approve, and force-stop as soon as the prompt closes | The desktop applies the answer once; reopening shows the request gone | A | audit |
| 10.8 | **Dark mode and language.** Switch the system to dark and back while on a conversation; switch the system language en ↔ pt-BR | Colors follow at once, contrast readable in both; words change to the new language as Android redraws the screen; nothing stays half-translated | A | screenshots |
| 10.9 | **Recents screen.** Open a risky request, then the Recents (overview) screen | The request's command and paths are visible in the thumbnail. See "Not implemented" (FLAG_SECURE) | A | screenshot |

## 11. The desktop side: Settings › Devices

These belong to the desktop (B9 and the Devices page). They're here because a phone can't be paired, trusted or
removed without them.

| # | Step | Expected | Who | Evidence |
|---|---|---|---|---|
| 11.1 | Open Settings › Devices with the gateway off | It's off by default, says so, and offers to turn it on; no QR | A | desktop screenshot |
| 11.2 | Turn it on and show the QR | The QR with its countdown (2 min), then a new one when asked; the address and port shown for typing by hand | A | desktop screenshot |
| 11.3 | While a phone pairs | "Parear <phone>?" with the same 6-character code as the phone; Accept and Decline | A/D | desktop screenshot |
| 11.4 | With paired phones | Each with its name and last access; Remove asks for confirmation | A | desktop screenshot |
| 11.5 | "Allow from phone" on a pane | Off by default, per pane, back to off when OXESpace restarts; the phone sees the change at once (4.11, 4.12) | A | screenshots |
| 11.6 | With 5 phones paired | The page says the limit is reached before showing a QR | A | desktop screenshot |
| 11.7 | Errors: firewall blocking (0.4), port in use | Each with its own words and what to do | A | desktop screenshot |

## Not implemented (proposals for the roadmap)

- **Recents privacy (10.9).** The app doesn't set `FLAG_SECURE`, so the Recents thumbnail shows what was on screen
  (commands, paths). Setting it on the request, conversation and terminal screens would also block screenshots,
  including this script's evidence. A debug-only exception or a setting would avoid that.
- **Orphaned pairing (10.5).** If the app dies between scanning and the desktop's answer, the desktop may end up with
  a paired device the phone doesn't know. Today the person removes it on the desktop. Proposal: the phone remembers the
  attempt and, on the next start, tells the desktop to forget it, or the desktop drops devices that never connect
  within a few minutes of pairing.
- **Per-app language (10.8).** The app follows the system language only. Android 13+ can offer a language per app
  (`localeConfig`); not declared yet.

## Results

| Run | Date | Build | Device | Steps failed (issue) | Not run (why) | By |
|---|---|---|---|---|---|---|
| | | | | | | |
