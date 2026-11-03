#!/bin/sh
# Phone RC pass on the oxespace-test emulator (G5, decision 10): one phase per call, following
# docs/validation/mobile-avd-rc-pass.md. Runs ONLY after the user's OK on decision 10.
#
#   RC_ROOT=dir OUT=dir APK=path sh scripts/android/avd-rc-pass.sh pair      boot, install, pair through the file protocol
#   RC_ROOT=dir OUT=dir STEPS=file sh scripts/android/avd-rc-pass.sh script  adb lines from a file, a shot after each
#     (steps: sleep N | tap Text | tap? Text | type Some text | an adb shell line; RC_TEMP_PIN=pin is cleared at the end)
#   RC_ROOT=dir OUT=dir sh scripts/android/avd-rc-pass.sh preflight          only the memory check; no emulator
#
# Memory: a phase doesn't boot with less than 4 GB free (about 3 GB for qemu plus the team's 1 GB floor), and stops at
# the next step (each shot and each 2 s of a wait) once free memory drops under 1 GB: fail.txt says "memory", and the
# emulator is shut down as on any failure.
#
# Run it inside the machine-wide heavy lock, in the foreground:
#   node "$TEMP/oxespace-heavy-lock.mjs" --owner mobile-rc -- sh scripts/android/avd-rc-pass.sh pair
#
# The file protocol (one shared folder per pass, each file written once):
#   avd-ready      MOBILE: emulator booted, app installed (holds the options used)
#   pair-link.txt  HOMOLOGATION: the oxespace://pair?... link the desktop's QR encodes
#   phone-code.txt MOBILE: the 6-character code the phone shows
#   done           MOBILE: the phone is connected and the evidence is saved
# A step waits at most 6 minutes for the file before it; on timeout fail.txt names the step. The emulator is always
# shut down at the end, failure included.
set -u
# Git Bash on Windows rewrites /sdcard/... into a host path; the phone-side paths must reach adb as written.
export MSYS_NO_PATHCONV=1
PHASE="${1:-}"
: "${RC_ROOT:?RC_ROOT: the shared folder of this pass}" "${OUT:?OUT: where the evidence goes}"
SDK="${ANDROID_SDK_ROOT:-${LOCALAPPDATA:-$HOME}/Android/Sdk}"
ADB="$SDK/platform-tools/adb"
# Every adb call is bounded: with the device gone, adb waits forever otherwise.
adbt() { timeout 60 "$ADB" "$@"; }
AVD=oxespace-test   # never Medium_Phone_API_36.0: that one belongs to the user
OPTIONS="-memory 1536 -no-snapshot-load -no-snapshot-save -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect"
WAIT_SECONDS=360
BOOT_FLOOR_MB=4096
RUN_FLOOR_MB=1024
mkdir -p "$RC_ROOT" "$OUT"

fail() { printf '%s\n' "$1" > "$RC_ROOT/fail.txt"; echo "fail: $1" >&2; }
# Free memory in MB, or nothing when it can't be read. RC_FAKE_FREE_MB stands in for it in tests.
free_mb() {
  if [ -n "${RC_FAKE_FREE_MB:-}" ]; then echo "$RC_FAKE_FREE_MB"; return; fi
  # Git Bash and Cygwin have a /proc/meminfo without MemAvailable: on Windows, ask Windows.
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) powershell.exe -NoProfile -Command '[math]::Floor((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1024)' 2>/dev/null | tr -d '\r'; return ;;
  esac
  [ -r /proc/meminfo ] && awk '/^MemAvailable:/ { a = int($2 / 1024) } /^MemFree:/ { f = int($2 / 1024) } END { print (a != "" ? a : f) }' /proc/meminfo
}
# Stops the phase when free memory is under `floor` MB. Unknown memory counts as enough: the lock still holds.
need_memory() {
  mb=$(free_mb)
  case "$mb" in ''|*[!0-9]*) return 0 ;; esac
  [ "$mb" -ge "$1" ] && return 0
  fail "memory: ${mb} MB free, ${1} MB needed"
  exit 1
}
shot() {
  need_memory "$RUN_FLOOR_MB"
  adbt exec-out screencap -p > "$OUT/$1.png" 2>/dev/null
  adbt shell uiautomator dump /sdcard/ui.xml > /dev/null 2>&1
  adbt exec-out cat /sdcard/ui.xml > "$OUT/$1.xml" 2>/dev/null
}
finish() {
  # Bounded: with no device, `adb logcat` waits forever, and a cleanup still waiting when the NEXT pass boots its
  # emulator would then `emu kill` that one (that is what killed two FOLLOW runs). Nothing here may outlive the pass.
  timeout 20 "$ADB" logcat -d -s 'OxeSpace:*' 'AndroidRuntime:E' > "$OUT/logcat.txt" 2>/dev/null
  # A temporary PIN a phase set (STEER) never outlives the pass, even when a step failed.
  [ -n "${RC_TEMP_PIN:-}" ] && timeout 20 "$ADB" shell locksettings clear --old "$RC_TEMP_PIN" > /dev/null 2>&1
  timeout 20 "$ADB" emu kill > /dev/null 2>&1
}
# Taps the first element whose text or content-desc contains $1 (a fresh UI dump), at the centre of its bounds.
tap_text() {
  adbt shell uiautomator dump /sdcard/ui.xml > /dev/null 2>&1
  adbt exec-out cat /sdcard/ui.xml > "$OUT/tap.xml" 2>/dev/null
  # awk, not grep -iF: Git Bash's grep aborts on a dump holding a typographic apostrophe ("Don’t allow").
  bounds=$(tr '>' '\n' < "$OUT/tap.xml" | awk -v k="$(printf %s "$1" | tr 'A-Z' 'a-z')" 'index(tolower($0), k) { print; exit }' | grep -oE 'bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' | head -1)
  [ -n "$bounds" ] || return 1
  set -- $(printf %s "$bounds" | grep -oE '[0-9]+')
  adbt shell input tap $(( ($1 + $3) / 2 )) $(( ($2 + $4) / 2 )) > /dev/null 2>&1
}
# Waits for a file of the protocol; 1 when it didn't come within WAIT_SECONDS.
wait_for() { i=0; while [ ! -s "$RC_ROOT/$1" ]; do need_memory "$RUN_FLOOR_MB"; i=$((i + 2)); [ "$i" -ge "$WAIT_SECONDS" ] && return 1; sleep 2; done; }
# Starts the app; extra arguments go to `am start` (a debug build reads pair_link and allow_capture, a release one ignores both).
start_app() { adbt shell am start -n com.oxespace.mobile/.MainActivity --ez allow_capture true "$@" > /dev/null; }

