# Linux: crescimento de syslog e falha de boot

Data: 2026-10-06. Atualizado com fotografias do journal: registro de erro atribuído a `/usr/lib/claude-desktop/claude-desktop`, PID 3159074. Origem do lançamento, extensão do consumo de disco e vínculo com a falha de boot ainda não comprovados. Nenhuma alteração de produto ou no Linux feita nesta análise.

## Atualização: metadados do journal

`evidencias/1000376714.jpg` mostra registro de 2026-10-06 às 09:41:36 -03, de um boot anterior:

```text
_TRANSPORT=stdout
_PID=3159074
_COMM=claude-desktop
_EXE=/usr/lib/claude-desktop/claude-desktop
_CMDLINE=/usr/lib/claude-desktop/claude-desktop
_SYSTEMD_USER_UNIT=app-com.anthropic.Claude-3159074.scope
MESSAGE=[3159074:1006/094136.203098:ERROR:content/browser/gpu/gpu_process_host.cc:1029] GPU process launch failed: error_code=1002
```

O PID no prefixo Chromium coincide com o PID dos metadados. Isso sustenta a atribuição desse registro ao executável Claude Desktop, em vez de somente inferir pelo texto GPU. Não prova que o usuário abriu esse aplicativo manualmente, que todo o volume de logs veio dele, nem quem iniciou o processo. O significado/causa do código 1002 não foi determinado nesta análise.

O usuário esclareceu que o incidente ocorreu no modo **Thread**, enquanto Code foi usado durante o dia e na investigação fotografada. A foto em Code não identifica o modo ativo na origem do incidente. O usuário informa usar apenas OXESpace; investigar lançamento indireto, associação de aplicativo, autostart e resolução do executável, sem assumir qualquer um deles como causa.

As entradas recentes com `_EXE=/usr/bin/sudo` são auditoria das consultas: o próprio comando contém a frase pesquisada. `evidencias/1000376715.jpg` também mostra tentativas com espaços entre campos que causaram `Invalid argument`. Usar consulta simplificada, em uma linha e filtrada por executável, elimina ambos os problemas:

```bash
sudo journalctl --no-pager -n 5 -o verbose _EXE=/usr/lib/claude-desktop/claude-desktop --grep='GPU process launch failed'
```

Próxima leitura de configuração, sem iniciar nenhum agente:

```bash
type -a claude
command -v claude-desktop
pgrep -af '/usr/lib/claude-desktop/claude-desktop'
```

Processos atuais não reconstituem a árvore de processos do boot anterior. A relação com a Thread depende de evidência de lançamento/configuração, não apenas da coincidência temporal. Busca literal por `claude-desktop`/`com.anthropic.Claude` em electron, src, shared e resources não encontrou referência explícita no checkout.

## Evidências recebidas

Três fotos em `C:/Users/dudu-/Downloads/bugprojetos`:

- `1000376424.jpg`: kernel panic, `VFS: Unable to mount root fs on unknown-block(0,0)`.
- `1000376434.jpg`: OXESpace **v0.16.0-beta.5**, superfície **Code**, terminal Claude. A resposta do agente relata cerca de 4,4 milhões de linhas `GPU process launch failed` entre 05:59 e 09:38, PID 3159074, journal de 2,2 GB e syslog.1 de 209 GB. Atribui o processo a Claude Desktop, mas não exibe os metadados originais que sustentariam essa atribuição.
- `1000376439.jpg`: a resposta relata 245.065 ocorrências do erro em uma amostra final de 50 MB, aproximadamente 35 outras linhas, e cerca de 365 GB liberáveis em syslog/syslog.1. Propõe truncamento/remoção, `--disable-gpu` e `maxsize 1G` no logrotate. A imagem não comprova execução dessas ações.

Os números e a identificação do processo são **relatos de outro agente fotografados**, não medições independentes nem logs brutos. O usuário confirma falta de espaço e recuperação usando um kernel anterior.

## Hipóteses iniciais e limites (antes dos metadados acima)

