---
name: grill-with-ticktick
description: Relay a grilling round (Matt Pocock's /grill-me) to TickTick so the user answers from their phone, wait at zero token cost, ingest the answers and keep grilling. Use when the user says "grill me over ticktick", "send the questions to my phone", "I'll answer later on my phone", or invokes /grill-with-ticktick.
argument-hint: "[effort] [--once]"
---

# Grill with TickTick

You run the `grilling` skill's interview, but each round goes to TickTick instead of the terminal. Read `${CLAUDE_PLUGIN_ROOT}/references/conventions.md` (layout), `${CLAUDE_PLUGIN_ROOT}/references/round-schema.md` (JSON + exit codes) and `${CLAUDE_PLUGIN_ROOT}/references/ingest.md` (how answers are read) before the first round. `tt-grill` is on your PATH; call it with the Bash tool and parse its stdout JSON. Every failure is a JSON object on stderr with an exit code from the table in `round-schema.md`.

## Procedure

1. **Effort name.** If `$ARGUMENTS` gives none, propose `<repo>-<topic>` (kebab-case, ≤ 40 chars) and confirm it in the terminal — the user is at the laptop right now. Quote it in every command: `--effort "<E>"`.
2. **Take over:** `tt-grill takeover --effort "<E>"` → remember `owner` as `<O>` for this conversation. Exit 5 → tell the user to run `/setup-ticktick` and stop.
3. **Ingest first** (answers may be waiting from an earlier session): follow `ingest.md`. If the host already has open questions of the current round, do not re-ask them.
4. **Build the round** exactly as `grilling` would: recompute the frontier, number the questions `r<round>.<n>` where `<round>` = host `round` + 1 (start at 1), give each a ≤ 80-char title, 1–3 lines of context, a recommended answer with a one-line why, and 2–5 options. Write the host prose (`goal`, `decided`, `open`, `notAsked`). Send it: `tt-grill push --effort "<E>" --owner "<O>"` with the round JSON on stdin (use a heredoc: `tt-grill push … <<'JSON' … JSON`).
5. **Tell the user** the round is in TickTick ("N questions in 🔥 Grill inbox, round R") and that they can also just type here to continue in the terminal.
6. **Wait in the background:** `tt-grill wait --effort "<E>" --owner "<O>"` with the Bash tool's `run_in_background: true`. Do nothing else while it runs; it costs no tokens.
7. **When the wait returns:**
   - exit 0 → ingest (`ingest.md`; the wait output already contains the `pull` result, but run `pull` again if the ingest is more than a minute later). Recompute the frontier. Empty frontier → finish as `grilling` does: state the shared understanding, then hand back to the user; offer `tt-grill finish --effort "<E>"` (archives the list) and run it only if they agree. Otherwise push the next round (step 4). With `--once` in `$ARGUMENTS`, stop after one push + wait + ingest.
   - exit 3 → another session took over; say so and stop.
   - exit 4 → nothing answered within the limit; say so and offer to re-run this skill later.
   - exit 5 / 6 → per `round-schema.md`.
8. **If the user types anything while the wait is running:** stop the background task (TaskStop) and continue in the terminal: follow `${CLAUDE_PLUGIN_ROOT}/skills/grill-from-ticktick/SKILL.md` from its step 2 (ingest, then won't-do the open questions, then grill live). Do not take over again — you already own the effort.

## Rules
- The decisions are the user's. Never answer a question for them, never treat ⭐ as accepted, never invent an answer for a `none` / `other-only` question.
- Facts are yours to find (sub-agents, files); only decisions go to TickTick.
- Never read the token file or ask for the token. Never call TickTick directly; only `tt-grill`.
- One `wait` at a time. If you lost `<O>` (compaction), run `takeover` again.
