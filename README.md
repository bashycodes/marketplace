# bashy-marketplace

Claude Code plugins by [bashycodes](https://github.com/bashycodes).

## Install

```
/plugin marketplace add bashycodes/marketplace
/plugin install bashy-plugins@bashy-marketplace
```

The marketplace ships one plugin, `bashy-plugins`, holding every skill and hook below. Skills are namespaced `bashy-plugins:<skill>` (e.g. `/bashy-plugins:tmux-bells-setup`); the bare `/<skill>` works when no other plugin uses the same name.

### Upgrading from the standalone plugins

`grill-over-ticktick`, `tmux-bells` and `android-wireless-debug` used to be separate plugins. They now ship inside `bashy-plugins`, so once the marketplace updates Claude Code reports the old names as not found. Install `bashy-plugins`, then uninstall whichever of the old ones you had, so no cached copy runs its hooks alongside the new plugin:

```
/plugin install bashy-plugins@bashy-marketplace
/plugin uninstall grill-over-ticktick@bashy-marketplace
/plugin uninstall tmux-bells@bashy-marketplace
/plugin uninstall android-wireless-debug@bashy-marketplace
```

Your TickTick token (`~/.config/tt-grill/token`), tmux config and phone setup stay where they are; nothing needs re-running. Also:

- **Project-scope installs:** a repo whose `.claude/settings.json` `enabledPlugins` names an old plugin needs that key changed to `"bashy-plugins@bashy-marketplace": true` (teammates share it).
- **Running sessions** pick up the new plugin after a restart.
- **Renamed skills:** `/tmux-bells:setup` is now `/bashy-plugins:tmux-bells-setup`; namespaced forms like `/grill-over-ticktick:grill-with-ticktick` or `/android-wireless-debug:android-wireless-debug` become `/bashy-plugins:…` (bare `/grill-with-ticktick` etc. still work). Permission rules naming the old skill IDs need the same rename.
- **Wayfinder maps** whose `## Notes` call `grill-over-ticktick:grill-with-ticktick` should now say `bashy-plugins:grill-with-ticktick`. Find them with `grep -rl 'grill-over-ticktick:' .scratch/`.

## What's inside

Everything lives under `plugins/bashy-plugins/`; per-feature docs are in [`plugins/bashy-plugins/docs/`](plugins/bashy-plugins/docs). Development files (tests, `package.json`, lockfile) stay at the repo root (`tests/<feature>/`) so that plugin installs never trigger `npm ci`.

| Feature | Skills | Description |
|---|---|---|
| [grill-over-ticktick](plugins/bashy-plugins/docs/grill-over-ticktick.md) | `setup-ticktick`, `grill-with-ticktick`, `grill-from-ticktick`, `wayfind-with-ticktick` | Relay /grill-me question rounds to TickTick; answer on your phone; Claude ingests and keeps grilling. Requires Node ≥ 20. Works best with Matt Pocock's `mattpocock-skills` (its `grilling` skill); without it the skills fall back to the same grilling format inline. Run `/setup-ticktick` once. Also works a wayfinder map from your phone (`/wayfind-with-ticktick`). |
| [tmux-bells](plugins/bashy-plugins/docs/tmux-bells.md) | `tmux-bells-setup` | 😴/🔔 badge on the tmux tab + terminal bell when a Claude Code session needs you; silent while you watch. Run `/bashy-plugins:tmux-bells-setup` once per machine. Does nothing outside tmux. |
| [android-wireless-debug](plugins/bashy-plugins/docs/android-wireless-debug.md) | `android-wireless-debug` | Drive a real Android phone over ADB to see, test and fix an app — screenshots, UI taps, logcat/dumpsys, APK installs; connects over Tailscale from anywhere, or via USB-opened TCP from WSL. Its PreToolUse hook refuses `adb` commands until `adb_connect.sh` has run in a session. |

Hooks are per plugin, so installing `bashy-plugins` installs every feature's hooks, but each stays inert until you opt in: the tmux-bells hooks until `/bashy-plugins:tmux-bells-setup` has configured tmux, and the android-wireless-debug stop-gesture hook until Claude has run its `adb_connect.sh` on the machine.

Development: `npm test` (offline unit tests), `npm run typecheck`, and `npm run validate` — the local manifest check (`claude plugin validate` for the plugin and the marketplace). `validate` needs the `claude` CLI, so it is not run in CI; run it before pushing manifest changes.

Limitations: `bashy-plugins` is not installable in claude.ai / Cowork (it ships a `bin/` directory for `tt-grill`), and the `tt-grill` CLI runs on Linux, macOS and WSL (not native Windows).

Cloud: Claude Code cloud/web sessions need `api.ticktick.com` on the network allowlist, and they do not install a repo's `enabledPlugins`.
