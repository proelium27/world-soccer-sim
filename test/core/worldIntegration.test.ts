import { describe, it, expect } from "vitest";
import { mulberry32 } from "../../src/engine/rng.js";
import { generateWorld } from "../../src/core/league/generate.js";
import { worldCompetitions, competitionTeamCount } from "../../src/core/competitions.js";
import { assignIdentities } from "../../src/core/teams/clubs.js";
import { simThrough } from "../../src/core/simThrough.js";
import { simOffseason } from "../../src/core/offseason.js";
import { buildCompetitionSchedule, type LeagueStore } from "../../src/core/leagueState.js";
import { emptyManagerState } from "../../src/core/manager/types.js";
import { emptyNationalManagerState } from "../../src/core/nationalManager/types.js";

function buildWorldLeague(seed: number): LeagueStore {
  const rng = mulberry32(seed);
  const world = generateWorld(rng, seed);
  const competitions = worldCompetitions();
  const teams = assignIdentities(world, competitions);
  const schedule = buildCompetitionSchedule(teams, competitions);
  return {
    lid: 1,
    meta: { name: "World Test League", created: Date.now(), userTid: 0 },
    competitions,
    teams,
    players: world.players,
    // Same value the old derived allocator produced, so pids are unchanged.
    nextPid: Math.max(0, ...world.players.map((p) => p.pid)) + 1,
    aiManagedSeasons: [],
    progressionModel: "random" as const,
    rollingCoefficients: true,
    season: 1,
    phase: "regular",
    schedule,
    played: [],
    negotiations: [],
    inboundOffers: [],
    transfers: [],
    transferClauses: [],
    winterMarketRunSeason: null,
    seasonHistory: [],
    newsEvents: [],
    retiredPlayers: [],
    playerNames: [],
    activeLoans: [],
    loanListings: [],
    loanRejections: [],
    watchlist: [],
    cup: null,
    cupHistory: [],
    shield: null,
    shieldHistory: [],
    domesticCups: [],
    domesticCupHistory: [],
    promotionPlayoffs: [],
    superCups: [],
    international: { qualifying: null, tournament: null, confederationCups: [], history: [], qualifyingHistory: [], confederationCupHistory: [], powerRankings: [], stage: null, stageInjuries: [] },
    powerRankingHistory: [],
    godMode: false,
    difficulty: "normal",
    manager: emptyManagerState(0, 1),
    nationalManager: emptyNationalManagerState(),
  };
}

describe("world integration (generateWorld through the real season/offseason pipeline)", () => {
  it("simulates a full season across all 16 competitions without crashing", () => {
    const rng = mulberry32(100);
    let league = buildWorldLeague(100);
    league = simThrough(league, "season", rng);
    expect(league.played.length).toBeGreaterThan(0);
    // Every played match is within one competition — no cross-competition fixtures.
    const compByTid = new Map(league.teams.map((t) => [t.tid, t.compId]));
    for (const m of league.played) {
      expect(compByTid.get(m.home)).toBe(compByTid.get(m.away));
    }
  });

  it("runs a full offseason: promotion/relegation happens independently per country", () => {
    const rng = mulberry32(101);
    let league = buildWorldLeague(101);
    league = simThrough(league, "season", rng);
    const beforeCompByTid = new Map(league.teams.map((t) => [t.tid, t.compId]));
    // The season's end settles every country's promotion playoff, before the
    // offseason consumes it (see simThrough's offseason transition).
    const playoffs = league.promotionPlayoffs;
    expect(playoffs.length).toBeGreaterThan(0);
    league = simOffseason(league, rng);
    expect(league.teams).toHaveLength(626);
    // Every competition still has its own club count after the swap — divisions
    // are different sizes now, and promotion must preserve each one exactly.
    for (const comp of league.competitions) {
      expect(league.teams.filter((t) => t.compId === comp.id))
        .toHaveLength(competitionTeamCount(comp));
    }
    // At least one country actually swapped teams (statistically near-certain
    // across 6 countries x 3 promotions each) — proves the per-country loop
    // from PR 1 (computeCountrySwaps/applyCompetitionSwaps) is actually firing
    // for Spain, Italy, and Germany, not just England.
    let anySwapped = false;
    for (const t of league.teams) {
      if (beforeCompByTid.get(t.tid) !== t.compId) anySwapped = true;
    }
    expect(anySwapped).toBe(true);

    // Every playoff winner is a club that actually went up, and the record is
    // copied onto the season it decided and cleared off the live field — the
    // two halves of "transient, not history". If the winner were ever left in
    // the second division the world would still balance (someone else went up
    // in his place), so this is the assertion that catches a swap that ignored
    // the playoff.
    const compAfter = new Map(league.teams.map((t) => [t.tid, t.compId]));
    for (const p of playoffs) {
      expect(p.winnerTid).not.toBeNull();
      expect(compAfter.get(p.winnerTid!)).toBe(p.d1CompId);
    }
    expect(league.promotionPlayoffs).toHaveLength(0);
    const archived = league.seasonHistory.at(-1)!.promotionPlayoffs;
    expect(archived).toEqual(playoffs);
  });

  it("the Division-2 ceiling sweep moves a qualifying player to tier 1 in ANY country, not just England", () => {
    const rng = mulberry32(102);
    let league = buildWorldLeague(102);
    league = simThrough(league, "season", rng);
    // Force a non-English tier-2 (Spain D1's partner, i.e. Spain D2, compId 3)
    // AI player to a qualifying OVR.
    const spainD2 = league.competitions.find((c) => c.country === "Spain" && c.tier === 2)!;
    const spainD2Team = league.teams.find((t) => t.compId === spainD2.id && t.tid !== league.meta.userTid)!;
    const targetPid = spainD2Team.roster[0];
    // A qualifying player needs genuinely high underlying ratings, not just a
    // forced `ovr`: simOffseason's progression step recomputes ovr from
    // ratings (progressPlayer) before the ceiling sweep runs, so setting `ovr`
    // alone gets wiped back to his real (~55) rating-derived value and he'd
    // never qualify. Boost every rating (real ovr ~90, comfortably survives one
    // progression step) and pin a prime age so retirement can't drop him from
    // the roster mid-offseason.
    league = {
      ...league,
      players: league.players.map((p) =>
        p.pid === targetPid
          ? {
              ...p,
              ratings: Object.fromEntries(
                Object.keys(p.ratings).map((k) => [k, 90]),
              ) as typeof p.ratings,
              ovr: 95,
              born: league.season - 24,
            }
          : p,
      ),
    };
    const next = simOffseason(league, rng);
    const newTeam = next.teams.find((t) => t.roster.includes(targetPid))!;
    const newComp = next.competitions.find((c) => c.id === newTeam.compId)!;
    expect(newComp.tier).toBe(1);
  });
});
