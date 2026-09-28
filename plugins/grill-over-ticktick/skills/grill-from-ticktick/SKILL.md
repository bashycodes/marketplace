---
name: grill-from-ticktick
description: Take a grilling session that is running over TickTick back into the terminal — ingest whatever the user answered on the phone, retire the rest, and continue the interview live. Use when the user says "let's finish this here", "bring the grill back", "continue in the terminal", or invokes /grill-from-ticktick.
argument-hint: "[effort]"
---

# Grill from TickTick (back to the terminal)

Read `${CLAUDE_PLUGIN_ROOT}/references/ingest.md` and `${CLAUDE_PLUGIN_ROOT}/references/round-schema.md`. `tt-grill` is on your PATH.

1. **Effort.** From `$ARGUMENTS` (it must satisfy the effort-name rule in `${CLAUDE_PLUGIN_ROOT}/references/conventions.md`; `tt-grill` exits 2 otherwise); if missing, run `tt-grill efforts` and let the user pick (show effort, round, open, answered). Exit 5 → `/setup-ticktick`.
2. **Take over:** `tt-grill takeover --effort "<E>"` → `<O>`. This makes any session that is still waiting exit with code 3; that is intended.
3. **Ingest and retire in one go.** Run `ingest.md` steps 1–4 only (pull, interpret, record). Then send exactly ONE close — no `reopen` in this mode:
   - `answered` = the keys you took answers from;
   - `wontdo` = every question of **any** round with `ingested: false` whose signal is `none`, `other-only`, `done` or `wontdo` (set on the phone), plus the re-ask cases from `ingest.md` (empty-answer `text`, contradicting ticks).
   - `drop` = every `missing` key with `ingested: false` (deleted on the phone; consumed with no TickTick write).
   ```bash
   tt-grill close --effort "<E>" --owner "<O>" <<'JSON'
   {"answered": ["r2.1"], "wontdo": ["r1.3", "r2.2"], "drop": ["r2.4"]}
   JSON
   ```
   Summarise what you learned in two or three lines and name the retired questions; the live round re-asks what still matters.
4. **Continue live** with the `mattpocock-skills:grilling` skill's format in the terminal (load it with the Skill tool; if it is not installed, use the same format inline: rounds, numbered questions, recommended answers, wait for the user). Keep numbering rounds after the host's `round`.
5. **On finish** (empty frontier): state the shared understanding as `grilling` does. Ask whether to archive the TickTick list; only then run `tt-grill finish --effort "<E>" --owner "<O>"`.

Rules: decisions are the user's; never accept ⭐ on their behalf; never read the token or ask for it; never talk to TickTick except through `tt-grill`.
