# orchestrate

Turn a Claude Code session into an autonomous orchestrator. It works a ticket queue for hours while you're away. Subagents implement each ticket in their own git worktree; the orchestrator reviews their work, pushes, waits for CI, merges, closes the ticket and dispatches the next one.

> **It acts without asking.** Once your project's `AGENTS.md` authorizes the pipeline, the orchestrator pushes branches, merges into your main branch and closes tickets on its own. Without that authorization it refuses to push or merge: it drafts the `AGENTS.md` section for you to approve first.

## Use

```
/bashy-plugins:orchestrate work the ready queue; park owner items on the board
```

User-invoked only; Claude never starts it by itself. The full launch recipe, including a fallback `/loop` heartbeat, is in [project-setup.md](../skills/orchestrate/project-setup.md#launch-recipe).

To stop it, interrupt the session (Esc) or tell it to stop. Background agents and CI waits it started can be stopped with `/tasks`.

## What your project needs first

Listed with the reason for each in [project-setup.md](../skills/orchestrate/project-setup.md):

- `AGENTS.md` with the pipeline (stated as authorized) and a few hard rules. A copyable section is at the bottom of project-setup.md.
- A tracker with a ready queue (`ready-for-agent` tickets with measurable acceptance criteria) and a doc on how to read and update it.
- An owner channel: a board or state doc where it lists what waits on you.

## Requirements

- Claude Code with the Agent tool (worktree isolation, background agents) and background Bash tasks. Finished background work is what wakes the orchestrator.
- An auto or permissive permission mode, so tool calls don't stop on prompts.
- GitHub Actions for CI, plus `gh` (authenticated) and `jq` for `ci-wait.sh`.
- Optional: `mattpocock-skills`. Its `code-review` skill is the two-axis review the orchestrator runs on each hand-back, and its tracker tags (`ready-for-agent`, `needs-triage`) are the ones the skill expects.

## Files

| Path | Purpose |
|---|---|
| `skills/orchestrate/SKILL.md` | The loop: kickoff, each wake, when a turn may end, questions, learning |
| `skills/orchestrate/project-setup.md` | Prerequisites, launch recipe, a minimal `AGENTS.md` section |
| `skills/orchestrate/brief-template.md` | The brief each implementer subagent gets |
| `skills/orchestrate/ci-wait.sh` | Waits for every GitHub Actions run on one commit. Exits 0 green, 1 red, 2 timeout, 3 no runs, 4 usage/`gh`/`jq` error |
