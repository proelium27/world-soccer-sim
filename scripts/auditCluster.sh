#!/usr/bin/env bash
#
# Run one audit's seeds across two Macs.
#
# WHY
#
# Audits are the long pole, longer than the test suite: weakLeaguesAudit
# defaults to SEASONS=20 x SEEDS=1,2,3,4, which is 80 season-cycles at ~13s
# each (scripts/worldGenSplitProbe.ts measures the 13s), and CLAUDE.md refers to
# 30- and 100-season runs. They also loop their seeds strictly serially.
#
# Seeds are independent by construction -- each builds its own world from its
# own seed and shares nothing -- so unlike the test suite's multi-season chains
# (where season N+1 starts from season N and no split is possible), seeds are
# genuinely parallel. Two machines, half the seeds each.
#
# THE TRAP THIS REFUSES TO WALK INTO
#
# Some audits do not merely loop seeds and print; they AGGREGATE across seeds
# and gate on the aggregate. weakLeaguesAudit is the important one: it averages
# each rung gap over the seeds and fails on the mean, precisely because a single
# seed is noisier than the effect (its own header says the adjacent rungs
# "coin-flip on seed noise", and it prints a NOTE that the mean gate is
# under-powered below 3 seeds).
#
# Split such an audit in half and each machine averages its own two seeds. Both
# halves print a confident-looking mean over a sample the script itself says is
# too small, and neither is the number you wanted. That is the same class of
# failure as a distributed test run reporting green against stale code: not a
# crash, just a plausible wrong answer. So this refuses to split those by
# default. --per-seed-only says you want the per-seed sections and are ignoring
# the aggregate, which is a legitimate thing to want while exploring.
#
# USAGE
#   SEASONS=20 SEEDS=1,2,3,4 npm run audit:cluster -- marketRealismAudit
#   SEEDS=1,2,3,4 npm run audit:cluster -- weakLeaguesAudit --per-seed-only
#   SEEDS=1,2,3,4 npm run audit:cluster -- weakLeaguesAudit --local
#
# Config (host, capacities) is shared with the test runner: .test-cluster.json.

set -uo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
CONFIG="$ROOT/.test-cluster.json"

