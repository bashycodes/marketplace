---
name: grill-from-ticktick
description: Take a grilling session that is running over TickTick back into the terminal — ingest whatever the user answered on the phone, retire the rest, and continue the interview live. Use when the user says "let's finish this here", "bring the grill back", "continue in the terminal", or invokes /grill-from-ticktick.
argument-hint: "[effort]"
---

# Grill from TickTick (back to the terminal)

Read `${CLAUDE_PLUGIN_ROOT}/references/ingest.md` and `${CLAUDE_PLUGIN_ROOT}/references/round-schema.md`. `tt-grill` is on your PATH.

1. **Effort.** From `$ARGUMENTS`; if missing, run `tt-grill efforts` and let the user pick (show effort, round, open, answered). Exit 5 → `/setup-ticktick`.
2. **Take over:** `tt-grill takeover --effort "<E>"` → `<O>`. This makes any session that is still waiting exit with code 3; that is intended.
3. **Ingest** everything answered so far (`ingest.md`). Summarise what you learned in two or three lines.
4. **Retire the rest:** every question of the current round that is still `none` or `other-only` goes into `close … {"wontdo": [...]}` together with the `answered` / `reopen` lists from step 3. Tell the user which ones you retired; the live round re-asks what still matters.
5. **Continue live** with the `grilling` skill's format in the terminal (rounds, numbered questions, recommended answers, wait for the user). Keep numbering rounds after the host's `round`.
6. **On finish** (empty frontier): state the shared understanding as `grilling` does. Ask whether to archive the TickTick list; only then run `tt-grill finish --effort "<E>"`.

Rules: decisions are the user's; never accept ⭐ on their behalf; never read the token or ask for it; never talk to TickTick except through `tt-grill`.
