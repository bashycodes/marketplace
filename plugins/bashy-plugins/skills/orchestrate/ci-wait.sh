#!/usr/bin/env bash
# Wait for every GitHub Actions run on one commit, however many there are.
# Run it with the project repo as the working directory (gh finds the repo there).
# Usage: ci-wait.sh <branch> [sha=origin/<branch>] [timeout_min=90] [appear_s=300]
# Exit: 0 all green, 1 any red, 2 timeout, 3 no runs appeared (path/branch
# filters skipped CI: dispatch a workflow manually or report), 4 usage/gh/jq error.
set -uo pipefail

usage() { echo "usage: ci-wait.sh <branch> [sha] [timeout_min] [appear_s]" >&2; exit 4; }
if [ $# -lt 1 ] || [ -z "$1" ]; then usage; fi
for t in gh jq git; do command -v "$t" >/dev/null 2>&1 || { echo "ci-wait.sh: $t not found" >&2; exit 4; }; done

branch=$1
sha=${2:-$(git rev-parse --verify -q "origin/$branch^{commit}" || git rev-parse --verify -q "$branch^{commit}")} \
  || { echo "ci-wait.sh: cannot resolve a commit for $branch (pass the sha)" >&2; exit 4; }
timeout_min=${3:-90}
appear_s=${4:-300}
[[ $timeout_min =~ ^[0-9]+$ && $appear_s =~ ^[0-9]+$ ]] || usage

start=$(date +%s)
deadline=$((start + timeout_min * 60))
poll=${CI_WAIT_POLL:-60}
grace=${CI_WAIT_GRACE:-45}
max_gh_errors=5
gh_errors=0

list() {
  gh run list --branch "$branch" --commit "$sha" --limit 100 \
    --json databaseId,name,status,conclusion
}
ids() { jq -c '[.[].databaseId] | sort' <<<"$1"; }
show() { jq -r '.[] | "\(.name)  \(.status)  \(.conclusion // "-")  \(.databaseId)"' <<<"$1"; }
# Completed runs that did not pass (anything but success / skipped / neutral).
BAD='[.[] | select(.status == "completed" and (.conclusion | IN("success","skipped","neutral") | not))] | length'

while :; do
  now=$(date +%s)
  [ "$now" -ge "$deadline" ] && { [ -n "${j:-}" ] && show "$j"; echo "TIMEOUT after ${timeout_min}m $branch@${sha:0:7}"; exit 2; }
  if ! j=$(list 2>/dev/null) || ! n=$(jq -e 'length' <<<"$j" 2>/dev/null); then
    gh_errors=$((gh_errors + 1)); j=
    if [ "$gh_errors" -ge "$max_gh_errors" ]; then
      echo "ci-wait.sh: gh run list failed $gh_errors times in a row (auth? not in the repo?):" >&2
      gh run list --branch "$branch" --commit "$sha" --limit 1 >/dev/null || true
      exit 4
    fi
    sleep "$poll"; continue
  fi
  gh_errors=0
  if [ "$n" -eq 0 ]; then
    [ $((now - start)) -ge "$appear_s" ] && { echo "NO RUNS for $branch@${sha:0:7} after ${appear_s}s"; exit 3; }
    sleep 30; continue
  fi
  if [ "$(jq "$BAD" <<<"$j")" -gt 0 ]; then
    show "$j"; echo "RED $branch@${sha:0:7}"; exit 1
  fi
  if [ "$(jq '[.[] | select(.status != "completed")] | length' <<<"$j")" -eq 0 ]; then
    # Grace re-list: a late workflow may still be queuing, or a run may have been re-run.
    sleep "$grace"
    if ! j2=$(list 2>/dev/null) || ! jq -e 'length' <<<"$j2" >/dev/null 2>&1; then continue; fi
    [ "$(ids "$j2")" = "$(ids "$j")" ] || continue
    [ "$(jq '[.[] | select(.status != "completed")] | length' <<<"$j2")" -eq 0 ] || continue
    show "$j2"
    [ "$(jq "$BAD" <<<"$j2")" -eq 0 ] && { echo "GREEN $branch@${sha:0:7}"; exit 0; }
    echo "RED $branch@${sha:0:7}"; exit 1
  fi
  sleep "$poll"
done
