// A stdio MCP server for tests. Its tool list is read from the JSON file named by FAKE_MCP_TOOLS on every
// tools/list, so a test can change what the server says between two connections.
const { readFileSync } = require('node:fs')
let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  buffer += chunk
  let index
  while ((index = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (!line) continue
    const message = JSON.parse(line)
    if (message.id === undefined) continue
    const reply = result => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n')
    if (message.method === 'initialize') reply({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1.0.0' } })
    else if (message.method === 'tools/list') reply({ tools: JSON.parse(readFileSync(process.env.FAKE_MCP_TOOLS, 'utf8')) })
    else reply({})
  }
})
