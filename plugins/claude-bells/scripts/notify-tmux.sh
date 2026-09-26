#!/usr/bin/env bash
# Claude Code -> tmux attention signal (wired up in ../hooks/hooks.json).
#   notify-tmux.sh alert <stop|ask|perm>
#                          - unless the pane is visible in a focused client: mark the window
#                            with @claude_waiting=<reason> and ring the pane bell
#                            (tmux config maps it to an emoji via @claude_badge, see /claude-bells:setup)
#   notify-tmux.sh clear   - remove the mark (you submitted a prompt, or a tool ran = Claude is
#                            working again; the next Stop re-marks it)
# The bell travels tmux -> outer terminal (Windows Terminal, or the SSH client's terminal).

cat >/dev/null  # drain the hook's JSON payload
[ -n "$TMUX" ] && [ -n "$TMUX_PANE" ] && command -v tmux >/dev/null || exit 0

case "$1" in
  clear)
    tmux set -wu -t "$TMUX_PANE" @claude_waiting 2>/dev/null
    ;;
  alert)
    read -r visible session tty < <(tmux display -p -t "$TMUX_PANE" \
      '#{&&:#{pane_active},#{window_active}} #{session_id} #{pane_tty}')
    # Skip badge and bell if you're already looking at this pane (needs `focus-events on`)
    if [ "$visible" = 1 ] && tmux list-clients -t "$session" -F '#{client_flags}' | grep -q focused; then
      exit 0
    fi
    tmux set -w -t "$TMUX_PANE" @claude_waiting "${2:-stop}"
    printf '\a' > "$tty"
    ;;
esac
exit 0
