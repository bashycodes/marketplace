# claude-bells

Know when a Claude Code session running in tmux needs you, without watching it.

- **Badge** on the session's tmux tab: 😴 when Claude has finished its turn, 🔔 when it asked you a question or wants permission.
- **Bell** rung in the pane. tmux greys the tab and passes the bell on to your terminal, including over SSH. On Windows Terminal it flashes the taskbar icon.
- **Nothing** happens while you're looking at the pane: it has to be the active pane and window, in a focused terminal.
- The badge clears once Claude is working again, either because you sent a prompt or because a tool ran. It comes back the next time Claude stops.
- To dismiss a badge by hand, press your tmux prefix, then `a`, in that window.

Outside tmux the plugin does nothing.

## Install

```
/plugin marketplace add bashycodes/marketplace
/plugin install claude-bells@bashy-marketplace
```

Then, from a Claude session inside tmux, run this once per machine:

```
/claude-bells:setup
```

Setup adds the badge to your tmux tabs, binds prefix `a` to clear it, turns on `focus-events`, and sets your terminal's bell reaction. It also removes any hand-wired `notify-tmux.sh` hooks, so alerts don't fire twice.

## When alerts fire

| Claude... | Badge | Bell |
|---|---|---|
| finishes its turn | 😴 | yes |
| asks you a question | 🔔 | yes |
| asks permission to run a tool | 🔔 | yes |
| any of the above, while you're looking at the pane | none | no |

The emoji mapping is the `@claude_badge` option in your tmux config, so change it there if you want different emoji. The clear key is the `bind a set -wu @claude_waiting` line there too.

Requires tmux 3.2 or later. The design and its decisions are in [SPEC.md](SPEC.md).
