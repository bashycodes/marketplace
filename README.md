# bashy-marketplace

Claude Code plugins by [bashycodes](https://github.com/bashycodes).

## Install

```
/plugin marketplace add bashycodes/marketplace
/plugin install <plugin>@bashy-marketplace
```

## Plugins

Each plugin lives under `plugins/<name>/`. Development files (tests, `package.json`, lockfile) stay at the repo root so that plugin installs never trigger `npm ci`.

| Plugin | Description |
|---|---|
| [grill-over-ticktick](plugins/grill-over-ticktick) | Relay /grill-me question rounds to TickTick; answer on your phone; Claude ingests and keeps grilling. Requires Node ≥ 20 and Matt Pocock's `mattpocock-skills` (for `grilling`). Run `/setup-ticktick` once. |

Limitations: Not installable in claude.ai / Cowork (the plugin ships a `bin/` directory).
