#!/usr/bin/env bash
# PreToolUse hook (Bash), on commands that reach the phone:
# - after the user cancels with the stop gesture (the watcher has already killed
#   the running phone commands), the next one is refused once, with the reason,
#   so Claude stops the task instead of retrying. Nothing stays blocked.
# - while no watcher is running, they are refused with an instruction to rerun
#   adb_connect.sh, which restarts it, so the gesture always works.
# Reads the tool call JSON on stdin; prints a deny decision, or nothing.
#
# `stop_hook.sh session-end` is the SessionEnd hook: it stops the watcher when
# the session that connected (ran adb_connect.sh) ends.
set -uo pipefail

STATE="${AWD_STATE_DIR:-${XDG_RUNTIME_DIR:-$HOME/.cache}/android-wireless-debug}"
INPUT=$(cat)
# How long a cancel stays news: the command after it comes within seconds; a
# later one belongs to a new request.
FRESH=${AWD_CANCEL_FRESH:-60}

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

# A process's full command line. `ps -o args=` cuts it at $COLUMNS, and a hook
# can run with a narrow one; the plugin's install path alone can be wider.
proc_args() {
  if [ -r "/proc/$1/cmdline" ]; then tr '\0' ' ' < "/proc/$1/cmdline"
  else ps -ww -o args= -p "$1" 2>/dev/null; fi
}

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

# Commands that reach the phone: adb itself, ui_find.sh (which runs adb), and
# tools that drive a device through adb without naming it.
# adb_connect.sh and stop_watch.sh don't count, nor do adb subcommands that
# never touch the phone's screen or apps, such as disconnecting: every adb in
# the command must be one of them.
rest=$(sed -E 's/adb_connect\.sh|stop_watch\.sh//g' <<<"$CMD")
ADB='(^|[^[:alnum:]_-])adb($|[^[:alnum:]_-])'
SAFE='(^|[^[:alnum:]_-])adb( +-[st] +[^ ;&|]+)* +(disconnect|devices|kill-server|mdns|version|usb)($|[^[:alnum:]_-])'
TOOLS='(^|[^[:alnum:]_-])(scrcpy|fastboot)($|[^[:alnum:]_-])|gradlew?[^;&|]*[[:space:]:](install|connected|uninstall)[[:alnum:]]*|flutter[[:space:]]+(run|install|drive|test|attach)|run-android|run:android'
grep -qE "$ADB|ui_find\.sh|$TOOLS" <<<"$rest" || exit 0
if ! grep -qE "ui_find\.sh|$TOOLS" <<<"$rest" \
   && [ "$(grep -oE "$ADB" <<<"$rest" | wc -l)" = "$(grep -oE "$SAFE" <<<"$rest" | wc -l)" ]; then
  exit 0
fi

deny() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$1"
  exit 0
}

# The first phone command after a cancel consumes it.
# Taken with mv, so a gesture landing meanwhile writes a new one, not lost.
# Only digits are trusted as numbers, and only plain characters reach the JSON.
taken="$STATE/cancel.$$"
if mv "$STATE/cancel" "$taken" 2>/dev/null; then
  reason=$(sed -n 's/^reason=//p' "$taken" | tr -cd '[:alnum:]-'); at=$(sed -n 's/^time=//p' "$taken" | tr -cd '0-9:')
  epoch=$(sed -n 's/^epoch=//p' "$taken"); rm -f "$taken"
  case "$epoch" in ''|*[!0-9]*) epoch=0 ;; esac
  case "$FRESH" in ''|*[!0-9]*) FRESH=60 ;; esac
  if [ $(( $(date +%s) - 10#$epoch )) -le "$FRESH" ]; then
    case "$reason" in
      power)           how="pressed the power button" ;;
      volume-sequence) how="pressed volume up-down-up-down" ;;
      *)               how="cancelled ($reason)" ;;
    esac
    deny "CANCELLED: the user $how at $at, which killed your running phone commands. Stop the current task, tell the user you stopped, and wait for their next message. Phone commands are not blocked: once they ask, carry on."
  fi
fi

# The phone has no button devices: no gesture to watch for.
[ -f "$STATE/unavailable" ] && exit 0

# No watcher (never connected, or it lost the phone): the gesture would do
# nothing, so have Claude reconnect, which restarts it.
pid=$(cat "$STATE/watcher.pid" 2>/dev/null)
if [ -z "$pid" ] || ! proc_args "$pid" | grep -qF "stop_watch.sh _run $STATE "; then
  deny "The stop-gesture watcher is not running, so the user cannot cancel you from the phone. Reconnect now by running adb_connect.sh on its own (not chained with phone commands), without asking the user; it restarts the watcher. Then retry. If adb_connect.sh fails, or says it could not start the watcher, stop and tell the user instead of retrying."
fi
exit 0
