# Phone audit, 1.4 (Android companion)

Status: draft · Owner: DESIGN/PRODUCT · For: MOBILE · Date: 2026-10-31
Source: the committed Paparazzi goldens on the M6–M9 chain (`feat/mobile-m9`,
`mobile/android/app/src/test/snapshots/images/`: Screens × en/pt-BR × light/dark, plus the TalkBack snapshots) and
`res/values-pt-rBR/strings.xml`. Checked against Material 3, the glossary (`docs/design/glossary.md`) and S7.4
(`docs/design/s7-mission-control.md` §8).

**Overall:** the phone is calm and readable. Every state has a screen (unpaired, connecting, offline, revoked,
incompatible, unreachable). Light and dark are both done, rows meet 48 dp, text grows at 200 %, and the TalkBack
snapshots show grouped labels. The findings are mostly about **matching the desktop**: the same decision must look
and read the same on both.

Severity: **H** a safety or meaning problem · **M** below product grade or incoherent with the desktop · **L** polish.

## 1. Approval request (RequestScreen)

| # | Sev | Finding | Fix |
|---|---|---|---|
| P1 | **H** | **Approve is the emphasised button on a destructive request.** `request-risky` shows **Aprovar** filled green, full width, and **Recusar** outlined below. The desktop now leads with Deny at medium and above (#243); a phone tapped in a hurry should do the same. | At orange/red (and later high/critical), Recusar/Negar is the filled button and the approve button is outlined. Approve still goes through biometrics. At green, Approve may stay filled. |
| P2 | M | **Different verbs from the desktop.** The phone says Aprovar / Recusar; the desktop modal and the glossary say **Permitir / Negar** ("Aprovar, Recusar: never in the approval modal"). | `request_decision_*` → "Permitir uma vez" / "Negar"; TalkBack names follow. |
| P3 | M | **The agent's text isn't marked as the agent's.** "Por quê" (the agent's reason) sits in the same grey field style as the app's facts (Ferramenta, Comando, Pasta). The desktop puts agent text in a labelled "Conteúdo do agente" block and never presents it as the app's. | A divider and an "Escrito pelo agente" label above "Por quê", in a different surface (outlined, not filled). |
| P4 | M | **The risk has no level word yet.** It shows a red title and "Apaga, eleva acesso ou publica". TalkBack reads "Deletes, escalates or publishes" with no "risk". Already agreed: the four levels arrive with the S7.1 CCR. | Until then, prefix TalkBack with "Risco: " and the colour's meaning. After the CCR: "Risco alto · Apaga, eleva acesso ou publica", with the glossary §6 tokens (critical = solid). |
| P5 | M | **The title is coloured red** (the whole request title), so colour stacks on top of the risk line. | Title in the normal text colour; colour only on the risk badge. |
| P6 | M | **"Só o seu computador pode responder este" is at the very bottom**, after all the details, in orange text with no action. The first thing the person needs to know is that they can't answer here. | A top banner (M3 card, warning tone): "Responda no computador" / "Answer on the computer", with the reason. Details below. |
| P7 | L | "De Fix the login redirect": "De" + the conversation title reads oddly. | "Da conversa “Fix the login redirect”" / "From the conversation “…”". |
| P8 | L *(backend)* | "Vale olhar de novo" lists main's warnings in English ("Deletes files outside the change set"). | Main sends these as C3 codes (BACKEND); the phone words them. |

## 2. Live lists (Conversas, Pedidos, Terminais, Tarefas)

