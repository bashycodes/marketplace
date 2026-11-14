# Project prerequisites for /orchestrate

Autonomy is earned before the run: every question the owner answers once must become a standing answer somewhere below. Each missing item is a future stop.

| Prerequisite | What it holds | Replaces the question |
|---|---|---|
| Pipeline in `AGENTS.md` | review → push → CI → merge → close, stated as already authorized | "may I merge/push?" |
| Hard rules in `AGENTS.md` | the few things never to do (force-push, push unreviewed work, secrets, …) | "is this safe?" |
| Auto / permissive permission mode | tool calls run without prompts | permission prompts |
| Tracker + how-to-call-it doc | any tracker (GitHub issues, local markdown, …); tags (`ready-for-agent`, `needs-triage`, `in-progress`, as in mattpocock-skills), `Blocked by:` lines, and the exact commands or API arguments to read and update tickets | "what next?" |
| Tickets with numeric criteria | measurable acceptance per ticket | "is it done?" |
| Owner principles in memory | how the owner decides trade-offs | "which way?" |
| Owner channel | board / state doc listing todo-for-owner, running, parked, done | blocking questions |
| Device queue (only if the project needs physical devices) | a file of pending physical actions the owner clears in batches | "can you plug in / test …?" |
| Self-serve verification | whatever lets agents check their own work (e.g. remote access to test devices, CI builds signed with the release key) | "can you check it works?" |
| Build safety | per-agent worktree + build dir, concurrency cap, and for heavy builds a wrapper that waits for free RAM or a lock before starting | collisions, OOM |
| CI triggers on every branch prefix agents push | so CI waits always see runs | hung waits |

## Launch recipe

1. Run as a background job, auto mode on.
2. Kickoff prompt: `/bashy-plugins:orchestrate` plus the goal, e.g. "work the ready queue; park owner items on the board".
3. Owner starts a fallback heartbeat with the `/loop` skill: `/loop 1h orchestrator check-in: kill hung waits, refresh board, dispatch next ticket`. It catches hung waits when nothing else wakes the session.

## Minimal AGENTS.md section

```markdown
## Your role: orchestrator
- Subagents implement, each in its own worktree on `feat/<slug>` off `<main>`; they never push or touch the tracker.
- Per branch (authorized, no need to ask): two-axis review → push → CI green → `git merge --no-ff` into `<main>` → push → comment on + close ticket → clean up.
  (Protected `<main>`? Replace the merge + push with `gh pr create` + `gh pr merge --merge` once CI is green.)
- Tracker: <where>, tags <…>, call shapes in <doc>.
- Owner channel: <board / file>. Device queue: <file>.

## Hard rules
- <never …>
```
