#!/bin/bash
# One probe run, printed as a single summary line.
# usage: KEY=VAL... deadAttrRun.sh   (all config comes from the environment)
cd "$(dirname "$0")/.."
npx tsx --max-old-space-size=1800 scripts/deadAttrProbe.ts 2>&1 | grep '^{' | node -e '
const r = JSON.parse(require("fs").readFileSync(0, "utf8"));
console.log([r.source + r.seed, r.model, JSON.stringify(r.w), "r", r.rXiOvrPpg,
  JSON.stringify(r.pts38PerOvrPoint), "g", r.goalsPerMatch, "hw", r.homeWin, "d", r.draw, "champ", r.champPts38].join(" "));'
