// Shared by the frozen F3 SECURITY tests (h1-secret-leaks, h1-secret-sweep). Written by the planner; the executor must
// not edit it. Every planted secret is a unique SKnn marker.
/** Each case: the command, its shell, and the secrets that must appear nowhere in what is kept. */
export const LEAK_CASES: Array<{ name: string; shell: 'bash' | 'powershell'; command: string; secrets: string[] }> = [
  // S1 — body values
  { name: 'S1 curl -d', shell: 'bash', command: "curl -d 'password=SK01hunter2' https://a.test/login", secrets: ['SK01hunter2'] },
  { name: 'S1 curl --data-raw', shell: 'bash', command: `curl --data-raw '{"pw":"SK02raw"}' https://a.test/x`, secrets: ['SK02raw'] },
  { name: 'S1 curl --data-binary', shell: 'bash', command: "curl --data-binary 'SK03bin' https://a.test/x", secrets: ['SK03bin'] },
  { name: 'S1 curl --data-urlencode', shell: 'bash', command: "curl --data-urlencode 'q=SK04enc' https://a.test/s", secrets: ['SK04enc'] },
  { name: 'S1 curl --json', shell: 'bash', command: `curl --json '{"k":"SK05json"}' https://a.test/j`, secrets: ['SK05json'] },
  { name: 'S1 curl -F', shell: 'bash', command: "curl -F 'token=SK06form' -F 'file=@/home/me/SK07secret.txt' https://a.test/up", secrets: ['SK06form', 'SK07secret'] },
  { name: 'S1 HTTPie items', shell: 'bash', command: 'http POST https://a.test/x pw=SK08field n:=SK09json', secrets: ['SK08field', 'SK09json'] },
  { name: 'S1 Invoke-RestMethod -Body', shell: 'powershell', command: "Invoke-RestMethod -Uri https://a.test/x -Method Post -Body 'SK10body'", secrets: ['SK10body'] },
  // S2 — credential flags
  { name: 'S2 curl -u', shell: 'bash', command: 'curl -u admin:SK11pass https://a.test/x', secrets: ['SK11pass'] },
  { name: 'S2 curl --user', shell: 'bash', command: 'curl --user admin:SK12pass https://a.test/x', secrets: ['SK12pass'] },
  { name: 'S2 curl --oauth2-bearer', shell: 'bash', command: 'curl --oauth2-bearer SK13bearer https://a.test/x', secrets: ['SK13bearer'] },
  { name: 'S2 curl -b', shell: 'bash', command: "curl -b 'session=SK14cookie' https://a.test/x", secrets: ['SK14cookie'] },
  { name: 'S2 curl -E', shell: 'bash', command: 'curl -E client.pem:SK15certpass https://a.test/x', secrets: ['SK15certpass'] },
  { name: 'S2 curl --proxy-user', shell: 'bash', command: 'curl --proxy-user me:SK16proxy https://a.test/x', secrets: ['SK16proxy'] },
  { name: 'S2 wget --password', shell: 'bash', command: 'wget --password=SK17pw https://a.test/f', secrets: ['SK17pw'] },
  { name: 'S2 wget --http-password', shell: 'bash', command: 'wget --http-password SK18pw https://a.test/f', secrets: ['SK18pw'] },
  { name: 'S2 wget --header', shell: 'bash', command: "wget --header 'X-Api-Key: SK19hdr' https://a.test/f", secrets: ['SK19hdr'] },
  { name: 'S2 HTTPie -a', shell: 'bash', command: 'http -a me:SK20pass https://a.test/x', secrets: ['SK20pass'] },
  { name: 'S2 HTTPie header item', shell: 'bash', command: 'http https://a.test/x X-Token:SK21hdr', secrets: ['SK21hdr'] },
  { name: 'S2 Invoke-WebRequest -Token -Headers', shell: 'powershell', command: "Invoke-WebRequest https://a.test/x -Credential $cred -Token SK22tok -Headers @{ 'X-Api-Key' = 'SK23hv'; Accept = 'application/json' }", secrets: ['SK22tok', 'SK23hv'] },
  // S3 — URL userinfo
  { name: 'S3 userinfo', shell: 'bash', command: 'curl https://user:SK24pass@a.test/x', secrets: ['SK24pass', 'user:'] },
  // S4 — secrets in the path
  { name: 'S4 Slack webhook', shell: 'bash', command: 'curl -X POST https://hooks.slack.com/services/T0ABCDEFG/B0ABCDEFG/SK25aBcDeFgHiJkLmNoP12', secrets: ['SK25aBcDeFgHiJkLmNoP12'] },
  { name: 'S4 Telegram bot token', shell: 'bash', command: 'curl https://api.telegram.org/bot123456789:AAHSK26xYzAbCdEfGhIjKlMn/sendMessage', secrets: ['AAHSK26xYzAbCdEfGhIjKlMn'] },
  { name: 'S4 key in the path', shell: 'bash', command: 'curl https://api.test/v1/keys/sk_live_SK27abcdefghijklmnop', secrets: ['sk_live_SK27abcdefghijklmnop'] },
  // S6 — inline environment secrets
  { name: 'S6 prefix assignment', shell: 'bash', command: 'TOKEN=SK28env curl https://a.test/x', secrets: ['SK28env'] },
  { name: 'S6 export before', shell: 'bash', command: 'export API_KEY=SK29exp && curl https://a.test/x', secrets: ['SK29exp'] },
  // Headers, for completeness
  { name: 'header value', shell: 'bash', command: "curl -H 'X-Signature: SK30sig' -H 'Authorization: Bearer SK31bearer' https://a.test/x", secrets: ['SK30sig', 'SK31bearer'] }
]
