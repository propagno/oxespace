# Roadmap MOBILE 1.4.0

Padrão de cada item e DoD comum: ver [README](README.md).


### Decisão técnica: nativo Kotlin + Compose (decisão do usuário)

**A favor:**
- serviço em primeiro plano confiável para manter o WebSocket e notificar sem nuvem;
- fixação do certificado autoassinado (pin pelo QR);
- Android Keystore e biometria para as aprovações;
- NSD nativo (mDNS);
- sem dependência de push da Google.

**Custos e como reduzir:**
- Sem reaproveitar TypeScript. Os contratos viram JSON Schema gerado de `shared/remote/protocol.ts`, e o Kotlin é gerado a partir dele.
- Os tokens do design system saem em JSON (F1/C4) e geram `Theme.kt`.
- As traduções do catálogo saem em `strings.xml`.

**Descartados:**
- PWA: certificado autoassinado na LAN quebra o service worker, e o push exigiria nuvem.
- Híbrido: a decisão já está tomada.

**Estrutura:**
- código em `mobile/android/` (Gradle), com job de CI próprio (build, testes de unidade, instrumentados no emulador e lint);
- `minSdk` 28.

### M1 · Gateway remoto no desktop, desligado por padrão (G) [BE B9]
- **Objetivo:** primeira superfície de rede do OXESpace, segura por construção.
- **Escopo:**
  - HTTPS e WSS em porta configurável;
  - liga só por Settings › Dispositivos e escuta na interface da LAN;
  - certificado autoassinado gerado e guardado com `safeStorage`;
  - limite de taxa, corpo máximo de 64 KB e auditoria.
- **Fora:** acesso pela internet, relay e túnel.
- **Contratos:** C5.
- **Aceite:**
  - desligado, nenhuma porta aberta;
  - ligado, só TLS;
  - os tokens internos (MCP, F3, execução) nunca passam pelo gateway (teste).
- **Testes:** integração com cliente TLS; varredura de portas no e2e; fuzz dos frames.
- **Riscos:**
  - nova superfície de ataque → revisão de segurança dedicada (`/security-review`) e itens no modelo de ameaças S10;
  - firewall do Windows → diálogo explicado.

### M2 · Descoberta e pareamento (M)
- **Escopo:**
  - mDNS `_oxespace._tcp`, anunciando só o nome e a porta, sem segredo;
  - IP manual como alternativa;
  - QR com host, porta, impressão SHA-256 do certificado e código de uso único de 2 minutos;
  - o celular gera um par de chaves no Keystore e o desktop confirma "Parear Pixel 8?".
- **Fora:** pareamento sem a tela do desktop.
- **Aceite:** código expirado ou reusado é recusado; certificado diferente do QR derruba a conexão.
- **Testes:** unidade nos dois lados; instrumentado com QR falso.
- **Riscos:** mDNS bloqueado na rede → IP manual.

### M3 · Autenticação e ciclo de vida do dispositivo (M)
- **Escopo:**
  - token de acesso de 15 minutos assinado no desktop;
  - refresh preso à chave do dispositivo, com prova de posse;
  - revogação em Settings › Dispositivos, que derruba a conexão na hora;
  - lista com último acesso;
  - até 5 dispositivos.
- **Aceite:** revogar fecha o WSS em menos de 1 s; token expirado é recusado.
- **Riscos:** relógio dessincronizado → validade calculada no desktop.

### M4 · Sessões e saída em tempo real (G)
- **Escopo:**
  - listar workspaces, panes, Threads, jobs e delegações;
  - Thread: eventos por notificação seguida de leitura (`readSince`, C2);
  - terminal: só leitura, pelos slices do `PtyRingBuffer` com seq, retomando após reconexão;
  - virtualização e ANSI → texto com cores.
- **Fora:** editor e diff completos.
- **Aceite:** retomar após 30 s sem rede não perde nem duplica eventos; latência < 300 ms na LAN.
- **Testes:** contrato C5; queda de rede simulada.

### M5 · Agir pelo celular (G)
- **Escopo:**
  - mensagem, direcionar e interromper uma Thread;
  - aprovar ou recusar pedidos da Thread com biometria, sempre com o pedido mostrado inteiro;
  - escrita no terminal só se o pane tiver "permitir do celular" ligado no desktop.
- **Fora** (tudo só do usuário, no desktop):
  - aprovações do OxeQuery e do MCP `confirm`;
  - login e tokens;
  - segredos;
  - confiança em MCP;
  - editar política;
  - `host.exec`.
- **Contratos:** C2, C5 e B1.1.
- **Aceite:**
  - auditoria registra o dispositivo;
  - teste garante que as capacidades proibidas não existem no protocolo.

### M6 · Notificações e resiliência (M)
- **Escopo:**
  - serviço em primeiro plano com o WSS ativo;
  - notificações de "precisa de você", "terminou" e "falhou";
  - reconexão com backoff;
  - estados claros: PC desligado, sessão encerrada, rede trocada e revogado.
- **Fora:** notificar com o app morto e sem rede local, porque não há nuvem (documentado).
- **Aceite:** com bateria em Doze, a notificação chega ao voltar; cenários de queda testados.

### M7 · Visual consistente (M) [FE]
- **Escopo:**
  - `Theme.kt` gerado dos tokens (cores OKLCH → sRGB, tipografia e motion);
  - marca, estados (incluindo offline) e claro/escuro;
  - pt-BR e en;
  - acessibilidade TalkBack e alvo de 48 dp.
- **Aceite:** capturas Paparazzi de cada tela nos dois modos.

### M8 · Distribuição (P)
- **Escopo:** APK assinado nos releases do GitHub, com verificação documentada.
- **Fora:** Play Store, que fica para decisão sua.
