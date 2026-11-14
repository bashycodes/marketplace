# Implementer brief template

Fill every `<…>`. Dispatch with worktree isolation and in the background.

```
Ticket <id>: <title>

Goal: <behaviour the owner will see, one or two sentences>
Acceptance (all must hold, measured): <numeric criteria from the ticket>
Blocked-by context: <what merged work this builds on, if any>

Setup: work in your own worktree on branch feat/<slug> off origin/<main>.
Use your own build output dir (e.g. CARGO_TARGET_DIR, a Gradle build dir or dist/ under <per-worktree path>).
Heavy builds: <the project's wrapper that waits for free RAM or a lock, if any>.

Standards: <coding standards doc>. Tests + lint: <commands>; commit only green.
Commit trailer: <project trailer>.

Fences:
- Commit on your branch only. The orchestrator pushes, merges and updates the tracker.
- Stop your own processes by PID; leave other processes alone (no pattern-matching kills).
- Owner content stays out of the repo; use synthetic stand-ins.
- <project hard rules>

Hand back (≤400 words): branch + head sha, what changed and why, how acceptance was measured with numbers, anything you decided that the owner might disagree with, follow-ups worth a ticket.
```
