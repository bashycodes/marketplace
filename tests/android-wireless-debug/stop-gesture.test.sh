#!/usr/bin/env bash
# Tests for the android-wireless-debug stop gesture: the watcher (stop_watch.sh)
# fed by a fake adb that replays getevent captured on a Galaxy S25, and the
# PreToolUse hook (stop_hook.sh) deciding on Bash tool calls.
# No phone needed. Run: bash tests/android-wireless-debug/stop-gesture.test.sh
set -u
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
SCRIPTS=$ROOT/plugins/android-wireless-debug/skills/android-wireless-debug/scripts
FIX=$ROOT/tests/fixtures/android-wireless-debug

TMP=$(mktemp -d)
export AWD_STATE_DIR=$TMP/state FAKE_LOG=$TMP/adb.log
trap 'bash "$SCRIPTS/stop_watch.sh" stop >/dev/null 2>&1; rm -rf "$TMP"' EXIT

# Fake adb, first on PATH. getevent -pl lists the S25's devices; getevent -lt
# replays $FAKE_EVENTS, then holds the stream open while $FAKE_HOLD is set
# (a live phone) or ends it (a dropped connection).
mkdir -p "$TMP/bin"
cat > "$TMP/bin/adb" <<EOF
#!/usr/bin/env bash
echo "\$*" >> "\$FAKE_LOG"
case "\$*" in
  *pkill*)           ;;
  *"getevent -pl"*)  cat "\${FAKE_PL:-$FIX/getevent-pl.txt}" ;;
  *"getevent -lt"*)  # like the real one: getevent takes a single device
                     for seg in \$(echo "\$*" | sed 's/&/\\n/g' | tr ' ' '_'); do
                       [ "\$(grep -o /dev/input/ <<<"\$seg" | wc -l)" -gt 1 ] && { echo "Usage: getevent ... [device]"; exit 1; }
                     done
                     sleep "\${FAKE_DELAY:-0}"
                     # -tt: a terminal, so lines end in CRLF, as from a real phone
                     [ -n "\${FAKE_EVENTS:-}" ] && cat \$FAKE_EVENTS | sed 's/\$/\r/' 
                     if [ -n "\${FAKE_HOLD:-}" ]; then
                       trap 'kill \$! 2>/dev/null; exit 143' TERM; sleep 600 & wait
                     fi ;;
  *"input tap"*)     trap 'kill \$! 2>/dev/null; exit 143' TERM
                     sleep 30 & wait ;;   # a long on-device batch
  *"/proc/uptime"*)  echo "\${FAKE_UPTIME:-57650.00} 1000.00" ;;
esac
exit 0
EOF
chmod +x "$TMP/bin/adb"
# mawk (Debian/Ubuntu's default awk) buffers piped input; when installed, make
# it the plain `awk` so the watcher is tested against it.
command -v mawk >/dev/null 2>&1 && ln -s "$(command -v mawk)" "$TMP/bin/awk"
export PATH="$TMP/bin:$PATH"

fails=0
TAP='adb -t 28 shell input tap 1 1'   # a command that acts on the phone
check() {  # check <description> <expected> <actual>
  if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected [$2], got [$3]"; fails=$((fails+1)); fi
}
watch_() { bash "$SCRIPTS/stop_watch.sh" "$@" >/dev/null 2>&1; }
# hook <command>: the hook's decision for a Bash call: allow, or deny:<reason>.
hook() {  # hook <command> [session_id]
  local out
  out=$(jq -n --arg c "$1" --arg s "${2:-s1}" '{session_id:$s,tool_name:"Bash",tool_input:{command:$c}}' | bash "$SCRIPTS/stop_hook.sh")
  [ -z "$out" ] && { echo allow; return; }
  echo "$(jq -r .hookSpecificOutput.permissionDecision <<<"$out"):$(jq -r .hookSpecificOutput.permissionDecisionReason <<<"$out")"
}
decision() { hook "$1" | cut -d: -f1; }
# settle: let the background watcher drain its input before asserting.
settle() { sleep "${1:-0.6}"; }
start() {  # start <fixture...>: a fresh session on a live phone replaying fixtures
  watch_ stop; rm -rf "$AWD_STATE_DIR"
  FAKE_HOLD=1 FAKE_EVENTS="$*" watch_ start 28; settle
}