| # | Sev | Finding | Fix |
|---|---|---|---|
| P9 | M | **State words differ from the shared vocabulary:** "1 esperando" / "esperando" (blocked), "Parada" (idle), "Interrompida". The glossary §5 says **Precisa de você**, **Ocioso**, **Interrompido**, **Falhou**, **Trabalhando**, **Terminou**. | Use the glossary words now (`live_agent_state_*`, `live_status_*`), so S7.4's move to the `agents` topic is a data change only. The states describe the agent, so they are masculine everywhere ("Ocioso", "Interrompido"). |
| P10 | M | **Raw provider id on the Terminals tab:** "claude · trabalhando" under a pane titled "Claude". | The provider name (Claude, Codex) and the state, capitalised as on the desktop: "Claude · Trabalhando". Or only the state, since the title already says Claude. |
| P11 | M | **The Pedidos list shows risk by colour only.** The request title is red, with no word and no age. | Each row: risk badge (word + tone), title in normal colour, "há 3 min" (the S7 needs-you timer age), conversation name. |
| P12 | L | The live state words are plain coloured text (blue "Trabalhando", red "Falhou"), unlike the desktop's dot + word. | A small dot before the word, same colours as `StatusDot` (`OxeTokens`), so both surfaces share one visual. |
| P13 | L | The four-tab bottom bar becomes Agentes · Pedidos · Mais in S7.4 (§8). Nothing to do now; don't polish the old tabs. | — |

## 3. Conversation (ThreadScreen)

| # | Sev | Finding | Fix |
|---|---|---|---|
| P14 | M | **"Direcionar" vs the desktop's "Orientar"** for steering a running turn. | "Orientar" (glossary gets the row: steer → orientar). |
| P15 | M | **The in-conversation request card says "esperando você"** and has no action. | "Precisa de você" plus a **Responder** text button that opens the RequestScreen (one tap, as the M6 push already does). |
| P16 | L | The text buttons "Carregar anteriores" and "Mostrar saída" look like links. Check that they are M3 `TextButton` with a 48 dp touch area. The snapshot suggests about 40 dp. | `Modifier.minimumInteractiveComponentSize()` |
| P17 | L | "Parar" sits left and the disabled "Direcionar" right, both as large pills. While running, Parar is the only live action. | Keep it, but give Parar a leading icon so it doesn't read as a cancel of the composer. |

## 4. Home and pairing states

| # | Sev | Finding | Fix |
|---|---|---|---|
| P18 | **H** | **Offline, the only action is "Desparear".** The full-width button is destructive, and nothing offers a way back ("Este celular não está na Wi-Fi…"). A person on mobile data who taps the only button unpairs. | Primary: **Tentar de novo**. Secondary: **Abrir configurações de Wi-Fi** (`Settings.Panel.ACTION_WIFI`). **Desparear** moves to the overflow menu, with a confirmation. Apply the same to *unreachable*. |
| P19 | M | **The offline/unreachable screens drop the app bar and the paired desktop's identity** below the title; there's a lot of empty space. | Keep the top app bar (desktop name, ⋯), and use an M3 empty-state illustration area with the message and actions centred. |
| P20 | L | Warning texts are orange paragraphs (offline, desktop-only). On the desktop a warning is a `Notice` with an icon. | An M3 card with the warning tone and an icon, shared by both screens. |

## 5. Accessibility (from the TalkBack snapshots)

- **Good:** headings marked, label and value grouped ("Command, rm -rf dist build"), Back is a labelled button,
  the decline-reason field is announced as editable, and text scales to 200 % without clipping.
- **P21 M:** the risk line is read without context (P4), and the decision buttons read "Approve" / "Decline" (P2).
- **P22 L:** "1 secret value hidden by your computer" could say where: "1 valor secreto escondido pelo OXESpace no
  computador".

## 6. Glossary additions from this audit

steer → **orientar** / steer; agent state words are masculine in pt-BR (they describe the agent); medium risk
one-liner stays **"Muda algo"** (the phone's "Altera algo" moves to it with the CCR, as MOBILE agreed).

## 7. Order for MOBILE

1. **H:** P1 (deny leads on risky requests), P18 (offline: no lone Unpair).
2. **M, words** (strings only, can ride any chain PR): P2, P9, P10, P14, P15 (copy), P7.
3. **M, layout:** P3, P5, P6, P11, P19.
4. P4 and P8 follow BACKEND's CCR and C3 codes; P12, P13, P16, P17, P20, P22 with S7.4.
5. Re-record the Paparazzi goldens once at the end.
