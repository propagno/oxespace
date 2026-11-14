set +e
# OXE-154: repeat e2e/agent-state-hook.spec.ts, once plain and once under CPU load (busy loops).
for v in $(env | grep -o '^OXESPACE_[A-Z_]*'); do unset "$v"; done
SPEC=e2e/agent-state-hook.spec.ts
RUNS=${RUNS:-20}
n=$(nproc 2>/dev/null || echo "${NUMBER_OF_PROCESSORS:-2}")
load=$((n * ${LOAD_FACTOR:-2}))
echo "os=$(uname -s) cpus=$n busy-loops=$load runs=$RUNS head=$(git rev-parse --short HEAD 2>/dev/null)"
git log -1 --format='%H %s' 2>/dev/null

step() { echo "--- $1"; shift; "$@" > step.log 2>&1; c=$?; if [ $c -ne 0 ]; then tail -60 step.log; echo "setup step failed ($c)"; exit 3; fi; }
step "rebuild:native:node" npm run rebuild:native:node
step "build" npm run build
step "fix:native" npm run fix:native
step "verify:native" npm run verify:native

pw() {
  label=$1
  npx playwright test "$SPEC" --repeat-each="$RUNS" --workers=1 --reporter=list > "pw-$label.raw" 2>&1
  code=$?
  sed 's/\x1b\[[0-9;]*m//g' "pw-$label.raw" > "pw-$label.log"
  echo "===== $label (exit $code)"
  grep -E '^\s+(✓|✘|-)\s' "pw-$label.log" | sed -E 's/ › the agent-state hook.*\(/ (/'
  grep -E '^\s+[0-9]+ (passed|failed|flaky|skipped)' "pw-$label.log"
  # Each failure: the diff lines of the received object.
  grep -nE '^\s+[0-9]+\) |^\s+[-+]\s+"state"|Timeout .* exceeded|^\s+> [0-9]+ \|' "pw-$label.log" | head -80
  pass=$(grep -cE '^\s+✓\s' "pw-$label.log"); fail=$(grep -cE '^\s+✘\s' "pw-$label.log")
  echo "SUMMARY $label: pass=$pass fail=$fail of $RUNS"
  return $code
}

pw plain; p=$?
pids=""
for i in $(seq 1 $load); do ( while :; do :; done ) & pids="$pids $!"; done
sleep 2
pw load; l=$?
kill $pids 2>/dev/null
echo "EXIT plain=$p load=$l"
[ $p -eq 0 ] && [ $l -eq 0 ]
