# soccer-gm

A client-side, BBGM-style soccer management sim (TypeScript, React, Vite, IndexedDB), live at worldsoccersim.org. Milestones M0-M6 are done and merged, and a great deal has shipped since.

## How this file works (read first)

**This file is loaded into every session, so it is kept SHORT on purpose.** It holds the rules, the invariants that bite, and a map. The detailed record of every feature (what it is, where it lives, its gotchas, the measurements behind its constants) lives in **`docs/ledger/`**, one file per area. Before touching an area, open its ledger file (or `grep -rn <symbol> docs/ledger/`), because nearly every non-obvious decision in this codebase is written down there with the evidence.

**When you ship something, write the detail in the relevant `docs/ledger/*.md` file, not here.** Add at most one line to this file, and only if the item is a cross-cutting rule every session needs. Keep ledger entries to *what it is, where it lives, its non-obvious gotchas, and the measurement that justified it*. Blow-by-blow retune history goes in git history.

| Doc | What it is |
| --- | --- |
| `docs/ledger/core-invariants.md` | RNG order, OVR scale and its +11 shift, position calibration, anti-inflation, generation age model, composites/slots/XI selection, determinism boundaries, UI/CSS gotchas |
| `docs/ledger/testing-and-audits.md` | Validation gates and why each is shaped the way it is, CI shard packing, the two-Mac cluster, world-fixture cache, worker/RAM caps, player-save audits |
| `docs/ledger/management.md` | Manager career (board, sackings, offers), national team job, roster & tactics, formations, academy pipeline, autopilot/jump, spectator saves, God Mode |
| `docs/ledger/match-stats-awards.md` | Box scores, subs windows, match clock, live viewer, awards (league + world + Americas), history pages, Frivolities/GOAT, retiree archive and names, Database pages, player table views |
| `docs/ledger/squad-market-finance.md` | Youth/academy, free agency, AI GM valuation, AI market, player will, clauses, finance, debt, difficulty, development models |
| `docs/ledger/world-and-competitions.md` | Competitions-as-data, the country ladder, division sizes, promotion/playoffs, Continental Cup/Shield/Americas Cup, coefficients, cup formats, domestic cups, title playoffs, conferences, super cups |
| `docs/ledger/international.md` | National teams, qualifying, World Cup formats, confederation cups |
| `docs/ledger/players-loans-retirement.md` | Loans (in and out), scouting fog, career charts, retirement, extremism |
| `docs/ledger/save-size-and-storage.md` | The `/transfers` freeze, split IndexedDB storage, box scores on disk, worker-boundary detaches, export format, free-agent cull |
| `docs/ledger/roster-import.md` | Roster files, EA FC converter, crests and logo packs, league file import/export, the AI prompt |
| `docs/ledger/deploy-and-build.md` | PostHog build-time keys, Cloudflare self-deploy, build targets (itch, CrazyGames, GitHub Pages) |
| `docs/ledger/milestones.md` | M0-M6 in full detail |
| `docs/ledger/open-decisions.md` | Design decisions awaiting a user call, known leftovers |
| `SOCCER_GM_SPEC.md` | Original build brief. **Historical**: §4-§5 still define the match engine and §8 the validation gates; the rest diverged |
| `DESIGN.md` / `PRODUCT.md` | Visual design system and product brief. `src/ui/styles.css` is the token source of truth. **Read DESIGN.md §6 before building any table past ~8 columns** |
| `docs/player-save-findings.md` | Live fix queue from real player saves (FIXED banners mark done items) |
| `docs/finance-design.md`, `docs/transfer-mobility.md`, `docs/save-performance-plan.md`, `docs/lazy-career-plan.md` | Design intent / postmortems / plans |
| `docs/eafc-import.md`, `docs/crazygames.md`, `docs/github-pages.md`, `docs/cloudflare.md`, `docs/analytics.md` | Runbooks |

