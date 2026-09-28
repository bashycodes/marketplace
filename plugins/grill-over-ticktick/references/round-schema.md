# tt-grill JSON contract

All commands print one JSON value on stdout and `{"error":"<code>","message":"…",…}` on stderr on failure. Run them with the Bash tool; parse stdout.

## Exit codes
| code | meaning | what the skill does |
|---|---|---|
| 0 | ok | continue |
| 1 | error (network exhausted, unexpected 5xx) | report; may retry the same command once |
| 2 | usage (bad args / stray positional argument — only `auth status` takes one / effort name breaks the rule in `conventions.md` / bad stdin JSON / text > 100 000 chars / `takeover` on a non-empty list that is not a tt-grill list) | fix the input, do not retry blindly |
| 3 | taken over — another session owns this effort (or, from `wait`, `host has no state block; run takeover`) | stop this mode, tell the user (for the no-block case: run `takeover` again and continue) |
| 4 | `wait` gave up (`--max` reached); stderr carries `{"error":"gave_up","message":"…","answered":N,"total":M}` over every not-yet-ingested question (any round) | tell the user (quote `answered`/`total`); offer to re-run `/grill-with-ticktick` |
| 5 | auth (no token or 401) | point the user at `/setup-ticktick`; never ask for the token in chat |
| 6 | not found (no such effort, or its host note was deleted — `push`, `pull`, `close`, `wait`, `finish` never create the layout; only `takeover` does) | offer to re-push the round (`takeover` then `push`) |

## `push` stdin (round JSON)
```json
{
  "effort": "tickgrill-auth",
  "round": 2,
  "host": { "goal": "…", "decided": ["…(r1.2)"], "open": ["r2.1 … — ⭐ …"], "notAsked": ["…"] },
  "questions": [
    { "key": "r2.1", "title": "Where does the token live?", "context": "1–3 lines",
      "rec": { "label": "~/.config/tt-grill/token", "why": "survives uninstall" },
      "options": ["~/.config/tt-grill/token", "${CLAUDE_PLUGIN_DATA}", "env only"] }
  ]
}
```
Rules: `effort` must equal `--effort` and satisfy the effort-name rule (`conventions.md`); `round` ≥ 1; `key` matches `^r\d+\.\d+$` and is unique; `title` ≤ 80 chars, without the `[i/N] ` prefix (`push` adds it); `rec.label` ∈ `options`; `options` must be non-empty with no empty strings and no duplicates, and no option may start with the recommended-item prefix `⭐ ` or equal the reserved item `Other → type after ✍️` — the CLI adds the `⭐ ` prefix to `rec.label` and appends the Other item itself, so never include either in `options`. `push` against an effort that was never taken over (`takeover`) exits 6 (not found) — it never creates the layout. `host.*` is the prose for the host note; keep `open` entries as `r2.1 <title> — ⭐ <rec label>`.