case "$PHASE" in pair|script|preflight) ;; *) echo "usage: avd-rc-pass.sh pair|script|preflight (see the header)" >&2; exit 2 ;; esac

# Before anything touches the emulator: enough memory to boot it, or no phase at all.
need_memory "$BOOT_FLOOR_MB"
[ "$PHASE" = preflight ] && { echo "memory: ok ($(free_mb) MB free)"; exit 0; }
trap finish EXIT INT TERM

# shellcheck disable=SC2086 # OPTIONS is a list of separate emulator flags
("$SDK/emulator/emulator" -avd "$AVD" $OPTIONS > "$OUT/emulator.log" 2>&1 &)
# Never hang if the emulator is gone (another adb client may shut it down): fail the boot step instead.
timeout 240 "$ADB" wait-for-device || { fail "boot: no device"; exit 1; }
for i in $(seq 1 150); do [ "$(adbt shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] && break; need_memory "$RUN_FLOOR_MB"; sleep 3; done
[ "$(adbt shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] || { fail "boot"; exit 1; }

case "$PHASE" in
  pair)
    : "${APK:?APK: the debug APK built from the RC commit}"
    adbt install -r "$APK" > "$OUT/install.log" 2>&1 || { fail "install"; exit 1; }
    start_app; sleep 6; shot 00-start
    echo "avd=$AVD $OPTIONS" > "$RC_ROOT/avd-ready"
    wait_for pair-link.txt || { fail "pair-link.txt"; exit 1; }
    # The link goes through the same checks as a scanned code: private address, fingerprint, one-time code.
    # adb shell hands its arguments to the phone's shell as one line, where "&" in the query would end the command:
    # the link travels single-quoted, so one with a quote or a space is refused instead.
    link=$(tr -d '\r\n' < "$RC_ROOT/pair-link.txt")
    case "$link" in oxespace://pair\?*) ;; *) fail "pair-link.txt: not an oxespace://pair link"; exit 1 ;; esac
    case "$link" in *"'"*|*' '*) fail "pair-link.txt: a quote or a space in the link"; exit 1 ;; esac
    start_app --es pair_link "'$link'"; sleep 5; shot 01-link
    code=""
    for i in $(seq 1 20); do
      shot "02-code-$i"
      code=$(grep -oE 'text="[A-Z0-9]{6}"' "$OUT/02-code-$i.xml" | head -1 | sed 's/text="//; s/"//')
      # The screen reads the code to TalkBack one character at a time: content-desc="Verification code C 9 B N W 5".
      [ -n "$code" ] || code=$(grep -oE 'content-desc="[^"]*([A-Z0-9] ){5}[A-Z0-9]"' "$OUT/02-code-$i.xml" | head -1 | grep -oE '([A-Z0-9] ){5}[A-Z0-9]"$' | tr -d ' "')
      [ -n "$code" ] && break; sleep 3
    done
    [ -n "$code" ] || { fail "phone-code"; exit 1; }
    printf %s "$code" > "$RC_ROOT/phone-code.txt"
    i=0
    # Paired and connected, the app opens its home: its tabs are the sign (en and pt-BR).
    until grep -qiE 'Conectado|Connected|Conversations|Conversas|Terminals|Terminais' "$OUT/03-wait.xml" 2>/dev/null; do
      i=$((i + 5)); [ "$i" -ge "$WAIT_SECONDS" ] && { fail "connected"; exit 1; }
      sleep 5; shot 03-wait
    done
    shot 04-connected
    : > "$RC_ROOT/done"
    ;;
  script)
    : "${STEPS:?STEPS: a file of adb shell lines; 'sleep N' lines wait}"
    start_app; sleep 8; shot step-00
    n=0
    while IFS= read -r line <&3; do
      case "$line" in ''|'#'*) continue ;; esac
      n=$((n + 1))
      case "$line" in
        sleep*) sleep "${line#sleep }" ;;
        'tap? '*) tap_text "${line#tap? }" || true ;;
        tap\ *) tap_text "${line#tap }" || { fail "step $n: no '${line#tap }' on screen"; exit 1; } ;;
        type\ *) adbt shell input text "$(printf %s "${line#type }" | sed 's/ /%s/g')" > /dev/null 2>&1 ;;
        *) adbt shell "$line" > /dev/null 2>&1 ;;
      esac
      sleep 3; shot "step-$(printf %02d "$n")"
    done 3< "$STEPS"  # fd 3: adb shell inside a step would read the steps from stdin
    : > "$RC_ROOT/done-${RC_PHASE_NAME:-script}"
    ;;
esac
