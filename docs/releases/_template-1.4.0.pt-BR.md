<!--
Modelo das notas da 1.4.0 em português, para a release no GitHub; no corte vira 1.4.0.pt-BR.md. Mesmas seções e
mesma ordem do _template-1.4.0.md.
Voz: você, resultado primeiro, abertura em negrito em cada item, nomes de tela como o app mostra; termos do
docs/design/glossary.md. Sem IDs internos, números de PR ou códigos. Apague este comentário antes de publicar.
-->
# OXESpace 1.4.0

<!-- Uma ou duas frases: o que a 1.4 muda para você. Depois a linha de atualização. -->
… Instalações da 1.3.x no Windows se atualizam sozinhas; no Linux, instale o pacote novo (a AppImage se atualiza
sozinha).

## Aprovar o que os agentes pedem

<!-- S1 · guia: docs/guide/pt-BR/01-acoes-confiaveis.md -->
- **…**

## Fechar e voltar sem perder os agentes

<!-- S2 · guia: docs/guide/pt-BR/02-sessoes-que-sobrevivem.md -->
- **…**

## Organizar muitas conversas

<!-- S3 · guia: docs/guide/pt-BR/03-conversas.md -->
- **…**

## O seu celular

<!-- S4 · guia: docs/guide/pt-BR/04-celular.md -->
- **…**

## As ferramentas do OXESpace para os agentes

<!-- S5 · guia: docs/guide/pt-BR/05-ferramentas-dos-agentes.md -->
- **…**

## Todos os seus agentes num lugar só

<!-- S7 · guia: docs/guide/pt-BR/07-agentes.md -->
- **…**

## O OXESpace do seu jeito

<!-- S6 · guia: docs/guide/pt-BR/06-o-app-do-seu-jeito.md -->
- **…**

## O que mudou de lugar ou saiu

<!-- entra quando o F34 for mesclado: "**O OXEVoice foi removido.** O OXESpace não grava mais voz; o ditado do seu
sistema continua digitando em qualquer campo, e o modelo de voz baixado é apagado no primeiro início. A voz nativa
está prevista para uma versão futura." -->
<!-- entra quando o F35 (#344) for mesclado: "**A equipe saiu da barra de título.** Abra em **Ferramentas › Equipe do
projeto…**, na paleta de comandos ou com `Ctrl+Shift+T`." -->
- **Fechar um painel encerra o que ele iniciou.** Trabalhos mandados para o segundo plano com `nohup` ou `disown`, e
  apps abertos pelo painel (`gedit &`, `notepad x`), agora fecham junto. Para manter algo rodando, inicie fora do
  OXESpace ou como um serviço do sistema.
- **…**

## Segurança

- **…**

## Limites conhecidos

- **Voltar para a 1.3.3 exige restaurar o backup automático antes de abrir a 1.3.3.** A 1.4.0 atualiza seus dados na
  primeira vez que abre, depois de salvar uma cópia verificada. A 1.3.3 não consegue ler os dados atualizados: mostra
  "No workspaces yet", sem aviso, embora nada se perca. Para voltar: feche o OXESpace, instale a 1.3.3 pela página de
  Releases e, **antes de abri-la**, coloque o `oxespace-v77-…sqlite3` mais recente da pasta `db-backups` no lugar de
  `oxespace.sqlite3`. A pasta é `%APPDATA%\OXESpace` no Windows e `~/.config/oxespace` no Linux. Depois abra a 1.3.3.
  Os passos completos estão em
  [Voltar para a versão anterior em uma máquina](https://github.com/propagno/oxespace/blob/main/docs/ci-cd.md#going-back-to-the-previous-release-on-one-machine)
  (em inglês).
- …
- **No Windows, um programa gráfico usado como comando de um painel aparece como encerrado logo de início.** Rode-o
  pelo shell do painel. Shells, Claude Code e Codex não são afetados.
- **No Linux e no macOS, um daemon de verdade (um processo que se separa duas vezes) continua rodando depois que o
  painel fecha.**