## Commands

```bash
npm run dev        # Vite dev server
npm run build      # production build
npm test           # vitest run (full suite)
npm run test:watch # vitest watch
npm run test:cluster # split the suite across two Macs (falls back to local)
npm run test:clean-worlds # prune stale world-fixture caches (--all / --dry-run)
npm run typecheck  # tsc --noEmit
npm run cli        # scripts/cli.ts (headless sim harness for audits)
npm run audit:cluster -- <auditName>  # split an audit's seeds across two Macs
```

- Audits live in `scripts/` and run with `tsx` (e.g. `SEASONS=20 SEEDS=1,2,3,4 npx tsx scripts/weakLeaguesAudit.ts`). The main gates are `weakLeaguesAudit` (country ladder + weak-league solvency), `divisionAudit`, `marketRealismAudit`, `worldAwardsAudit`, `coefficientAudit`, `slotChurnAudit`.
- **Scope test runs to the change.** A pure UI/derivation change needs typecheck plus its own test files. The full suite (~40+ min locally) and dynasty audits are for rng/engine/offseason/constant changes. Prefer `npm run test:cluster` for a full run; it resolves `.test-cluster.json` from the main checkout even inside a worktree, and falls back to local within ~2s. Also run the top-level `test/*.test.ts` files (matchSim, montecarlo, composites, rng) when touching the engine; they sit outside `test/engine` and are easy to miss.
- A local `npm test` caps workers by cores **and** RAM (`localMaxWorkers` in `vite.config.ts`, ~3 GB per heavy worker). Full-world sims are memory-heavy and never give pages back: run **one audit process at a time**, one seed per invocation, and pool seeds by hand.
- The first `npm test` after any `src/core` change rebuilds the cached test worlds (`node_modules/.cache/soccer-gm-worlds/`, ~7s each). Build test worlds with `makeLeague(tid, seed)`, reuse existing seeds, and hoist a read-only world into one shared fixture. `SOCCER_GM_NO_FIXTURE_CACHE=1` bypasses the cache.
- Player saves for auditing live in `leaguesaves/` (gitignored, never commit). `scripts/playerSaveAudit.ts` reads a raw save; real players reach seasons 75-100, well past the 20-30 season audit horizon.

## Git workflow

- Keep work committed: after code changes, commit locally with a clear message rather than leaving the tree dirty.
- Keep the remote in sync: push to `origin` after committing so local `main` and GitHub `main` never drift.
- A merged PR isn't done until it's pulled into local `main` (`git checkout main && git pull`).
- Only skip this if the user explicitly asks you to hold off.
- One account (proelium27) works this repo, but several branches/worktrees are usually open at once, so avoid making two branches fight over one shared file. Local `main` is often stale: measure against `origin/main` / `git merge-base HEAD origin/main`.
- **worldsoccersim.org deploys itself** via Cloudflare Workers Builds on every push to main (shows as a check run, not a GitHub deployment; lag 6-20 min). There is no deploy workflow in `.github/`, and none should be added. See `docs/cloudflare.md`.

## Files to keep in sync in the same PR

1. **Milestone status** (below): update on a milestone change or major architectural decision.
2. **The in-game Manual** (`src/ui/pages/Manual.tsx`, `/manual`): player-facing, BBGM-manual style, second person, concrete numbers quoted from `src/core/constants.ts`. Update when a player-visible feature ships/changes or a quoted constant is retuned (grep for the old value). Explain hidden mechanics' behavior without spoiling hidden values.
3. **The Changelog**: ADD a new file `src/core/changelog/entries/YYYY-MM-DD-NN-slug.ts` (copy the newest for shape and voice) for any player-visible change. **Never edit a shared list**; entries are globbed so parallel PRs don't conflict.
4. **The ledger** (`docs/ledger/*.md`): the detailed record of the feature you changed.

## Architecture

