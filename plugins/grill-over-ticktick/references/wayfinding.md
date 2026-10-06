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
- Treat CRLF like LF; compare keys case-insensitively; ignore trailing spaces. When writing (Claim, Resolve), keep the file's existing line endings (CRLF stays CRLF).
- `Blocked by:` lists ticket numbers. A number with no file counts as **not resolved** (blocked).

## Frontier

Scan `.scratch/<effort>/issues/` in numeric order. `Status:` values:
- empty or `open`: a frontier candidate;
- `claimed`: resumable or claimed by someone else (below);
- `resolved`: done;
- any other value (e.g. `closed`, `wontfix`): not on the frontier, **not** resolved for `Blocked by:` purposes, and reported to the user in the "what remains" list.

A ticket is on the frontier when its `Status:` is empty or `open` and it is unblocked (every number in `Blocked by:` has a file whose `Status:` is `resolved`). The lowest number wins. Order of picking: Recovery first (below), then a resumable ticket, then the frontier.

**Resumable:** any ticket with `Status: claimed` and a `Claimed-by: tt-grill` line, whatever owner it names (that owner string is stale after a new takeover; Claim rewrites it to the new owner). Offer a resumable ticket before the frontier. If `tt-grill pull --effort "<E>"` exits 6 (the effort was never created), no ticket is resumable. A `claimed` ticket with no `Claimed-by: tt-grill` line is claimed by someone else: skip it.

When nothing can be picked, report what remains and why: blocked / non-grilling / claimed by someone else / other status (`closed`, `wontfix`, …) / none.

## Recovery

`Status: resolved` is written before the commit, so a failed commit or a crash leaves a resolved ticket that the frontier skips. Before picking a frontier ticket, look for a ticket whose file has `## Answer` and `Status: resolved` AND either (a) `git status --porcelain -- "<ticket path>"` shows uncommitted changes, or (b) `map.md`'s Decisions so far has no line linking `issues/NN-<slug>.md`. Uncommitted edits to `map.md` alone do not trigger Recovery: they may be hand edits or another session's. For such a ticket finish only the missing Resolve steps (Idempotency decides which; do not re-grill), then continue. The `close` step (step 4, and thus `takeover`) runs in Recovery only when it finds un-ingested remaining questions of the ticket to retire or the card's Decided lacks the gist; otherwise skip it.

## Claim

Re-read the file. If its `Status:` is `resolved`, refuse it (also when `NN` was given explicitly: say it is already resolved and stop). If it is `claimed` with no `Claimed-by: tt-grill` line, it is claimed by someone else: skip it and pick the next frontier ticket (with an explicit `NN`, say so and stop). Otherwise write `Status: claimed` (replace an existing `Status:` line, else insert after `Type:`, else after the title) and a `Claimed-by: tt-grill <owner>` line right after it; a resumable ticket's existing `Claimed-by:` line is rewritten to the new owner. Keep the file's line endings. Do not commit the claim.

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
3. Commit exactly those two paths, no push. `<map path>` is `.scratch/<effort>/map.md`, `<ticket path>` is `.scratch/<effort>/issues/NN-<slug>.md`. First run `git check-ignore -q -- "<map path>" "<ticket path>"`: if it matches (exit 0), tell the user `.scratch/` is gitignored and ask whether to `git add -f` those two paths or to file without a commit for this map; never silently skip the commit and never report the ticket as committed when it was not. Quote every path and pass the message through a quoted heredoc:
   ```bash
   git add -- "<map path>" "<ticket path>"
   git commit -F - -- "<map path>" "<ticket path>" <<'MSG'
   wayfinder(<effort>): resolve NN <title>

   <gist>
   MSG
   ```
   Title and gist are data from the user/phone: never interpolate them into a double-quoted shell string. Staged changes to other files stay out (the `git commit -- <paths>` form limits the commit to those paths), but the whole of each file is committed, so unrelated staged or unstaged edits to `map.md` are swept into this commit. Never stage everything and never use the commit-all flag. If git fails (hooks, signing, identity), leave the files written, show git's error verbatim and stop; do not retry with `--no-verify` or `--no-gpg-sign` unless the user says so.
4. Host-only `tt-grill close`: run a fresh `tt-grill pull --effort "<E>"`. If any remaining `ingested: false` question of this ticket has an answer signal other than `none`, surface it first (one line: "answered on the phone after the last ingest: <key>") and ask whether it changes the resolution, instead of silently retiring it. Then put this ticket's remaining questions with `ingested: false` (their context starts with `Ticket NN · <title>`) into `wontdo` (superseded by the filed resolution); `answered`, `reopen`, `drop` empty; `host.decided` extended by the gist and `host.open` empty, so the TickTick card mirrors the map:
   ```bash
   tt-grill close --effort "<E>" --owner "<O>" <<'JSON'
   {"answered":[],"wontdo":["r3.2"],"reopen":[],"drop":[],"host":{"goal":"<goal>","decided":["<...prior>","<filed gist>"],"open":[],"notAsked":[]}}
   JSON
   ```

## Idempotency

| Effect | Present when | Then |
|---|---|---|
| `## Answer` written | ticket file has an `## Answer` heading | do not append a second one |
| `Status: resolved` | line says `resolved` | leave it |
| Decisions line | `map.md` already links `issues/NN-<slug>.md` under Decisions so far | do not append |
| Commit | `git check-ignore -q` first (porcelain prints nothing for ignored paths; if ignored, ask as in Resolve step 3), then `git status --porcelain -- <the two paths>` prints nothing | do not commit |
| `close` | the fresh `tt-grill pull` shows no `ingested: false` question of this ticket | send an empty `wontdo`; the host-only close is always safe to repeat, never skipped |

Re-running after a crash therefore only does what is missing.

## Map fields for the TickTick card

- `goal` = first non-empty line under the map's Destination heading.
- `decided` = the map's Decisions-so-far lines, reduced to `<title>: <gist>`.
- `notAsked` = the map's Not-yet-specified lines.
- `open` = `Ticket NN <title>` first, then one line per open question of the current round.
- Each question's `context` starts with `Ticket NN · <title>` on its own line.
