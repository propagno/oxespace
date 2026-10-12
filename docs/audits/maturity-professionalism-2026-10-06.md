# Avaliação de maturidade e profissionalismo — OXESpace

Data: 2026-10-06. Versão: **0.16.0-beta.6**. Base examinada: `33b04d45671ea37602b87f9e35fa8ae8f66bde9c`.

## Parecer

**O OXESpace é um beta avançado, com práticas profissionais de engenharia e maturidade desigual entre funcionalidades. Ainda não há sustentação suficiente para classificá-lo como produto estável para adoção ampla ou corporativa.** O principal investimento agora deve ser estabilização, segurança e recuperação de dados.

Minha avaliação de maturidade é **6,3/10**. O profissionalismo do processo de engenharia está aproximadamente em **7/10**: há arquitetura deliberada, testes relevantes, CI nas plataformas distribuídas, verificação de pacotes, diagnóstico limitado e documentação de restrições. Essa segunda nota é um juízo qualitativo sobre práticas, não outra média nem uma certificação. Falhas de segurança, atualização do runtime e recuperação impedem que a quantidade de funcionalidades se converta automaticamente em confiança operacional.

O selo beta é adequado. Code tem evidência de consolidação superior à de Thread. Teams possui fundamentos de autorização e persistência bem concebidos, mas ainda entrega apenas parte da visão de coordenação.

## Método e limites