Round guards (exit 2, before any write): `round` lower than the host's `round` is refused (`round N is behind the host (round M)`); a `round` higher than the host's may not reuse a key that already exists in TickTick (pushlog or a child's footer) — a new round must use new keys. Re-pushing the host's current round is the idempotent case.

Output: `{listId, hostId, owner, gen, round, questions:[{key, taskId, created}]}` (`questions` in key order). Each stored title is `[i/N] <title>` (position in `questions` / count); each desc ends with a `Next →` link to the next question (the last to the host note), so questions are created last-first — see `conventions.md`. Re-running `push` with the same round is safe (`created:false`), even if the local pushlog was lost: existing questions are adopted by their footer key. Creates (`POST /task`, and `takeover`'s folder/list/column/host/tag) are **never auto-retried** on a network error, timeout or 5xx, because the create may have committed: `push` exits 1, and the fix is to re-run the same `push` — it adopts whatever was created by footer and creates only what is still missing. `push` re-reads the host owner right before writing the host (exit 3 if a takeover happened meanwhile).

## `pull` output
```json
{ "host": { "id": "…", "etag": "…", "owner": "o_…", "gen": 3, "round": 2, "body": "…", "prose": "…", "hasBlock": true },
  "questions": [ { "key": "r2.1", "taskId": "…", "etag": "…", "status": 0, "title": "[1/3] …", "position": 1, "total": 3,
      "items": [ { "title": "⭐ …", "ticked": true, "isRec": true, "isOther": false } ],
      "desc": "…", "descChanged": false, "answerText": "", "signal": "tick", "ingested": false } ],
  "truncated": false }
```
The host is read from `GET /project/{listId}/data` (as `wait` does on every poll), so a deleted host note is exit 6. `hasBlock:false` = the host body has no readable state block (owner/gen/round then read as null/0/0); run `takeover`.

`signal` ∈ `none | tick | text | tick+text | other-only | done | wontdo | missing | unknown` (mechanical; see `ingest.md` for meaning). `unknown` appears only with `truncated:true`: the question is in the pushlog but the capped filter did not return it, so it may still exist — it is neither final nor touched for `wait`, and `close` skips it. Questions are sorted by key and include earlier rounds.

`title` is the stored title as-is, including the `[i/N] ` prefix `push` adds; `position`/`total` are `i`/`N` parsed from it, `null` when the title has no prefix (a task pushed before the prefix existed, or a title edited on the phone) and for `missing`/`unknown` questions. `answerText` is the text after `✍️ Answer:` up to the `Next →` link line (never including it); `null` when the marker is gone.

`ingested` (every question, including `missing` ones): `true` once a previous `close` set this question to answered (`answered` → status 2) or won't-do (`wontdo` → status −1); `reopen` does not set it. `drop` sets it for a `missing` question. `false` when unknown. It lives in the local pushlog, so on another machine it reads `false`. A closed question keeps its `tick`/`text` signal, so use `ingested`, not `status`, to tell a consumed answer from a new one.

`truncated:true` = the 200-task filter cap was hit. Warn the user and continue with what you got; questions beyond the cap read as `unknown` (never `missing`) until older ones are archived via `finish`.

## `close` stdin / output
stdin `{"answered": ["r2.1"], "wontdo": ["r2.3"], "reopen": ["r2.2"], "drop": ["r2.4"], "host": {"goal": "…", "decided": ["…"], "open": ["…"], "notAsked": ["…"]}}` (each optional) → `{closed, wontdo, reopened, dropped, skipped}`. `host` has the same shape as in round JSON; when present, `close` rewrites the host prose with it (state block and owner/gen/round unchanged) after the owner check and **before** any status write, so what you ingested is stored in TickTick before it is marked consumed — always send the updated `decided`/`open` lists. The owner is re-checked after the status writes and before the `ingested` lines (exit 3 → nothing is marked ingested; the new owner sees those answers). A key that appears in more than one of `answered` / `wontdo` / `reopen` / `drop` is a usage error (exit 2) — every key you send must be unique across the whole call. A key `close` can't resolve to a task lands in `skipped`, not an error. Status-only writes (2 / −1 / 0); descriptions and items are never rewritten. Every key actually set to 2 or −1 is recorded as ingested (see `pull`). `drop` is for `missing` (deleted) questions: each such key is recorded as ingested with **no** TickTick write and listed in `dropped`; a `drop` key that is not currently `missing` lands in `skipped`. While the filter is truncated, any `drop` is refused (exit 2, `cannot drop while the filter is truncated`) before any write.

## `takeover` → `{owner, gen, created, listId, hostId}` — creates folder/list/host/tag when missing. Refuses (exit 2) a list of the same name in `Claude` that has no `📍 <effort>` host and is not empty; an empty one is adopted. If the host has no readable state block, `round` is rebuilt as the highest `r<N>` among its questions' footer keys (0 if none).
## `wait` → `{reason: "all" | "settled", …full pull output…}`; exit 3 / 4 / 6 as above. It judges **every question with `ingested:false`**, of any round: `all` = every one of them is final (answered / `done` / `wontdo` / `missing`; `unknown` is not final); `settled` = at least one is answered or `other-only` and nothing changed for `--settle`. Answers already consumed by `close` (`ingested:true`) never end a wait; an earlier round's still-open question does. Each poll is one tag filter + one `GET /project/{listId}/data` (the host is read from there; a deleted host → exit 6). Defaults `--every 3m --settle 10m --grace 90s --max 72h`; every duration must be > 0 (exit 2 otherwise).
## `finish --effort E --owner O` → `{effort, listId, prose, decisions:[{key, title, signal, status, ticked, answerText}], archived: true}` — archives the list. Exit 3 if `O` is not the host's owner (nothing archived).
## `efforts` → `[{effort, listId, hostId, owner, round, open, answered}]`. Lists whose name breaks the effort-name rule are skipped.
## `auth status` → `{ok: true, projects: N}`.
