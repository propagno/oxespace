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
`adb logcat -d -b crash`. Keep them in `e2e/homologation/mobile/<date>/` and never in a public issue if a token, path
or command line shows.

Who can run it: **A** = AVD is enough; **D** = needs the real phone (the user); **A/D** = both, the real phone confirms.

## 0. Before pairing

| # | Step | Expected | Who | Evidence |
|---|---|---|---|---|
| 0.1 | With the gateway off (the default), scan the desktop's LAN address: `nmap -p 1-65535 <desktop-ip>` from another machine | No OXESpace port open | A | nmap output |
| 0.2 | Turn the gateway on in Settings › Devices. Scan again | One port, TLS only: `openssl s_client -connect <ip>:<port>` shows the self-signed certificate; plain HTTP on it gets nothing | A | openssl output |
| 0.3 | Open the app for the first time, pt-BR and then en | "Seu computador no bolso" / "Your desktop, in your pocket", one "Pair" button | A | screenshot |

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

## Results

| Run | Date | Build | Device | Steps failed (issue) | Not run (why) | By |
|---|---|---|---|---|---|---|
| | | | | | | |