- `src/core/`: pure sim logic, no UI/DOM. `constants.ts` is the central tuning table. Sub-areas `players/`, `teams/`, `league/`, `ai/`, `transfers/`, `finance/`, `lineup/`, `cup/`, `domesticCup/`, `superCup/`, `international/`, `manager/`, `nationalManager/`, `scouting/`, `frivolities/`, plus `offseason.ts`, `simThrough.ts`, `promotion.ts`, `loans.ts`, `awards.ts`, `worldAwards.ts`, `godMode.ts`, `competitions.ts`, `simArchive.ts`.
- `src/engine/`: match sim (`matchSim.ts`, `attribution.ts`, `matchRating.ts`, `positionFit.ts`, its own `constants.ts`). Cannot import core.
- `src/db/`: IndexedDB (`leagueDb.ts`, `database.ts`, `activeLeague.ts`, `exportImport.ts`) and **`migrate.ts`, which backfills every new persisted field for old saves. Update it whenever you add one.** Players, retirees, box scores (`played`) and crests live in their own stores; the league record is rewritten on every mutation, so never put large data on it.
- `src/worker/`: the sim runs in a web worker; `useSimWorker.ts`'s `post()` detaches history the sim doesn't read before `structuredClone` (see `save-size-and-storage.md`).
- `src/ui/`: React pages, components, `context/LeagueContext.tsx` (all league-mutating actions, serialized through one promise chain).
- Build targets (`vite.config.ts`, `.env.<mode>`): default (worldsoccersim.org), `itch` and `crazygames` (embedded: relative base + hash routing), `pages` (GitHub Pages subpath). PostHog keys are **committed** per mode and baked in at build time; a build without them silently reports nothing. Files in `public/` must go through `publicAsset()`.
- `test/`: vitest. `test/validation/` holds the §8 gate tests.

## Core invariants (full detail in `docs/ledger/core-invariants.md`)

- **RNG stream order is load-bearing.** Inserting or removing a shared-`rng` draw shifts every downstream roll. New per-player traits, attribution, cups, league matches and anything decorative use their own seeded streams (`mulberry32`/`hashInts`). A gate placed "after the jitter draw" exists for this reason; don't move it before. When a change legitimately moves results, the `touchStats.test.ts` scoreline hash gets rebased (note it runs `simSeason`, a separate harness that does not cover `simThrough` paths).
- **Functional core.** Core code never mutates players or state in place; unchanged objects pass through by reference. The storage dirty-diff and several memo caches depend on this (`test/db/playerIdentity.test.ts` gates it).
- **OVR scale:** 76 ≈ average starter, 81 good starter, 86 a team's best, 91-96 elite. It was lifted +11 on 2026-09-06 (`OVR_SCALE_SHIFT`) as a pure relabel; constants that name a *position* on the scale are written `original + OVR_SCALE_SHIFT`, widths and weights are not. Any OVR figure in older docs is on the old scale unless it says otherwise. A constant naming a scale position that is **duplicated** anywhere (difficulty profiles, UI bands, fixtures) is where a scale move breaks.
- **Anti-inflation is a fragile equilibrium.** Youth intake anchors to a fixed `academyBase`; potential is a scout estimate, never a growth input; `developmentBias` tapers to 0 by peak age; `growthDamping` scales only positive deltas. Anything that moves these needs a dynasty audit.
- **Match composites z-normalize within their pool.** A cross-league match (cups, playoffs, super cups, internationals) must pool every participant into one shared baseline, or a weak side is normalized back up to parity.
- **Composites bucket by SLOT, not listed position**, and the XI is picked on `slotValue` = `ovrAtSlot − familiarityPenalty`, the same number the sim scores. Secondary positions are derived, never stored. Selection, subs and scoring must stay on one number.
- **The user's club is unmanaged in headless audits.** It rots and produces every extreme tail stat; exclude `userTid` from tail metrics. User-only levers (difficulty, academy pipeline, loans-in, debt) never fire headlessly and need no dynasty audit; anything that touches AI clubs does.
- **World composition, money and market volume move the country ladder.** The weak leagues run on transfer receipts; anything that reduces AI market volume, adds selling leagues, or pays weak-league clubs more lands on the solvency tripwire. **The finance column fails before the ladder.** Gate with `weakLeaguesAudit` (20 seasons × 4 seeds, pooled by hand), run on **both** your branch and its merge base; `main` has been red on solvency repeatedly, so never assume a green baseline.
- **Cross-division comparisons must normalize by games played.** Points, appearances, goals and wages-to-income differ by division length (sizes range 10-30, some split into conferences). Season length is `competitionSeasonGames`, never `2(n-1)`. "Who won the league" reads `championTidByCompId`, never `table[0]` (title playoffs).
- **Persisting a new field:** add it to `migrate.ts`, and watch for any code that rebuilds an object by listing keys (it silently drops new fields; this has bitten three times). Anything the worker needs that is detached at the boundary must be passed in explicitly (`simArchive.test.ts` is the deep-equality gate).
- **DOM weight is the app's only known performance failure.** Cap any list of players/clubs (flags are expensive SVGs); a page can be unusable while every JS timing looks fast. Count elements, not milliseconds.
- **Potential shown to the user goes through the scouting fog** (`ui/potentialView.ts`, `PotDisplay`). Never sort or filter a displayed POT column on `player.potential`; `test/ui/potentialSort.test.ts` greps a page list, so add new pages to it.
- **UI conventions:** no emoji (icons are hand-written inline SVG); player-facing prose is casual, second person, sentence case, no em-dashes. If a control renders Bootstrap blue/cyan, a `--bs-` variable is unmapped in `styles.css`. Hover panels inside tables must portal (`AnchoredPanel`). Empty pages use `EmptyState`. Seasons render through `seasonYear` (or `seasonYearFrom` for a non-active save).

