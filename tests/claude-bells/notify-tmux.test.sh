#!/usr/bin/env bash
# Tests for plugins/claude-bells/scripts/notify-tmux.sh against a private tmux server
# (own socket; your real tmux sessions are never touched). Run: bash tests/claude-bells/notify-tmux.test.sh
# The badge mapping under test is the one the setup skill tells users to install.
set -u
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
SCRIPT=$ROOT/plugins/claude-bells/scripts/notify-tmux.sh
SKILL=$ROOT/plugins/claude-bells/skills/setup/SKILL.md

TMP=$(mktemp -d); SOCK=$TMP/tmux.sock
t() { tmux -S "$SOCK" "$@"; }
trap 't kill-server 2>/dev/null; rm -rf "$TMP"' EXIT

t -f /dev/null new-session -d -s test -n main 'sleep 600'
t set -g @claude_badge "$(sed -n 's/^set -g @claude_badge "\(.*\)"$/\1/p' "$SKILL")"
t setw -g window-status-format '#W#{E:@claude_badge}'
PANE=$(t new-window -d -P -F '#{pane_id}' -n hidden 'sleep 600')
export TMUX="$SOCK,$(t display -p '#{pid}'),0"

fails=0
check() {  # check <description> <expected> <actual>
  if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected [$2], got [$3]"; fails=$((fails+1)); fi
}
run()   { echo '{}' | TMUX_PANE=$PANE bash "$SCRIPT" "$@"; }
state() { t show -wv -t "$PANE" @claude_waiting 2>/dev/null; }
tab()   { t display -p -t "$PANE" '#{E:window-status-format}'; }

run alert stop;  check "alert stop sets reason"      stop            "$(state)"
                 check "stop renders 😴"              "hidden 😴"    "$(tab)"
run clear;       check "clear removes it"            ""              "$(state)"
                 check "cleared tab has no badge"    "hidden"      "$(tab)"
run alert ask;   check "ask renders 🔔"               "hidden 🔔"    "$(tab)"
run alert perm;  check "perm renders 🔔"              "hidden 🔔"    "$(tab)"
run alert;       check "reason defaults to stop"     stop            "$(state)"
t set -w -t "$PANE" @claude_waiting bogus
                 check "unknown reason shows nothing" "hidden"     "$(tab)"

run clear; run alert stop
for _ in 1 2 3 4 5 6 7 8 9 10; do [ "$(t display -p -t "$PANE" '#{window_bell_flag}')" = 1 ] && break; sleep 0.1; done
check "alert rings the pane bell" 1 "$(t display -p -t "$PANE" '#{window_bell_flag}')"

# The clear key setup installs. Untargeted, like a key binding, so it acts on the current window.
CLEAR_KEY=$(sed -n 's/^bind a //p' "$SKILL")
t select-window -t "$PANE"
[ -n "$CLEAR_KEY" ] && t $CLEAR_KEY  # unquoted on purpose: split into tmux arguments
check "clear key removes the badge" "" "$(state)"

out=$(echo '{}' | env -u TMUX bash "$SCRIPT" alert stop; echo "exit=$?")
check "outside tmux: silent no-op" "exit=0" "$out"

[ "$fails" = 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
