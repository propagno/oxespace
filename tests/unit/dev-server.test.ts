import { describe, expect, test } from 'vitest'
import { detectDevServers, launchAutoVerify, packageManagerFor, stripJsonComments, urlFromOutput } from '../../shared/dev-server'

const pkg = (scripts: Record<string, string>, deps: Record<string, string> = {}): string => JSON.stringify({ name: 'shop', scripts, devDependencies: deps })

describe('detectDevServers: what to run so the page is up', () => {
  test('a Vite project: the dev script, on the port Vite uses', () => {
    expect(detectDevServers({ packageJson: pkg({ dev: 'vite', build: 'vite build', preview: 'vite preview' }, { vite: '^6.0.0' }) })).toEqual([
      { id: 'package:dev', name: 'dev', command: 'npm run dev', cwd: null, port: 5173, url: 'http://localhost:5173', origin: 'package' },
      { id: 'package:preview', name: 'preview', command: 'npm run preview', cwd: null, port: 5173, url: 'http://localhost:5173', origin: 'package' }
    ])
  })

  test('the port a script names wins over the tool default', () => {
    expect(detectDevServers({ packageJson: pkg({ dev: 'next dev -p 4000' }, { next: '15' }) })[0]).toMatchObject({ port: 4000, url: 'http://localhost:4000' })
    expect(detectDevServers({ packageJson: pkg({ dev: 'cross-env PORT=8123 node server.js' }) })[0]).toMatchObject({ port: 8123 })
    expect(detectDevServers({ packageJson: pkg({ dev: 'astro dev --port=4400' }, { astro: '5' }) })[0]).toMatchObject({ port: 4400 })
  })

  test('the tool is read from the script, then from the dependencies, then 3000', () => {
    expect(detectDevServers({ packageJson: pkg({ dev: 'ng serve' }, { '@angular/cli': '19' }) })[0].port).toBe(4200)
    expect(detectDevServers({ packageJson: pkg({ dev: 'node scripts/dev.mjs' }, { astro: '5' }) })[0].port).toBe(4321)
    expect(detectDevServers({ packageJson: pkg({ dev: 'node server.js' }) })[0].port).toBe(3000)
    expect(detectDevServers({ packageJson: pkg({ storybook: 'storybook dev' }) })[0]).toMatchObject({ id: 'package:storybook', port: 6006 })
  })

  test('"start" is offered only when there is no dev script', () => {
    expect(detectDevServers({ packageJson: pkg({ start: 'react-scripts start' }, { 'react-scripts': '5' }) }).map(item => item.name)).toEqual(['start'])
    expect(detectDevServers({ packageJson: pkg({ dev: 'vite', start: 'node dist/server.js' }) }).map(item => item.name)).toEqual(['dev'])
  })

  test('the package manager of the project runs it', () => {
    expect(detectDevServers({ packageJson: pkg({ dev: 'vite' }), packageManager: 'pnpm' })[0].command).toBe('pnpm run dev')
    expect(detectDevServers({ packageJson: pkg({ dev: 'vite' }), packageManager: 'bun' })[0].command).toBe('bun run dev')
    expect(packageManagerFor(['README.md', 'pnpm-lock.yaml'])).toBe('pnpm')
    expect(packageManagerFor(['yarn.lock'])).toBe('yarn')
    expect(packageManagerFor(['bun.lockb'])).toBe('bun')
    expect(packageManagerFor(['package-lock.json'])).toBe('npm')
  })

  test('the launch file comes first, with its folder, port and arguments', () => {
    const launchJson = `{
      // written by Claude Code
      "version": "0.0.1",
      "autoVerify": false,
      "configurations": [
        { "name": "web", "runtimeExecutable": "npm", "runtimeArgs": ["run", "dev", "--", "--host", "my host"], "port": 5180, "cwd": "apps/web", },
        { "name": "api", "program": "server/index.js", "args": ["--watch"], "port": 4000 },
        { "name": "already running", "url": "http://localhost:9000/app" },
      ]
    }`
    expect(detectDevServers({ launchJson, packageJson: pkg({ dev: 'vite' }) })).toEqual([
      { id: 'launch:web', name: 'web', command: 'npm run dev -- --host "my host"', cwd: 'apps/web', port: 5180, url: 'http://localhost:5180', origin: 'launch' },
      { id: 'launch:api', name: 'api', command: 'node server/index.js --watch', cwd: null, port: 4000, url: 'http://localhost:4000', origin: 'launch' },
      { id: 'launch:already running', name: 'already running', command: null, cwd: null, port: null, url: 'http://localhost:9000/app', origin: 'launch' },
      { id: 'package:dev', name: 'dev', command: 'npm run dev', cwd: null, port: 5173, url: 'http://localhost:5173', origin: 'package' }
    ])
    expect(launchAutoVerify(launchJson)).toBe(false)
    expect(launchAutoVerify('{ "configurations": [] }')).toBe(true)
    expect(launchAutoVerify(null)).toBeNull()
  })

  test('a launch file of a repository cannot leave the project or this machine', () => {
    const launchJson = JSON.stringify({ configurations: [
      { name: 'up', runtimeExecutable: 'npm', cwd: '../other' },
      { name: 'abs', runtimeExecutable: 'npm', cwd: 'C:\\Windows' },
      { name: 'elsewhere', url: 'https://example.com/login' },
      { name: 'both', runtimeExecutable: 'npm', url: 'https://evil.example/', port: 3100 },
      { runtimeExecutable: 'npm' },
      'nonsense'
    ] })
    expect(detectDevServers({ launchJson })).toEqual([
      { id: 'launch:up', name: 'up', command: 'npm', cwd: null, port: 3000, url: 'http://localhost:3000', origin: 'launch' },
      { id: 'launch:abs', name: 'abs', command: 'npm', cwd: null, port: 3000, url: 'http://localhost:3000', origin: 'launch' },
      { id: 'launch:both', name: 'both', command: 'npm', cwd: null, port: 3100, url: 'http://localhost:3100', origin: 'launch' }
    ])
  })

  test('nothing to read, nothing offered', () => {
    expect(detectDevServers({})).toEqual([])
    expect(detectDevServers({ packageJson: '{ not json', launchJson: '[]' })).toEqual([])
    expect(detectDevServers({ packageJson: pkg({ build: 'tsc', test: 'vitest' }) })).toEqual([])
  })
})

