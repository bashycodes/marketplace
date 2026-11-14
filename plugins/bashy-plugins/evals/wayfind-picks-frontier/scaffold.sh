#!/usr/bin/env bash
# Fixture: only ticket 04 is on the frontier (01 resolved research, 02 blocked by open 03, 03 blocked by missing 09).
set -euo pipefail
git init -q 2>/dev/null || true
git config user.name "eval"
git config user.email "eval@example.invalid"
mkdir -p docs/agents .scratch/demo-map/issues
printf "# Issue tracker: Local Markdown\n\nIssues live in \`.scratch/\`.\n" > docs/agents/issue-tracker.md
printf "# Demo map\n\n## Destination\nPick a cache strategy\n\n## Decisions so far\n\n## Not yet specified\n- eviction\n" > .scratch/demo-map/map.md
printf "# Survey caches\nType: research\nStatus: resolved\n\n## Question\nWhich caches exist?\n" > .scratch/demo-map/issues/01-survey.md
printf "# Choose cache\nType: grilling\nBlocked by: 03\n\n## Question\nWhich cache?\n" > .scratch/demo-map/issues/02-choose.md
printf "# TTL policy\nType: grilling\nBlocked by: 09\n\n## Question\nWhat TTL?\n" > .scratch/demo-map/issues/03-ttl.md
printf "# Eviction\nType: grilling\n\n## Question\nHow do we evict?\n" > .scratch/demo-map/issues/04-evict.md
git add -A && git commit -qm fixture
