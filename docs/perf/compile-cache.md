# Cache de compilação do V8 no boot (OXE-126 parte 1, A6)

**Decisão: desligado** na 1.5.2.

**A medição da A6 está incompleta: o Windows não foi medido.** O card pede Windows e Linux, e só o Linux tem números.

- **Linux, cache quente:** ganha 16,4 ms até ready-to-show (3,0%) e 17,7 ms até interactive (2,8%).
- **Linux, cache frio:** perde 12,5 ms e 11,7 ms quando o cache ainda não existe.
- **Por que desligado:** o ganho é pequeno, não está provado no Windows, e ligar o cache pela entrada planejada tem os riscos listados em "Antes de ligar". Esta decisão não diz que o cache não ganha no Windows.

`electron/main/compile-cache.ts` não foi criado e `electron.vite.config.ts` não mudou.

## Resultado (run 44991822685)

Antes = sem cache. Depois = com `module.enableCompileCache()`. Cada lado é a mediana de 80 aberturas. O delta é a mediana das diferenças por rodada, com IC95 por bootstrap, por isso pode não ser igual a depois menos antes. Negativo é mais rápido.

| Métrica | Sistema | Cache | Antes (ms) | Depois (ms) | Delta em ms [IC95] |
|---|---|---|---:|---:|---:|
| boot: process→ready-to-show | Linux | quente | 538,2 | 522,1 | **-16,4** [-20,0; -12,7] |
| boot: process→ready-to-show | Linux | frio | 538,2 | 549,1 | **+12,5** [+9,0; +14,4] |
| boot: process→interactive | Linux | quente | 636,5 | 619,5 | **-17,7** [-20,5; -13,9] |
| boot: process→interactive | Linux | frio | 636,5 | 647,4 | **+11,7** [+7,7; +15,7] |
| boot: process→ready-to-show | Windows | quente e frio | não medido | não medido | não medido |
| boot: process→interactive | Windows | quente e frio | não medido | não medido | não medido |

### De onde vem a diferença (Linux, run 44991822685)

| Etapa | Cache | Antes (ms) | Depois (ms) | Delta em ms [IC95] |
|---|---|---:|---:|---:|
| Import de `out/main/index.js` | quente | 64,0 | 51,9 | -12,1 [-12,6; -11,8] |
| Import de `out/main/index.js` | frio | 64,0 | 72,4 | +8,4 [+8,0; +8,7] |
| process→app-ready | quente | 173,2 | 161,7 | -12,0 [-13,9; -10,6] |
| process→app-ready | frio | 173,2 | 182,5 | +8,0 [+6,9; +10,2] |

A maior parte do ganho está no import do bundle do main.

### p95 (Linux, run 44991822685)

| Marca | Sem cache (ms) | Quente (ms) | Frio (ms) |
|---|---:|---:|---:|
| ready-to-show | 549,0 | 534,0 | 562,4 |
| interactive | 648,3 | 630,0 | 660,6 |

## Como foi medido

