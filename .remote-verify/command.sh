LOAD_FACTOR=1
set +e
for v in $(env | grep -o '^OXESPACE_[A-Z_]*'); do unset "$v"; done
FILE=tests/unit/oxequery-worker-client.test.ts
RUNS=${RUNS:-20}
n=$(nproc 2>/dev/null || echo "${NUMBER_OF_PROCESSORS:-2}")
load=$((n * ${LOAD_FACTOR:-4}))
tmpd="${RUNNER_TEMP:-/tmp}"
cat > "$tmpd/boot.cjs" <<'EOF'
const { Worker } = require('node:worker_threads')
const code = "const { parentPort } = require('node:worker_threads'); parentPort.on('message', m => parentPort.postMessage(m))"
async function once() {
  const t0 = performance.now()
  const w = new Worker(code, { eval: true })
  let online = 0
  w.once('online', () => { online = performance.now() - t0 })
  const reply = await new Promise(r => { w.once('message', () => r(performance.now() - t0)); w.postMessage(1) })
  await w.terminate()
  return [online, reply]
}
(async () => {
  const rows = []
  for (let i = 0; i < 40; i++) rows.push(await once())
  const pick = k => rows.map(r => r[k]).sort((a, b) => a - b)
  const f = a => `p50 ${a[20].toFixed(0)} p90 ${a[36].toFixed(0)} max ${a[39].toFixed(0)}`
  console.log(`${process.argv[2]}: new Worker -> online ms ${f(pick(0))}; -> first reply ms ${f(pick(1))}; first replies over 100 ms: ${rows.filter(r => r[1] > 100).length}/40`)
})()
EOF
echo "os=$(uname -s) cpus=$n busy-loops=$load runs=$RUNS file=$FILE head=$(git rev-parse --short HEAD 2>/dev/null)"
node "$tmpd/boot.cjs" idle
pids=""
for i in $(seq 1 $load); do ( while :; do :; done ) & pids="$pids $!"; done
sleep 2
node "$tmpd/boot.cjs" loaded
pass=0; fail=0; failedcases=0
for i in $(seq 1 "$RUNS"); do
  out=$(node scripts/test-electron.mjs "$FILE" 2>&1); code=$?
  clean=$(printf '%s\n' "$out" | sed 's/\x1b\[[0-9;]*m//g')
  if [ $code -eq 0 ]; then
    pass=$((pass + 1)); echo "run $i: pass"
  else
    fail=$((fail + 1))
    c=$(printf '%s\n' "$clean" | grep -cE '^ +× ')
    failedcases=$((failedcases + c))
    echo "run $i: FAIL ($c cases)"
    printf '%s\n' "$clean" | grep -E '^ +(×|✓) |^Error|Unhandled|^ +Tests ' | head -16
  fi
done
kill $pids 2>/dev/null
echo "SUMMARY pass=$pass fail=$fail of $RUNS runs; failed cases=$failedcases"
[ "$fail" -eq 0 ]
