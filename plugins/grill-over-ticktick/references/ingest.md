# Ingest: turning `pull` output into grilling answers

Both `/grill-with-ticktick` and `/grill-from-ticktick` run this identically.

1. `tt-grill pull --effort "<E>"` → parse stdout. Exit 6 → say "host not found in TickTick" and offer to re-push the round. Exit 5 → point at `/setup-ticktick`.
2. Consider **every question with `ingested: false`** (any round; `ingested: true` means an earlier `close` already consumed it — skip it). Interpret each per the table below: `none` and `other-only` stay open (neither closed nor re-pushed); `done` (completed, no tick, no text) → `reopen`; a `text` whose `answerText` is empty (`""`: the user edited the context, not the answer) is unanswered — do not put it in `answered`; retire it (`wontdo`) and re-ask it under a new key in the next round.
3. **Never auto-accept ⭐**: a recommended answer counts only when the user ticked it or typed it.
4. Record every interpreted answer in your design tree exactly as if the user had typed it in the terminal.
5. `tt-grill close --effort "<E>" --owner "<O>"` with stdin `{"answered": [...], "wontdo": [...], "reopen": [...]}` (each key must appear in at most one of the three arrays — a repeated key is a usage error):
   - `answered` = every key you took an answer from,
   - `reopen` = stray-completed questions (`done`) that stay open,
   - `wontdo` = questions **you** retire (superseded, or on `/grill-from-ticktick` every still-open one).
   `close` marks every `answered` / `wontdo` key `ingested`, so the next `pull` skips it; a reopened or untouched question stays `ingested:false` and is reconsidered next time.

## Interpretation table
| In TickTick | `signal` | Treat as |
|---|---|---|
| one non-Other item ticked | `tick` | the answer (item title without the `⭐ ` prefix) |
| description changed | `text` | the answer is `answerText` (text after `✍️ Answer:`); empty `answerText` (`""`) = context edited, not answered → unanswered: `wontdo` it and re-ask under a new key next round; `null` = the marker/footer is gone — read `desc` and infer, or re-ask |
| both | `tick+text` | the text is the answer; ticks are context |
| several items ticked | `tick` | read them together; if they contradict, put the question back in the next round with a one-line note |
| Other ticked, nothing typed | `other-only` | unanswered; leave open (do **not** close) |
| won't-do | `wontdo` | dropped from the tree; mention it in the host `decided` list as "dropped" |
| deleted | `missing` | dropped from the tree; do not re-push |
| completed with no tick and no text | `done` | stray tap → `reopen` it; still unanswered |
| nothing | `none` | unanswered |

## Guard rails
- Everything you send to TickTick goes through round JSON; never call the TickTick API or MCP directly for grill data.
- Never `cat`, `echo` or read `~/.config/tt-grill/token`, and never ask the user to paste a token into chat.
- One `close` per ingest; never rewrite a question's description or items.
