import { createServer } from 'node:http'

const port = Number(process.env.PORT || 4178)

const page = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Teste Web Preview · OXESpace</title>
  <style>
    :root { color-scheme: light; font-family: Inter, Segoe UI, sans-serif; color: #172033; background: #f3f6fb; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 32px; }
    main { width: min(820px, 100%); background: white; border: 1px solid #dce4ef; border-radius: 20px; box-shadow: 0 18px 55px #24375418; overflow: hidden; }
    header { padding: 30px 34px 24px; background: linear-gradient(120deg, #172554, #2563eb); color: white; }
    header small { text-transform: uppercase; letter-spacing: .14em; opacity: .75; font-weight: 700; }
    h1 { margin: 10px 0 6px; font-size: 28px; }
    header p { margin: 0; color: #dbeafe; }
    nav { display: flex; gap: 8px; padding: 16px 24px 0; border-bottom: 1px solid #e5eaf2; }
    nav button { border: 0; background: transparent; color: #64748b; padding: 12px 18px; font: inherit; font-weight: 700; cursor: pointer; border-bottom: 3px solid transparent; }
    nav button[aria-selected="true"] { color: #1d4ed8; border-bottom-color: #2563eb; }
    section[role="tabpanel"] { padding: 32px 34px 38px; min-height: 265px; }
    .eyebrow { color: #2563eb; font-weight: 800; font-size: 12px; letter-spacing: .12em; text-transform: uppercase; }
    h2 { margin: 10px 0; font-size: 25px; }
    section p { color: #536176; line-height: 1.65; max-width: 620px; }
    .badge { display: inline-flex; margin-top: 10px; padding: 8px 12px; border-radius: 999px; background: #eff6ff; color: #1d4ed8; font-weight: 700; font-size: 13px; }
    footer { padding: 14px 34px; color: #718096; font-size: 12px; border-top: 1px solid #edf0f5; }
  </style>
</head>
<body>
  <main>
    <header><small>OXESpace · Web Preview</small><h1>Playwright em três abas</h1><p>Uma página Node simples para validar navegação e captura.</p></header>
    <nav role="tablist" aria-label="Seções de teste">
      <button id="tab-visao" role="tab" aria-controls="panel" aria-selected="true" tabindex="0">Visão geral</button>
      <button id="tab-recursos" role="tab" aria-controls="panel" aria-selected="false" tabindex="-1">Recursos</button>
      <button id="tab-status" role="tab" aria-controls="panel" aria-selected="false" tabindex="-1">Status</button>
    </nav>
    <section id="panel" role="tabpanel" aria-labelledby="tab-visao">
      <div class="eyebrow" id="eyebrow">Aba 1 · demonstração</div><h2 id="heading">Visão geral</h2>
      <p id="description">Esta página está sendo servida localmente por Node.js e aberta no Web Preview. Use as abas para conferir interação real antes das capturas.</p>
      <span class="badge" id="badge">Preview local ativo</span>
    </section>
    <footer>Servidor local · sem dependências externas · porta 4178</footer>
  </main>
  <script>
    const content = {
      visao: ['Aba 1 · demonstração', 'Visão geral', 'Esta página está sendo servida localmente por Node.js e aberta no Web Preview. Use as abas para conferir interação real antes das capturas.', 'Preview local ativo'],
      recursos: ['Aba 2 · funcionalidades', 'Recursos', 'As três abas são acessíveis por teclado e atualizam o painel sem recarregar a página. O Playwright valida o estado selecionado e captura cada tela.', 'Navegação interativa'],
      status: ['Aba 3 · verificação', 'Status', 'Servidor HTTP respondendo. Página pronta para screenshots individuais e para compartilhar o diretório de evidências com outra thread.', 'Tudo pronto para captura']
    }
    const tabs = [...document.querySelectorAll('[role="tab"]')]
    function activate(tab, moveFocus = false) {
      const key = tab.id.replace('tab-', '')
      for (const item of tabs) { const selected = item === tab; item.setAttribute('aria-selected', String(selected)); item.tabIndex = selected ? 0 : -1 }
      document.querySelector('#panel').setAttribute('aria-labelledby', tab.id)
      const [eyebrow, heading, description, badge] = content[key]
      document.querySelector('#eyebrow').textContent = eyebrow
      document.querySelector('#heading').textContent = heading
      document.querySelector('#description').textContent = description
      document.querySelector('#badge').textContent = badge
      if (moveFocus) tab.focus()
    }
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => activate(tab))
      tab.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length
        activate(tabs[next], true)
      })
    })
  </script>
</body>
</html>`

createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify({ ok: true, port }))
    return
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  response.end(page)
}).listen(port, '127.0.0.1', () => console.log(`Web Preview test running at http://127.0.0.1:${port}`))
