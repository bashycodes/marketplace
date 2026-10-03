#!/usr/bin/env bash
# PreToolUse hook (Bash): refuse adb commands while the user's stop gesture is in
# effect. Reads the tool call JSON on stdin; prints a deny decision, or nothing.
set -uo pipefail

STATE="${AWD_STATE_DIR:-${XDG_RUNTIME_DIR:-$HOME/.cache}/android-wireless-debug}"
INPUT=$(cat)

# The Bash command. Falls back to the whole JSON when neither jq nor python3 is
# around: that can only over-match (e.g. on the description), never miss.
command_of() {
  if command -v jq >/dev/null 2>&1; then jq -r '.tool_input.command // ""' <<<"$INPUT"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("command",""))' <<<"$INPUT"
  else printf '%s' "$INPUT"; fi
}
CMD=$(command_of)

deny() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$1"
  exit 0
}

# Deleting the stop file is resume's job, and resume needs the user's go-ahead.
if grep -qE 'android-wireless-debug/stop($|[^-_.[:alnum:]])' <<<"$CMD" || grep -qF "$STATE/stop" <<<"$CMD"; then
  deny "Do not touch the stop file directly. Use stop_watch.sh resume, and only after the user explicitly says to continue."
fi

# Commands that reach the phone: adb itself, or ui_find.sh (which runs adb).
# adb_connect.sh and stop_watch.sh stay allowed so a stopped session can recover.
# adb subcommands that never touch the phone's screen or apps, such as
# disconnecting, also stay allowed: every adb in the command must be one of them.
rest=$(sed -E 's/adb_connect\.sh|stop_watch\.sh//g' <<<"$CMD")
ADB='(^|[^[:alnum:]_-])adb($|[^[:alnum:]_-])'
SAFE='(^|[^[:alnum:]_-])adb( +-[st] +[^ ;&|]+)* +(disconnect|devices|kill-server|mdns|version|usb)($|[^[:alnum:]_-])'
grep -qE "$ADB|ui_find\.sh" <<<"$rest" || exit 0
if ! grep -q 'ui_find\.sh' <<<"$rest" \
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
if [ -z "$pid" ] || ! ps -o args= -p "$pid" 2>/dev/null | grep -q 'stop_watch\.sh _run'; then
  deny "The stop-gesture watcher is not running, so the user could not stop you from the phone. Connect with adb_connect.sh first; it starts the watcher."
fi
exit 0
