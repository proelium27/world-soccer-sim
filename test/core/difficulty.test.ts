import { describe, it, expect } from "vitest";
import { playSeason } from "../helpers/offseasonLeague.js";
import { mulberry32 } from "../../src/engine/rng.js";
import { createLeagueState } from "../../src/core/leagueState.js";
import { simOffseason } from "../../src/core/offseason.js";
import { makeLeague } from "../helpers/league.js";
import { financeScale, financeScaleFor } from "../../src/core/finance/budget.js";
import {
  protectedStarPids, lastCompletedSeason, userProtectedStarBar, isProtectedStar,
} from "../../src/core/transfers/protectedStars.js";
import { reservationPrice, scoutedValue } from "../../src/core/transfers/negotiation.js";
import { potentialFog } from "../../src/core/scouting/potentialFog.js";
import {
  DIFFICULTIES, DIFFICULTY_ORDER, DEFAULT_DIFFICULTY, difficultyProfile,
  PROTECTED_STAR_OVR, PROTECTED_STAR_TOP_FINISH, MAX_TRANSFER_VALUE,
  SCOUT_POT_FOG_HALFWIDTH_MAX,
} from "../../src/core/constants.js";
import type { LeagueStore } from "../../src/core/leagueState.js";
import type { Player } from "../../src/core/players/types.js";

/**
 * The whole feature rests on one promise: difficulty changes the user's club
 * and nothing else. Most of these tests exist to hold that line, not to check
 * arithmetic.
 */
