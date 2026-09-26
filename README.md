# bashy-marketplace

Claude Code plugins by [bashycodes](https://github.com/bashycodes).

## Install

```
/plugin marketplace add bashycodes/marketplace
/plugin install <plugin>@bashy-marketplace
```

## Plugins

Each plugin lives under `plugins/<name>/`. Development files (tests, `package.json`, lockfile) stay at the repo root (`tests/<plugin>/`) so that plugin installs never trigger `npm ci`.

| Plugin | Description |
|---|---|
| [claude-bells](plugins/claude-bells) | 😴/🔔 badge on the tmux tab + terminal bell when a Claude Code session needs you; silent while you watch. Run `/claude-bells:setup` once after install. |