start "$FIX/power.txt"
check "power press stops adb"            deny "$(decision 'adb -t 28 shell input tap 1 1')"
check "reason names the power press"      yes  "$(hook "$TAP" | grep -q 'power button' && echo yes)"

start "$FIX/power.txt" "$FIX/volume-sequence.txt" "$FIX/touch-and-wake.txt"
check "a stop keeps its first reason"       yes  "$(bash "$SCRIPTS/stop_watch.sh" status 2>&1 | grep -q 'stopped: power' && echo yes)"

start
check "no presses: adb allowed"          allow "$(decision 'adb -t 28 shell input tap 1 1')"
# ps truncates args= to $COLUMNS, and the watcher's command line (the long
# plugin cache path) is wider than a hook's narrow COLUMNS.
check "narrow COLUMNS: adb allowed"      allow "$(COLUMNS=40 decision "$TAP")"
check "narrow COLUMNS: status watching"   yes  "$(COLUMNS=40 bash "$SCRIPTS/stop_watch.sh" status 2>&1 | grep -q '^watching' && echo yes)"

start "$FIX/volume-sequence.txt"
check "volume up-down-up-down stops adb"  deny "$(decision 'adb -t 28 shell input tap 1 1')"
check "reason names the volume sequence"  yes  "$(hook "$TAP" | grep -q 'volume' && echo yes)"

# Variants of the real volume capture.
VOL=$FIX/volume-sequence.txt
awk '{ if (match($0, /[0-9]+\.[0-9]+/)) { t = substr($0, RSTART, RLENGTH); $0 = substr($0, 1, RSTART-1) sprintf("%.6f", 57650 + (t - 57650) * 3) substr($0, RSTART+RLENGTH) } print }' \
  "$VOL" > "$TMP/slow.txt"                                             # spread over ~4.1s
sed -e 's/KEY_VOLUMEUP/KEY_VOLUMEXX/; s/KEY_VOLUMEDOWN/KEY_VOLUMEUP/; s/KEY_VOLUMEXX/KEY_VOLUMEDOWN/' "$VOL" > "$TMP/reversed.txt"  # down-up-down-up
grep -m1 -B0 'KEY_VOLUMEUP .*DOWN' "$VOL" > "$TMP/single.txt"

for f in slow reversed single; do
  start "$TMP/$f.txt"
  check "volume $f: adb allowed"         allow "$(decision 'adb -t 28 shell input tap 1 1')"
done
start "$FIX/touch-and-wake.txt"
check "touches and wake taps: adb allowed" allow "$(decision 'adb -t 28 shell input tap 1 1')"

# Which commands the hook covers, while stopped.
start "$FIX/power.txt"
check "stopped: non-adb commands allowed"  allow "$(decision 'git status')"
check "stopped: \$D batches refused"        deny "$(decision 'D="adb -t 28"; $D shell input tap 1 1')"
check "stopped: ui_find.sh refused"         deny "$(decision 'scripts/ui_find.sh 28 "Settings"')"
check "stopped: adb_connect.sh allowed"    allow "$(decision 'bash scripts/adb_connect.sh')"
check "stopped: stop_watch.sh allowed"     allow "$(decision 'scripts/stop_watch.sh status')"
check "stopped: connect then adb refused"   deny "$(decision 'scripts/adb_connect.sh && adb -t 28 shell input tap 1 1')"
check "stopped: deleting the stop file refused" deny "$(decision "rm -f $AWD_STATE_DIR/stop")"
check "stopped: running this test suite allowed" allow "$(decision 'bash tests/android-wireless-debug/stop-gesture.test.sh')"
check "stopped: adb disconnect allowed"    allow "$(decision 'adb disconnect 100.115.101.104:54321')"
check "stopped: adb devices allowed"       allow "$(decision 'adb devices -l')"
check "stopped: disconnect then tap refused" deny "$(decision 'adb disconnect x; adb -t 28 shell input tap 1 1')"
check "status says volume-sequence"         yes  "$(start "$FIX/volume-sequence.txt"; bash "$SCRIPTS/stop_watch.sh" status 2>&1 | grep -q 'volume-sequence' && echo yes)"
start
check "deleting the state dir refused"     deny "$(decision 'rm -rf ~/.cache/android-wireless-debug')"
check "deleting the state dir via XDG refused" deny "$(decision 'rm -rf "${XDG_RUNTIME_DIR}/android-wireless-debug"')"
check "deleting the real state dir refused" deny "$(decision "rm -rf $AWD_STATE_DIR")"
start "$FIX/power.txt"
for c in './gradlew installDebug' './gradlew connectedDebugAndroidTest' 'scrcpy -s 100.1.2.3:54321' \
         'flutter run -d 100.1.2.3:54321' 'fastboot reboot' 'npx react-native run-android' 'npx expo run:android'; do
  check "stopped: $c refused"              deny "$(decision "$c")"