1. A hipótese principal para o consumo de disco é uma tempestade de logs de falha de inicialização de processo GPU em um aplicativo Chromium/Electron. A mensagem existe em `GpuProcessHost::OnProcessLaunchFailed` no código Chromium. Ela não identifica sozinha o aplicativo nem a causa da falha; falta inclusive o `error_code` original.
2. OXESpace também usa Electron; não pode ser excluído. O terminal Claude visível não comprova que havia um Claude Desktop separado. É preciso obter `_EXE`, `_COMM`, `_CMDLINE`, `_PID`, `_BOOT_ID` e a linha completa do journal. Um PID pode ser reutilizado entre boots.
3. A imagem mostra Code/beta.5, não Thread/beta.6. Não há evidência para atribuir este incidente às mudanças locais não publicadas de Thread/beta.6. Isso também não inocenta componentes compartilhados do OXESpace.
4. O panic informa que o kernel não conseguiu montar a raiz. Falta de espaço pode ter prejudicado a geração de initramfs durante uma atualização; essa é uma hipótese, não diagnóstico fechado. Bootloader, initramfs e módulos/driver do kernel que falha precisam ser conferidos. O funcionamento com um kernel anterior orienta a comparação, sem provar a causa.
5. `maxsize 1G` não é um teto contínuo de escrita: logrotate só avalia o tamanho quando executado. Um agendamento diário ainda permite grande crescimento entre execuções. Limitar journald também não limita automaticamente os arquivos mantidos pelo rsyslog.

## Inspeção do checkout

- `electron/main/index.ts` inicializa electron-log e crashReporter. Há tratamento de `render-process-gone`, mas não foi encontrado tratamento de `child-process-gone` para conter falhas GPU repetidas nem chamada `disableHardwareAcceleration`. A tag beta.5 também não contém esses mecanismos no entrypoint.
- `electron/main/services/shell-profile.defaults.ts` configura o perfil Claude como executável `claude`, não como lançamento explícito de um aplicativo Desktop. O executável efetivamente resolvido no Linux do incidente continua desconhecido.
- O transporte Thread atual consome stderr do CLI por callback; não foi encontrada nesta inspeção uma gravação explícita desse fluxo em `/var/log/syslog`. Isso não cobre logs nativos do Electron nem a configuração de logging da sessão Linux.
- Testes Windows da beta.6 não validam recuperação GPU, driver Linux ou retenção de syslog. O smoke de quatro Web Preview guests não cobre esse incidente.

## Próxima coleta no Linux, somente leitura

Não copiar nem percorrer integralmente centenas de GB para esta triagem. Obter uma amostra pequena com identidade do processo:

```bash
df -h / /var /boot
df -i / /var /boot
uname -r
sudo journalctl --no-pager -n 3 -o verbose --grep='GPU process launch failed'
sudo ls -lh /var/log/syslog /var/log/syslog.1
ls -lh /boot/vmlinuz-* /boot/initrd.img-*
systemctl list-timers --all logrotate.timer
```

Se o journal já tiver descartado os eventos, obter somente o final de um syslog ainda preservado:

```bash
sudo tail -c 65536 /var/log/syslog | grep -m 3 -F 'GPU process launch failed'
```

Se o erro não estiver no arquivo atual, repetir a mesma amostra em `syslog.1`; ausência na amostra não elimina a hipótese. Não inferir identidade pelo quinto campo de uma linha: o formato de timestamp e prefixos varia. Antes de compartilhar, revisar caminhos/argumentos pessoais presentes nos metadados.

Confirmar também se havia Claude Desktop separado e quais comandos de limpeza/configuração foram realmente executados. Depois de identificar o emissor, interromper o processo responsável antes de limpar logs. Preservar uma amostra e corrigir a origem; limpeza isolada permite recorrência. Teste com GPU desativada deve visar o aplicativo identificado e ser monitorado, não ser tratado como correção comprovada. Não reinstalar kernel nem modificar GRUB/initramfs sem verificar versões, espaço e falhas de atualização.

## Fontes primárias

- [Chromium: gpu_process_host.cc](https://chromium.googlesource.com/chromium/src/+/ec29c78d6a862ac2fb95fc83a99dcb167b2f5cf9/content/browser/gpu/gpu_process_host.cc).
- [Manual logrotate: frequência de execução e tamanho](https://www.man7.org/linux/man-pages/man8/logrotate.8.html).
- [Linux: initramfs e montagem da raiz](https://www.kernel.org/doc/html/latest/filesystems/ramfs-rootfs-initramfs.html).
