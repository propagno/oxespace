# Prontidão para a primeira versão estável — OXESpace

Data: 2026-10-11. Versão no repositório: **0.16.0-beta.8**. Branch de trabalho: `feat/redesign-wave-0`.

Este estudo responde a três perguntas: (1) o produto está consistente o bastante
para sair do beta; (2) a presença do projeto no GitHub e a documentação refletem o
que existe; (3) como usar a pipeline atual para commit, push e release. Ele
reutiliza a [avaliação de maturidade de 2026-10-06](maturity-professionalism-2026-10-06.md)
como régua e **reverifica no código de hoje** cada achado que ela classificou como
condição para uma versão estável.

## 1. Parecer

**O produto está tecnicamente pronto para uma primeira estável (`0.16.0`) assim que
duas evidências que dependem de máquina real forem produzidas: a campanha nativa de
Thread e o ensaio de atualização beta → estável.** Nenhuma delas pode ser
substituída por fixtures; ambas levam menos de um dia.

| Condição de saída da auditoria (itens 1–4) | Estado hoje | Evidência |
|---|---|---|
| 1. Comparação de caminhos e recuperação do banco | **Resolvido** | `assertCanonicalInside` não dobra mais caixa (`file-system.service.ts`); `openDatabase` não move mais WAL/SHM e preserva o banco em erros transitórios; teste em `tests/integration/file-system.service.test.ts` |
| 2. Electron suportado e dependências triadas | **Resolvido** | Electron 44.6; `scripts/check-runtime-support.mjs` e `security:audit`/`security:audit:tools` são etapas do CI; `npm run security:audit` retorna *0 vulnerabilities* |
| 3. Campanha nativa de Thread (Claude/Codex autenticados) | **Pendente** | `npm run test:thread:native` existe, mas depende de contas reais e é ignorada no CI; nenhuma execução registrada com a beta.8 |
| 4. Assinatura Windows e ensaio de atualização | **Pendente** | Sem `signtool`/certificado no builder ou no CI; nenhum teste de upgrade de versão anterior instalada |

Os demais achados da auditoria (A7 credenciais, A8 documentação) estão na seção 2.

## 2. Reverificação dos achados (A1–A8)

| # | Achado original | Estado | Observação |
|---|---|---|---|
| A1 | Caminhos podem sair do workspace no Linux | Resolvido | Sem `toLowerCase` na comparação; canonicalização por `realpath` |
| A2 | Electron fora de suporte | Resolvido | 31 → 44.6; gate de janela de suporte no CI |
| A3 | Dependências sem gate | Resolvido | Auditoria de produção e de ferramentas bloqueiam o build; 0 vulnerabilidades hoje |
| A4 | Recuperação do banco pode ocultar dados | Resolvido | Backup verificado é obrigatório para migrar (a migração para se não houver); sem quarentena de WAL |
| A5 | Validação de Thread não acompanha o fluxo | **Aberto** | Ver seção 4, passo 1 |
| A6 | Sem assinatura Windows / sem ensaio de upgrade / RTK sem hash | **Aberto** | Instalador e executável sem assinatura; `rtk.service.ts` baixa por HTTPS sem verificar hash |
| A7 | Políticas de credencial desiguais | Aberto (baixo) | Linear ainda grava em texto simples se `safeStorage` não existir (há aviso na interface) |
| A8 | Hotspots e documentação divergente | Parcial | README, especificação, `SECURITY.md`, `CONTRIBUTING.md`, `CODEOWNERS` e Dependabot **criados nesta passagem**; `GitHubPanel.tsx`, `ThreadView.tsx` e `App.tsx` continuam grandes |

Nenhum item aberto é uma falha de segurança conhecida; todos são lacunas de prova
(A5, A6) ou de política (A7). O que a auditoria pedia para tratar a estável como
"ampla" continua valendo: assinatura é a diferença entre *estável técnica* e
*adotável sem aviso do Windows*.

## 3. Revisão da pipeline

A pipeline (`.github/workflows/ci.yml`, "CI and Release") já é de nível de produção.
O que ela faz, verificado no arquivo:

- **Matriz Windows + Linux** (`windows-2022`, `ubuntu-22.04`), sem `fail-fast`.
- Auditorias → janela de suporte do Electron → typecheck → lint → testes com
  cobertura → build com orçamento de bundle → verificação de módulos nativos →
  E2E (smoke e gate de desempenho).
- Em release: empacota (NSIS, AppImage, `.deb`), roda o **smoke do pacote real**,
  gera SBOM e checksums e envia como artefato imutável.
