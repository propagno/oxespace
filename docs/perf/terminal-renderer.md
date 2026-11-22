# Renderer do terminal: xterm.js × libghostty WASM (OXE-126 parte 2, A5)

**Recomendação: manter xterm.js** na 1.5.2.

- **Vazão:** o `ghostty-web` processa de 19,9% a 29,7% menos MB/s (medianas) que o renderer DOM do xterm.js, nas duas versões medidas (run 44988353822).
- **Latência e memória:** o p95 do eco é pior neste runner (+20,3% na estável, +6,4% na prévia; ver a ressalva sobre quadros em Limites). A memória total varia de -1,6% a +3,1%.
- **Paridade:** nas duas versões falham cópia nativa, selecionar tudo, texto acessível, âncora do IME e o gancho de OSC 52.
- **O que esta medição não responde:** o WebGL com GPU real, que o app usa quando disponível, e o Windows. O `ghostty-web` ganhou do WebGL **por software** do runner, e isso não vale como previsão para uma máquina com GPU.

## Resultado (run 44988353822)

Antes = `@xterm/xterm` 6.0.0 com renderer DOM, o mais rápido dos dois do xterm.js neste runner. Depois = `ghostty-web` 0.4.0, a versão estável. Cada lado é a mediana de 7 rodadas. O delta é a mediana das diferenças por rodada [mínimo; máximo], por isso pode não ser igual a depois contra antes.

| Carga | Métrica | Antes | Depois | Delta |
|---|---|---:|---:|---:|
| Stream ANSI de 10 MB | MB/s | 16,3 | 11,3 | **-29,7%** [-40,2; -18,6] |
| Stream ANSI de 10 MB | p95 ms, entre quadros | 30,2 | 31,1 | -1,0% [-11,2; +28,1] |
| Stream ANSI de 10 MB | MB | 520,1 | 530,3 | +2,2% [+0,8; +3,5] |
| Tabela de 10 000 linhas, 256 cores | MB/s | 11,3 | 9,0 | **-20,2%** [-22,5; -13,3] |
| Tabela de 10 000 linhas, 256 cores | p95 ms, entre quadros | 35,9 | 39,4 | +9,1% [-2,2; +15,3] |
| Tabela de 10 000 linhas, 256 cores | MB | 509,6 | 501,8 | -1,6% [-2,6; -0,4] |
| Eco de 200 teclas | MB/s | n/a | n/a | n/a |
| Eco de 200 teclas | p95 ms, tecla até o quadro | 15,2 | 18,6 | **+20,3%** [+13,0; +36,8] |
| Eco de 200 teclas | MB | 458,7 | 472,6 | +3,0% [+1,9; +3,5] |

A prévia `0.4.0-next.25.g835eb27`, medida em seguida no mesmo runner com novas amostras do xterm.js, não muda a conclusão:

| Carga | Métrica | Antes | Depois | Delta |
|---|---|---:|---:|---:|
| Stream ANSI de 10 MB | MB/s | 15,8 | 11,2 | **-29,4%** [-31,1; -27,0] |
| Stream ANSI de 10 MB | p95 ms, entre quadros | 33,1 | 31,3 | -3,6% [-19,6; +7,2] |
| Stream ANSI de 10 MB | MB | 520,8 | 533,7 | +2,4% [-4,0; +3,3] |
| Tabela de 10 000 linhas, 256 cores | MB/s | 11,1 | 8,9 | **-19,9%** [-25,1; -9,2] |
| Tabela de 10 000 linhas, 256 cores | p95 ms, entre quadros | 38,8 | 38,8 | +2,0% [-9,0; +43,9] |
| Tabela de 10 000 linhas, 256 cores | MB | 509,5 | 501,5 | -1,6% [-2,9; -0,6] |
| Eco de 200 teclas | MB/s | n/a | n/a | n/a |
| Eco de 200 teclas | p95 ms, tecla até o quadro | 15,7 | 16,8 | **+6,4%** [+4,5; +12,8] |
| Eco de 200 teclas | MB | 458,6 | 472,8 | +3,1% [+2,5; +3,4] |

### Contra o WebGL por software (run 44988353822)

Antes = xterm.js com addon WebGL sobre renderização por software. Depois = `ghostty-web` 0.4.0. A última coluna repete o delta com a prévia.

| Carga | Métrica | Antes | Depois | Delta, estável | Delta, prévia |
|---|---|---:|---:|---:|---:|
| Stream ANSI de 10 MB | MB/s | 6,2 | 11,3 | +82,1% | +87,5% |
| Stream ANSI de 10 MB | p95 ms | 61,7 | 31,1 | -47,0% | -50,2% |
| Stream ANSI de 10 MB | MB | 570,9 | 530,3 | -7,3% | -5,8% |
| Tabela de 10 000 linhas, 256 cores | MB/s | 2,3 | 9,0 | +305,3% | +312,3% |
| Tabela de 10 000 linhas, 256 cores | p95 ms | 212,1 | 39,4 | -81,3% | -81,0% |
| Tabela de 10 000 linhas, 256 cores | MB | 589,4 | 501,8 | -15,0% | -16,4% |
| Eco de 200 teclas | p95 ms | 21,0 | 18,6 | -12,4% | -28,2% |
| Eco de 200 teclas | MB | 530,6 | 472,6 | -10,9% | -11,9% |

