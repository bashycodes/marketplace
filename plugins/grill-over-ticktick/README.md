# grill-over-ticktick

Answer a grilling session from your phone. Claude sends each round of `/grill-me`-style questions (context, a recommended answer, options) to TickTick, waits in the background at zero token cost, reads what you ticked or typed, and keeps grilling.

## Install

```
/plugin marketplace add bashycodes/marketplace
/plugin install grill-over-ticktick@bashy-marketplace
```

Then run `/setup-ticktick` once. You paste your TickTick API token into your own terminal, never into the chat.

## Skills

| Skill | What it does |
|---|---|
| `/setup-ticktick` | One-time setup: store and verify the token, then send a test question to your phone. |
| `/grill-with-ticktick [effort] [--once]` | Send a round to TickTick, wait for your answers, ingest them, and send the next round. |
| `/grill-from-ticktick [effort]` | Bring a TickTick session back to the terminal: ingest what you answered, retire the rest, and continue live. |

Works best with Matt Pocock's `mattpocock-skills` (its `grilling` skill). Without it, the skills use the same grilling format inline.

## Requirements

- Node ≥ 20.
- Linux, macOS or WSL. Native Windows is not supported (`bin/tt-grill` is a shebang script).
- A TickTick account with an API token.

## Reference

- [conventions.md](references/conventions.md): the TickTick layout (folder, list, host note, question tasks, tag) and where the token lives.
- [round-schema.md](references/round-schema.md): the `tt-grill` commands, their JSON and their exit codes.
- [ingest.md](references/ingest.md): how answers are read back.