- Job `release`: garante a tag no SHA verificado → rascunho → baixa e **reverifica**
  o payload → publica → confirma que está público, com o flag de pré-release correto
  e os assets exigidos. Não existe caminho de "rascunho esquecido".
- O corpo da release vem de `docs/releases/<versão>.md` quando existe.

### Beta → estável: o updater funciona?

Sim, e foi verificado no código instalado (`electron-updater` 6.8.9,
`GitHubProvider`): uma instalação beta pede `beta.yml`; se a release não tem esse
manifesto, **cai para `latest.yml`**. Uma instalação estável nunca recebe
pré-release (`allowPrerelease` só é ligado quando a versão atual tem sufixo). O
`.deb` não se atualiza sozinho; AppImage e Windows sim.

### Lacunas da pipeline (nenhuma bloqueia a estável)

| Lacuna | Risco | Recomendação |
|---|---|---|
| Sem ensaio de upgrade automatizado | Regressão de migração só aparece no usuário | Job opcional: instalar a última estável, abrir, atualizar para o build candidato, abrir de novo, checar `user_version` e dados |
| Sem assinatura | Aviso do SmartScreen; sem identidade de publicador | Certificado de assinatura de código (ou Azure Trusted Signing) e `win.signtoolOptions`; manter o checksum como fallback |
| Sem *build provenance* | Não há atestado de origem do binário | `actions/attest-build-provenance` sobre os assets; documentar `gh attestation verify` |
| Sem ambiente protegido para publicar | Qualquer um com *write* pode disparar o release | Ambiente `release` com revisores obrigatórios (o workflow usa só `GITHUB_TOKEN`) |
| Instalador RTK sem hash | Execução de binário baixado sem verificação | Verificar SHA-256 publicado pelo fornecedor antes de promover |

## 4. Plano de lançamento da `0.16.0`

### Antes de tocar na versão

1. **Campanha nativa de Thread** (Windows e Linux, contas reais):
   `npm run test:thread:native` e uma sessão manual de cada provedor cobrindo
   pergunta, aprovação de comando, aprovação de ferramenta MCP, cancelamento,
   anexo, tarefa em background, reconexão e retomada. Registrar versão da CLI.
2. **Ensaio de atualização:** instalar a `0.16.0-beta.8` do release público,
   criar dados (workspace, thread, servidor MCP), atualizar para o candidato,
   conferir dados e abrir de novo. Repetir no Linux com o AppImage.
3. **Validar o login do Notion de ponta a ponta** e um conector com token
   (Postgres/MongoDB) abrindo uma thread nova.
4. **Revisar a árvore de trabalho** (ver abaixo) e rodar a verificação local:
   `npm run typecheck`, `npm run lint`, `npm run test:electron`, `npm run build`,
   `npm run test:e2e`.

### Estado da árvore de trabalho

A árvore contém duas linhas de trabalho misturadas: o redesenho (Thread, shell,
Changes, MCP, barra de CI, documentação) e alterações de memória do usuário
(`electron/main/services/memory/*`, `shared/types/memory.ts`, `resources/memory`,
workflow `memory-compatibility.yml`). O teste
`tests/integration/fs-allowlist.test.ts` falha hoje por causa de
`memory-migration.ts` e `memory-outbox.ts` — isso precisa estar resolvido antes
do release, porque o CI é bloqueante.

Sugestão de commits separados (os da memória em seu próprio commit ou branch):

1. `feat: remove Agents navigation and legacy Thread panels`
2. `refactor: design tokens, dead CSS removal and shared styles`
3. `feat: frameless shell, menu bar, rail sidebar`
4. `feat: Thread transcript views, prompt box, usage ring, PR status bar`
5. `feat: Changes panel with Monaco diff, viewed marks and line comments`
6. `feat: MCP connector catalog, one-click sign-in and Thread attachment`
7. `docs: README, platform specification, community files, release notes`
8. (usuário) `feat: memory …`

### Versão e release

```powershell
# 1. versão (sem sufixo) — package.json e package-lock.json
npm version 0.16.0 --no-git-tag-version

# 2. commit e push da branch
git add package.json package-lock.json docs/releases/0.16.0.md
git commit -m "release: v0.16.0"
git push -u origin HEAD

# 3. validar sem publicar (opcional, recomendado)
gh workflow run ci.yml --ref <branch> -f publish_release=false

# 4. publicar
gh workflow run ci.yml --ref <branch> -f publish_release=true
gh run watch
```

