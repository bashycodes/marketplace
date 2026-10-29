#!/usr/bin/env bash
# Watch the phone's hardware buttons for the user's stop gesture.
#
# Usage:
#   stop_watch.sh start <transport_id>   # (re)start watching; adb_connect.sh does this
#   stop_watch.sh status                 # watching | not running | unavailable
#   stop_watch.sh stop                   # stop watching, when done with the phone
#
# Stop gesture: a power press, or volume up-down-up-down within 3 seconds.
# Either cancels what Claude is doing on the phone: it kills the running phone
# commands and writes the cancel file, so the PreToolUse hook (stop_hook.sh)
# refuses the next phone command once, telling Claude why. Nothing stays
# blocked.
#
# Env:
#   AWD_STATE_DIR  where the watcher's state lives
#                  (default ${XDG_RUNTIME_DIR:-$HOME/.cache}/android-wireless-debug)
set -uo pipefail

STATE="${AWD_STATE_DIR:-${XDG_RUNTIME_DIR:-$HOME/.cache}/android-wireless-debug}"
say() { printf '%s\n' "$*" >&2; }

# A process's full command line. `ps -o args=` cuts it at $COLUMNS, and a hook
# can run with a narrow one; the plugin's install path alone can be wider.
proc_args() {
  if [ -r "/proc/$1/cmdline" ]; then tr '\0' ' ' < "/proc/$1/cmdline"
  else ps -ww -o args= -p "$1" 2>/dev/null; fi
}

write_cancel() {  # write_cancel <reason>
  mkdir -p "$STATE"
  # Written aside, then renamed, so the hook never reads half a file.
  printf 'reason=%s\ntime=%s\nepoch=%s\n' "$1" "$(date '+%H:%M:%S')" "$(date +%s)" > "$STATE/cancel.new.$$" \
    && mv -f "$STATE/cancel.new.$$" "$STATE/cancel"
}

# --- the background watcher ---------------------------------------------------
# Reads `getevent -lt` lines; prints the gesture name each time one completes.
# Only key-down events count. Volume needs UP, DOWN, UP, DOWN within 3 seconds;
# any other key-down breaks the sequence. Older presses never arrive: getevent
# has no history. (Don't filter on /proc/uptime: it counts deep sleep, event
# stamps don't, so it runs hours ahead and would discard every press.)
detect() {
  # mawk (Debian/Ubuntu's default awk) buffers piped input, so a press would
  # sit unread; -W interactive makes it read line by line.
  local awk=awk
  case "$(awk -W version 2>&1)" in *mawk*) awk="awk -W interactive" ;; esac
  $awk '
    function stamp() { match($0, /[0-9]+\.[0-9]+/); return substr($0, RSTART, RLENGTH) + 0 }
    { sub(/\r$/, "") }
    $NF != "DOWN" || $(NF-2) != "EV_KEY" { next }
    $(NF-1) == "KEY_POWER" { print "power"; fflush(); n = 0; next }
    $(NF-1) == "KEY_VOLUMEUP" || $(NF-1) == "KEY_VOLUMEDOWN" {
      # keep the last four volume presses: key[1..4], at[1..4]
      if (n == 4) { for (i = 1; i < 4; i++) { key[i] = key[i+1]; at[i] = at[i+1] }; n = 3 }
      n++; key[n] = ($(NF-1) == "KEY_VOLUMEUP") ? "U" : "D"; at[n] = stamp()
      if (n == 4 && key[1] key[2] key[3] key[4] == "UDUD" && at[4] - at[1] <= 3) {
        print "volume-sequence"; fflush(); n = 0
      }
      next
    }
    { n = 0 }'
}

# Kill this machine's adb commands still running against the phone, such as a
# batch of taps in one `adb shell`, so a stop does not wait for them to finish.
# A non-interactive shell that launched one (`bash -c`, as Claude's Bash tool
# runs commands) is killed first, so its later adb lines never start; an
# interactive terminal is left alone. The watcher's own stream is spared.
kill_in_flight() {
  local tid="$1" pid parent
  # Anchored on the program: adb itself (or a script run as adb), never a
  # process that merely mentions adb in its arguments.
  for pid in $(pgrep -f "^([^ ]+ )?([^ ]*/)?adb(\.exe)? (.* )?-t $tid (shell|exec-out)"); do
    proc_args "$pid" | grep -q 'getevent -lt' && continue
    parent=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')
    if [ -n "$parent" ] && proc_args "$parent" | grep -qE '^([^ ]*/)?(ba|da|z|k)?sh (-[a-z]+ )*-[a-z]*c '; then
      kill "$parent" 2>/dev/null
    fi
    kill "$pid" 2>/dev/null
  done
}