Inspeção dirigida do código, configuração, testes, documentação e pipeline; confirmação do SHA e da release; leitura dos logs do [CI publicado](https://github.com/propagno/oxespace/actions/runs/37526237625); execução de `npm audit --omit=dev --package-lock-only --json`; reprodução isolada da comparação de caminhos com semântica POSIX; confirmação de suporte do Electron na fonte oficial.

O CI consultado passou no mesmo SHA do checkout. Não executei novamente a suíte completa nesta análise: não houve mudança de código de produto que justificasse repetir os mesmos testes. A auditoria de dependências consulta informações atuais e pode diferir do resultado no momento de instalação.

Não houve pentest completo, sessão nova autenticada com Claude/Codex, teste prolongado, pesquisa com usuários, teste com leitor de tela ou inspeção visual nova. Não medi taxa de falhas em produção, retenção de usuários, MTTR ou custo de suporte. Memória histórica serviu como indicação de onde procurar; código e resultados atuais prevaleceram. Ausência de evidência no material examinado não significa inexistência de uma prática fora do repositório.

## Rubrica

Escala orientativa: 0–2 = prova de conceito; 3–4 = protótipo funcional; 5–6 = beta com lacunas relevantes; 7–8 = operação consistente e validação ampla; 9–10 = maturidade sustentada por uso, recuperação e governança demonstrados. As notas são julgamento de engenharia, não precisão estatística. Diferenças de décimos não têm significado isolado.

| Dimensão | Peso | Nota | Fundamento predominante |
|---|---:|---:|---|
| Arquitetura e manutenção | 15% | 7,0 | Separação de processos e serviços; concentração crescente nos coordenadores e telas |
| Testes e validação | 15% | 8,0 | CI Windows/Linux e pacotes reais; lacunas em agentes autenticados e longa duração |
| Segurança e dependências | 20% | 4,5 | Boas barreiras, mas runtime EOL e falha concreta na comparação de caminhos |
| Confiabilidade e recuperação | 15% | 5,5 | Persistência e backups presentes; recuperação WAL e ensaios de falha insuficientes |
| Diagnóstico e operação | 10% | 7,0 | Registros limitados e privados; cobertura parcial de processos e consumo de disco |
| Distribuição e atualização | 10% | 7,0 | Pipeline verificável e SBOM; Windows sem assinatura e recuperação de atualização não comprovada |
| Experiência e acessibilidade | 10% | 6,5 | Fluxos e teclado testados; avaliação de usabilidade e cobertura acessível incompletas |
| Documentação e governança | 5% | 5,0 | Documentos técnicos úteis, mas divergências de estado e ausência de política operacional demonstrada |

Média ponderada: 6,275, arredondada para **6,3**. Riscos de segurança e integridade de dados não são compensados por médias altas em outras dimensões.

## Evidência positiva

### Arquitetura com intenção técnica

Há separação entre renderer, preload, IPC e serviços privilegiados. TypeScript está em modo estrito. A janela principal usa `contextIsolation: true`, `nodeIntegration: false` e `sandbox: true` em [index.ts](../../electron/main/index.ts). O preview recebe partições próprias, restrições de permissões e configuração de segurança no processo principal. Isso é uma base profissional para um aplicativo que executa ferramentas locais e exibe conteúdo de projetos.

O terminal tem ciclo de vida independente da montagem visual e buffer limitado; remontar a interface não precisa reiniciar o processo. Thread dispõe de serviços próprios para transporte, histórico, projetos e checkpoints. Teams diferencia autorização da execução, mensagem persistida, submissão e confirmação de recebimento. Preservar estados desconhecidos e evitar reenvio automático incerto são boas decisões em sistemas com agentes.

### Validação substancial e rastreável

Resultados do CI do commit publicado, sem somar plataformas como se fossem testes distintos:

| Resultado | Windows | Linux |
|---|---:|---:|
| Testes unitários/integração aprovados | 1.213 | 1.209 |
| Testes ignorados nessa suíte | 26 | 30 |
| Arquivos de teste aprovados | 189 | 188 |
| Cobertura de linhas | 63,14% | 62,83% |
| Cobertura de branches | 71,70% | 71,59% |
| Cobertura de funções | 60,60% | 60,41% |
| E2E aprovados na etapa principal | 28 | 28 |
| Cenários do gate de desempenho aprovados | 15 | 15 |
| Smoke do aplicativo empacotado aprovado | 1 | 1 |

O pipeline também executa typecheck, lint, build, orçamento de bundle e verificações nativas. Gera SBOM e checksums e verifica os artefatos antes de publicar. O microbenchmark informativo usa `continue-on-error`, mas os gates de desempenho de interface das duas plataformas são bloqueantes. É importante não confundir essas etapas.

A cobertura é significativa, porém os pisos configurados são apenas 35% para linhas/funções/statements e 25% para branches. Uma regressão grande ainda poderia passar pelo piso global. O alvo deveria ser impedir regressão e proteger módulos críticos, não perseguir 100% indiscriminadamente. O `tsconfig.json` principal não inclui `tests/` e `e2e/`: os testes são executados e lintados, mas esse comando de typecheck não valida seus tipos.

### Diagnóstico compatível com a preocupação de espaço

[runtime-diagnostics.ts](../../electron/main/services/runtime-diagnostics.ts) limita o armazenamento estruturado a três arquivos de 512 KiB, retenção de sete dias, 120 combinações distintas por janela de um minuto, contadores de repetição e memória limitada. O limite de 120 é de combinações; os resumos de repetição podem gerar linhas adicionais. O esquema exclui prompts, argumentos, ambiente e saída de terminal. Falha de escrita desabilita o registrador, evitando tentativas repetitivas de log.

É uma melhoria relevante para suporte e privacidade. Entretanto, o limite de 1,5 MiB vale para esse registrador: não vale para todo o userData, banco, anexos, históricos dos agentes, crash dumps ou syslog. A implementação também faz I/O síncrono limitado no processo principal; vale medir seu impacto em disco lento durante os ensaios de carga.

## Achados que mais reduzem a maturidade

### A1 — Comparação de caminhos pode aceitar saída do workspace em Linux

**Prioridade alta; confiança alta na falha lógica, reprodução completa em Linux pendente.**

Em [file-system.service.ts](../../electron/main/services/file-system.service.ts), `assertCanonicalInside` usa `realpath` e depois converte raiz e alvo para minúsculas em todas as plataformas. Em filesystem sensível a maiúsculas, `/work/Project` e `/work/project` podem ser diretórios distintos.

Exemplo: raiz autorizada `/work/Project`; link interno `linked` apontando para `/work/project`; leitura de `linked/secret.txt`. O caminho lexical permanece dentro da raiz, mas o caminho real sai dela. A comparação atual aceita `/work/project/secret.txt` após converter a raiz para minúsculas. A reprodução isolada com `node:path.posix` retornou `acceptedByCurrentPredicate: true`.

O serviço usa essa verificação em leitura, escrita e preview. A condição exige o arranjo de diretórios/link e uma operação por esse serviço; não é evidência de exploração remota ou acesso arbitrário sem essas condições. Os testes existentes cobrem escape comum por junction, mas não esse caso de diferença de caixa.

**Critério de resolução:** comparação respeitando a semântica do filesystem, teste real de symlink em Linux com diretórios irmãos diferenciados por caixa, rejeição de leitura/escrita e preservação dos cenários legítimos Windows. Rever também a autorização da raiz e a janela entre validação e acesso.

### A2 — Electron distribuído está fora de suporte

**Prioridade alta; confirmado.** `package.json` usa Electron `^31.7.7`, e os logs de empacotamento mostram a linha 31. A página oficial de [Electron 31.7.7](https://releases.electronjs.org/release/v31.7.7) declara encerramento de suporte. A [política oficial](https://www.electronjs.org/docs/latest/tutorial/electron-timelines) mantém as três linhas estáveis mais recentes.

Isso importa especialmente porque o aplicativo incorpora Chromium e carrega previews. O audit com `--omit=dev` não substitui a revisão do runtime: Electron está declarado como dependência de desenvolvimento, mas é distribuído no produto.

**Critério de resolução:** versão suportada, rebuild de PTY/SQLite, testes de preload/preview/terminal/GPU e pacotes Windows/Linux aprovados; calendário de atualização e prazo para correções de segurança.

### A3 — Dependências com alertas e ausência de gate explícito de segurança

**Prioridade alta para triagem; exploração não determinada.** O audit do lockfile retornou **13 entradas de pacotes: 1 crítica, 8 altas e 4 moderadas**. Não são necessariamente 13 vulnerabilidades independentes: algumas entradas herdam problemas transitivos.

| Severidade reportada | Pacotes |
|---|---|
| Crítica | next |
| Alta | @xenova/transformers, fast-uri, js-yaml, nanoid, postcss, sharp, source-map-js, vite |
| Moderada | baseline-browser-mapping, dompurify, esbuild, monaco-editor |

O lockfile inclui Next como peer de `geist`; sua presença não significa que OXESpace execute um servidor Next vulnerável. Dependências de build também aparecem na árvore de produção: `@tailwindcss/vite`, por exemplo, está em `dependencies`. É necessário confrontar árvore, imports e conteúdo efetivamente empacotado antes de avaliar exposição.

Não encontrei um passo explícito de `npm audit` bloqueante nos workflows examinados. O resumo de audit emitido por `npm ci` não é gate de segurança: instalar pode terminar com sucesso apesar dos alertas. A documentação descreve checagem de advisories, mas não demonstra uma política automatizada de aceitação.

**Critério de resolução:** inventário de exposição por advisory, correções ou justificativas com prazo, remoção do que não precisa ser distribuído e gate com exceções explícitas e expirantes. Não aplicar `npm audit fix --force` sem analisar compatibilidade.

### A4 — Recuperação do banco pode ocultar alterações recentes

**Prioridade alta; comportamento confirmado, perda real não reproduzida.** [db/index.ts](../../electron/main/db/index.ts) tenta abrir o banco até cinco vezes para erros transitórios. Depois, `quarantineWalSidecars` move `-wal` e `-shm` para `.bak` e tenta reabrir. A classificação inclui `SQLITE_BUSY` e `SQLITE_LOCKED`, que não comprovam corrupção.

O próprio comentário reconhece que alterações ainda não transferidas do WAL podem deixar de aparecer no banco ativo. Preservar o arquivo ajuda uma recuperação especializada; não equivale a restauração automática verificada. Não foi identificada, nos testes examinados, uma campanha para essa sequência com dados confirmados e leitura após recuperação.

Há pontos positivos: WAL, foreign keys, migrações até versão 62, testes de upgrades parciais e backup anterior à migração com retenção de cinco cópias. Porém, falha do backup apenas registra aviso e permite continuar a migração. Em disco cheio, essa política reduz a proteção justamente quando mais importa.

**Critério de resolução:** não tratar bloqueio como corrupção; preservar estado completo de forma consistente; modo explícito de recuperação; teste com WAL contendo alterações, falta de espaço, processo interrompido e restauração validada. Definir comportamento quando o backup de upgrade falha.

### A5 — A validação de Thread ainda não acompanha a criticidade do fluxo

**Prioridade alta para promoção a estável.** As [notas públicas da beta.6](../releases/0.16.0-beta.6.md) reconhecem pendências em perguntas/aprovações/background de Claude autenticado, fluxos completos de Codex, sessões longas instaladas e ensaio de 60 minutos. Alguns testes nativos estão condicionados a variáveis de ambiente e foram ignorados no CI.

Fixtures e testes de transporte verificam contratos importantes, mas não demonstram sozinhos comportamento com conta real, versão real da CLI, queda de processo, retomada e resposta tardia. Uma conexão aberta não prova conclusão de tarefa; submissão não prova recebimento pelo agente. O código já reconhece parte dessas distinções, mas falta completar a prova operacional.

**Critério de resolução:** matriz por provedor e versão da CLI, com aprovação, pergunta, cancelamento, anexos, ferramentas, tarefa em background, reconexão e retomada; evidência reproduzível no instalado nas duas plataformas. Sessões prolongadas devem medir memória, CPU, disco e processos remanescentes. Uma hora é um primeiro marco, não garantia para uso diário prolongado.

### A6 — Distribuição verificável, mas sem assinatura Windows

**Prioridade média/alta para adoção externa; confirmado.** O CI registra `no signing info identified, signing is skipped` tanto para o executável principal quanto para o instalador. Checksums verificam integridade em relação ao manifesto; não substituem identidade de publicador e assinatura de código.

O updater configura download automático e instalação ao sair. Isso torna importante testar upgrade real de uma versão anterior, retenção de dados, interrupção e comportamento diante de pacote inválido. Smoke de boot do pacote novo não comprova essas propriedades. A migração do banco também limita qualquer promessa de downgrade simples.

O instalador de RTK examinado baixa por HTTPS, extrai e promove o binário sem verificação explícita de hash ou assinatura do artefato nesse fluxo. Isso é uma lacuna de validação de dependência executável, não evidência de comprometimento do fornecedor.

**Critério de resolução:** assinatura e verificação na distribuição Windows, identidade verificável dos binários auxiliares e ensaios de atualização/recuperação. Testar AppImage e instalação deb separadamente, sem assumir que possuem o mesmo mecanismo de atualização.

### A7 — Segurança e credenciais têm políticas desiguais

O serviço Linear usa `safeStorage`, mas persiste texto simples se criptografia não estiver disponível; há aviso na interface. O runtime de memória recusa criar a credencial nesse caso. A diferença é explícita, porém merece uma política consistente para uso profissional: exigir cofre, permitir somente sessão ou exigir consentimento prévio informado para persistência sem proteção. Verificar o backend efetivo em Linux, além da disponibilidade nominal da API.

Thread/Team/Delegation verificam remetente/frame em handlers; outros handlers examinados, como filesystem, validam entradas e raiz sem a mesma checagem explícita de frame. Isso pede uma revisão uniforme da fronteira IPC. Não demonstra, por si só, um caminho explorável a partir do preview, cujo preload e isolamento são restringidos.

### A8 — Concentração de responsabilidades e descompasso documental

`GitHubPanel.tsx` tem cerca de 85 KB; `thread-orchestrator.ts`, 85 KB; `ThreadView.tsx`, 65 KB; `App.tsx`, 65 KB. Tamanho não prova mau design, mas esses pontos concentram estado, eventos, interface e coordenação. Com provedores e modos novos, cresce o custo de entender e alterar o ciclo completo sem regressões.

Recomendo extração gradual por responsabilidade e contratos de estado, protegida por testes de comportamento. Não há evidência que justifique reescrever o aplicativo ou trocar de framework.

O README permanece centrado em Windows, embora a release tenha artefatos Linux. Documentos de validação ainda dizem que não houve publicação, apesar da release confirmada. São registros históricos úteis, mas precisam de status final inequívoco. Não localizei `CONTRIBUTING`, `CODEOWNERS`, configuração Dependabot/Renovate ou política `SECURITY.md` na raiz/.github; existe `docs/SECURITY_MODEL.md`. Isso não prova ausência de proteção de branch ou revisão configurada no GitHub, que não foram auditadas.

## Maturidade por área de produto

| Área | Julgamento | O que sustenta / limita |
|---|---|---|
| Code | Beta mais consolidado | PTY, remount, teclado e pacote testados; continua sujeito às lacunas transversais de segurança e dados |
| Thread | Beta em estabilização | Camadas e estados bem encaminhados; contratos reais de provedores e sessões longas ainda pendentes |
| Teams | Funcionalidade inicial sobre boa infraestrutura | Inbox durável, deduplicação e autorização; piloto real com dois agentes e transferência exclusiva de controle ainda incompletos |
| Linux | Distribuição com CI real, validação de campo incompleta | Build, testes e smoke aprovados; não equivalem a validar diferentes drivers, kernels, desktops, permissões e uso prolongado |

Acessibilidade tem evidência concreta em `e2e/keyboard-accessibility.spec.ts`: navegação de Code, foco, Escape e retorno após diálogos. Isso não comprova cobertura de Thread, leitor de tela, zoom, contraste ou todas as ferramentas. A documentação de interface e a amplitude funcional demonstram investimento; satisfação e facilidade de adoção exigem observação de usuários reais.

O posicionamento também precisa ficar mais claro: terminal/workspace, conversa com agentes, coordenação, memória, documentação, preview e integrações coexistem. O primeiro uso deveria conduzir a uma tarefa concluída com um provedor, mostrando apenas capacidades disponíveis e diferenciando configuração, autorização, execução e falha. Essa é uma recomendação de produto derivada da complexidade observada, não resultado de teste com usuários.

## Incidente Linux e alcance do diagnóstico

O incidente anterior não deve ser usado como prova de que Thread/OXESpace causou o consumo de disco. A evidência de journal preservada identifica um executável `claude-desktop` emitindo a mensagem; quem o iniciou e a relação causal com Thread continuam sem comprovação. Tampouco há evidência para dizer que a beta.6 corrigiu a causa do incidente.

O novo registrador ajuda a correlacionar processos diretos e eventos de execução. Não registra universalmente todos os descendentes de todo agente, não é detector de repetição de qualquer processo do sistema e não limita logs do Linux. Para maturidade operacional, é necessário tornar visível o uso total de armazenamento e definir limpeza/limites por categoria, preservando históricos que o usuário queira manter.

## Sequência recomendada e critérios de saída

| Ordem | Entrega | Evidência exigida |
|---|---|---|
| 1 | Corrigir comparação de caminhos e rever recuperação WAL | Casos Linux de caixa/symlink bloqueados; dados confirmados preservados em falhas de banco |
| 2 | Atualizar Electron e triar dependências | Runtime suportado, exposição documentada, gates e pacotes aprovados |
| 3 | Concluir campanha nativa Thread | Claude/Codex autenticados, versões registradas, interrupção/retomada e sessões prolongadas |
| 4 | Consolidar distribuição e recuperação | Assinatura, upgrade de versão anterior, restauração comprovada e integridade de auxiliares |
| 5 | Definir orçamento global de armazenamento | Diagnóstico por categoria, avisos acionáveis, políticas de retenção e teste de disco cheio |
| 6 | Alinhar documentação e suporte | README multiplataforma, estado real de cada modo, compatibilidade de CLI e procedimento de recuperação |
| 7 | Reduzir hotspots e ampliar usabilidade | Extrações pequenas com testes, foco/teclado nos fluxos críticos e observação de usuários |

Para **beta controlado por usuário técnico**, a base já é utilizável, com limites explicitados e correção prioritária dos riscos encontrados. Para **lançamento estável amplo**, considero os itens 1–4 condições essenciais, além de documentação coerente. Para **uso corporativo**, ainda falta demonstrar política de credenciais, atualização, compatibilidade, suporte, recuperação e manutenção contínua.

Não proponho ampliar Teams ou adicionar integrações como primeira resposta a esta avaliação. O ganho imediato de profissionalismo virá de demonstrar que as funções atuais se mantêm previsíveis diante de falhas, atualizações e uso prolongado.

## Evidências e reprodução

- [CI do SHA avaliado](https://github.com/propagno/oxespace/actions/runs/37526237625) e [release publicada](https://github.com/propagno/oxespace/releases/tag/v0.16.0-beta.6).
- [Resumo preservado da auditoria de dependências](maturity-dependencies-2026-10-06.json), com comando, SHA e links dos advisories. Representa o resultado da data, não a exposição final do pacote.
- Fontes locais: `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`, `.github/workflows/ci.yml`, `electron-builder.yml`, `electron/main/index.ts`, `electron/main/db/index.ts`, `electron/main/updater.ts`, `electron/main/services/file-system.service.ts`, `runtime-diagnostics.ts`, `linear.service.ts`, `rtk.service.ts`, testes de filesystem/migrações e documentos citados.
- Logs brutos consultados em `dist/maturity-ci.log`; audits em `dist/maturity-audit.json` e `dist/maturity-lock-audit.json`. São arquivos locais ignorados pelo Git; os resultados relevantes foram preservados neste relatório e no JSON associado.
- Reprodução isolada do predicado: normalizar `/work/Project` e `/work/project/secret.txt` com `node:path.posix`, aplicar `toLowerCase()` a ambos e verificar igualdade/prefixo com `/`. Resultado: aceita. A validação completa com filesystem Linux permanece como critério de correção.

Esta análise adiciona somente documentação e evidência resumida. Não corrige código, não publica outra versão e não altera as garantias da beta.6.
