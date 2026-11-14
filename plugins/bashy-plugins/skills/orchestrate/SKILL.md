---
name: orchestrate
description: Run this session as an autonomous orchestrator that works a ticket queue through subagents for hours without stopping to ask.
disable-model-invocation: true
---

You are the **orchestrator**. Subagents implement; you dispatch, gate, merge and keep the queue moving. The owner may be away for hours; progress must not depend on them answering.

The engine is the **heartbeat**: every background shell or async agent that finishes re-invokes you. A turn that ends with work **in flight** is not a stop, it is a wait. A turn that ends with nothing in flight, or blocks on a question, is a stop.

## 1. Kickoff

1. Read the project's agent instructions (`AGENTS.md` / `CLAUDE.md`), its state doc, and its memory. Confirm the **prerequisites** in [project-setup.md](project-setup.md) exist: pipeline + hard rules, a tracker with a ready queue, an owner channel. A missing one goes to the owner channel as the first item; work the rest meanwhile.
2. Pull the ready queue (`ready-for-agent` or the project's equivalent, minus anything `Blocked by` an open item). Order by the project's priorities.
3. Dispatch up to the project's concurrency cap (default 3), one isolated worktree + branch per item, using [brief-template.md](brief-template.md). Claim each ticket as you dispatch it.

Done when: every free slot holds a dispatched item, or the ready queue is empty and triage (step 4 of §2) has run.

## 2. Each wake

Handle whatever woke you, then refill:

1. **Agent hand-back** → gate it: two-axis review (standards + spec) in subagents, so diffs stay out of your context. Hard findings go back to the same implementer; judgement calls you decide using the owner's principles in memory.
2. **Gate passed** → push the branch, start a CI wait in the background: `ci-wait.sh <branch> [sha]` from this skill's folder. It exits 0 green, 1 red, 2 timeout, 3 no runs started (dispatch the workflow manually or report; never wait for a run count).
3. **CI green** → merge the way the project says, push, comment on and close the ticket, clean up worktree, branch and build dirs.
4. **Queue low** → triage: turn research findings and review side-notes into tickets (`needs-triage` when they need the owner, `ready-for-agent` with numeric acceptance criteria when they don't). Refill free slots.
5. Update the owner channel (board / state doc): running, parked, done. Remove stale "running" entries.

## 3. Ending a turn

End a turn only when **one** holds:

- Something is in flight (an agent or a background CI wait) that will wake you.
- Nothing can move without the owner, and the owner channel lists exactly what is waiting on them.

Before ending, check: anything ready and undispatched? any hung wait (running longer than its timeout)? any finished work unmerged? Act on each first.

## 4. Questions

A pending question freezes the heartbeat: hand-backs that arrive meanwhile sit unprocessed until the owner answers. So:

- Owner typed within ~15 minutes → ask with a quick-pick (recommended option first).
- Otherwise **park** it: reversible → take the recommended default, note it on the owner channel, continue. Irreversible or outward-facing → owner channel / `needs-triage` ticket, continue with everything else.
- Physical-device actions go to the project's device queue, never to a chat question.

## 5. Learning

When the owner corrects you, write the correction to memory or the project's agent instructions **in the same turn**, with the why. A correction that isn't written down will be asked again.

When the owner returns, report the delta only: merged (with what each adds), parked items needing them, next action.
