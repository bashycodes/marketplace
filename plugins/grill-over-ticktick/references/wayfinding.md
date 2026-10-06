# Wayfinding recipe (local-markdown tracker)

Matt Pocock's `issue-tracker-local.md` ("Wayfinding operations") defines the file format; this page is how `wayfind-with-ticktick` and the ticket mode of `grill-with-ticktick` apply it. If the format and this page disagree, the tracker file in the user's repo (`docs/agents/issue-tracker.md`) wins; say so and follow it.

Layout: `.scratch/<effort>/map.md`, `.scratch/<effort>/issues/NN-<slug>.md` (NN from `01`). `<effort>` is the directory name and must satisfy the effort-name rule in `conventions.md`; if it does not, ask the user for a conforming TickTick effort name and use that for every `--effort` (the directory name stays as is).

## Reading a ticket

A ticket file has, near the top, these lines (any may be absent):

```
Type: grilling
Status: claimed
Claimed-by: tt-grill o_2vrj5b
Blocked by: 01, 03
```

and a `## Question` heading whose body is the question. Rules:
- Missing `Status:` means open. Missing `Type:` means `grilling` **only if** the body has `## Question`; otherwise skip the file and tell the user.
- Treat CRLF like LF; compare keys case-insensitively; ignore trailing spaces.
- `Blocked by:` lists ticket numbers. A number with no file counts as **not resolved** (blocked).

## Frontier

Scan `.scratch/<effort>/issues/` in numeric order. A ticket is on the frontier when it is open (`Status:` not `resolved`), unclaimed (`Status:` not `claimed`), and unblocked (every number in `Blocked by:` has a file whose `Status:` is `resolved`). The lowest number wins. A ticket that is `claimed` with a `Claimed-by: tt-grill` line is **resumable**: offer it before the frontier when `tt-grill pull --effort "<E>"` shows questions with `ingested: false`.

## Claim

Re-read the file, check it is still unclaimed, then write `Status: claimed` (replace an existing `Status:` line, else insert after `Type:`, else after the title) and a `Claimed-by: tt-grill <owner>` line right after it. Do not commit the claim. If the re-read shows `claimed` by someone else, pick the next frontier ticket.

## Resolve

Do the four steps in order; each is skipped when its effect is already present (see Idempotency).

1. Append to the ticket file:
   ```markdown
   ## Answer
   <the decision, 1–10 lines, in the user's terms; link assets by path>

   Decided over TickTick (<effort>, round <n>) on <YYYY-MM-DD>.
   ```
   then set `Status: resolved` and delete the `Claimed-by:` line.
2. Append to `map.md`, under `## Decisions so far` (create the heading at the end of the file if it is missing):
   `- [<ticket title>](issues/NN-<slug>.md): <one-line gist>`
3. Commit exactly those two paths, no push:
   ```bash
   git add -- .scratch/<effort>/map.md .scratch/<effort>/issues/NN-<slug>.md
   git commit -m "wayfinder(<effort>): resolve NN <title>" -m "<gist>" -- .scratch/<effort>/map.md .scratch/<effort>/issues/NN-<slug>.md
   ```
   (the `git commit -- <paths>` form limits the commit to those paths, even when other changes are staged). Never stage everything and never use the commit-all flag. If git fails (hooks, signing, identity), leave the files written, show git's error verbatim and stop; do not retry with `--no-verify` or `--no-gpg-sign` unless the user says so.
4. `tt-grill close` with `host.decided` extended by the gist, so the TickTick card mirrors the map.

## Idempotency

| Effect | Present when | Then |
|---|---|---|
| `## Answer` written | ticket file has an `## Answer` heading | do not append a second one |
| `Status: resolved` | line says `resolved` | leave it |
| Decisions line | `map.md` already links `issues/NN-<slug>.md` under Decisions so far | do not append |
| Commit | `git log -1 --format=%H -- <ticket path>` is newer than the `## Answer` edit, i.e. `git status --porcelain -- <the two paths>` is empty | do not commit |
| `close` | `tt-grill pull` shows the question keys with `ingested: true` | skip |

Re-running after a crash therefore only does what is missing.

## Map fields for the TickTick card

- `goal` = first non-empty line under the map's Destination heading.
- `decided` = the map's Decisions-so-far lines, reduced to `<title>: <gist>`.
- `notAsked` = the map's Not-yet-specified lines.
- `open` = `Ticket NN <title>` first, then one line per open question of the current round.
- Each question's `context` starts with `Ticket NN · <title>` on its own line.
