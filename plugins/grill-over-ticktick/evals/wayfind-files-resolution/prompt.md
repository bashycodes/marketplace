---
name: wayfind-files-resolution
tags: [wayfind-with-ticktick, filing]
max_turns: 20
---
Create this fixture with plain file writes in the current directory (git repo; `git init -q`), commit it, then stage an unrelated change (`echo x > notes.txt && git add notes.txt`) and leave it staged. Then run /wayfind-with-ticktick demo-map 01. Pretend TickTick is unreachable and I am typing in the terminal instead: when the skill asks question 1, I answer "Use Redis, 5 minute TTL". Treat that as converged and file the resolution.

docs/agents/issue-tracker.md: "# Issue tracker: Local Markdown\n\nIssues live in `.scratch/`."
.scratch/demo-map/map.md: "# Demo map\n\n## Destination\nPick a cache\n\n## Decisions so far\n"
.scratch/demo-map/issues/01-choose.md: "# Choose cache\nType: grilling\n\n## Question\nWhich cache and TTL?"
