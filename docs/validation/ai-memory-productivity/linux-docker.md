# Certificação Linux via Docker

Executada em 2026-10-09, America/Sao_Paulo (2026-10-10 UTC), após autorização explícita do usuário para usar Docker. Valida os contratos de memória em Linux; não certifica instaladores desktop, sessões autenticadas reais ou ganho de produtividade.

## Ambiente e isolamento

- Imagem local `oxespace-stabilization`, ID `sha256:d34b2ce4273f4c1164895b2527eb60d7be69dd9682c276ae671a22b8bdcaac1e`.
- Electron 44.6.0, Node da imagem 22.23.3; testes executados sob o Node do Electron pelo runner existente.
- Linux x64, kernel `5.15.167.4-microsoft-standard-WSL2`.
- Dependências da imagem comparadas ao lockfile atual, ignorando somente a versão raiz do aplicativo: correspondência integral. Fontes atuais copiados para `/app` antes dos testes.
- Contêiner descartável `oxespace-memory-certification`: 1 CPU, 1 GiB RAM, memory-swap 1 GiB (sem swap adicional), 192 PIDs, logs Docker limitados a 2 MiB.
- Workspace montado somente leitura em `/source`; nenhum diretório pessoal de memória montado. Dados sintéticos e binários em `/tmp` do contêiner.
- RAM observada em duas amostras: 337,7 e 423,9 MiB; não é medição de pico.

O início do Docker reativou automaticamente três contêineres k3d. O servidor k3d chegou a 2,385 GiB de RAM e 646% CPU. Os três foram parados antes da certificação; estavam desligados antes desta tarefa. Isso não explica o incidente histórico de disco cheio.

## Resultados

| Suite | Resultado final | Duração do runner |
|---|---|---|
| ai-memory 2.1.0 | 12/12, zero skips | 10.735 ms |
| ai-memory 2.6.2 | 17/17, zero skips | 20.120 ms |
| Cliente, serviço, ferramentas e diagnóstico | 33/33 | 8.810 ms (Vitest) |

Os binários foram baixados das releases oficiais e os arquivos compactados verificados antes da extração:

| Versão | SHA256 tar.gz | SHA256 executável |
|---|---|---|
| 2.1.0 | `b4d911f392fea7f151c9c1ff83521922417570e5104ffb02a5e82253afc877ac` | `822130b1d67a80b63dac66c4fff092ca352817b55b69d25f802aa5baa54619c2` |
| 2.6.2 | `dc73118f772763a119b03d387f6f44f0b866d85498851b74aa5152944ef2e650` | `ef75630570a12ae15780b96d498d47e28406bd52d6b16943244b26e25dc05789` |

Houve dois timeouts nas tentativas iniciais: instalador de hooks (30 s) e suíte complementar de serviço com Git real (5 s). O instalador direto respondeu em 0,099 s; seu teste isolado e a repetição completa 2.1.0 passaram. Na repetição da suíte complementar, o cenário de Git anteriormente afetado concluiu em 1,798 s. Não houve alteração de código, aumento de timeout ou mudança de quota entre as tentativas. A causa exata dos timeouts transitórios não foi determinada; não escondê-los como execução estável sem ressalvas.

## Reprodução

O script `docker/memory-compatibility.sh` exige imagem previamente preparada com dependências Linux em `/app` e checkout atual em `/source` readonly. Rejeita dependências divergentes, verifica SHA256 dos arquivos compactados e executa versões sequencialmente. Não reconstrói imagem nem modifica dependências do host.

Exemplo PowerShell, da raiz do projeto (nome do contêiner precisa estar livre):

```powershell
docker run -d --name oxespace-memory-certification --init --cpus=1 --memory=1g --memory-swap=1g --pids-limit=192 --log-opt max-size=2m --log-opt max-file=1 --mount "type=bind,source=$PWD,target=/source,readonly" --env NODE_OPTIONS=--max-old-space-size=640 --entrypoint sleep oxespace-stabilization 1800
docker exec oxespace-memory-certification bash -c "sed 's/\r$//' /source/docker/memory-compatibility.sh | bash"
docker stop --timeout 5 oxespace-memory-certification
docker rm oxespace-memory-certification
```

O limite de 30 minutos do contêiner evita permanência indefinida se a execução for interrompida. O runner de certificação limita cada rodada a 180 segundos. Após a coleta, o contêiner foi parado e removido, e o Docker Desktop foi desligado. Confirmação: endpoint `dockerDesktopLinuxEngine` ausente e nenhum processo Docker Desktop/backend listado. A chamada CLI de encerramento demorou e permaneceu aguardando mesmo após essas confirmações. Imagens e volumes preexistentes foram preservados.

## Gate restante

Compatibilidade automatizada Windows/Linux demonstrada. T01 ainda exige baseline V12 e a matriz de provedores autenticados; os tempos de testes não substituem essas medições. A workflow GitHub ainda não foi executada. Nenhuma migração do runtime em uso, alteração de versão ou publicação realizada.
