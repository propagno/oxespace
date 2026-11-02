# OXESpace guide: how it is written

The user guide for people who use OXESpace, one page per 1.4 outcome. **pt-BR is written first**; `en/` mirrors it
with the same headings in the same order.

- [Guia em português](pt-BR/README.md)
- [Guide in English](en/README.md)

This file is for the people who write the guide. DESIGN/PRODUCT owns the voice and structure; each slice's owner
fills its page when the slice reaches its exit check (charter "Definition of done": documented).

## Pages

| Page (pt-BR / en) | Slice | Fills it |
|---|---|---|
| `01-acoes-confiaveis` / `01-trustworthy-actions` | S1 | BACKEND + FRONTEND |
| `02-sessoes-que-sobrevivem` / `02-sessions-that-survive` | S2 | BACKEND + FRONTEND |
| `03-conversas` / `03-conversations` | S3 | FRONTEND |
| `04-celular` / `04-phone` | S4 | MOBILE |
| `05-ferramentas-dos-agentes` / `05-agent-tools` | S5 | BACKEND |
| `06-o-app-do-seu-jeito` / `06-your-way` | S6 | FRONTEND + DESIGN |
| `07-agentes` / `07-agents` | S7 | DESIGN + BACKEND + FRONTEND |

S0 (the team's factory) has no page: it isn't something the person does.

## Structure of every page (don't add or reorder sections)

1. **Title**: what the person achieves, in their words ("Aprovar o que os agentes pedem"), not the feature's name.
2. **One-line outcome** as a quote.
3. **O que você consegue fazer / What you can do**: the tasks, one line each. They are also the `###` headings below.
4. **Como fazer / How to**: per task, numbered steps, one action each.
5. **O que o OXESpace garante / What OXESpace guarantees**: the promises the tests prove (safety, privacy, nothing
   lost). Only what a test enforces; if it isn't tested, it isn't a promise.
6. **Se algo der errado / If something goes wrong**: every message the person can see for this outcome (the slice's
   C3 messages), quoted exactly as the app shows it, then what to do.
7. **No celular / On the phone**: what changes there, or "Nada muda no celular."
8. **Limites conhecidos / Known limits**: what doesn't work yet in 1.4, one line each, with the version it's planned
   for when known.

The generated skeleton marks each place to fill with an HTML comment (`A PREENCHER` / `TO FILL`). A page is done when
none is left.

## Voice

- Talk to the person: "você", second person, present tense. "Abra **Agentes**", not "O usuário deve abrir".
- One action per step. Start with the verb: "Clique em **Permitir**", "Pressione `Ctrl+Shift+G`".
- **Screen names in bold, exactly as the app shows them**, in that language. If the app says "Equipe do projeto…",
  the guide says **Equipe do projeto…**, ellipsis included.
- Shortcuts in code style with the Windows/Linux chord (`Ctrl+Shift+G`); add the macOS one in parentheses when macOS
  ships.
- Every term follows the [glossary](../design/glossary.md). A word not there is added there first.
- No internal ids, codes, file paths of the app or English in pt-BR, except product names and the glossary's
  developer terms.
- Say why only when it changes what the person does ("Permitir espera 2 s em risco crítico para que você leia o
  pedido").
- Short paragraphs, at most 3 sentences. Lists over prose.

## Screenshots

- Path: `docs/guide/assets/<slice>/<name>.<pt-BR|en>.<claro|escuro|light|dark>.png`, at 1440×900 and 100 % scale.
- Taken from the e2e of the slice (the same doubles as the acceptance specs), never from the user's live app or data.
- No real names, paths, tokens or company data in a capture; use the e2e fixtures' names.
- One light capture per task is enough; add dark only where the difference matters (risk colours, production band).

## Checks before a page is called done

- pt-BR and en have the same headings in the same order.
- Each promise names the test that proves it in the PR body (not in the page).
- HOMOLOGATION follows the steps on the real app once, in both languages, and the page is fixed where they diverge.
- DESIGN reviews voice and structure in the PR (design review, item 5 "Copy").
