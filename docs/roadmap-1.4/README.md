# OXESpace 1.4.0 — roadmap dividido

## Contexto

A 1.4.0 sai com tudo em maturidade de produção, e o prazo não limita. O trabalho se divide entre três sessões, e esta sessão (`backlog-pos-1-3-0-plano`) coordena, mergeia e valida:

| Sessão | Papel |
|---|---|
| `oxespace-b4` | FRONTEND |
| `oxespace-02` | BACKEND |

Decisões do usuário:
- o app Android entra na 1.4.0;
- o app é nativo, em Kotlin + Compose.

Esta é a primeira entrega: os três roadmaps, os contratos e o plano de integração. Aprovado pelo usuário em 30/10/2026.

Depois de aprovado:
- este conteúdo vira `docs/roadmap-1.4/{frontend,backend,mobile,contracts,integration}.md` num PR só de documentação;
- cada sessão recebe o seu brief por mensagem.

### Estado de partida (main 0a70b471 e seguintes)

**Já entregue:**
- Mandacaru (tokens OKLCH, claro e escuro via `data-mode`, densidade, escala e `data-motion`);
- primitivas em `src/ui`: EmptyState, ErrorState, LoadingState, Skeleton e Spinner;
- i18n com i18next;
- axe em cada PR;
- orçamentos de bundle e de interação;
- auditoria de ofertas;
- OxePod e OxePost H1–H4;
- segurança S5, S6 e S7 (S7 parcial);
- A8.

**Lacunas medidas:**

Frontend:
- não há estado de sucesso nem offline;
- não há splash, favicon, loader com a marca nem tela About;
- as cores do logo não vêm dos tokens;
- existem cerca de 20 keyframes avulsos;
- o axe cobre WCAG 2.1, não 2.2;
- o roteiro de leitor de tela nunca foi executado;
- a regressão visual não bloqueia PR;
- não há breakpoints em token.

Backend:
- o processo principal está perto do orçamento de 1000 KiB;
- validação de IPC escrita à mão;
- não há agregado de aprovações entre conversas;
- os motivos de quarentena e os diálogos nativos saem em inglês;
- S3 e S4 não estão aplicados.

Mobile:
- nada existe;
- todo servidor escuta só em 127.0.0.1 ou num pipe;
- não há TLS, mDNS nem QR.

### Padrão de cada item

Cada item tem: Objetivo e porquê · Escopo / Fora · Dependências e contratos · Aceite · Testes · Riscos → mitigação · Complexidade (P/M/G/GG) · DoD.

**DoD comum**, que vale para todo item e não se repete abaixo:
- PR para a `main` com CI verde em Linux e Windows;
- catracas só descem: tamanho de arquivo, lint de design e orçamentos;
- textos novos em en e pt-BR;
- offer-audit verde;
- ferramentas MCP declaradas em `shared/mcp-coverage.ts`;
- validação do coordenador contra o aceite;
- o item só conta como feito depois de mergeado na `main` **e** homologado (sessão de homologação, registro em `docs/validation/homologacao-1.4.md`);
- nota no roadmap.



## Documentos

- [Frontend](frontend.md)
- [Backend](backend.md)
- [Mobile](mobile.md)
- [Contratos](contracts.md)
- [Integração e ordem de merge](integration.md)
