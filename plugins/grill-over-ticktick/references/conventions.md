# TickTick conventions (grill-over-ticktick v1)

`tt-grill` owns every byte written to TickTick. Skills never craft TickTick payloads; they send round JSON (see `round-schema.md`) and read back `pull` JSON.

## Layout
- Folder **`Claude`** → one kanban **list per effort** (list title = effort name) → tasks → subtasks.
- Each list has one column **`📍`**.
- **Host** = a `kind: NOTE` task titled `📍 <effort>` in the `📍` column. Notes have no checkbox, so a stray tap cannot complete them.
- **Question** = a `CHECKLIST` subtask of the host (`parentId` = host), tagged **`grill`**. The user's smart list "🔥 Grill inbox" filters on that tag.
- No dates, reminders or comments are ever used.
- Only `takeover` creates the folder/list/host/tag when they are missing. `push`, `pull`, `close`, `wait` and `finish` all resolve an existing layout and fail with exit 6 (not found) if the effort was never taken over. Always `takeover` before the first `push` for an effort.

## Question format
- `title` = the question, ≤ 80 chars.
- `desc` (exactly):
  ```
  <1–3 lines of context>

  ⭐ Recommended: <label> — <why>

  ✍️ Answer:

  ⌁ <key> <hash>
  ```
  `<key>` = `r<round>.<n>`; `<hash>` = first 8 hex of SHA-256 over the normalised text above the footer (CRLF→LF, trailing whitespace stripped, trailing blank lines dropped). `pull` recomputes it: mismatch or missing footer ⇒ `descChanged: true` ⇒ the user typed something.
- `items` = `⭐ <recommended>` first, then the other options in the given order, then `Other → type after ✍️`.

## Host body
Prose written by the skill (via round JSON `host`) followed by the state block, which must be **last**:
```
📍 <effort>

Goal: <one line>

Decided
- <gist> (r1.2)

Open
- r2.1 <title> — ⭐ <rec>

Not asked yet
- <gist>

```grill
{"v":1,"owner":"o_7f3k2a","gen":3,"round":2}
```
```
`tt-grill` parses only the block; the prose is opaque to it. `push` rewrites the body **before** creating questions. If the block is not last (user typed below it) the host is treated as having no state.

## Ownership
`takeover` writes a fresh `owner` (`o_` + 6 base32 chars) and `gen+1`. `push`, `close` and `wait` refuse (exit 3) when the host's owner is not the `--owner` they were given. Both `/grill-with-ticktick` and `/grill-from-ticktick` start with `takeover`; that is how one session kicks another out of `wait`.

## Local files
- Token: `~/.config/tt-grill/token` (0600) or `TICKTICK_TOKEN` (CI/cloud only). Never read by skills.
- Pushlog: `~/.local/state/tt-grill/<listId>.log` — makes `push` idempotent (re-runs never duplicate questions).
