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
| `/grill-with-ticktick [effort] [--once] [--ticket <path>]` | Send a round to TickTick, wait for your answers, ingest them, and send the next round. With `--ticket`, grill one wayfinder ticket and file its resolution. |
| `/grill-from-ticktick [effort]` | Bring a TickTick session back to the terminal: ingest what you answered, retire the rest, and continue live. |
| `/wayfind-with-ticktick <map> [NN]` | Work a wayfinder map from your phone: claims the next grilling ticket, relays its questions, files each resolution (one git commit, no push), then continues with the next ticket. Local-markdown tracker only. |

Works best with Matt Pocock's `mattpocock-skills` (its `grilling` skill). Without it, the skills use the same grilling format inline.

## Requirements

- Node ≥ 20.
- Linux, macOS or WSL. Native Windows is not supported (`bin/tt-grill` is a shebang script).
- A TickTick account with an API token.

## Wayfinding

Two routes. Notes route: `grill-with-ticktick` answers one ticket per `/wayfinder` session. `/wayfind-with-ticktick` works a whole map, ticket after ticket. Only one phone-grilling session per map runs at a time: a second takeover ends the first one's wait. The Notes route is unverified in a live `/wayfinder` run. The `evals/wayfind-*` evals need the plugin directory trusted once interactively (`claude plugin eval` refuses untrusted dirs non-interactively) and `--scaffold` to build their git fixture (see `evals/README.md`).

## Reference

- [conventions.md](references/conventions.md): the TickTick layout (folder, list, host note, question tasks, tag) and where the token lives.
- [round-schema.md](references/round-schema.md): the `tt-grill` commands, their JSON and their exit codes.
- [ingest.md](references/ingest.md): how answers are read back.
- [wayfinding.md](references/wayfinding.md): the map/ticket file recipe the wayfinding skills follow.