| Item | Valor |
|---|---|
| A/B | [run 44991822685](https://github.com/propagno/oxespace/actions/runs/44991822685), snapshot `e6a18934e1` |
| O cache funciona | [run 44991463231](https://github.com/propagno/oxespace/actions/runs/44991463231), snapshot `bbd6f8e9ce` |
| Base | `7e772ca129` |
| Runner do A/B | Linux x64 6.8.0-1070-azure, 4 CPUs AMD EPYC 9V74, Xvfb |
| Runtime | Electron 44.10.0, Node 24.22.1 |
| App | `npm run build`, não empacotado, com `OXESPACE_E2E_MOCK_NATIVE=1` |
| Amostras | 80 rodadas de três lados, depois de 5 aberturas de aquecimento, nenhuma descartada |

- Um módulo de entrada temporário, criado só no runner, liga ou não o cache e depois importa `out/main/index.js`. O bundle é idêntico nos três lados.
- A ordem dos lados passa pelas seis permutações. Cada abertura usa perfil e banco novos.
- **Quente:** diretório de cache gravado no aquecimento. **Frio:** diretório vazio a cada abertura.
- Os números são as marcas do próprio app, `oxe:ready-to-show` e `oxe:interactive`, contadas do início do processo (`electron/main/startup-timing.ts`).
- No run 44991463231, cada abertura quente teve 86 linhas de log com `accepted` (4 na fria) e nenhuma com `rejected`, e o log confirma que o cache de `out/main/index.js` foi aceito. São linhas de log, não módulos distintos. O diretório ficou com 694 992 bytes. O A/B não repetiu essa contagem.
- O comando completo e os valores por rodada estão no log de cada run. O comando está também na mensagem do commit de snapshot.
- O run 44991245090 foi descartado: terminou com exit 0, mas nenhuma das 25 aberturas iniciou o Electron.

## O que não foi medido

- **Windows.** O `remote-verify` só tem runner `ubuntu-22.04`. Os workflows do repositório com runner Windows que foram examinados precisam de um spec novo ou comparam refs diferentes, e não o cache ligado e desligado. Um workflow ou spec novo está fora do escopo desta tarefa.
- **App empacotado:** asar, fuses, NSIS, zip, AppImage e deb.
- **Disco frio** e antivírus, que podem mudar o custo de ler e gravar o cache.
- **Banco, terminais e serviços reais**, substituídos pelo mock.
- **As demais linhas do gate OXE-105.** Como o produto não muda, esta decisão não as afeta.
- **Outro runner.** O A/B é um run em uma máquina.

## Antes de ligar

Achados na leitura do código, não testados com um build da entrada nova:

1. **Caminhos relativos ao bundle.** Com `index` apontando para um módulo que faz `import('./index')`, o app tende a sair em `out/main/chunks/`. `electron/main/db/index.ts`, `electron/main/i18n.ts` e `electron/main/agent-text.ts` derivam pastas de `import.meta.url`, e migrações e traduções são copiadas para `out/main/`. É preciso conferir esses caminhos no build.
2. **Orçamento cego.** `scripts/verify-bundle-budgets.mjs` mede `out/main/index.js` (574 kB no run 44991245090, cujo build foi válido). Com a entrada nova, mediria só o módulo pequeno, e o limite de 620 kB deixaria de proteger o main.
3. **Integridade.** O app empacotado só carrega de `app.asar`, com validação de integridade no Windows. O cache de código fica em um diretório gravável e fora dessa validação. O local e as permissões precisam de revisão de segurança, e o padrão do Node, no diretório temporário, não deve ser aceito sem ela.
4. **Ordem antes de `ready`.** O `index.ts` chama `app.setPath`, `crashReporter.start` e o lock de instância única antes de `ready`. No run 44991463231 o import dinâmico sempre terminou antes de `ready`, mas isso só foi visto no Linux.

## Verificação do build sem mudança de produto

- **O comando de boot prescrito pela tarefa falha** ([run 44992688028](https://github.com/propagno/oxespace/actions/runs/44992688028), exit 1). O build e os orçamentos passam, mas o Playwright responde `No tests found`, porque `playwright.config.ts` ignora `perf-benchmark.spec.ts`. O comando precisa de `--config playwright.tools.config.ts`.
- **Com essa config, os 2 testes de boot passam** ([run 44992976549](https://github.com/propagno/oxespace/actions/runs/44992976549)), sem `OXESPACE_PERF_GATE`, ou seja, sem cobrar os orçamentos de tempo. As medianas de 4 aberturas foram 657,5 ms até ready-to-show e 789,1 ms até interactive. É outro run e outro harness, e esses números não se comparam com os do A/B.

## Quando reavaliar

Repetir este A/B em `windows-2022`, de preferência com o app empacotado. Se o cache quente ganhar nos dois sistemas com o IC95 inteiro abaixo de zero, o custo frio for aceito e os quatro pontos acima estiverem resolvidos, a decisão pode virar ligar o cache.