describe('small pieces', () => {
  test('comments and trailing commas leave, strings stay', () => {
    expect(JSON.parse(stripJsonComments('{ "a": "http://x // not a comment", /* gone */ "b": [1, 2,], }'))).toEqual({ a: 'http://x // not a comment', b: [1, 2] })
  })

  test('the address a server prints', () => {
    expect(urlFromOutput('  VITE v6.0.1  ready in 312 ms\n\n  \u001b[32m➜\u001b[39m  \u001b[1mLocal\u001b[22m:   \u001b[36mhttp://localhost:\u001b[1m5174\u001b[22m/\u001b[39m\n  ➜  Network: http://192.168.0.12:5174/')).toBe('http://localhost:5174/')
    expect(urlFromOutput(' ⚠ Port 3000 is in use, trying 3001 instead.\n   - Local:        http://localhost:3001\n   - Network:      http://10.0.0.4:3001')).toBe('http://localhost:3001/')
    expect(urlFromOutput('Server running at http://0.0.0.0:8080/app.')).toBe('http://localhost:8080/app')
    expect(urlFromOutput('listening on https://127.0.0.1:8443, press Ctrl+C')).toBe('https://127.0.0.1:8443/')
    expect(urlFromOutput('compiled successfully\nwaiting for changes')).toBeNull()
    expect(urlFromOutput('see http://192.168.1.2:3000 or https://example.com')).toBeNull()
  })
})
