#!/usr/bin/env bash
# Watch the phone's hardware buttons for the user's stop gesture.
#
# Usage:
#   stop_watch.sh start <transport_id>   # (re)start watching; adb_connect.sh does this
#   stop_watch.sh status                 # watching | stopped | not running | unavailable
#   stop_watch.sh resume                 # clear a stop -- only when the user says continue
#   stop_watch.sh stop                   # stop watching, when done with the phone
#
# Stop gesture: a power press, or volume up-down-up-down within 3 seconds.
# Either writes the stop file, which makes the PreToolUse hook (stop_hook.sh)
# refuse every adb command until `resume`.
#
# Env:
#   AWD_STATE_DIR  where the stop file lives
#                  (default ${XDG_RUNTIME_DIR:-$HOME/.cache}/android-wireless-debug)
set -uo pipefail

STATE="${AWD_STATE_DIR:-${XDG_RUNTIME_DIR:-$HOME/.cache}/android-wireless-debug}"
say() { printf '%s\n' "$*" >&2; }

write_stop() {  # write_stop <reason>
  mkdir -p "$STATE"
  printf 'reason=%s\ntime=%s\n' "$1" "$(date '+%H:%M:%S')" > "$STATE/stop"
}

# --- the background watcher ---------------------------------------------------
# Reads `getevent -lt` lines; prints the gesture name each time one completes.
# Only key-down events count. Volume needs UP, DOWN, UP, DOWN within 3 seconds;
# any other key-down breaks the sequence. Older presses never arrive: getevent
# has no history. (Don't filter on /proc/uptime: it counts deep sleep, event
# stamps don't, so it runs hours ahead and would discard every press.)
detect() {
  awk '
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
# The watcher's own getevent stream is spared.
kill_in_flight() {
  local tid="$1" pid
  # Anchored on the program: adb itself (or a script run as adb), never a
  # process that merely mentions adb in its arguments.
  for pid in $(pgrep -f "^([^ ]+ )?([^ ]*/)?adb(\.exe)? (.* )?-t $tid (shell|exec-out)"); do
    ps -o args= -p "$pid" 2>/dev/null | grep -q 'getevent -lt' || kill "$pid" 2>/dev/null
  done
}

run() {  # run <transport_id> <device...>
  local tid="$1"; shift
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
    [ -f "$STATE/stop" ] && continue
    write_stop "$reason"
    kill_in_flight "$tid"
  done < <(adb -t "$tid" shell -tt "$script" </dev/null 2>/dev/null | detect)
  # The stream ended without `stop_watch.sh stop`: adb dropped or the phone
  # rebooted, so presses can no longer be seen. Fail closed.
  if [ "$(cat "$STATE/watcher.pid" 2>/dev/null)" = "$$" ]; then
    [ -f "$STATE/stop" ] || write_stop watcher-down
    rm -f "$STATE/watcher.pid"
  fi
}

# Event devices that report a power or volume key, from `getevent -pl`.
# Fails if the phone listed no input devices at all, i.e. it was not reached.
button_devices() {
  adb -t "$1" shell getevent -pl 2>/dev/null | tr -d '\r' | awk '
    /^add device/ { dev = $NF; seen = 1 }
    /KEY_POWER|KEY_VOLUMEUP|KEY_VOLUMEDOWN/ && dev != "" { print dev; dev = "" }
    END { exit !seen }'
}

start() {
  local tid="$1" devs
  stop
  mkdir -p "$STATE"
  rm -f "$STATE/unavailable"
  echo "$tid" > "$STATE/transport"
  [ "$(sed -n 's/^reason=//p' "$STATE/stop" 2>/dev/null)" = watcher-down ] && rm -f "$STATE/stop"
  if ! devs=$(button_devices "$tid"); then
    say "could not list the phone's input devices over transport $tid; not watching."
    say "adb stays blocked until adb_connect.sh connects and the watcher starts."
    return 1
  fi
  if [ -z "$devs" ]; then
    : > "$STATE/unavailable"
    say "unavailable: no power or volume input devices found on this phone."
    say "Tell the user they cannot stop you from the phone this session."
    return 0
  fi
  # A watcher left on the phone by an earlier session would otherwise linger.
  adb -t "$tid" shell pkill -f "'getevent -lt'" >/dev/null 2>&1
  # Own process group, so `stop` takes adb and awk down with the watcher.
  if command -v setsid >/dev/null 2>&1; then
    setsid nohup bash "$0" _run "$tid" $devs >/dev/null 2>&1 < /dev/null &
  else
    nohup bash "$0" _run "$tid" $devs >/dev/null 2>&1 < /dev/null &
  fi
  echo $! > "$STATE/watcher.pid"
  say "power button, or volume up-down-up-down. Tell the user. (watching $devs)"
}

# A pid file can outlive its watcher and the pid be reused, so check that the
# process really is one.
is_watcher() { ps -o args= -p "$1" 2>/dev/null | grep -q 'stop_watch\.sh _run'; }

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
  # A watcher killed with SIGKILL runs no trap and leaves its pieces behind,
  # its adb stream still reading the buttons. There is one watcher per
  # machine, so sweep up any by command line.
  pkill -TERM -f '^([^ ]+ )?([^ ]*/)?stop_watch\.sh _run ' 2>/dev/null
  pkill -TERM -f '^([^ ]+ )?([^ ]*/)?adb(\.exe)? (.* )?shell -tt .*getevent -lt' 2>/dev/null
  return 0
}

alive() {
  local pid
  pid=$(cat "$STATE/watcher.pid" 2>/dev/null) && is_watcher "$pid"
}

status() {
  if [ -f "$STATE/stop" ]; then
    echo "stopped: $(sed -n 's/^reason=//p' "$STATE/stop") at $(sed -n 's/^time=//p' "$STATE/stop")"
  elif [ -f "$STATE/unavailable" ]; then echo "unavailable: no button devices on this phone"
  elif alive; then echo "watching"
  else echo "not running"; return 1
  fi
}

# Clear a stop. If the watcher died meanwhile, restart it on the last transport.
resume() {
  rm -f "$STATE/stop"
  alive && { status; return 0; }
  local tid
  tid=$(cat "$STATE/transport" 2>/dev/null) || { say "no previous session: run adb_connect.sh"; return 1; }
  start "$tid"
}

case "${1:-}" in
  start)  start "${2:?transport id}" ;;
  stop)   stop ;;
  status) status ;;
  resume) resume ;;
  _run)   shift; run "$@" ;;
  *)      sed -n '2,15p' "$0" >&2; exit 2 ;;
esac
