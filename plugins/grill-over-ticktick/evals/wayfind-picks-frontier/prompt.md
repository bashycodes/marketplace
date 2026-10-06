---
name: wayfind-picks-frontier
tags: [wayfind-with-ticktick, frontier]
max_turns: 14
---
First create this fixture with plain file writes in the current directory (a git repo; run `git init -q` if needed), commit it, then run /wayfind-with-ticktick demo-map

docs/agents/issue-tracker.md: "# Issue tracker: Local Markdown\n\nIssues live in `.scratch/`."
.scratch/demo-map/map.md: "# Demo map\n\n## Destination\nPick a cache strategy\n\n## Decisions so far\n\n## Not yet specified\n- eviction\n"
.scratch/demo-map/issues/01-survey.md: "# Survey caches\nType: research\n\n## Question\nWhich caches exist?"
.scratch/demo-map/issues/02-choose.md: "# Choose cache\nType: grilling\nBlocked by: 01\n\n## Question\nWhich cache?"
.scratch/demo-map/issues/03-ttl.md: "# TTL policy\nType: grilling\nBlocked by: 09\n\n## Question\nWhat TTL?"
.scratch/demo-map/issues/04-evict.md: "# Eviction\nType: grilling\n\n## Question\nHow do we evict?"
