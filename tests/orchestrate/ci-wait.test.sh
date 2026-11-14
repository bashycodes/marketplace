#!/usr/bin/env bash
# Tests for plugins/bashy-plugins/skills/orchestrate/ci-wait.sh with a stubbed `gh`.
# Each case gives the JSON that successive `gh run list` calls return (one per line;
# the last line repeats; `ERR` = gh fails). Run: bash tests/orchestrate/ci-wait.test.sh
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
SCRIPT=$ROOT/plugins/bashy-plugins/skills/orchestrate/ci-wait.sh
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"
cat > "$TMP/bin/gh" <<'STUB'
#!/usr/bin/env bash
n=$(( $(cat "$CASE.cnt" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$CASE.cnt"
line=$(sed -n "${n}p" "$CASE"); [ -n "$line" ] || line=$(tail -n1 "$CASE")
[ "$line" = ERR ] && { echo "gh: not authenticated" >&2; exit 1; }
printf '%s\n' "$line"
STUB
chmod +x "$TMP/bin/gh"
export PATH="$TMP/bin:$PATH" CI_WAIT_POLL=0 CI_WAIT_GRACE=0
fail=0
# check <name> <expected exit> <gh outputs...> -- <args...>
check() {
  local name=$1 want=$2; shift 2; export CASE="$TMP/$name"; : > "$CASE"; rm -f "$CASE.cnt"
  while [ $# -gt 0 ] && [ "$1" != -- ]; do printf '%s\n' "$1" >> "$CASE"; shift; done; shift
  local out got; out=$(bash "$SCRIPT" "$@" 2>&1); got=$?
  if [ "$got" -eq "$want" ]; then echo "ok   $name"; else echo "FAIL $name: exit $got, want $want"; echo "$out" | sed 's/^/     /'; fail=1; fi
}
G='{"databaseId":1,"name":"ci","status":"completed","conclusion":"success"}'
P='{"databaseId":1,"name":"ci","status":"in_progress","conclusion":""}'
R='{"databaseId":1,"name":"ci","status":"completed","conclusion":"failure"}'
S='{"databaseId":2,"name":"lint","status":"completed","conclusion":"startup_failure"}'
G2='{"databaseId":2,"name":"lint","status":"completed","conclusion":"success"}'

check green 0          "[$G]" -- b abc
check pending-then-green 0 "[$P]" "[$G]" -- b abc
check red 1            "[$R]" -- b abc
check startup-failure-is-red-early 1 "[$P,$S]" -- b abc
check rerun-during-grace-waits 0 "[$G]" "[$P]" "[$G]" "[$G]" -- b abc
check late-workflow-waits 0 "[$G]" "[$G,$G2]" "[$G,$G2]" -- b abc
check no-runs 3        "[]" -- b abc 90 0
check gh-error-exits-4 4 ERR -- b abc
check gh-blip-recovers 0 ERR "[$G]" -- b abc
check garbage-exits-4 4 "not json" -- b abc
check no-args 4        "[$G]" --
check bad-timeout 4    "[$G]" -- b abc x
check timeout 2        "[$P]" -- b abc 0
cd "$TMP" && check no-sha-outside-repo 4 "[$G]" -- b
[ "$fail" -eq 0 ] && echo "all passed"; exit "$fail"
