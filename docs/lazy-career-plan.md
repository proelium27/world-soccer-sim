# Lazy careers: stop holding every player's whole career in memory

Follow-on to `docs/save-performance-plan.md`. That plan split `players` out of the
league record so a save would stop rewriting the world on every click. This one
is about a different cost, and the distinction is the whole point of the
document.

## The problem in one sentence

A save holds every player's entire career in memory from the moment it loads,
whether or not anything is going to look at it.

## Why the previous splits do not already fix this

`players` (v2) and `retirees` (v3) are separate stores, and both were the right
call — but both target **write** cost. `loadLeague` still reassembles everything
into one ordinary `LeagueStore`, deliberately, so that nothing above the db layer
had to change. That containment is what made those changes small and safe, and it
is exactly what leaves this problem untouched: the pool is still fully resident.

So this is not "split another field". It is the first change that makes the
in-memory league **smaller than the save on disk**.

## Measured baseline

All figures from the real reported save (`soccer-gm-league-4`, season 60, 59
completed seasons, the shipped 16-competition / 320-club world, 10,864 players).

| form | size |
| --- | --- |
| on disk, gzipped | 30.6 MB |
| as JSON text | 207.7 MB |
| serialized (structured clone) | 181.6 MB |
| **live JS objects** | **275.8 MB** |

Live objects cost ~1.52x their serialized form: a career is millions of small
objects and each one carries overhead.

Inside `players` (49.7 MB serialized):

| | size | rows |
| --- | --- | --- |
| `stats[]` | 22.7 MB | 73,808 season rows |
| `hist[]` | 22.5 MB | 92,137 ratings snapshots |
| everything else | 4.5 MB | 10,864 players |

**A player's identity is ~4.5 MB across the whole world. His career record is
45.2 MB, ten times as much.** That ratio is what makes this worth doing, and it
gets worse every season while identity stays flat.

## What this is worth, and what it is not

PR #274 already cut the *copying*: a sim round trip held 876 MB live (main
thread + worker's copy + the result) and now holds ~576 MB. This plan attacks
the other half — the ~275.8 MB that is resident whether or not you sim.