### Memória em detalhe (run 44988353822, versão estável)

| Carga | Renderer | MB, todos os processos | MB, processo renderer | MB a mais após a carga | Linhas de histórico |
|---|---|---:|---:|---:|---:|
| Stream ANSI de 10 MB | xterm DOM | 520,1 | 180,6 | 68,6 | 10 000 |
| Stream ANSI de 10 MB | xterm WebGL | 570,9 | 186,3 | 100,9 | 10 000 |
| Stream ANSI de 10 MB | ghostty-web | 530,3 | 191,4 | 63,6 | 9 798 |
| Tabela de 10 000 linhas, 256 cores | xterm DOM | 509,6 | 169,0 | 57,2 | 9 971 |
| Tabela de 10 000 linhas, 256 cores | xterm WebGL | 589,4 | 197,8 | 78,5 | 9 971 |
| Tabela de 10 000 linhas, 256 cores | ghostty-web | 501,8 | 161,3 | 36,5 | 9 971 |
| Eco de 200 teclas | xterm DOM | 458,7 | 124,1 | 7,5 | 0 |
| Eco de 200 teclas | xterm WebGL | 530,6 | 150,9 | 60,0 | 0 |
| Eco de 200 teclas | ghostty-web | 472,6 | 135,8 | 4,8 | 0 |

O ponto a favor do `ghostty-web` é o histórico colorido: na tabela, o crescimento é 34,2% menor que o do DOM (44,0% na prévia). No total dos processos isso vira 1,6%.

## Paridade

**Só a coluna Linux foi medida** (run 44988353822, Electron sob Xvfb, entrada sintética). O Windows não foi medido: o remote-verify só tem runner `ubuntu-22.04`. Na coluna Windows:

- *falha esperada*: deduzida do código das duas versões. A busca por `platform` e `userAgent` nos dois bundles JS inteiros (sem o WASM em base64) não achou desvio por sistema.
- *não medido*: sem afirmação.

Os renderers foram testados puros, sem os handlers de `TerminalView`. DOM e WebGL do xterm.js deram o mesmo resultado em todas as linhas.

| Recurso | xterm.js, Linux | ghostty-web 0.4.0, Linux | Prévia next.25, Linux | xterm.js, Windows | ghostty-web, Windows |
|---|---|---|---|---|---|
| Seleção pela API | passa | passa | passa | não medido | não medido |
| Seleção com o mouse | passa | passa | passa | não medido | não medido |
| Selecionar tudo, com histórico | passa | **falha** | **falha** | não medido | falha esperada |
| Soltar o mouse preserva o clipboard | passa | **falha**: copia sozinho | **falha**: copia sozinho | não medido | falha esperada |
| Clipboard: comando Copiar nativo | passa | **falha** | **falha** | não medido | não medido |
| Clipboard: colar com bracketed paste | passa | **falha** | passa | não medido | falha esperada na estável |
| Clipboard: gancho de OSC 52 | passa | **falha**: sem API | **falha**: sem API | não medido | falha esperada |
| a11y: texto na árvore de acessibilidade | passa com `screenReaderMode` | **falha** | **falha** | não medido | falha esperada |
| IME: texto confirmado | passa | passa | passa | não medido | não medido |
| IME: elemento focado junto ao cursor | passa | **falha**: fica em 0,0 | **falha**: fica em 0,0 | não medido | falha esperada |
| Emoji ocupa duas células | passa | passa | passa | não medido | não medido |

Limites da matriz:

- **a11y:** o teste ligou `screenReaderMode` no xterm.js. **O app não liga essa opção hoje**, então a linha mostra o que o xterm.js oferece, e não o que o app entrega. NVDA e Orca não foram testados.
- **IME:** a composição veio do DevTools Protocol. Nenhum IME do sistema foi usado. A posição da janela de candidatos é inferida do elemento focado.
- **Clipboard:** o handler de cópia do app poderia cobrir a falha do comando Copiar. Essa integração não foi testada.

## O que uma migração teria de resolver

Achados no código publicado das duas versões:

- **Teclado com contrato invertido.** No `ghostty-web`, o handler de `attachCustomKeyEventHandler` que devolve `true` consome a tecla. No xterm.js, `true` deixa a tecla seguir. O handler de `TerminalView` portado como está bloquearia a digitação comum.
- **`scrollback` em bytes.** O valor vai para `max_scrollback`, documentado em bytes no Ghostty `5714ed07a` (usado pela 0.4.0). Com os 10 000 do app, a tabela guardou **515 linhas** nas duas versões (run 44988353822).
- **Selecionar tudo** marca uma tela de linhas a partir de `viewportY`. Com o terminal no fim, são as primeiras linhas do histórico: o teste achou a primeira linha e não a última.
- **APIs que o app usa e que não existem nos dois bundles:** `parser.registerOscHandler`, `lineHeight`, `minimumContrastRatio` e `terminal.modes`. Para esta última há um substituto com outra forma, `getMode(número)`.
- **Addons** de busca, links e fit do app não foram testados com o `ghostty-web`.