describe("difficulty", () => {
  describe("normal is exactly the shipped game", () => {
    it("has identity values for every lever", () => {
      const normal = DIFFICULTIES.normal;
      expect(normal.budgetScale).toBe(1);
      expect(normal.academyOffset).toBe(0);
      expect(normal.buyPriceScale).toBe(1);
      expect(normal.fogScale).toBe(1);
    });

    it("uses the shipped protected-star constants", () => {
      expect(DIFFICULTIES.normal.protectedStarOvr).toBe(PROTECTED_STAR_OVR);
      expect(DIFFICULTIES.normal.protectedStarTopFinish).toBe(PROTECTED_STAR_TOP_FINISH);
    });

    it("is the default, so an old save migrates onto the shipped tuning", () => {
      expect(DEFAULT_DIFFICULTY).toBe("normal");
      expect(difficultyProfile(undefined)).toBe(DIFFICULTIES.normal);
    });
  });

  describe("levers move in the intended direction", () => {
    it("gets harder down the order on every axis", () => {
      const profiles = DIFFICULTY_ORDER.map((d) => DIFFICULTIES[d]);
      for (let i = 1; i < profiles.length; i++) {
        const prev = profiles[i - 1];
        const cur = profiles[i];
        expect(cur.budgetScale).toBeLessThan(prev.budgetScale);
        expect(cur.academyOffset).toBeLessThan(prev.academyOffset);
        expect(cur.buyPriceScale).toBeGreaterThan(prev.buyPriceScale);
        expect(cur.fogScale).toBeGreaterThan(prev.fogScale);
        // A wider gate = a lower ovr bar and a deeper finishing cutoff.
        expect(cur.protectedStarOvr).toBeLessThan(prev.protectedStarOvr);
        expect(cur.protectedStarTopFinish).toBeGreaterThan(prev.protectedStarTopFinish);
      }
    });
  });

  describe("money", () => {
    const league = makeLeague(0, 11);
    const userTeam = league.teams.find((t) => t.tid === league.meta.userTid)!;
    const aiTeam = league.teams.find((t) => t.tid !== league.meta.userTid)!;

    it("scales the user's club and nobody else's", () => {
      for (const d of DIFFICULTY_ORDER) {
        const base = financeScale(league.competitions, aiTeam.compId);
        expect(
          financeScaleFor(league.competitions, aiTeam.compId, aiTeam.tid, league.meta.userTid, d),
        ).toBe(base);
      }
    });

    it("moves the user's scale by exactly his profile's budgetScale", () => {
      for (const d of DIFFICULTY_ORDER) {
        const base = financeScale(league.competitions, userTeam.compId);
        expect(
          financeScaleFor(league.competitions, userTeam.compId, userTeam.tid, league.meta.userTid, d),
        ).toBeCloseTo(base * DIFFICULTIES[d].budgetScale, 6);
      }
    });

    it("leaves every club untouched on normal", () => {
      for (const t of league.teams.slice(0, 20)) {
        expect(
          financeScaleFor(league.competitions, t.compId, t.tid, league.meta.userTid, "normal"),
        ).toBe(financeScale(league.competitions, t.compId));
      }
    });
  });

  describe("opening budget", () => {
    it("scales the user's post-wage surplus and never starts him in the red", () => {
      // Generated (not makeLeague) because the opening budget is computed
      // during creation, which is the thing under test.
      const byLevel = DIFFICULTY_ORDER.map((d) => {
        const l = createLeagueState(0, mulberry32(5), 5, d);
        return { d, budget: l.teams.find((t) => t.tid === 0)!.budget };
      });
      const normal = byLevel.find((b) => b.d === "normal")!.budget;
      for (const { d, budget } of byLevel) {
        expect(budget).toBeGreaterThan(0);
        expect(budget).toBeCloseTo(Math.round(normal * DIFFICULTIES[d].budgetScale), -3);
      }
    });

    it("leaves every AI club's opening budget identical on every level", () => {
      const normal = createLeagueState(0, mulberry32(5), 5, "normal");
      const brutal = createLeagueState(0, mulberry32(5), 5, "brutal");
      for (let i = 1; i < 40; i++) {
        expect(brutal.teams[i].budget).toBe(normal.teams[i].budget);
      }
    });
  });

  describe("the protected-star gate", () => {
    // A world with a season behind it, so the gate has a completed season to
    // read. Every level is applied to this ONE world: difficulty diverges the
    // rng stream, so separately simmed worlds aren't comparable.
    const played = (() => {
      const rng = mulberry32(21);
      let l = createLeagueState(0, rng, 21);
      // playSeason, not simThrough: simThrough halts before the user's cup
      // final, and simOffseason silently no-ops on any phase but "offseason" —
      // which leaves no completed season for the gate to read, so every level
      // reported zero protected stars and the "strictly more" check compared
      // 0 against 0.
      l = playSeason(l, rng);
      return simOffseason(l, rng);
    })();

    function hiddenFrom(league: LeagueStore, difficulty: LeagueStore["difficulty"]): Set<number> {
      return protectedStarPids(
        lastCompletedSeason(league), league.teams, league.players, league.competitions,
        league.meta.userTid, userProtectedStarBar(difficulty),
      );
    }

    it("shows the AI market exactly the normal-difficulty view", () => {
      // THE invariant, stated as something that can actually fail. The AI
      // callers pass no bar and so get DEFAULT_BAR; the claim worth pinning is
      // that DEFAULT_BAR is the *normal* profile, i.e. an AI club on any save
      // sees the world a normal-difficulty user does, and the harder levels
      // withhold more from the user alone.
      //
      // The previous version of this test spread `{...played, difficulty: d}`
      // through the loop and re-read `.teams` / `.players` / `.competitions`
      // off it. protectedStarPids takes those discretely and never sees a
      // league, so every iteration called the same function with identical
      // arguments and compared the result to itself — it could not fail, in
      // either direction, and would have stayed green through exactly the leak
      // it was written to catch.
      const aiFacing = protectedStarPids(
        lastCompletedSeason(played), played.teams, played.players, played.competitions,
        played.meta.userTid,
      );
      expect([...aiFacing].sort()).toEqual([...hiddenFrom(played, "normal")].sort());
      expect(aiFacing.size).toBeGreaterThan(0);
    });

    it("hides strictly more from the user as the level gets harder", () => {
      const sets = DIFFICULTY_ORDER.map((d) => hiddenFrom(played, d));
      for (let i = 1; i < sets.length; i++) {
        expect(sets[i].size).toBeGreaterThan(sets[i - 1].size);
        // Superset, not merely bigger: a harder level must never *unhide* a
        // player an easier one withheld.
        for (const pid of sets[i - 1]) expect(sets[i].has(pid)).toBe(true);
      }
    });

    it("matches the shipped gate exactly on normal", () => {
      const shipped = protectedStarPids(
        lastCompletedSeason(played), played.teams, played.players, played.competitions,
        played.meta.userTid,
      );
      expect([...hiddenFrom(played, "normal")].sort()).toEqual([...shipped].sort());
    });

    it("never protects the user's own players, on any level", () => {
      const userPids = new Set(played.teams.find((t) => t.tid === played.meta.userTid)!.roster);
      for (const d of DIFFICULTY_ORDER) {
        for (const pid of hiddenFrom(played, d)) expect(userPids.has(pid)).toBe(false);
      }
    });

    it("defaults to the shipped bar when none is passed", () => {
      const last = lastCompletedSeason(played)!;
      const team = played.teams.find((t) => t.tid !== played.meta.userTid)!;
      for (const pid of team.roster) {
        const p = played.players.find((pp) => pp.pid === pid)!;
        expect(isProtectedStar(last, played.competitions, team.tid, p)).toBe(
          isProtectedStar(last, played.competitions, team.tid, p, {
            ovr: PROTECTED_STAR_OVR, topFinish: PROTECTED_STAR_TOP_FINISH,
          }),
        );
      }
    });
  });

  describe("transfer prices", () => {
    const league = makeLeague(0, 12);
    const player = league.players.find((p) => p.ovr >= 70 && p.ovr <= 74)!;

    it("scales what the user is asked to pay", () => {
      const normal = reservationPrice(league.lid, 1, "summer", player, 1);
      for (const d of DIFFICULTY_ORDER) {
        const scale = DIFFICULTIES[d].buyPriceScale;
        const priced = reservationPrice(league.lid, 1, "summer", player, scale);
        expect(priced).toBeCloseTo(Math.round(normal * scale), -3);
      }
    });

    it("defaults to the unscaled price, so every existing caller is unaffected", () => {
      expect(reservationPrice(league.lid, 1, "summer", player)).toBe(
        reservationPrice(league.lid, 1, "summer", player, 1),
      );
      expect(scoutedValue(league.lid, 1, "summer", player, 0)).toBe(
        scoutedValue(league.lid, 1, "summer", player, 0, 1),
      );
    });

    it("never quotes above the believable ceiling, however hard the level", () => {
      const elite = [...league.players].sort((a, b) => b.ovr - a.ovr)[0];
      const inflated: Player = { ...elite, ovr: 99, potential: 99 };
      for (const d of DIFFICULTY_ORDER) {
        const scale = DIFFICULTIES[d].buyPriceScale;
        expect(reservationPrice(league.lid, 1, "summer", inflated, scale))
          .toBeLessThanOrEqual(MAX_TRANSFER_VALUE);
        expect(scoutedValue(league.lid, 1, "summer", inflated, 0, scale))
          .toBeLessThanOrEqual(MAX_TRANSFER_VALUE);
      }
    });
  });

  describe("scouting fog", () => {
    const args = [72, 1234, 5, null, 0] as const;

    it("widens the band as the level gets harder", () => {
      const widths = DIFFICULTY_ORDER.map((d) => {
        const fog = potentialFog(...args, d);
        return fog.high - fog.low;
      });
      for (let i = 1; i < widths.length; i++) {
        expect(widths[i]).toBeGreaterThanOrEqual(widths[i - 1]);
      }
      expect(widths[widths.length - 1]).toBeGreaterThan(widths[0]);
    });

    it("is unchanged on normal and when no difficulty is passed", () => {
      expect(potentialFog(...args, "normal")).toEqual(potentialFog(...args));
    });

    it("always brackets the true potential, on every level", () => {
      for (const d of DIFFICULTY_ORDER) {
        for (const pot of [40, 55, 72, 88]) {
          const fog = potentialFog(pot, 99, 5, null, 0, d);
          expect(fog.low).toBeLessThanOrEqual(pot);
          expect(fog.high).toBeGreaterThanOrEqual(pot);
        }
      }
    });

    it("cannot widen past a sane band even on the hardest level", () => {
      const fog = potentialFog(72, 1234, 5, null, 0, "brutal");
      expect(fog.high - fog.low).toBeLessThanOrEqual(
        SCOUT_POT_FOG_HALFWIDTH_MAX * 2 * DIFFICULTIES.brutal.fogScale + 1,
      );
    });
  });

  describe("academy", () => {
    // One played season, then the same offseason run twice with only the
    // difficulty differing — every rng draw before youth intake is identical,
    // so any gap in the intake is the academy lever and nothing else.
    const base = (() => {
      const rng = mulberry32(31);
      const l = createLeagueState(0, rng, 31);
      return playSeason(l, rng);
    })();

    function intakeOvr(difficulty: LeagueStore["difficulty"], tid: number): number {
      const before = new Set(base.players.map((p) => p.pid));
      const after = simOffseason({ ...base, difficulty }, mulberry32(777));
      const team = after.teams.find((t) => t.tid === tid)!;
      // The USER's intake lands in his academy; an AI club's goes straight to
      // the roster, so covering both keeps one helper honest for both callers.
      const fresh = [...team.roster, ...team.academyRoster]
        .filter((pid) => !before.has(pid))
        .map((pid) => after.players.find((p) => p.pid === pid))
        .filter((p): p is Player => p !== undefined);
      if (fresh.length === 0) return NaN;
      return fresh.reduce((s, p) => s + p.ovr, 0) / fresh.length;
    }

    it("gives the user better prospects on easy than on brutal", () => {
      const easy = intakeOvr("easy", base.meta.userTid);
      const brutal = intakeOvr("brutal", base.meta.userTid);
      expect(easy).toBeGreaterThan(brutal);
    });

    it("leaves an AI club's intake identical on both levels", () => {
      const aiTid = base.teams.find((t) => t.tid !== base.meta.userTid)!.tid;
      expect(intakeOvr("easy", aiTid)).toBe(intakeOvr("brutal", aiTid));
    });
  });
});
