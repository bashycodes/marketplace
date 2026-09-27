# Manual acceptance (phone + laptop)

Run once per release against the throwaway TickTick account. Effort name `acc-<date>`.

`tt-grill` is on PATH only inside Claude's Bash tool. In a human terminal use the absolute path (ask Claude to run `command -v tt-grill`, or use `<plugin root>/bin/tt-grill`).

Setup
- [ ] `/setup-ticktick` walks through auth in the user's own terminal, `auth status` prints `{ok:true,…}`.
- [ ] The setup test question appears in the smart list "🔥 Grill inbox" on the phone within a minute.

Round trip
- [ ] `/grill-with-ticktick acc-<date>` on a small topic: the host note `📍 acc-<date>` sits in column `📍`, questions are subtasks tagged `grill`, items show ⭐ first and `Other → type after ✍️` last.
- [ ] Tick one item on the phone → laptop `wait` returns `settled` after ~10 min of quiet or `all` once every question is answered; Claude reports the exact answer.
- [ ] Tick-only answers show `descChanged:false` in `tt-grill pull` (the app's re-serialisation is not an edit).
- [ ] Type after `✍️ Answer:` → ingested as text; the ticks are mentioned as context.
- [ ] Tick `Other` only → stays open; Claude does not treat it as answered.
- [ ] Swipe-complete a question without ticking → Claude reopens it and says it is still open.
- [ ] Mark a question won't-do → Claude drops it and notes it in the host prose.
- [ ] Delete a question → Claude drops it (signal `missing`) and does not re-create it.
- [ ] Tick two contradicting items → Claude re-asks in the next round with a note.
- [ ] Second round: `wait` does not return until a round-2 answer arrives (the closed round-1 answers do not end it); no duplicate questions are pushed.

Ownership
- [ ] While `wait` runs, start `/grill-from-ticktick acc-<date>` in a second session → the first session stops with "taken over"; open questions become won't-do; the grill continues in the terminal.
- [ ] Typing in the waiting session stops the wait and continues in the terminal.

Finish
- [ ] `tt-grill finish` archives the list; it disappears from `tt-grill efforts`.
- [ ] No token appears in any terminal output, including after a deliberate `TICKTICK_TOKEN=wrong tt-grill auth status` (exit 5, fixed message).
