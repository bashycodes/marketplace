# TickTick conventions (grill-over-ticktick v1)

`tt-grill` owns every byte written to TickTick. Skills never craft TickTick payloads; they send round JSON (see `round-schema.md`) and read back `pull` JSON.

## Effort names
An effort name must match `^[A-Za-z0-9](?:[A-Za-z0-9 ._-]{0,58}[A-Za-z0-9._-])?$`: 1–60 characters, only letters, digits, space, `.`, `_` and `-`, starting with a letter or digit and with no leading or trailing space. No quotes, `$`, backticks or newlines — the name is pasted into shell commands. `tt-grill` refuses anything else with exit 2 (every `--effort` and the round JSON `effort`), and `efforts` never lists a list whose name breaks the rule.

## Layout
- Folder **`Claude`** → one kanban **list per effort** (list title = effort name) → host note + question tasks, all top-level.
- Each list has one column **`📍`**.
- **Host** = a `kind: NOTE` task titled `📍 <effort>` in the `📍` column. Notes have no checkbox, so a stray tap cannot complete them. It must stay undone: `GET /project/{id}/data` returns undone tasks only, so a host completed by other means (e.g. the web app) reads as not found (exit 6).
- **Question** = a top-level `CHECKLIST` task in the effort's list (no `parentId`), in the `📍` column, tagged **`grill`**. Top-level matters: the TickTick Android app renders a `Next →` link as a task chip only when its target is a top-level task. The user's smart list "🔥 Grill inbox" filters on that tag.
- `tt-grill` treats any `grill`-tagged task in the list whose desc footer carries a key as a question, whatever its `parentId`. Efforts created before v1.0.1 have their questions as subtasks of the host (`parentId` = host); they are read, adopted, closed and finished the same way.
- No dates, reminders or comments are ever used.
- Only `takeover` creates the folder/list/host/tag when they are missing. `push`, `pull`, `close`, `wait` and `finish` all resolve an existing layout and fail with exit 6 (not found) if the effort was never taken over or its host note was deleted. The host is always read via `GET /project/{listId}/data` (never the single-task GET, which still returns deleted tasks); `pull` and every `wait` poll use it. Always `takeover` before the first `push` for an effort. `takeover` never converts a list the user already had: if a list with the effort's name exists in `Claude` without a `📍 <effort>` host and is not empty, it exits 2 (`list "<E>" exists in folder Claude but is not a tt-grill list; rename it or pick another effort`); an empty one is adopted.

## Question format
- `title` = `[i/N] <question>`: `i` = the question's 1-based position in the round's `questions`, `N` = their count (e.g. `[2/3] Which columns does a phase-2 map list get?`), so sorting the smart list by name shows the round in order. The round JSON `title` (without the prefix) is ≤ 80 chars; the stored title may exceed 80 by the prefix.
- `desc` (exactly):
  ```
  <1–3 lines of context>

  ⭐ Recommended: <label> — <why>

  ✍️ Answer:

  Next → [[i+1/N] <next title>](https://ticktick.com/webapp/#p/<listId>/tasks/<nextTaskId>)

  ⌁ <key> <hash>
  ```
  In wayfinding the context starts with one extra line `Ticket NN · <title>` in addition to the 1–3 lines (`wayfinding.md`). The `Next →` line links to the next question of the round; the last question links back to the host: `Next → [📍 <effort>](https://ticktick.com/webapp/#p/<listId>/tasks/<hostId>)`. Because each desc needs the next task's id, `push` creates a round's questions last-first. (The link's field is the `LINK_FIELD` constant in `lib/desc.mjs`, currently `desc`; if it is flipped to `content`, the desc has no `Next →` line and the task's `content` is that line alone.)
  `<key>` = `r<round>.<n>`; `<hash>` = first 8 hex of SHA-256 over the normalised text above the footer (the `Next →` line included) (CRLF→LF, trailing whitespace stripped, trailing blank lines dropped, and backslash-escapes TickTick inserts around markdown-special punctuation stripped before hashing). `pull` recomputes it: mismatch or missing footer ⇒ `descChanged: true` ⇒ the user typed something. `answerText` = the text between `✍️ Answer:` and the `Next →` line (or the footer when there is no `Next →` line); text typed below the `Next →` line or the footer is not read. In the `Next →` label every `[`/`]` (the `[i/N] ` prefix included) is written as fullwidth `［`/`］`: the Android app does not parse a link whose text holds an ASCII bracket, and renders a bracket-free label as a task chip showing the target's title.
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
`tt-grill` parses only the block (the last well-formed ```` ```grill ```` fence that starts a line); the prose is opaque to it. `push` rewrites the body **before** creating questions, and `close` rewrites the prose when given `host`. Text the user typed below the block on the phone does not break anything: every write keeps it, moved above the new block (which is always written last). A host with no readable block at all makes `wait` exit 3 (`host has no state block; run takeover`).

## Ownership
`takeover` writes a fresh `owner` (`o_` + 6 base32 chars) and `gen+1`. `push`, `close`, `wait` and `finish` refuse (exit 3) when the host's owner is not the `--owner` they were given. Both `/grill-with-ticktick` and `/grill-from-ticktick` start with `takeover`; that is how one session kicks another out of `wait`.

## Local files
- Token: `$XDG_CONFIG_HOME/tt-grill/token` when `XDG_CONFIG_HOME` is set, else `~/.config/tt-grill/token` (0600) or `TICKTICK_TOKEN` (CI/cloud only). Never read by skills.
- Pushlog: `~/.local/state/tt-grill/<listId>.log` — makes `push` idempotent (re-runs never duplicate questions).