run() {  # run <state_dir> <transport_id> <device...>
  local tid="$2"; shift 2
  local reason dev script=""
  # getevent takes a single device, so run one per button device, all in one
  # adb shell: a single stream, and the touchscreen is never read. -tt gives
  # getevent a terminal, so it writes each event at once instead of holding
  # them in a pipe buffer until ~4 KB accumulate.
  for dev in "$@"; do script="$script getevent -lt $dev &"; done
  script="$script wait"
  echo $$ > "$STATE/watcher.pid"
  # Killed on its own (not via `stop`): take the adb stream down too, or it
  # would linger, still reading the phone's buttons.
  trap 'trap "" TERM; kill -TERM -- -$$ 2>/dev/null || kill_tree $$; exit 0' TERM
  while IFS= read -r reason; do
    write_cancel "$reason"
    kill_in_flight "$tid"
  done < <(adb -t "$tid" shell -tt "$script" </dev/null 2>/dev/null | detect)
  # The stream ended without `stop_watch.sh stop`: adb dropped or the phone
  # rebooted. adb_connect.sh starts a new watcher on reconnect.
  [ "$(cat "$STATE/watcher.pid" 2>/dev/null)" = "$$" ] && rm -f "$STATE/watcher.pid"
}

# Event devices that report a power or volume key, from `getevent -pl`.
# Touch devices are skipped even if they declare KEY_POWER (some
# double-tap-to-wake drivers do): their stream would carry every touch.
# Fails if the phone listed no input devices at all, i.e. it was not reached.
button_devices() {
  adb -t "$1" shell getevent -pl 2>/dev/null | tr -d '\r' | awk '
    function flush() { if (dev != "" && keys && !touch) print dev }
    /^add device/ { flush(); dev = $NF; keys = touch = 0; seen = 1; next }
    /KEY_POWER|KEY_VOLUMEUP|KEY_VOLUMEDOWN/ { keys = 1 }
    /ABS_MT_POSITION|BTN_TOUCH|INPUT_PROP_DIRECT|INPUT_PROP_POINTER/ { touch = 1 }
    END { flush(); exit !seen }'
}

start() {
  local tid="$1" devs
  stop
  mkdir -p "$STATE"
  rm -f "$STATE/unavailable"
  # 1.2.x's lasting stop and transport files are gone for good. A cancel too
  # old to report is dropped; a fresh one is kept, since Claude may reconnect
  # because the cancel killed its command, and must still hear of it.
  rm -f "$STATE/stop" "$STATE/transport"
  local epoch fresh=${AWD_CANCEL_FRESH:-60}
  epoch=$(sed -n 's/^epoch=//p' "$STATE/cancel" 2>/dev/null)
  case "$epoch" in ''|*[!0-9]*) epoch=0 ;; esac
  case "$fresh" in ''|*[!0-9]*) fresh=60 ;; esac
  [ $(( $(date +%s) - 10#$epoch )) -le "$fresh" ] || rm -f "$STATE/cancel"
  if ! devs=$(button_devices "$tid"); then
    say "could not list the phone's input devices over transport $tid; not watching."
    say "Phone commands stay refused until the watcher runs. Stop and tell the user."
    return 1
  fi
  if [ -z "$devs" ]; then
    : > "$STATE/unavailable"
    say "unavailable: no power or volume input devices found on this phone."
    say "Tell the user they cannot cancel you from the phone this session."
    return 0
  fi
  # A watcher left on the phone by an earlier session would otherwise linger.
  adb -t "$tid" shell pkill -f "'getevent -lt'" >/dev/null 2>&1
  # Own process group, so `stop` takes adb and awk down with the watcher.
  if command -v setsid >/dev/null 2>&1; then
    setsid nohup bash "$0" _run "$STATE" "$tid" $devs >/dev/null 2>&1 < /dev/null &
  else
    nohup bash "$0" _run "$STATE" "$tid" $devs >/dev/null 2>&1 < /dev/null &
  fi
  echo $! > "$STATE/watcher.pid"
  say "power button, or volume up-down-up-down. Tell the user. (watching $devs)"
}

# A pid file can outlive its watcher and the pid be reused, so check that the
# process really is one.
is_watcher() { proc_args "$1" | grep -qF "stop_watch.sh _run $STATE "; }

kill_tree() {  # without setsid there is no group to kill: children first
  local child
  for child in $(pgrep -P "$1"); do kill_tree "$child"; done
  kill -TERM "$1" 2>/dev/null
}

stop() {
  local pid
  rm -f "$STATE/unavailable"
  pid=$(cat "$STATE/watcher.pid" 2>/dev/null)
  rm -f "$STATE/watcher.pid"
  if [ -n "$pid" ] && is_watcher "$pid"; then
    kill -TERM -- "-$pid" 2>/dev/null || kill_tree "$pid"
  fi
  # A watcher killed with SIGKILL runs no trap and leaves its pieces behind:
  # its process-substitution subshell, still running the adb stream. Sweep up
  # this state dir's leftovers by command line, and only this state dir's.
  for pid in $(pgrep -f 'stop_watch\.sh _run '); do
    proc_args "$pid" | grep -qF "stop_watch.sh _run $STATE " && kill_tree "$pid"
  done
  return 0
}

alive() {
  local pid
  pid=$(cat "$STATE/watcher.pid" 2>/dev/null) && is_watcher "$pid"
}

status() {
  if [ -f "$STATE/unavailable" ]; then echo "unavailable: no button devices on this phone"
  elif alive; then echo "watching"
  else echo "not running"; return 1
  fi
}

case "${1:-}" in
  start)  start "${2:?transport id}" ;;
  stop)   stop ;;
  status) status ;;
  _run)   shift; run "$@" ;;
  *)      sed -n '2,17p' "$0" >&2; exit 2 ;;
esac
