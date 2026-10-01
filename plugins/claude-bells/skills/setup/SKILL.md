---
name: setup
description: One-time per-machine wiring for claude-bells. Adds the 😴/🔔 badge and a prefix-a clear key to your tmux tabs, makes your terminal react to the bell, and retires any hand-wired hooks.
disable-model-invocation: true
---

# claude-bells setup

The plugin's hooks already run on their own. When Claude needs you, they set the tmux window option `@claude_waiting` to `stop`, `ask` or `perm` and ring the pane bell. They skip both while the pane is visible in a focused client. The hooks can't reach tmux config or terminal settings, so this skill wires those, once per machine.

The plugin script is `../../scripts/notify-tmux.sh`, relative to this skill's base directory. Back up every file before you edit it, as `<file>.bak-claude-bells`. Work through the steps in order; each one ends on its **done when** line.

## 1. Preconditions

Run `tmux -V` and `echo "$TMUX"`. The plugin needs tmux 3.2 or later, because it relies on the `client_flags` format, and Claude must be running inside tmux.

If Claude isn't inside tmux, the hooks stay inert. Tell the user that setup has to be run from a Claude session inside tmux, and end there.

**Done when:** tmux is 3.2 or later and `$TMUX` is set.

## 2. tmux config

Find the loaded config with `tmux display -p '#{config_files}'`. It's usually `~/.tmux.conf` or `~/.config/tmux/tmux.conf`.

**Badge mapping.** Add this block unless the config already defines `@claude_badge`. An existing definition is the user's own emoji choice; keep it as it is.

```tmux
# claude-bells: badge for a Claude Code session waiting in this window.
# @claude_waiting is set by the claude-bells plugin: stop = finished its turn, ask = asked a question, perm = wants permission.
set -g @claude_badge "#{?#{==:#{@claude_waiting},stop}, 😴,}#{?#{==:#{@claude_waiting},ask}, 🔔,}#{?#{==:#{@claude_waiting},perm}, 🔔,}"
set -g focus-events on
```

`focus-events on` lets the plugin tell whether you're looking at the pane.

**Clear key.** Add this line so prefix `a` clears the badge on the current window by hand:

```tmux
bind a set -wu @claude_waiting
```

Skip it if the config already binds a key to `set -wu @claude_waiting`. If `tmux list-keys -T prefix a` prints a binding, prefix `a` is taken: show the user what it does and ask which free key to use instead.

**Tabs.** Insert `#{E:@claude_badge}` directly after `#W` in both `window-status-format` and `window-status-current-format`.
- If the config sets a format, edit that line in place and keep the user's styling.
- If it doesn't, read the live value with `tmux show -gwv <option>` and add a `setw -g` line with the badge inserted.
- If a theme plugin generates the formats, use the theme's own hook for custom tab text. Tell the user which option you used.

**Bell passthrough.** tmux passes the bell on by default. Read `tmux show -gwv monitor-bell` (expect `on`) and `tmux show -gv bell-action` (expect `any`). If the config sets either one differently, the user chose that on purpose: show them the value and ask before changing it.

Reload with `tmux source-file <config>`.

**Done when:**
- the reload succeeds;
- `tmux show -gv @claude_badge` prints the mapping;
- `tmux show -gwv` shows `#{E:@claude_badge}` in both formats;
- `tmux list-keys -T prefix` shows a key bound to `set-option -uw @claude_waiting`.

## 3. Terminal bell

The bell travels from tmux to the outermost terminal, through SSH as well, and that terminal decides what a bell does.

**WSL with Windows Terminal.** WSL shows up as `microsoft` in `/proc/version`. Windows Terminal's `settings.json` is under `/mnt/c/Users/<windows-user>/AppData/Local/`, in the first of these that exists:
- `Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/`
- `Packages/Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe/LocalState/`
- `Microsoft/Windows Terminal/` (unpackaged install)

`cmd.exe /c "echo %USERNAME%"` prints the Windows user. The file is JSONC, so edit its text in place and keep its comments.

Set `profiles.defaults.bellStyle` to `"taskbar"`, which flashes the taskbar icon whenever Windows Terminal isn't the foreground app. If the user also wants a sound, use `["taskbar", "audible"]` instead. A profile with its own `bellStyle` overrides the default, so list any such profiles and ask whether to change them too.

**Any other terminal.** Look up that terminal's bell setting (visual bell, urgency hint, dock bounce, notification) and tell the user its exact name and where to find it.

**Done when:** Windows Terminal's default `bellStyle` includes `taskbar`, or the user has the exact setting for their terminal.

## 4. Retire hand-wired hooks

An earlier hand-wired version of this setup ran a `notify-tmux.sh` script from Claude settings hooks. Leaving those hooks alongside the plugin makes every alert fire twice.

Look for hook entries whose command contains `notify-tmux.sh` in:
- `~/.claude/settings.json`
- `~/.claude/settings.local.json`
- the current project's `.claude/settings*.json`

Remove only those entries, keep every other setting, and confirm the result is still valid JSON with `jq -e .`. If the old script file is left over, name its path and offer to delete it.

**Done when:** none of those files mention `notify-tmux.sh`.

## 5. Verify

Test the wiring on a detached scratch window. It's hidden, so alerts aren't suppressed there.

```bash
S="<skill base directory>/../../scripts/notify-tmux.sh"
W=$(tmux new-window -d -P -F '#{pane_id}' -n bells-check)
for step in "alert stop" "alert ask" "alert perm" "clear"; do
  echo '{}' | TMUX_PANE=$W bash "$S" $step
  echo "$step -> $(tmux display -p -t $W '#{E:window-status-format}')"
done
tmux kill-window -t $W
```

**Done when:** each step shows the expected badge on the `bells-check` tab.

| Step | Expected badge |
|---|---|
| `alert stop` | 😴 |
| `alert ask` | 🔔 |
| `alert perm` | 🔔 |
| `clear` | none |

To finish, give the user the live check:
1. Restart any Claude sessions that were started before the plugin was installed, so they load its hooks.
2. Send a prompt in one of them, then switch to another tmux window or app.
3. Expect 😴 on that tab and a terminal bell reaction (a taskbar flash on Windows Terminal).