Depois do run verde: abrir a release, conferir que **não** é rascunho nem
pré-release, que os 9 assets estão presentes e que `SHA256SUMS.txt` bate com o
instalador baixado. Se o tag estiver em `main`, o Dependabot e o badge do README
passam a refletir a estável.

### Alternativa mais prudente

Publicar antes `0.16.0-rc.1` (canal `rc`, marcada como pré-release). A pipeline
suporta; os usuários beta recebem pelo mesmo mecanismo, e a `0.16.0` sai quando o
candidato ficar uma semana sem regressão. O custo é um ciclo de release a mais.

### Reversão

Release publicada: marcar como pré-release (`gh release edit vX --prerelease`) ou
excluir a release e a tag; usuários que já atualizaram **não** voltam
automaticamente — o banco só migra para frente. Por isso o ensaio do passo 2 vem
antes.

## 5. Página do GitHub

### O que existia

- `README.md` descrevia apenas Windows, "Agent Settings", "Caveman/RTK" como
  destaques e uma lista de recursos anterior ao modo Thread; não mencionava Linux,
  Changes, catálogo MCP nem a barra de PR; sem capturas de tela.
- Sem `SECURITY.md`, `CONTRIBUTING.md`, `CODEOWNERS`, modelos de issue/PR,
  Dependabot nem categorias de notas de release.
- `.gitignore` ignorava `.github/*` exceto workflows, o que teria escondido
  qualquer arquivo de comunidade criado.

### O que mudou nesta passagem

| Arquivo | O que é |
|---|---|
| `README.md` | Reescrito: proposta de valor, modos Code/Thread, capturas reais, instalação por plataforma com verificação de checksum, requisitos, privacidade e rede, build, mapa da documentação |
| `docs/PLATFORM_SPEC.md` | Especificação: plataformas e pacotes, runtime, capacidades com maturidade, requisitos externos, dados, segurança, canais de atualização, gates, limitações conhecidas |
| `docs/RELEASE_PIPELINE.md` | Payload completo (Windows + Linux), seção de promoção beta → estável |
| `docs/releases/0.16.0.md` | Notas da estável (corpo da release) |
| `docs/assets/screenshots/` | `thread.png`, `code-review.png`, `mcp-catalog.png`, geradas pelo harness e2e com `OXESPACE_README_SHOTS=1` |
| `SECURITY.md`, `CONTRIBUTING.md` | Política de segurança e guia de contribuição |
| `.github/` | `CODEOWNERS`, `dependabot.yml`, `release.yml`, modelo de PR, modelos de issue (bug e funcionalidade) |
| `.gitignore` | Exceções para os arquivos de comunidade |

Regenerar as capturas: `OXESPACE_README_SHOTS=1 npx playwright test e2e/changes-panel.spec.ts e2e/thread-view.spec.ts`
(exige `npm run build`).

### Configurações do repositório (exigem permissão de administrador)

Não foram aplicadas — são decisões do mantenedor:

```powershell
# descrição e tópicos
gh repo edit propagno/oxespace `
  --description "Desktop workspace for coding agents: terminals, native Claude Code and Codex threads, diff review, MCP connectors and local memory." `
  --add-topic electron --add-topic ai-agents --add-topic claude-code --add-topic codex `
  --add-topic mcp --add-topic model-context-protocol --add-topic terminal --add-topic developer-tools

# relato privado de vulnerabilidades (referenciado por SECURITY.md)
gh api -X PUT repos/propagno/oxespace/private-vulnerability-reporting

# proteção da main: CI obrigatório, sem force-push
gh api -X PUT repos/propagno/oxespace/branches/main/protection --input protection.json
```

Também: imagem de pré-visualização social (1280×640, `docs/assets/banner.png`
serve de base), ambiente `release` com revisores obrigatórios e a página
*Releases* como destaque na barra lateral.

## 6. Decisões em aberto

| Decisão | Opções | Recomendação |
|---|---|---|
| Número da versão | `0.16.0` · `1.0.0` | `0.16.0`: continua a linha, evita prometer estabilidade de API e de armazenamento que o `0.x` ainda não oferece |
| Caminho | direto · `0.16.0-rc.1` antes | RC se a campanha nativa ou o ensaio de upgrade falharem ou não puderem ser feitos esta semana |
| Assinatura Windows | antes da estável · depois | Depois, desde que o README e as notas deixem o aviso explícito (já deixam) |
| Alterações de memória | no mesmo release · branch própria | Branch própria, a menos que `fs-allowlist` e o CI de compatibilidade estejam verdes |