done
check "stopped: gradle build allowed"      allow "$(decision './gradlew assembleDebug')"
start
check "plugin paths and names still fine"  allow "$(decision 'cat plugins/android-wireless-debug/README.md; git commit -m "android-wireless-debug 1.2.0"')"
check "watching: deleting the stop file refused" deny "$(decision 'rm ~/.cache/android-wireless-debug/stop')"

# A stop cuts short a batch that is already running.
watch_ stop; rm -rf "$AWD_STATE_DIR"
FAKE_HOLD=1 FAKE_DELAY=1.5 FAKE_EVENTS="$FIX/power.txt" watch_ start 28
adb -t 28 shell 'input tap 1 1; sleep 0.5; input tap 2 2' & batch=$!
bash -c 'sleep 5; : adb -t 28 shell input tap 1 1' & bystander=$!   # only mentions adb
settle 2.5
check "stop spares non-adb processes"      alive "$(kill -0 $bystander 2>/dev/null && echo alive || echo dead)"
kill $bystander 2>/dev/null
check "stop kills the running batch"        dead "$(kill -0 $batch 2>/dev/null && echo alive || echo dead)"
check "stop spares the watcher itself"      yes  "$(kill -0 "$(cat "$AWD_STATE_DIR/watcher.pid")" 2>/dev/null && echo yes)"
kill $batch 2>/dev/null

# A stop also ends the script that sent the batch, so its later adb lines
# never run.
watch_ stop; rm -rf "$AWD_STATE_DIR"; : > "$FAKE_LOG"
FAKE_HOLD=1 FAKE_DELAY=1.5 FAKE_EVENTS="$FIX/power.txt" watch_ start 28
bash -c 'adb -t 28 shell input tap 1 1; adb -t 28 shell input text after-stop' & script=$!
settle 2.5
check "stop ends the rest of the script"    none "$(grep -q 'after-stop' "$FAKE_LOG" && echo ran || echo none)"
kill $script 2>/dev/null

# /proc/uptime counts deep sleep and getevent's clock does not, so on a real
# phone uptime runs far ahead of event stamps (S25: 83567 vs ~60499).
# Presses must still count.
FAKE_UPTIME=83567.29 start "$FIX/power.txt"
check "uptime ahead of the event clock: power still stops" deny "$(decision "$TAP")"

# Fail closed: no live watcher means no adb.
watch_ stop; rm -rf "$AWD_STATE_DIR"
check "never started: adb refused"          deny "$(decision 'adb -t 28 shell input tap 1 1')"
check "never started: reason says connect"  yes  "$(hook "$TAP" | grep -q 'adb_connect.sh' && echo yes)"
start; watch_ stop
check "after stop_watch.sh stop: adb refused" deny "$(decision "$TAP")"
start; kill "$(cat "$AWD_STATE_DIR/watcher.pid")"; settle 0.3
check "watcher killed: adb refused"         deny "$(decision "$TAP")"
watch_ stop; rm -rf "$AWD_STATE_DIR"; FAKE_EVENTS= watch_ start 28; settle
check "stream ended: adb refused"           deny "$(decision "$TAP")"
check "stream ended: reason says lost"      yes  "$(hook "$TAP" | grep -q 'lost' && echo yes)"

# A phone without power/volume input devices: no gesture, but not locked out.
watch_ stop; rm -rf "$AWD_STATE_DIR"
grep -v -E 'KEY_POWER|KEY_VOLUME' "$FIX/getevent-pl.txt" > "$TMP/no-buttons.txt"
out=$(FAKE_PL=$TMP/no-buttons.txt FAKE_HOLD=1 bash "$SCRIPTS/stop_watch.sh" start 28 2>&1); settle
check "no buttons: start says unavailable"  yes  "$(grep -qi 'unavailable' <<<"$out" && echo yes)"
check "no buttons: adb allowed"            allow "$(decision 'adb -t 28 shell input tap 1 1')"
watch_ stop
check "no buttons, after stop: adb refused" deny "$(decision 'adb -t 28 shell input tap 1 1')"

