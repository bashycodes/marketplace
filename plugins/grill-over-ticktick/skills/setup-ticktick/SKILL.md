---
name: setup-ticktick
description: One-time setup for grill-over-ticktick — store the TickTick API token in the user's own terminal, verify it, and push a test question to the phone.
disable-model-invocation: true
argument-hint: ""
---

# Set up TickTick for grilling

Never accept, display or read a token. The token is typed by the user in **their own terminal**, not through you.

1. **Explain** in three lines: TickTick web app → avatar → Settings → Account → **API Token** → create and copy it. First run `command -v tt-grill` with the Bash tool (`tt-grill` is on PATH only inside your Bash tool, not in the user's terminal) and give the user that **absolute path** — in case `${CLAUDE_PLUGIN_ROOT}` below was not substituted. Then, in a terminal outside Claude (the command needs a real TTY), they run:
   ```
   "${CLAUDE_PLUGIN_ROOT}/bin/tt-grill" auth
   ```
   (or `"<absolute path>" auth` with the path you found). It prompts for the token without echoing it, checks it against TickTick and stores it at `~/.config/tt-grill/token` (mode 0600). Suggest `! "${CLAUDE_PLUGIN_ROOT}/bin/tt-grill" auth` only if their harness lets `!` commands attach to the terminal; otherwise a separate terminal window.
2. **Verify:** when they say it is done, run `tt-grill auth status`. Expect `{"ok":true,"projects":N}`. Exit 5 → ask them to repeat step 1 (wrong or empty token). Exit 1 → network problem; show the message.
3. **Smart list:** ask whether they have a smart list named "🔥 Grill inbox" filtering on tag `grill`. If not: TickTick → Smart Lists → + → name `🔥 Grill inbox`, condition Tag = `grill`, save.
4. **Test round:** `tt-grill takeover --effort "setup-test"`; `<O>` below is the `owner` field of that command's JSON output. Then push (see `${CLAUDE_PLUGIN_ROOT}/references/round-schema.md`):
   ```bash
   tt-grill push --effort "setup-test" --owner "<O>" <<'JSON'
   {"effort":"setup-test","round":1,
    "host":{"goal":"Confirm TickTick relay works","decided":[],"open":["r1.1 Did this reach your phone? — ⭐ yes"],"notAsked":[]},
    "questions":[{"key":"r1.1","title":"Did this reach your phone?","context":"Tick one item to confirm the relay works.","rec":{"label":"yes","why":"it should"},"options":["yes","no"]}]}
   JSON
   ```
   Tell them to open 🔥 Grill inbox on the phone and tick an item, then run `tt-grill wait --effort "setup-test" --owner "<O>" --every 15s --settle 2m --max 10m` in the background. Read the result per `${CLAUDE_PLUGIN_ROOT}/references/ingest.md` and confirm what they ticked.
5. **Clean up:** `tt-grill finish --effort "setup-test"`. Say that `/grill-with-ticktick` is ready.
