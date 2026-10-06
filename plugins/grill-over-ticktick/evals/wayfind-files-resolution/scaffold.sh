#!/usr/bin/env bash
# Fixture: a one-ticket map, committed, plus an unrelated staged file that the resolution commit must leave out.
set -euo pipefail
git init -q 2>/dev/null || true
git config user.name "eval"
git config user.email "eval@example.invalid"
mkdir -p docs/agents .scratch/demo-map/issues
printf "# Issue tracker: Local Markdown\n\nIssues live in \`.scratch/\`.\n" > docs/agents/issue-tracker.md
printf "# Demo map\n\n## Destination\nPick a cache\n\n## Decisions so far\n" > .scratch/demo-map/map.md
printf "# Choose cache\nType: grilling\n\n## Question\nWhich cache and TTL?\n" > .scratch/demo-map/issues/01-choose.md
git add -A && git commit -qm fixture
echo x > notes.txt && git add notes.txt
