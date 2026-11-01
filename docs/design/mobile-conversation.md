# M10 · The conversation on the phone, in Mandacaru

> Screen spec for the Android conversation, the request screen and their loading state. They must read as the same
> product as OxeChat on the desktop. Slice S4 · Owner: MOBILE · Copy gate: [glossary](glossary.md) ·
> Tokens: contract C4 (`src/design/tokens`, exported to `OxeTokens.kt`).
> The user's review (2026-11-01): the phone's conversation looked like a different app. This replaces the
> conversation, requests and loading goldens recorded before it. The S7.4 agents list (#347) stays as approved.

## 1. Type: the Mandacaru families on Android

**The problem:** the colours and sizes already come from the tokens (`OxeTypography`), but no role sets a
`fontFamily`, so everything is Roboto. Without the families the brand disappears.

- **Bundle the desktop's three families** in `app/src/main/res/font/`. All three are under the SIL OFL; ship their
  licence files with the app's notices.
  - **IBM Plex Sans** (400, 500, 600, 700): the interface and every body text. Desktop `--font-ui`.
  - **IBM Plex Mono** (400, 500): commands, paths, code and the terminal. Desktop `--font-mono`.
  - **Bricolage Grotesque** (600, 800): screen titles and the request title only. Desktop `--font-display`.
- **Map them onto Material's roles** (the sizes stay those of `OxeTypography`: phone body at `lg`, 16 sp):

| Role | Family | Size / leading / weight | Used for |
|---|---|---|---|
| `headlineSmall` | Bricolage Grotesque | `xl` / tight / 600 | the request screen's title |
| `titleLarge` | Bricolage Grotesque | `xl` / snug / 600 | empty-state titles |
| `titleMedium` | Plex Sans | `lg` / snug / 600 | app bar title (the conversation name) |
| `titleSmall` | Plex Sans | `md` / snug / 500 | section labels, the plan's title |
| `bodyLarge` | Plex Sans | `lg` / normal / 400 | the person's prompt (600) and the agent's prose |
| `bodyMedium` | Plex Sans | `md` / normal / 400 | tool step rows, the request facts |
| `bodySmall` | Plex Sans | `sm` / normal / 400 | meta lines, "Último sinal do provedor há 2 s" |
| `labelLarge` | Plex Sans | `md` / snug / 500 | buttons |
| `labelMedium`, `labelSmall` | Plex Sans | `xs`, `2xs` / snug / 500 | badges, counts |
| *code* (new `OxeType.code`) | Plex Mono | `sm` / normal / 400 | inline code, code blocks, commands, paths |

- **Scaling:** sizes stay in `sp`, so the system font size scales them. At 200 % nothing truncates that a person must
  act on: the request title and the composer wrap.
- **Terminal:** the terminal screen uses Plex Mono too, at the existing size.

## 2. The conversation timeline

**Rule:** only one thing per screen gets a card. Everything else is text, a row or a block. The person's prompt, the
agent's prose and the steps are what a conversation is made of, and they should not look like form fields.

| Item | How it looks | Desktop equivalent |
|---|---|---|
| **The person's prompt** | `surface-sunken` block, radius `lg` (12), 10/12 padding, `bodyLarge` at 600. Same fill in light and dark. Never the accent or `accent-soft`. | `.thread-prompt` |
| **Agent prose** | Plain text on the canvas (`bodyLarge`), with Markdown rendered (bold, lists, inline code, links as text). No box and no "Agente" label. | the timeline's assistant text |
| **Tool step** | One row, 40 dp min height: a status icon (✓ `intent-success-fg`, a spinner while running, ✕ `intent-danger-fg`), a verb ("Leu", "Executou", "Editou", "Criou"), the target in Plex Mono, then a muted count ("2 arquivos", "+12 −3") and a chevron. Tapping expands the output below in a code block. No card. | the collapsed tool row |
| **Plan** | One raised block (`surface-raised`, `border-subtle`, radius 12): "Plano · 1 de 3", done steps muted and struck through, the current one at 600. | the plan dock |
| **Final answer** | The **one card** of a turn: `surface-raised`, `border-subtle`, radius 12, a small label "Resposta do agente" in `text-accent`, Markdown, code blocks with **Copiar**. Only the turn's final message gets it. | "Final response" card |
| **Code block** | `surface-sunken`, radius `md` (8), Plex Mono `sm`, horizontal scroll inside the block, **Copiar** at the top right (48 dp target). | the code block |
| **Secrets hidden** | One muted line under the step: "1 valor secreto escondido pelo seu computador." (existing copy). | — |
| **Pending request marker** | A small pill in the timeline where the request happened: "Pedido esperando sua resposta ↓" (`intent-warning-bg` / `-fg`). The request itself is in the bar (§4). | — |

- Drop the per-item labels "Você", "Pensando", "Agente" and "Pedido".
  - The prompt is recognisable by its block.
  - The running state has its own row (§3).
  - TalkBack still reads who said what: each prompt has the content description "Você: …".
- Spacing: 12 dp between items, 16 dp side padding. "Carregar anteriores" stays at the top as a text button.

## 3. The running state

- **App bar:** back, then the title (`titleMedium`, one line) and below it the state line: the state dot, the state
  word from `agents.state.*` in `text-primary` at 500, then "· há 2 min · Claude" muted.
  - The dot uses the desktop's state colours (working = the running token, needs you = warning, failed = danger). Never
    a blue that the desktop doesn't use.
  - Working pulses with `oxe-pulse` (`--duration-pulse`), and stands still with reduced motion.
- **Live row** at the end of the timeline while the agent works: a 14 dp spinner (`--duration-spin`; slow under
  reduced motion), what is happening now in 600 ("Editando src/auth/session.ts", from the provider's activity, or
  "Analisando o pedido" when there is none), and below it "Último sinal do provedor há N s" (the desktop's string).
  - It replaces the static "Pensando".
  - It is announced politely once when it starts, not on every update.
- **Stale signal:** past the desktop's threshold the second line reads like the desktop's ("Sem sinal do provedor há
  …"), in `intent-warning-fg`.

## 3a. Patterns taken from Orca's phone app (MIT, analysed 2026-11-01)

The four patterns below are behaviour from Orca's phone app, drawn in Mandacaru. We take the patterns, not the code:
Orca's app is React Native, ours is Kotlin and Compose.

- **Turn bar.**
  - **While the turn runs,** the bar sits under the person's prompt: "Trabalhando há 42 s" (it counts once a second,
    and only while running), plus the live row's current step.
  - **When the turn ends,** it settles in place to "Trabalhou por 3 min 4 s · 7 passos". The bar is a button
    (`expanded` state) that opens that turn's steps. Collapsed is the default for finished turns, so a long
    conversation stays short.
  - **pt/en strings:** "Trabalhando há {{time}}" / "Working for {{time}}"; "Trabalhou por {{time}} · {{count}} passos" /
    "Worked for {{time}} · {{count}} steps".
- **Grouped steps with an inline diff.**
  - Consecutive tool steps fold into one row: "Leu 3 arquivos · executou 2 comandos" / "Read 3 files · ran 2 commands".
    It expands to the individual rows of §2.
  - The step that is running pulses with its own label ("Executando npm test -- auth", `oxe-pulse`).
  - An edit step expands to its diff: + and − lines in Plex Mono on `intent-success-bg` / `intent-danger-bg`. It is
    capped at 240 lines, with "Abrir no computador" past that.
- **The message queue.**
  - What the person sends while the agent works is queued, as on the desktop. On the phone the queue is visible right
    above the composer: "2 mensagens na fila · enviadas quando o turno terminar". Each queued message can be edited and
    deleted.
  - When the desktop pauses the queue (the turn was interrupted), the line reads the desktop's "Fila pausada" copy,
    with **Retomar envio**.
- **A question with options.**
  - When the agent asks a question, its options show as a single-choice list (`selectableGroup`, `Role.RadioButton`)
    of full-width rows, plus "Outra resposta…" for free text, then **Responder**. None of it looks like a form field.
  - It opens from the request bar, as any request does.

**Not taken from Orca:**
- **Relay pairing:** it goes through the cloud, and S4 promises no cloud.
- **Its grey-and-blue skin:** Mandacaru is the brand.
- **Its permission card:** it makes the provider's first option (usually "Yes") the primary button. Ours keeps Negar
  primary. We do take its context labels on the request screen: **Motivo**, **Caminho bloqueado**, **Regra**, shown
  when the provider reports them.

**Later (1.4.x / 1.5):**
- 1.4.x: the terminal key row (Esc, Tab, ⇧Tab, Ctrl+C, arrows, Colar) and the terminal text size.
- 1.5: `/` commands and `@` files in the composer; a chat-or-terminal view per pane; a "Continuar" card and account
  usage on the home screen; Quick Commands tied to OxeCode's Scripts.

## 4. The pending request: a fixed bar above the composer

- **Where:** docked at the bottom, **directly above the composer**, and it never scrolls away. It is above the
  composer rather than at the top so that it is under the thumb and next to where the person would answer. That is
  where the desktop docks the approval.
- **Content:**
  - a risk badge with its word ("Risco alto", glossary §6 colours: high = danger, critical = solid danger, medium =
    warning, low = neutral) and the one-liner ("Apaga, eleva acesso ou publica");
  - the C3 title (`titleCode`, "Quer executar uma ação");
  - "+N outros" when more wait;
  - a filled **Responder** button (primary).
- **Computer-only requests:** the bar says "Responda no computador" and has no button (§8 of the S7 spec).
- **Behaviour:** the bar is a live region (polite) when it appears. When the request is answered (here or on the
  computer), it goes away at once and the timeline marker turns into "Respondido: Negado" / "Respondido: Permitido".
- **Height:** at most 3 lines at 100 % text. At 200 % it may grow, and the timeline above it scrolls.

## 5. The composer: one container, one button

- **One raised container:** `surface-raised`, `border-default`, radius `full`, 48 dp min height. The field grows to 5
  lines, then scrolls.
- **One trailing button that changes with the state:**

| State | Button | Look |
|---|---|---|
| idle, empty field | **Enviar** (disabled) | primary, disabled |
| idle, text typed | **Enviar** | primary |
| working, empty field | **Parar** | a round 40 dp button with a square glyph, accent fill (the desktop's stop) and the accessible name "Parar o turno"; it opens the existing confirm ("Parar turno" / "Deixar rodando") |
| working, text typed | **Orientar** | primary |
| needs you | **Enviar** | primary (text sent while a request waits is queued, as on the desktop) |

- Parar is also in the app bar's ⋮ menu, so it stays reachable while text is typed.
- The two-row layout (the field, then the Parar and Orientar pills) goes away.

## 6. The request screen

- **Title:** `headlineSmall` (Bricolage) with the C3 title. Below it, the risk badge and its one-liner, and below that
  the queue position when there are several ("Pedido 1 de 3").
- **Facts** as label/value rows (`bodyMedium`, label muted), never as boxes that look like input fields:
  - **Pedido por:** agent · conversation;
  - **Onde:** the target, in Plex Mono, cut in the middle;
  - **Ferramenta:** the tool.
- **The command or change** in a code block (§2).
- **The agent's own text**, under the heading **Escrito pelo agente**, in a dashed `border-default` box. It opens with
  the line "O OXESpace não verificou este texto." and keeps the agent's "Por quê" and notes inside. It mirrors the
  desktop modal's split between the app's notes and the agent's words.
- **The app's notes** ("1 valor secreto escondido pelo seu computador.", "Vale olhar de novo …") as a list above the
  agent box, in the app's voice.
- **Motivo para o agente (opcional):** a real input, the only box on the screen that looks editable.
- **Buttons:**
  - **Negar** is the primary button, in the accent fill, full width. It is the safe answer, so it is never danger red.
  - **Permitir uma vez** is secondary (outlined).
  - Under them, "Permitir pede sua digital." (biometrics, M7).
  - At critical risk the desktop's rules apply: Permitir waits the hold, and the screen says so.

## 7. Loading

- **Conversation:** the OxeChat skeleton from [view-skeletons.md](view-skeletons.md): a header line, the prompt block,
  4 prose lines, the composer frame (real and disabled) at the bottom.
  - The title stays the conversation's name when it is known (it comes from the agents list), never "Carregando…".
  - The skeleton shows after 300 ms ([motion.md](motion.md)). Before that, the previous screen stays.
- **Request screen:** a title bar, then the risk-badge shape, 3 fact rows and a code-block shape. The buttons are real
  and disabled.
- **TalkBack:** the root says "Carregando a conversa" once, and every bar inside is hidden from it.

## 8. Dark theme

- The same structure in the dark tokens: canvas `#0d100e`, raised `#131714`, sunken `#1b201c` for the prompt, accent
  ochre `#f5a939` on buttons only.
- No surface uses `accent-soft` except the selected chip, as on the desktop.

## 9. Acceptance (design)

1. Side by side with the desktop OxeChat baselines (`thread-conversation-*`, `thread-running-*`,
   `thread-approval-*`), the phone reads as the same product in both themes:
   - the same families;
   - the prompt as a sunken block;
   - steps as rows;
   - a single card for the final answer;
   - the accent only on actions.
2. **While working:** the pulsing state dot and the live row with its spinner and last-signal time are visible
   without scrolling.
3. **A pending request** is always visible above the composer, with Responder. Answering it removes the bar at once.
4. **On the request screen,** Negar is the primary button (accent, not red), and no read-only value looks like an
   input.
5. **Loading** shows the skeleton with the real title, never "Carregando…" as the title.
6. **At 200 % text,** the request bar title, the request screen's title and the composer wrap; nothing the person
   must act on is cut.
7. **Goldens:** conversation (working, needs you, finished, loading) and the request screen (risky, question,
   computer-only, gone), each in en/pt-BR × light/dark, plus the accessibility snapshot of the conversation.

**Reference mock-ups** (HTML with the Mandacaru token values), shared by DESIGN on request:
`https://claude.ai/artifact/Xbm5ZDaY2bDQafAQgvNAHN`.
