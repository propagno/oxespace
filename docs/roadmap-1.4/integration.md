# Integração e ordem de merge


**Ondas** (cada onda fecha com baselines visuais na `main` e roadmap atualizado):

| Onda | BACKEND | FRONTEND | Mobile |
|---|---|---|---|
| 0 · Fechar lote | #151 A4, Q4/Q5 PR | — | — |
| 1 · Fundações | B8.1 (minify + C3), contratos C1–C5 (só tipos), B3.1 | F1, F2, F3 | esqueleto `mobile/android` + CI; C4 exporta tokens |
| 2 · Segurança e gateway | B6.1 em modo auditar, B9 M1–M3, B1.1, B7.2, B2.2, T8, contrato do B8.3 | F4, F6, F8, F12 | M2, M3 (app) |
| 3 · Produto | B1 (A5, A7, T*), B3 (Q6, Q7, P4, P7), B4 (H4–H9), B5, B8.3 | F5, F7, F9, F10, F11 | M4, M5 |
| 4 · Endurecimento | B6 negar por padrão, S8/S10/S11, X6/X8 | F9 restantes, roteiro NVDA/Orca | M6, M7, M8 |
| 5 · Candidata | só correções | só correções | só correções |

A Onda 5 é X15: 4 semanas no beta, depois o seu OK (X16).

**Ordem dentro da onda:**
1. PR de contrato.
2. BE: implementação.
3. FE: tela.
4. Mobile.

O coordenador mergeia um por vez pelo `merge-when-green.sh`, sempre depois de `gh pr update-branch`.

**Validação pelo coordenador (antes de cada merge):**
1. O diff confere com o aceite do item.
2. Os contratos estão intactos (testes de contrato verdes e nenhum arquivo C7 mudado fora de CCR).
3. Catracas e orçamentos não sobem.
4. A oferta faz sentido (offer-audit).
5. Segurança: nada só do usuário exposto (MCP ou gateway).

**Relato de cada sessão ao fim de cada etapa (SendMessage ao coordenador):** feito (PRs) · falta · bloqueios · CCRs pendentes · catracas.

**Limites da máquina:**
- no máximo 4 agentes no total entre as três sessões;
- um processo pesado (Electron, Playwright, build ou Gradle) por sessão de cada vez;
- CI pesada por dispatch.

## Arquivos

**Novos:**
- `docs/roadmap-1.4/*.md`;
- `shared/remote/protocol.ts`, `shared/messages.ts`;
- `electron/main/services/remote/**`;
- `mobile/android/**`;
- `docs/design/motion.md`.

**Base que se reaproveita:**
- `src/ui/Display.tsx`, `src/design/tokens/*`, `src/components/Brand/OxeLogo.tsx`;
- `electron/main/services/pty-ring-buffer.ts`;
- `thread-request-registry.ts`;
- `mcp-internal/local-rpc-server.ts` (padrão de auth e limites);
- `services/oxequery/secret-cipher.ts` (`safeStorage`).

## Verificação

- **Primeira entrega:** você aprova estes roadmaps. Eu escrevo `docs/roadmap-1.4/*`, abro o PR de documentação e envio os briefs a `oxespace-b4` e `oxespace-02`.
- **Por item:** CI verde e o aceite conferido pelo coordenador.
- **Por onda:** baselines revisadas, `bench:ui` e axe verdes, roadmap regenerado.
- **Mobile:** e2e manual num Android real na mesma Wi-Fi:
  1. parear;
  2. revogar;
  3. queda de rede;
  4. aprovar com biometria;
  5. PC encerrado.

  Também entram a varredura de portas com o gateway desligado e uma revisão de segurança dedicada antes do beta.
