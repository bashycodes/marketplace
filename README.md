# bashy-marketplace

Claude Code plugins by [bashycodes](https://github.com/bashycodes).

## Install

```
/plugin marketplace add bashycodes/marketplace
/plugin install grill-over-ticktick@bashy-marketplace
```

(General form: `/plugin install <plugin>@bashy-marketplace`.)

## Plugins

Each plugin lives under `plugins/<name>/`. Development files (tests, `package.json`, lockfile) stay at the repo root (`tests/<plugin>/`) so that plugin installs never trigger `npm ci`.

| Plugin | Description |
|---|---|
| [grill-over-ticktick](plugins/grill-over-ticktick) | Relay /grill-me question rounds to TickTick; answer on your phone; Claude ingests and keeps grilling. Requires Node ≥ 20. Works best with Matt Pocock's `mattpocock-skills` (its `grilling` skill); without it the skills fall back to the same grilling format inline. Run `/setup-ticktick` once. |
| [tmux-bells](plugins/tmux-bells) | 😴/🔔 badge on the tmux tab + terminal bell when a Claude Code session needs you; silent while you watch. Run `/tmux-bells:setup` once after install. Renamed from `claude-bells`, whose alerts stop once the marketplace updates: install `tmux-bells`, then uninstall `claude-bells`. |
| [android-wireless-debug](plugins/android-wireless-debug) | Drive a real Android phone over ADB to see, test and fix an app — screenshots, UI taps, logcat/dumpsys, APK installs; connects even via USB-opened TCP from WSL. |

Development: `npm test` (offline unit tests), `npm run typecheck`, and `npm run validate` — the local manifest check (`claude plugin validate` for the plugin and the marketplace). `validate` needs the `claude` CLI, so it is not run in CI; run it before pushing manifest changes.

Limitations: grill-over-ticktick is not installable in claude.ai / Cowork (the plugin ships a `bin/` directory), and its `tt-grill` CLI runs on Linux, macOS and WSL (not native Windows).

Cloud: Claude Code cloud/web sessions need `api.ticktick.com` on the network allowlist, and they do not install a repo's `enabledPlugins`.
