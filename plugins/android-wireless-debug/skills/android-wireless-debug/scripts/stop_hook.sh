#!/usr/bin/env bash
# PreToolUse hook (Bash): refuse adb commands while the user's stop gesture is in
# effect. Reads the tool call JSON on stdin; prints a deny decision, or nothing.
#
# `stop_hook.sh session-end` is the SessionEnd hook: it stops the watcher when
# the session that connected (ran adb_connect.sh) ends.
set -uo pipefail

STATE="${AWD_STATE_DIR:-${XDG_RUNTIME_DIR:-$HOME/.cache}/android-wireless-debug}"
INPUT=$(cat)

# A process's full command line. `ps -o args=` cuts it at $COLUMNS, and a hook
# can run with a narrow one; the plugin's install path alone can be wider.
proc_args() {
  if [ -r "/proc/$1/cmdline" ]; then tr '\0' ' ' < "/proc/$1/cmdline"
  else ps -ww -o args= -p "$1" 2>/dev/null; fi
}

# A field of the hook input: tool_input.command or session_id. Without jq or
# python3 the command falls back to the whole JSON, which can only over-match
# (e.g. on the description), never miss.
field() {
  if command -v jq >/dev/null 2>&1; then jq -r "$1 // \"\"" <<<"$INPUT"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c 'import json,sys; d=json.load(sys.stdin)
for k in sys.argv[1].lstrip(".").split("."): d=d.get(k,{}) if isinstance(d,dict) else {}
print(d if isinstance(d,str) else "")' "$1" <<<"$INPUT"
  elif [ "$1" = .tool_input.command ]; then printf '%s' "$INPUT"; fi
}
SESSION=$(field .session_id)

if [ "${1:-}" = session-end ]; then
  if [ -n "$SESSION" ] && [ "$(cat "$STATE/session" 2>/dev/null)" = "$SESSION" ]; then
    bash "$(dirname "$0")/stop_watch.sh" stop >/dev/null 2>&1
    rm -f "$STATE/session"
  fi
  exit 0
fi

CMD=$(field .tool_input.command)

# Remember which session connected, so only its end stops the watcher.
if grep -q 'adb_connect\.sh' <<<"$CMD" && [ -n "$SESSION" ]; then
  mkdir -p "$STATE" && printf '%s\n' "$SESSION" > "$STATE/session"
fi

deny() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$1"
  exit 0
}

# The stop state is stop_watch.sh's alone: clearing it is resume's job, and
# resume needs the user's go-ahead. Deleting the whole state dir would also
# let a reconnect forget the user's stop.
if grep -qE 'android-wireless-debug/stop($|[^-_.[:alnum:]])' <<<"$CMD" \
   || grep -qE '(\.cache|XDG_RUNTIME_DIR\}?|/run/user/[0-9]+)/android-wireless-debug($|[^-_.[:alnum:]])' <<<"$CMD" \
   || grep -qF "$STATE" <<<"$CMD"; then
  deny "Do not touch the stop state directly. Use stop_watch.sh resume, and only after the user explicitly says to continue."
fi

# Commands that reach the phone: adb itself, ui_find.sh (which runs adb), and
# tools that drive a device through adb without naming it.
# adb_connect.sh and stop_watch.sh stay allowed so a stopped session can recover.
# adb subcommands that never touch the phone's screen or apps, such as
# disconnecting, also stay allowed: every adb in the command must be one of them.
rest=$(sed -E 's/adb_connect\.sh|stop_watch\.sh//g' <<<"$CMD")
ADB='(^|[^[:alnum:]_-])adb($|[^[:alnum:]_-])'
SAFE='(^|[^[:alnum:]_-])adb( +-[st] +[^ ;&|]+)* +(disconnect|devices|kill-server|mdns|version|usb)($|[^[:alnum:]_-])'
TOOLS='(^|[^[:alnum:]_-])(scrcpy|fastboot)($|[^[:alnum:]_-])|gradlew?[^;&|]*[[:space:]:](install|connected|uninstall)[[:alnum:]]*|flutter[[:space:]]+(run|install|drive|test|attach)|run-android|run:android'
grep -qE "$ADB|ui_find\.sh|$TOOLS" <<<"$rest" || exit 0
if ! grep -qE "ui_find\.sh|$TOOLS" <<<"$rest" \
   && [ "$(grep -oE "$ADB" <<<"$rest" | wc -l)" = "$(grep -oE "$SAFE" <<<"$rest" | wc -l)" ]; then
  exit 0
fi

if [ -f "$STATE/stop" ]; then
  reason=$(sed -n 's/^reason=//p' "$STATE/stop"); at=$(sed -n 's/^time=//p' "$STATE/stop")
  case "$reason" in
    power)  how="pressed the power button" ;;
    volume-sequence) how="pressed volume up-down-up-down" ;;
    watcher-down)
      deny "STOP: at $at the stop-gesture watcher lost the phone (adb dropped or the phone rebooted), so the user's stop presses can no longer be seen. Run adb_connect.sh to reconnect; it restarts the watcher." ;;
    *)      how="stopped phone control ($reason)" ;;
  esac
  deny "STOP: the user $how at $at to take the phone back. Do not send the phone any more commands. Tell the user you have stopped, and wait. Run stop_watch.sh resume only after the user explicitly says to continue."
fi

# The phone has no button devices: no gesture to watch for.
[ -f "$STATE/unavailable" ] && exit 0

pid=$(cat "$STATE/watcher.pid" 2>/dev/null)
if [ -z "$pid" ] || ! proc_args "$pid" | grep -qF "stop_watch.sh _run $STATE "; then
  deny "The stop-gesture watcher is not running, so the user could not stop you from the phone. Connect with adb_connect.sh first; it starts the watcher."
fi
exit 0
