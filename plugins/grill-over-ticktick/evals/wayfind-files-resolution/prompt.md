---
name: wayfind-files-resolution
tags: [wayfind-with-ticktick, filing]
max_turns: 20
---
Create this fixture with plain file writes in the current directory (git repo; `git init -q`), commit it, then stage an unrelated change (`echo x > notes.txt && git add notes.txt`) and leave it staged. Then run /wayfind-with-ticktick demo-map 01. TickTick is not set up, so takeover will exit 5; that is expected. After the skill stops, I answer in the terminal: 'Use Redis, 5 minute TTL'. That is my decision; file ticket 01 with it using the Resolve steps 1–3 in references/wayfinding.md (claim it first if needed; the final tt-grill close will also exit 5, just report it).

docs/agents/issue-tracker.md: "# Issue tracker: Local Markdown\n\nIssues live in `.scratch/`."
.scratch/demo-map/map.md: "# Demo map\n\n## Destination\nPick a cache\n\n## Decisions so far\n"
.scratch/demo-map/issues/01-choose.md: "# Choose cache\nType: grilling\n\n## Question\nWhich cache and TTL?"