# The config is GITIGNORED (it names your machine), and a git worktree only
# checks out TRACKED files — so it is never present in one, and looking for it
# beside the worktree's package.json is a guaranteed false negative. That reads
# as "no second machine configured" and silently falls back to a local run,
# which is how a worktree session ends up running the suite at 1x while the
# other Mac sits idle. Resolve it from the MAIN checkout when it is not here:
# `git rev-parse --git-common-dir` points at the main .git from any worktree.
if [ ! -f "$CONFIG" ]; then
  COMMON_DIR=$(git -C "$ROOT" rev-parse --git-common-dir 2>/dev/null || true)
  case "$COMMON_DIR" in
    "") ;;
    /*) MAIN_ROOT=$(dirname "$COMMON_DIR") ;;
    *)  MAIN_ROOT=$(cd "$ROOT/$(dirname "$COMMON_DIR")" 2>/dev/null && pwd || true) ;;
  esac
  if [ -n "${MAIN_ROOT:-}" ] && [ -f "$MAIN_ROOT/.test-cluster.json" ]; then
    CONFIG="$MAIN_ROOT/.test-cluster.json"
    echo "==> Using the main checkout's cluster config: $CONFIG"
  fi
fi

# Audits that compute something across seeds and gate on it. Splitting these
# silently produces two partial aggregates. Keep this list honest: it is
# derived from scripts that reference SEEDS.length or average across seeds.
AGGREGATING="weakLeaguesAudit leagueVolumeProbe positionAwardAudit midVsMidProbe totsSlotProbe totsWeightProbe academyOnlyProbe"

# Env knobs the audits actually read (grep for process.env across scripts/).
# SEEDS is deliberately absent -- it is what gets split. Add to this list when a
# new audit reads a new variable, or it silently won't reach the remote.
# MODEL is weakLeaguesAudit's development-model knob, and it is the sharpest
# illustration of why this list has to be maintained: unset, the remote half
# does not fail, it quietly audits the DEFAULT model. Half the seeds would then
# describe a different game from the other half, pooled into one verdict that
# looks perfectly well-formed.
FORWARD_VARS="SEASONS SEED SHOW RUN RATE N ALL_N COUNTRY MODEL"

PER_SEED_ONLY=0
FORCE_LOCAL=0
AUDIT=""
for arg in "$@"; do
  case "$arg" in
    --per-seed-only) PER_SEED_ONLY=1 ;;
    --local) FORCE_LOCAL=1 ;;
    -*) echo "unknown flag: $arg" >&2; exit 2 ;;
    *) AUDIT="$arg" ;;
  esac
done

if [ -z "$AUDIT" ]; then
  echo "usage: SEEDS=1,2,3,4 npm run audit:cluster -- <auditName> [--per-seed-only] [--local]" >&2
  echo "       (audit name with or without the .ts, e.g. weakLeaguesAudit)" >&2
  exit 2
fi

AUDIT="${AUDIT%.ts}"
AUDIT="${AUDIT#scripts/}"
SCRIPT="scripts/$AUDIT.ts"
if [ ! -f "$ROOT/$SCRIPT" ]; then
  echo "no such audit: $SCRIPT" >&2
  exit 2
fi

# An audit that doesn't read SEEDS has nothing to split; say so rather than
# running it twice and printing the same thing from both machines.
if ! grep -q "process.env.SEEDS" "$ROOT/$SCRIPT"; then
  echo "$SCRIPT does not read SEEDS, so there is nothing to split across machines." >&2
  echo "Run it directly:  npx tsx $SCRIPT" >&2
  exit 2
fi

SEEDS_IN="${SEEDS:-}"
if [ -z "$SEEDS_IN" ]; then
  echo "set SEEDS explicitly, e.g. SEEDS=1,2,3,4 -- this runner will not guess" >&2
  echo "which seeds you meant and then split them." >&2
  exit 2
fi

case " $AGGREGATING " in
  *" $AUDIT "*)
    if [ "$PER_SEED_ONLY" = "0" ] && [ "$FORCE_LOCAL" = "0" ]; then
      echo "REFUSING to split $AUDIT across machines." >&2
      echo >&2
      echo "It aggregates across seeds and gates on the aggregate, so each machine" >&2
      echo "would average only its own half and print a confident number over a" >&2
      echo "sample the script itself calls too small. Neither half is the answer." >&2
      echo >&2
      echo "  --per-seed-only   split anyway; read the per-seed sections, ignore" >&2
      echo "                    each half's aggregate (fine while exploring)" >&2
      echo "  --local           run all seeds here, aggregate valid, just slower" >&2
      exit 2
    fi
    ;;
esac

read_cfg() {
  python3 - "$CONFIG" "$1" "$2" <<'PY'
import json, sys
path, key, default = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    with open(path) as fh:
        print(json.load(fh).get(key, default))
except Exception:
    print(default)
PY
}

REMOTE_HOST=$(read_cfg remoteHost "")
REMOTE_DIR=$(read_cfg remoteDir "~/soccer-gm-testcluster")
CAP_LOCAL=$(read_cfg capacityLocal "1")
CAP_REMOTE=$(read_cfg capacityRemote "1")

# Rebuild the caller's env for the remote side, minus SEEDS.
forwarded=""
for v in $FORWARD_VARS; do
  eval "val=\${$v:-}"
  [ -n "$val" ] && forwarded="$forwarded $v='$val'"
done

run_all_local() {
  echo "==> Running all seeds ($SEEDS_IN) on this machine."
  exec env SEEDS="$SEEDS_IN" npx tsx "$SCRIPT"
}

[ "$FORCE_LOCAL" = "1" ] && run_all_local
[ -z "$REMOTE_HOST" ] && { echo "==> No remoteHost in .test-cluster.json."; run_all_local; }

# Split the seeds proportionally to capacity, largest-remainder, every seed
# landing exactly once. Fewer seeds than machines is not an error, it just means
# one side gets none -- in which case there is nothing to distribute.
SPLIT=$(python3 - "$SEEDS_IN" "$CAP_LOCAL" "$CAP_REMOTE" <<'PY'
import sys
seeds = [s.strip() for s in sys.argv[1].split(",") if s.strip()]
cl, cr = float(sys.argv[2]), float(sys.argv[3])
n = len(seeds)
want_local = n * cl / (cl + cr)
k = int(round(want_local))
k = max(0, min(n, k))
# Never strand every seed on one side when there are at least two to share.
if n >= 2:
    k = max(1, min(n - 1, k))
print(",".join(seeds[:k]))
print(",".join(seeds[k:]))
PY
)
LOCAL_SEEDS=$(echo "$SPLIT" | sed -n 1p)
REMOTE_SEEDS=$(echo "$SPLIT" | sed -n 2p)

if [ -z "$LOCAL_SEEDS" ] || [ -z "$REMOTE_SEEDS" ]; then
  echo "==> Only one seed given; nothing to split."
  run_all_local
fi

echo "==> Probing $REMOTE_HOST ..."
if ! ssh -o ConnectTimeout=2 -o BatchMode=yes "$REMOTE_HOST" true 2>/dev/null; then
  echo "==> $REMOTE_HOST unreachable; running every seed here."
  run_all_local
fi

# Login shell: ssh's non-login shell skips /etc/zprofile on macOS, so PATH lacks
# /usr/local/bin and npx is not found. Same reason as scripts/testCluster.sh.
rsh() { ssh "$REMOTE_HOST" 'zsh -ls' <<< "$1"; }

echo "==> Syncing to $REMOTE_HOST:$REMOTE_DIR"
rsh "mkdir -p $REMOTE_DIR" || exit 1
rsync -a --delete \
  --exclude '.git' --exclude 'node_modules' --exclude 'dist' \
  --exclude '.vitest-reports' --exclude '.test-cluster-run' \
  --exclude '.claude/worktrees' --exclude 'leaguesaves' \
  "$ROOT/" "$REMOTE_HOST:$REMOTE_DIR/" || exit 1

# Same false-green reasoning as the test runner: an audit result you act on had
# better have come from the code you have.
hash_cmd='find src scripts -type f 2>/dev/null | LC_ALL=C sort | xargs shasum | shasum | cut -d" " -f1'
LOCAL_HASH=$(cd "$ROOT" && eval "$hash_cmd")
REMOTE_HASH=$(rsh "cd $REMOTE_DIR && $hash_cmd")
if [ "$LOCAL_HASH" != "$REMOTE_HASH" ]; then
  echo "ERROR: tree hash mismatch after sync ($LOCAL_HASH vs $REMOTE_HASH)." >&2
  echo "Refusing to run: half the results would be from different code." >&2
  exit 1
fi
rsh "cd $REMOTE_DIR && npm ci --silent >/dev/null 2>&1" || exit 1

RUNDIR="$ROOT/.test-cluster-run"
rm -rf "$RUNDIR"; mkdir -p "$RUNDIR"

echo "==> $AUDIT: seeds $LOCAL_SEEDS here, $REMOTE_SEEDS on $REMOTE_HOST"
[ "$PER_SEED_ONLY" = "1" ] && echo "==> --per-seed-only: each half's cross-seed aggregate is NOT valid; read the per-seed sections."
START=$(date +%s)

( env SEEDS="$LOCAL_SEEDS" npx tsx "$SCRIPT" > "$RUNDIR/audit-local.log" 2>&1
  echo $? > "$RUNDIR/audit-local.exit" ) &
LP=$!
( rsh "cd $REMOTE_DIR && env SEEDS='$REMOTE_SEEDS'$forwarded npx tsx $SCRIPT" \
    > "$RUNDIR/audit-remote.log" 2>&1
  echo $? > "$RUNDIR/audit-remote.exit" ) &
RP=$!

wait $LP; wait $RP
LRC=$(cat "$RUNDIR/audit-local.exit" 2>/dev/null || echo 1)
RRC=$(cat "$RUNDIR/audit-remote.exit" 2>/dev/null || echo 1)

echo
echo "################ seeds $LOCAL_SEEDS — this machine (exit $LRC) ################"
cat "$RUNDIR/audit-local.log"
echo
echo "################ seeds $REMOTE_SEEDS — $REMOTE_HOST (exit $RRC) ################"
cat "$RUNDIR/audit-remote.log"
echo
echo "==> $AUDIT done in $(( $(date +%s) - START ))s (logs in .test-cluster-run/)"
[ "$PER_SEED_ONLY" = "1" ] && echo "==> Reminder: ignore each half's cross-seed aggregate; it saw only its own seeds."

[ "$LRC" = "0" ] && [ "$RRC" = "0" ] && exit 0
exit 1
