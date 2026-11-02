# As ferramentas do OXESpace para os agentes

> O Claude e o Codex usam as ferramentas do OXESpace quando ajudam, e você vê quais estão ligadas e quanto custam.

<!-- Sobre esta página: Fatia S5 · Quem preenche: BACKEND · Itens: B7.2, B7.3, F10, B7, T8, B24, B25 · parcial: escrita a partir do que está na main em 01/11 (grupos e modos no oxe.yaml, sob demanda, busca semântica por projeto). Configurações › Ferramentas (F10, #210), a recusa de grupo desligado (B24, #358) e o aviso de Node.js ausente (B25) entram quando forem para a main. -->

Também em: [en](../en/05-agent-tools.md)

## O que você consegue fazer

- Quais ferramentas cada conversa recebe
- Ligar, deixar sob demanda ou desligar grupos por projeto no oxe.yaml
- Configurações › Ferramentas: ver e controlar
- Busca semântica por projeto
- O que um agente pode e não pode fazer com elas

## Como fazer

### Quais ferramentas cada conversa recebe

Toda conversa do OxeChat e todo agente num terminal do OxeCode recebem as ferramentas **essenciais**: o contexto do
projeto, a memória e a busca de código (semântica, estrutural e híbrida). O resto vem em grupos:

| Grupo | O que o agente consegue fazer |
|---|---|
| `orchestration` | iniciar outros agentes e conversas, delegar tarefas e acompanhar o Trabalho dos agentes |
| `data` | ler e alterar bancos de dados e contêineres pelo OxeQuery e pelo OxePod |
| `docs` | abrir e capturar previews da web e criar documentação |
| `app` | Git, GitHub, conversas, skills, automações, Linear, servidores MCP e configurações do app |

Papéis acrescentam o que precisam: um membro da Equipe do projeto recebe as ferramentas da equipe, e quem roda uma
delegação ou uma tarefa do Trabalho dos agentes recebe as ferramentas para informar o resultado.

### Ligar, deixar sob demanda ou desligar grupos por projeto no oxe.yaml

Cada grupo tem um modo por projeto:

- **sempre** (`always`): oferecido desde o início;
- **sob demanda** (`on-demand`, o padrão): o agente recebe só os nomes e carrega uma ferramenta quando precisa dela.
  O Codex já carrega sob demanda; o Claude também, com a busca de ferramentas ligada; sem ela, o agente pede o grupo
  com `oxespace_tools_enable`;
- **desligado** (`off`): nunca oferecido, nem no OxeChat, nem nos terminais do OxeCode, nem pelo `.mcp.json` do
  workspace, e o agente não consegue religar.

1. Abra o `oxe.yaml` na raiz do projeto (crie se não existir).
2. Em `thread.tools`, dê o modo de cada grupo que você quer mudar:

   ```yaml
   thread:
     tools:
       orchestration: always
       data: off
       docs: on-demand
   ```

3. Salve. Vale para as conversas e os agentes iniciados depois.

A forma da 1.3 (`tools: [orchestration, data]`, uma lista) continua valendo: os grupos listados ficam **sempre**, e os
outros, **sob demanda**.

### Configurações › Ferramentas: ver e controlar

<!-- A PREENCHER quando o F10 (#210) entrar: a página com os grupos, o modo de cada um, o custo em tokens (Claude e
Codex) e as regras por ferramenta. Copiar os textos de shared/locales. -->

1. …

### Busca semântica por projeto

A busca semântica deixa os agentes encontrarem arquivos pelo significado, não só pelo nome.

1. Na barra lateral do OxeChat, abra o menu **…** do projeto e escolha **Configurações do projeto**.
2. Em **Busca semântica**, ligue **Indexar este projeto para os agentes buscarem por significado**.
3. A linha mostra o andamento (**Indexando… N arquivos até agora**) e depois **N arquivos indexados**.

O índice fica neste computador.

### O que um agente pode e não pode fazer com elas

- **Pode**, nos grupos que o projeto oferece: ler o projeto e a memória, buscar código, e, com os grupos ligados,
  delegar, consultar dados, abrir previews e mexer no app.
- **Pede a você** antes de qualquer coisa que muda algo importante: um comando arriscado, uma escrita em banco de
  produção, um link fora do app. O pedido aparece no OXESpace (veja [Aprovar o que os agentes pedem](01-acoes-confiaveis.md)).
- **Nunca pode**: responder aprovações, ver ou mudar contas, segredos e a política, nem ligar um grupo que o projeto
  desligou.
<!-- Entra com o B24 (#358): "Se um agente chamar uma ferramenta de um grupo desligado, a chamada é recusada mesmo que
ele edite a configuração MCP, e o Diagnóstico registra: «Um agente chamou uma ferramenta do OXESpace de um grupo
desligado em Configurações › Ferramentas. A chamada foi recusada.»" -->

## O que o OXESpace garante

- Uma conversa recebe só as ferramentas essenciais e os grupos que o projeto oferece; um grupo desligado nunca é
  oferecido.
- O que é só seu (aprovações, contas, segredos, política) nunca vira ferramenta de agente.
- O índice da busca semântica fica neste computador.

## Se algo der errado

- **"Não foi possível alterar a busca semântica."** Tente de novo. Se continuar, relate em **Ajuda › Relatar um
  problema**.
- **O agente diz que não tem uma ferramenta do OXESpace.** Confira o modo do grupo no `oxe.yaml`: desligado nunca é
  oferecido. Mudanças valem para conversas e agentes iniciados depois.

<!-- A PREENCHER com o F10 (#210), o B24 (#358: incident.mcp.toolGroupOff no Diagnóstico) e o B25 (Node.js não
encontrado: docs/design/b25-node-missing.md). -->

## No celular

Nada muda no celular.

## Limites conhecidos

- Mudar um modo no `oxe.yaml` não muda uma sessão já aberta: vale para a próxima.

<!-- Capturas: `docs/guide/assets/S5/<nome>.pt-BR.<claro|escuro>.png`. -->
