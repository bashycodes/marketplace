#!/usr/bin/env bash
# Wait for every GitHub Actions run on one commit, however many there are.
# Usage: ci-wait.sh <branch> [sha=HEAD] [timeout_min=90] [appear_s=300]
# Exit: 0 all green, 1 any red, 2 timeout, 3 no runs appeared (path/branch
# filters skipped CI: dispatch a workflow manually or report), 4 usage/gh error.
set -uo pipefail

branch=${1:?usage: ci-wait.sh <branch> [sha] [timeout_min] [appear_s]}
sha=${2:-$(git rev-parse HEAD)} || exit 4
timeout_min=${3:-90}
appear_s=${4:-300}

start=$(date +%s)
deadline=$((start + timeout_min * 60))
poll=60

list() {
  gh run list --branch "$branch" --commit "$sha" --limit 50 \
    --json databaseId,name,status,conclusion 2>/dev/null
}

while :; do
  now=$(date +%s)
  if ! j=$(list); then
    [ "$now" -ge "$deadline" ] && { echo "TIMEOUT (gh errors) $branch@${sha:0:7}"; exit 2; }
    sleep "$poll"; continue
  fi
  n=$(jq 'length' <<<"$j")
  if [ "$n" -eq 0 ]; then
    if [ $((now - start)) -ge "$appear_s" ]; then
      echo "NO RUNS for $branch@${sha:0:7} after ${appear_s}s"; exit 3
    fi
    sleep 30; continue
  fi
  failed=$(jq '[.[] | select(.status == "completed" and (.conclusion == "failure" or .conclusion == "cancelled" or .conclusion == "timed_out"))] | length' <<<"$j")
  if [ "$failed" -gt 0 ]; then
    jq -r '.[] | "\(.name)  \(.status)  \(.conclusion // "-")  \(.databaseId)"' <<<"$j"
    echo "RED (early) $branch@${sha:0:7}"; exit 1
  fi
  pending=$(jq '[.[] | select(.status != "completed")] | length' <<<"$j")
  if [ "$pending" -eq 0 ]; then
    # Grace re-list: a late workflow may still be queuing.
    sleep 45
    j2=$(list) || j2=$j
    if [ "$(jq 'length' <<<"$j2")" -eq "$n" ]; then
      jq -r '.[] | "\(.name)  \(.conclusion)  \(.databaseId)"' <<<"$j2"
      bad=$(jq '[.[] | select(.conclusion != "success" and .conclusion != "skipped" and .conclusion != "neutral")] | length' <<<"$j2")
      [ "$bad" -eq 0 ] && { echo "GREEN $branch@${sha:0:7}"; exit 0; }
      echo "RED $branch@${sha:0:7}"; exit 1
    fi
    continue
  fi
  if [ "$now" -ge "$deadline" ]; then
    jq -r '.[] | "\(.name)  \(.status)  \(.conclusion // "-")  \(.databaseId)"' <<<"$j"
    echo "TIMEOUT after ${timeout_min}m $branch@${sha:0:7}"; exit 2
  fi
  sleep "$poll"
done
