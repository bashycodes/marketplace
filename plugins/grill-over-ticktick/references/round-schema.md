# tt-grill JSON contract

All commands print one JSON value on stdout and `{"error":"<code>","message":"…",…}` on stderr on failure. Run them with the Bash tool; parse stdout.

## Exit codes
| code | meaning | what the skill does |
|---|---|---|
| 0 | ok | continue |
| 1 | error (network exhausted, unexpected 5xx) | report; may retry the same command once |
| 2 | usage (bad args / stray positional argument — only `auth status` takes one / bad stdin JSON / text > 100 000 chars) | fix the input, do not retry blindly |
| 3 | taken over — another session owns this effort | stop this mode, tell the user |
| 4 | `wait` gave up (`--max` reached); stderr carries `{"error":"gave_up","message":"…","answered":N,"total":M}` over the current round's not-yet-ingested questions | tell the user (quote `answered`/`total`); offer to re-run `/grill-with-ticktick` |
| 5 | auth (no token or 401) | point the user at `/setup-ticktick`; never ask for the token in chat |
| 6 | not found (no such effort / host — `push`, `pull`, `close`, `wait`, `finish` never create the layout; only `takeover` does) | offer to re-push the round (`takeover` then `push`) |

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
Rules: `effort` must equal `--effort`; `round` ≥ 1; `key` matches `^r\d+\.\d+$` and is unique; `title` ≤ 80 chars; `rec.label` ∈ `options`; `options` must be non-empty with no empty strings and no duplicates, and no option may start with the recommended-item prefix `⭐ ` or equal the reserved item `Other → type after ✍️` — the CLI adds the `⭐ ` prefix to `rec.label` and appends the Other item itself, so never include either in `options`. `push` against an effort that was never taken over (`takeover`) exits 6 (not found) — it never creates the layout. `host.*` is the prose for the host note; keep `open` entries as `r2.1 <title> — ⭐ <rec label>`.

Output: `{listId, hostId, owner, gen, round, questions:[{key, taskId, created}]}`. Re-running `push` with the same round is safe (`created:false`).

## `pull` output
```json
{ "host": { "id": "…", "etag": "…", "owner": "o_…", "gen": 3, "round": 2, "body": "…", "prose": "…" },
  "questions": [ { "key": "r2.1", "taskId": "…", "etag": "…", "status": 0, "title": "…",
      "items": [ { "title": "⭐ …", "ticked": true, "isRec": true, "isOther": false } ],
      "desc": "…", "descChanged": false, "answerText": "", "signal": "tick", "ingested": false } ],
  "truncated": false }
```
`signal` ∈ `none | tick | text | tick+text | other-only | done | wontdo | missing` (mechanical; see `ingest.md` for meaning). Questions are sorted by key and include earlier rounds.

`ingested` (every question, including `missing` ones): `true` once a previous `close` set this question to answered (`answered` → status 2) or won't-do (`wontdo` → status −1); `reopen` does not set it. `false` when unknown; a `missing` question can never be closed, so its flag never changes — ignore it (see `ingest.md`). It lives in the local pushlog, so on another machine it reads `false`. A closed question keeps its `tick`/`text` signal, so use `ingested`, not `status`, to tell a consumed answer from a new one.

`truncated:true` = the 200-task filter cap was hit. Warn the user and continue with what you got; questions beyond the cap are invisible until older ones are archived via `finish`.

## `close` stdin / output
stdin `{"answered": ["r2.1"], "wontdo": ["r2.3"], "reopen": ["r2.2"]}` (each optional) → `{closed, wontdo, reopened, skipped}`. A key that appears in more than one of `answered` / `wontdo` / `reopen` is a usage error (exit 2) — every key you send must be unique across the whole call. A key `close` can't resolve to a task lands in `skipped`, not an error. Status-only writes (2 / −1 / 0); descriptions and items are never rewritten. Every key actually set to 2 or −1 is recorded as ingested (see `pull`).

## `takeover` → `{owner, gen, created, listId, hostId}` — creates folder/list/host/tag when missing.
## `wait` → `{reason: "all" | "settled", …full pull output…}`; exit 3 / 4 / 6 as above. It judges only the **current round's** questions (`key` starts with `r<host.round>.`) with `ingested:false`: `all` = every one of them is final (answered / `done` / `wontdo` / `missing`); `settled` = at least one is answered or `other-only` and nothing changed for `--settle`. Earlier rounds never end a wait. Defaults `--every 3m --settle 10m --grace 90s --max 24h`; every duration must be > 0 (exit 2 otherwise).
## `finish` → `{effort, listId, prose, decisions:[{key, title, signal, status, ticked, answerText}], archived: true}` — archives the list.
## `efforts` → `[{effort, listId, hostId, owner, round, open, answered}]`.
## `auth status` → `{ok: true, projects: N}`.
