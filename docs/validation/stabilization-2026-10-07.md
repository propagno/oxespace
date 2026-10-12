# Estabilização — arquivos, dados, dependências e Thread

Trabalho solicitado em 2026-10-07 sobre beta.6 (`33b04d4`). Documento de execução; não é declaração de nova release ou conclusão de todos os cenários.

## Implementação

- Filesystem: compara caminhos canônicos sem transformar caixa. Validação da raiz registrada também usa realpath. Regressão POSIX cobre irmãos `Project`/`project`, link externo, leitura, escrita, preview e listagem; confirma preservação do arquivo externo.
- Banco: remove quarentena automática de WAL/SHM. Bloqueio ou erro de I/O preserva o conjunto original. Upgrade usa `VACUUM INTO` para snapshot consistente com WAL, verifica integridade e versão, aplica permissões restritas, sincroniza e promove o arquivo. Falha interrompe a migração. Versão de banco mais nova impede downgrade. Mantém cinco backups, ordenados por data.
- Runtime: Electron 44.6.0 exato, da linha suportada segundo a [agenda oficial](https://releases.electronjs.org/schedule). Área de transferência migrada para a [API assíncrona](https://www.electronjs.org/docs/latest/api/clipboard). SQLite 13 e PTY 1.1 usam seus binários Node-API; o preparador elimina ABI 125 hardcoded e verifica o runtime realmente instalado.
- Dependências: remove Geist não utilizado e seu peer Next; move ferramentas CSS para devDependencies; atualiza DOMPurify/Sharp, Vite, electron-vite, Vitest e electron-builder e transitivas vulneráveis. CI passa a exigir audit de produção a partir de moderada e checagem da janela de suporte do Electron.
- Thread: campanha opt-in usa arquivos sintéticos e assinatura existente; nenhuma conversa pessoal é importada. Verifica ferramentas, retomada após encerrar processo, cancelamento e mensagem posterior. Harness de aplicativo mede sessão, dados locais e processos Electron, verifica contexto após reiniciar o aplicativo e grava relatório compacto sem prompts ou respostas.
- Consulta de conta: falha de instalação/conexão não é mais classificada como ausência de login. Prazo da consulta passa a 30 segundos, com limite explícito, sem retry infinito.

## Evidência já obtida

- Audit de produção: zero alertas após atualizações.
- Audit completo após atualização de ferramentas: zero altos/críticos; oito entradas moderadas herdadas de `sprintf-js` pelo logger/proxy de download de electron-builder. Mesmo advisory `GHSA-hp3w-g68c-fv3c`, não oito falhas independentes. A árvore não é distribuída como dependência de produção. O risco é DoS por precisão de formatação controlada por atacante; nenhuma entrada externa para formato foi demonstrada no fluxo examinado. Não se aplicou downgrade automático de electron-builder sugerido por audit. Reavaliar até 2026-11-07 ou antes da próxima publicação, o que ocorrer primeiro; proibir logs com format strings não confiáveis. [Advisory](https://github.com/advisories/GHSA-hp3w-g68c-fv3c).
- Verificação nativa: SQLite e PTY carregaram no Electron 44.6.0 (ABI reportada 149).
- Build atualizado após ajustes de foco e orçamento de bundles passaram. Verificação de suporte confirmou Electron instalado e fixado em 44.6.0.
- Typecheck e lint dos arquivos alterados passaram. Empacotamento Windows concluiu; smoke do executável empacotado passou com terminal nativo e quatro previews. Boot medido em 8.058 ms; processos Electron voltaram de oito para quatro após fechar os quatro guests. Isso não comprova ausência de vazamento em uso prolongado.
- Linux real (Docker): regressões de filesystem e recuperação passaram (12 aprovadas, uma específica de outra plataforma ignorada). Suíte ampla: 1.213 aprovados, 32 ignorados, dois timeouts de cinco segundos em histórico longo e revisão Git; não é aprovação integral.
- Windows: suíte completa final local sem Docker aprovada: **1.218 testes passaram, 31 ignorados, zero falhas**, em 190 arquivos aprovados e oito ignorados (414 segundos), com execução sequencial de arquivos. Ignorados incluem cenários opt-in e específicos de outras plataformas; não equivalem a validação autenticada. Repetição focada anterior passou 38 testes dos cinco arquivos antes afetados. Terminal Thread real passou, incluindo remontagem sem trocar processo; Thread UI com histórico grande passou (clipboard desse teste é simulado).
- Clipboard nativo separado passou com handlers reais: escrita/leitura de texto e imagem PNG via preload, com restauração do conteúdo anterior sem registrá-lo. Preview com guest real passou. Navegação por teclado passou após corrigir retorno de foco em Ferramentas e Novo workspace, inclusive opener substituído durante lazy loading.
- Inferência semântica offline após atualizar Sharp: embedding de 768 dimensões finitas e processamento de PNG passaram.
- 45 testes focados de terminal, conta e recuperação passaram após ajustes de mocks construtores para Vitest atual.
- Codex autenticado: ferramentas, contexto após restart de processo, interrupção e mensagem posterior passaram. Isso não comprova todos os fluxos nem substitui teste do aplicativo instalado.

## Falhas encontradas durante a validação

- npm 10.9.2 falhou no rollback da instalação; instalação com npm 10.9.9 completou. Não houve instalação global de npm.
- fsync de backup aberto somente para leitura falhou com EPERM no Windows. Corrigido para abrir o snapshot temporário com `r+`; regressões passaram.
- Teste E2E de terminal iniciou antes da navegação do renderer terminar. Passou a aguardar URL e DOM carregados.
- Primeira suíte ampla encontrou mocks de construtores incompatíveis com Vitest atualizado e timeouts sob concorrência. Corrigidos os mocks e configurada execução sem paralelismo entre arquivos; resultado inicial não é aprovação.
- Scripts de teste Electron/benchmark usavam subpath do Vitest que deixou de ser exportado. Resolvem agora o executável relativo ao package.json público. Uma hipótese de falha no pool de processos não foi confirmada (o runner Node também ficou sem saída por um período e concluiu com sucesso); não se manteve alteração de pool como suposta correção.
- Primeiro ensaio de aplicativo falhou em preflight de conta com `THREAD_AUTH_REQUIRED`. Corrigida a classificação da falha de consulta; preflight posterior confirmou assinatura conectada. Ensaio seguinte foi bloqueado por `usageLimitExceeded` do provedor. Não contar como soak aprovado nem repetir consumo sem necessidade.
- Docker precisava copiar os scripts antes de `npm ci`, porque o novo postinstall os utiliza. Ordem corrigida. Uma tentativa posterior sofreu falha do job BuildKit; não é resultado de teste Linux.

## Campanha e limites

Com Claude autenticado, executar `OXESPACE_NATIVE_PROVIDERS=claude,codex` e `npm run test:thread:native`. O opt-in consome inferência da assinatura; os testes usam diretório temporário e acesso somente leitura. Não habilitar esses testes indiscriminadamente em CI público sem contas dedicadas.

Para duração: `OXESPACE_THREAD_ENDURANCE=1`, `OXESPACE_ENDURANCE_PROVIDER=codex` (ou claude), `OXESPACE_ENDURANCE_MINUTES=60`, Playwright com `playwright.tools.config.ts` e `e2e/thread-native-endurance.spec.ts`. O relatório limita-se a processos Electron e dados locais isolados; não mede todos os descendentes das CLIs e não prova ausência de vazamento.

Pendências: ensaio prolongado e restart de aplicativo com provedor real, perguntas/aprovações/anexos/filas/background autenticados e validação final do pacote Linux. Claude local inicialmente sem login; solicitado login ao usuário, sem pedir credenciais. Linux via Docker não recebe cópia de credenciais pessoais. Sem assinatura/conta Linux dedicada, não declarar campanha nativa Linux aprovada. A pedido do usuário, não iniciar Docker para continuar as verificações; evidências Linux acima são anteriores à restrição. Nenhuma nova versão foi publicada.