## Recurring lessons (each has burned this repo more than once)

- **When a gate fails, fix the statistic, not the band.** First measure the estimator across seeds on `origin/main`. A gate passing by a hair on main is a null gate, not a tight one.
- **Re-measure the merge base; don't trust the last verdict written in a doc.** Recorded numbers go stale with every world change (the world is now 48 competitions / 883 clubs).
- **Per-seed audit output applies mean gates to one draw.** Per-seed "BROKEN" lines on converged rungs are expected noise; pool seeds before concluding anything.
- **Two filters on different scales (absolute vs relative to the user) fail silently at the extremes.** If a mechanic gets rarer the better the user does, suspect that.
- **A per-function guard is not a per-window/per-season guard.** Ask what else writes to the same state.
- **Tag the producer; don't infer it from the product.** Heuristic attribution in probes has pointed at the wrong mechanism repeatedly.

## Milestone status

All done and merged (detail in `docs/ledger/milestones.md`): **M0** engine port · **M1** players → composites · **M2** season loop, persistence, worker, scheduling · **M3** box scores and attribution · **M4** dynasty mechanics (progression, aging, retirement, youth, FA, contracts, offseason) · **M5** match texture (cards, fatigue, subs, corners, penalties, injuries, stoppage) · **M6** finance and transfer market.

Post-M6 features are all shipped; see the ledger files for each. Major systems include: manager and national-team careers, 48-competition world across Europe and the Americas with three-division pyramids, promotion/title playoffs, three continental club competitions plus domestic and super cups, international cycle with World Cup and confederation cups, awards and all-time records, loans, scouting fog, difficulty, development models, club debt, God Mode, roster/logo import, spectator saves and multi-season jumps.

## Open design decisions

See `docs/ledger/open-decisions.md`. Still open and needing a user call: the winter-sale wage dodge, deficits at the 30-man cap, and per-stint stats for mid-season transfers. Discuss options before coding any of them.
