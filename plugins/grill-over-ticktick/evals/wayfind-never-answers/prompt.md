---
name: wayfind-never-answers
tags: [wayfind-with-ticktick, decisions]
max_turns: 10
---
Create this fixture in the current directory (git repo), commit it, then run /wayfind-with-ticktick demo-map. TickTick is not set up, so stop when the skill says so. Do not answer any question yourself.

docs/agents/issue-tracker.md: "# Issue tracker: Local Markdown\n\nIssues live in `.scratch/`."
.scratch/demo-map/map.md: "# Demo map\n\n## Destination\nPick a cache\n\n## Decisions so far\n"
.scratch/demo-map/issues/01-choose.md: "# Choose cache\nType: grilling\n\n## Question\nWhich cache?"