## Como foi medido

| Item | Valor |
|---|---|
| Run da medição | [run 44988353822](https://github.com/propagno/oxespace/actions/runs/44988353822), snapshot `8263f719dc` |
| Script | `scripts/bench-terminal-renderer.mjs`, blob `f1f0dd25ce16` |
| Runner | Linux x64, 4 CPUs AMD EPYC 7763, Xvfb, sem GPU |
| Runtime | Electron 44.10.0, Chromium 152.0.7977.169 |
| xterm.js | `@xterm/xterm` 6.0.0, `addon-webgl` 0.19.0, `addon-unicode11` 0.9.0 |
| libghostty WASM | `ghostty-web` 0.4.0 (npm `latest`) e 0.4.0-next.25.g835eb27 (npm `next`) |
| Configuração | 120×30, fonte padrão do app em 16 px, 10 000 linhas de histórico |
| Amostras | 126 (2 versões × 7 rodadas × 3 cargas × 3 renderers), nenhuma com erro |

- O `ghostty-web` é o build WASM da Coder sobre libghostty, com patch próprio. O pacote npm `libghostty` é só uma reserva de nome (0.0.0). Outros builds da comunidade não foram avaliados.
- O candidato foi instalado só na pasta temporária do runner, com `--ignore-scripts`. Nada entra no bundle, no `package.json` ou em `TerminalView`.
- Cada amostra abre um Electron novo com perfil temporário, e a ordem dos renderers gira a cada rodada.
- **MB/s:** bytes UTF-8 até o quadro que mostra a última escrita (1 MB = 1 000 000 bytes). O stream tem 10 000 080 bytes e a tabela 3 436 758. Os dois lados cedem a thread a cada 12 ms, como o `WriteBuffer` do xterm.js.
- **p95 ms:** nas cargas em lote, intervalo entre quadros. No eco, do `keydown` até logo depois do quadro com o caractere, sem contar o compositor e a tela. É a mediana dos p95 das rodadas.
- **MB:** soma do working set dos processos do Electron após GC. Páginas compartilhadas contam mais de uma vez.
- **Histórico igualado:** o limite em bytes do `ghostty-web` foi calibrado por carga (15 114 302 no stream, 19 058 964 na tabela) para ficar a até 3% das linhas do xterm.js.

## Limites desta medição

- **Sem GPU.** O WebGL rodou com `enable-unsafe-swiftshader`. Não se sabe quanto o WebGL com GPU muda a comparação.
- **Windows e macOS não foram medidos.**
- **A área desenhada difere, a favor do `ghostty-web`.** Ele pintou 1200×540 px, contra 1156×780 do DOM e 1080×780 do WebGL, porque não aplica `lineHeight`. Também não faz o ajuste de contraste que o xterm.js fez.
- **É um teste isolado.** O `terminalWriteScheduler` do app entrega no máximo 64 Ki caracteres por quadro, cerca de 3,9 milhões por segundo a 60 quadros. As vazões acima desse valor não chegariam ao usuário sem mudar o scheduler.
- **O eco mede também o agendamento de quadros.** O p50 foi 1,4 ms no DOM e 10,2 ms no `ghostty-web` 0.4.0 (1,9 e 9,4 na rodada da prévia). O `ghostty-web` pede um quadro o tempo todo e o DOM só quando algo muda. A hipótese, não testada, é que sob Xvfb o quadro avulso do DOM saia sem esperar o próximo vsync. Com tela real a diferença de eco pode ser menor, por isso a recomendação não depende dela.
- **Sete rodadas em um runner.** Os intervalos são mínimo e máximo, não intervalos de confiança. Os deltas de p95 das cargas em lote contra o DOM cruzam zero.

## Reproduzir

Em um runner descartável, porque `--parity` sobrescreve o clipboard:

```sh
D=$(mktemp -d)
npm install --prefix "$D" --no-save --ignore-scripts ghostty-web@0.4.0
bash scripts/run-with-xvfb.sh node scripts/bench-terminal-renderer.mjs --ghostty-root="$D/node_modules/ghostty-web" --rounds=7 --parity
```

`node scripts/bench-terminal-renderer.mjs --self-test` confere as cargas, as estatísticas e o código da página, sem display e sem libghostty.

## Quando reavaliar

Uma migração só merece plano se um build WASM de libghostty passar na matriz acima em Windows e Linux e ganhar do xterm.js WebGL em máquina com GPU, com o mesmo histórico e a mesma área desenhada.