Careful about double-counting: holding careers back from the worker payload was
measured separately at **20.8 MB** (see #274's notes) and is *subsumed* by this
work. Do not count both.

## Access-pattern survey

87 sites read `player.stats` across 22 files; 26 sites read `player.hist` across
15. That sounds fatal until you look at what they ask for:

**The dominant pattern is one season, not a career.** `Roster.tsx`,
`Dashboard.tsx`, `Leaders.tsx` and `awards.ts` all do
`p.stats.find((s) => s.season === season)`. Everything on the hot path — the
pages you look at while playing — wants the current season's row.

**Full careers are wanted by a short, cold list:** Player Profile (one player),
Frivolities / GOAT / all-time leaders (the whole pool, but a page you visit
rarely), `archivePlayer` at retirement, and the OVR/value charts.

**The sim needs less than it looks.** After the `peakOvr` change in phase 1
below, the worker's only full-career reader is `archivePlayer`.

One site needs rewriting rather than porting: `Leaders.tsx:82` builds its season
dropdown with `flatMap((p) => p.stats.map((s) => s.season))`, walking every
career to collect season *numbers*. Those are already in `league.seasonHistory`.

## Design

### 1. `peakOvr` on the player (phase 1, shippable alone)

`careerPeakOvr` (`freeAgentCull`) and `peakOf` (`archive`) each walk a player's
whole `hist` to compute one number. Store it instead: `peakOvr` and
`peakOvrSeason`, maintained by `progressPlayer` where the snapshot is already
appended.

This is a prerequisite for everything below — the cull and the archive-worthiness
gate have to work without history resident — and it stands on its own as a CPU
win, removing two O(career) walks per player per offseason.

`positionHistory` also walks all of `hist`, but it is UI-only and never runs in
the worker, so it needs nothing.

### 2. Schema v4: a `careers` store

```
careers: { key: [number, number]; value: { stats: SeasonStats[]; hist: RatingsSnapshot[] } }
```

Same out-of-line `[lid, pid]` compound key as `players` and `retirees`, for the
same reason: a league's careers become one range query.

Split lazily in `loadLeague`, exactly as v2 and v3 were, so a large save cannot
stall a versionchange transaction at startup.

### 3. The resident shape, and making truncation impossible to miss

The resident `Player` carries a **window**, not a career: the current season's
stats row and the last few ratings snapshots (enough for `ovrDuringSeason`,
which wants season-1, and the position-spell walk).

**Rename the fields.** `stats` becomes `recentStats` and `hist` becomes
`recentHist`. This is the load-bearing part of the design, not cosmetics: it
breaks all 87 + 26 sites at compile time and forces each one to be triaged
rather than silently returning a truncated answer. Every prior change in this
area has had the same failure mode — a short array read as if it were complete
produces a wrong number, not an error — and this is the only version of it the
compiler can catch.

Full careers come back through an explicit async accessor:

```ts
loadCareer(lid, pid): Promise<Career>
loadCareers(lid, pids): Promise<Map<number, Career>>
```

### 4. Who loads what

| surface | needs | how |
| --- | --- | --- |
| Roster, Dashboard, Standings, Transfers | current season | resident window |
| Leaders (per-season) | current season, all players | resident window |
| Player Profile | one full career | `loadCareer` on mount |
| Frivolities / GOAT / all-time | every career | `loadCareers` on mount, with a spinner |
| sim: accumulate, awards, positions | window | payload |
| sim: `archivePlayer` | full career of retirees | see open question 1 |

### 5. Migration

v3 -> v4 in `loadLeague`: read each player, move `stats`/`hist` into the
`careers` store, keep the window on the player, write back. Interrupted leaves
the save in its old shape and retries next load, like the previous two.

## Phasing

1. **`peakOvr` on the player.** No storage change, no behaviour change, sim
   results bit-identical. Removes the two full-`hist` walks.
2. **`careers` store, written but not yet read.** Storage lands and is exercised
   while the in-memory shape is unchanged, so a bug shows up as a failed
   round-trip test rather than a wrong league.
3. **Flip the resident shape.** The rename, the async accessors, the UI loading
   states. The big one.

Each phase ships on its own and is useful without the next.

## Risks

- **Truncated-array reads.** The whole reason for the rename. A site that wants a
  career and gets a window returns a plausible wrong number.
- **Async in render paths.** Player Profile and Frivolities become loading
  screens. Frivolities pulls every career, so it will be slow the first time; it
  is already the heaviest page in the game.
- **The one-way door.** v4 means a rolled-back build cannot open the database at
  all (`VersionError`), the same trap documented for v2. Deploy rollback is a
  total outage for anyone who loaded the new build. Export JSON stays the escape
  hatch.
- **`league.players` identity.** The reference-identity dirty set
  (`test/db/playerIdentity.test.ts`) assumes players are replaced, never mutated.
  A career loaded and cached onto a player object would break it. Cache careers
  **beside** the pool, never on it.

## Open questions

1. ~~**`archivePlayer` needs a full career for retirees.**~~ **Dissolved, not
   solved.** The plan was to have the worker hand back each retiree's final
   ratings snapshot and rebuild the row on the main thread — real protocol, and a
   delicate reconstruction. Once the summary carried `seasons` as well as totals
   and best, it turned out `archivePlayer` needed nothing else: `seasons` is the
   same type it was already emitting, `totals`/`best` are folded, and the peak is
   its own field. It now builds from the summary, and the fold runs at offseason
   step 2 — before retirement at step 3 — so the season he just finished is
   already in it. **This was the only place in the sim that wanted a whole
   career, so it was the only reason careers had to reach the worker at all.**
   Pinned by an equality test between the two paths.
2. ~~**Does Frivolities stay whole-pool?**~~ **Yes, and it loads nothing.** The
   original plan (store a few scalars, pre-filter, load the top few hundred) was
   unnecessary: totals + best + seasons fit in 13.5 MB against the 45.2 MB they
   stand in for, so every board ranks the whole pool with no career reads. No
   feature loss — ranking, filtering and sorting work the same on a summary.
3. **How wide is the window?** Still open, and now the *only* open question.
   Awards want season − 1; the position-spell walk wants `need` entries;
   `ovrDuringSeason` (via `archivePlayer`'s `finalOvr`) wants season − 1. Pick
   from the code, not by feel, and pin it with a test.

## Not in scope

- `played`'s box scores (done in #274).
- The append-only histories `newsEvents` / cup histories (separate follow-up,
  needs the culled pid set out of `simOffseason`).
- On-disk size. This changes what is resident, not what is stored.

## Phase 3, as built (2026-09-18)

Shipped as schema v7. It differs from the design above in one structural way,
and the reason is worth keeping.

**The store is per season, not per career.** The plan kept `careers` (one row
per player holding his whole history). That row is atomic, which makes a window
impossible to maintain cheaply: reading the window means reading the career, and
adding a season means rewriting it. So `careers` was replaced by `seasons`, one
row per player per season per kind (stat line or ratings snapshot), keyed
`[lid, pid, season, kind]` with a `bySeason` index. A season's row is written
while it is live and never again, and the index answers a question the plan's
access table missed: **an arbitrary past season for everyone** (Leaders, the
Database, the performance views' season pickers, the Awards page, a club's past
squad). Those are one range read each.

**The window is the worker's window.** Open question 3 is settled by reusing it:
`RECENT_STATS_SEASONS` (2) stat lines and `RECENT_HIST_SEASONS` (3) snapshots, by
count, already proven by `simArchive.test.ts` to run a season and an offseason
with no difference. A count-based window of two lines always covers the current
season and the one before (pinned over every gap pattern of a ten-season career),
which is what lets most screens skip the disk entirely.

**Measured** (`scripts/careerResidentProbe.ts`, live heap of the whole league):

| save | whole careers | window | saved |
| --- | --- | --- | --- |
| season 47, mid-season | 297.9 MB | 266.5 MB | 31.4 MB (10.5%) |
| season 101, offseason | 201.8 MB | 172.7 MB | 29.0 MB (14.4%) |

Both 320-club saves. The saving is flat with save age (retirement caps the
seasons a pool carries) and scales with world size.

**Risks, as they turned out.** The truncated-read risk is what the rename was
for, and it worked for reads. It did NOT cover object-literal keys in spreads
with inferred types, where `tsc` stays silent: three of those were found by grep
after a green compile, including the sim's working copy writing to a dead field.
The async-screens risk is small: the Player Profile is the only screen that reads
a whole career, and it caches per player.