# A stale pid file whose pid now belongs to an unrelated process.
start; watch_ stop; sleep 60 & other=$!; echo $other > "$AWD_STATE_DIR/watcher.pid"
check "reused pid: adb refused"             deny "$(decision 'adb -t 28 shell input tap 1 1')"
watch_ stop
check "reused pid: stop spares that process" alive "$(kill -0 $other 2>/dev/null && echo alive || echo dead)"
kill $other 2>/dev/null

# Phone unreachable while starting: an empty device list is not "no buttons".
watch_ stop; rm -rf "$AWD_STATE_DIR"
FAKE_PL=/dev/null watch_ start 28; settle
check "unreachable phone: adb refused"      deny "$(decision "$TAP")"

# Some touchscreens declare KEY_POWER (double-tap-to-wake drivers). They must
# never be watched: their stream would carry every touch.
watch_ stop; rm -rf "$AWD_STATE_DIR"; : > "$FAKE_LOG"
sed 's/KEY_WAKEUP/KEY_POWER /' "$FIX/getevent-pl.txt" > "$TMP/touch-power.txt"
FAKE_PL=$TMP/touch-power.txt FAKE_HOLD=1 watch_ start 28; settle
check "touchscreen with KEY_POWER not watched" none "$(grep 'getevent -lt' "$FAKE_LOG" | grep -oE 'event[78]' | head -1 | grep . || echo none)"
check "button devices still watched"        yes  "$(grep 'getevent -lt' "$FAKE_LOG" | grep -q 'event3' && echo yes)"

# One watcher per state dir: stopping one leaves another session's alone.
start; other_state=$TMP/other-state
AWD_STATE_DIR=$other_state FAKE_HOLD=1 watch_ start 28; settle
watch_ stop; settle 0.3
check "stop spares another state dir's watcher" yes "$(AWD_STATE_DIR=$other_state bash "$SCRIPTS/stop_watch.sh" status 2>&1 | grep -q '^watching' && echo yes)"
AWD_STATE_DIR=$other_state watch_ stop

# Session end stops the watcher, but only for the session that connected.
start; hook 'bash scripts/adb_connect.sh' sess-A >/dev/null
end_session() { jq -n --arg s "$1" '{session_id:$s,hook_event_name:"SessionEnd"}' | bash "$SCRIPTS/stop_hook.sh" session-end; settle 0.3; }
end_session sess-B
check "another session ending: still watching" yes "$(bash "$SCRIPTS/stop_watch.sh" status 2>&1 | grep -q '^watching' && echo yes)"
end_session sess-A
check "connecting session ending: watcher stopped" yes "$(bash "$SCRIPTS/stop_watch.sh" status 2>&1 | grep -q '^not running' && echo yes)"

# Lifecycle: status, resume, reconnect, stop.
start "$FIX/power.txt"
check "status names the stop"               yes  "$(bash "$SCRIPTS/stop_watch.sh" status 2>&1 | grep -q 'stopped.*power' && echo yes)"
FAKE_HOLD=1 watch_ start 28; settle
check "reconnect keeps the user's stop"     deny "$(decision "$TAP")"
watch_ resume; settle
check "resume hands control back"          allow "$(decision "$TAP")"
check "status after resume: watching"       yes  "$(bash "$SCRIPTS/stop_watch.sh" status 2>&1 | grep -q '^watching' && echo yes)"

watch_ stop; rm -rf "$AWD_STATE_DIR"; FAKE_EVENTS= watch_ start 28; settle
FAKE_HOLD=1 watch_ resume; settle
check "resume after a lost stream restarts the watcher" allow "$(decision "$TAP")"
watch_ stop; rm -rf "$AWD_STATE_DIR"; FAKE_EVENTS= watch_ start 28; settle
FAKE_HOLD=1 watch_ start 28; settle
check "reconnect clears a lost-stream stop" allow "$(decision "$TAP")"

start; kill -9 "$(cat "$AWD_STATE_DIR/watcher.pid")"; settle 0.3   # SIGKILL: no trap runs
check "SIGKILLed watcher: adb refused"      deny "$(decision "$TAP")"
watch_ stop; settle 0.3
check "stop leaves nothing running"         0    "$(pgrep -f "_run $AWD_STATE_DIR |$TMP/bin/adb" | wc -l | tr -d ' ')"

echo; [ $fails -eq 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
