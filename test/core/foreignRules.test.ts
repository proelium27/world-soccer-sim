import { describe, it, expect } from "vitest";
import {
  registrationBlock, helpsShortMinimum, breaksMinimum, isHomegrown, isNonEu, isAcp,
  competitionForeignRules, worldRules, LEAGUE_FOREIGN_RULES, type ForeignRule, type RuleContext,
} from "../../src/core/foreignRules.js";
import { worldCompetitions } from "../../src/core/competitions.js";
import { signFreeAgent, signToAcademy, trimRosterSurplus } from "../../src/core/freeAgency.js";
import type { Player } from "../../src/core/players/types.js";
import { makeLeague } from "../helpers/league.js";

let nextPid = 10_000_000;
const player = (nationality: string, extra: Partial<Player> = {}) =>
  ({ pid: nextPid++, nationality, ovr: 60, born: -10, stats: [], ...extra }) as unknown as Player;

const ctx = (country: string): RuleContext => ({ country, countryOfTid: () => undefined, season: 1 });

describe("caps are hard", () => {
  it("a foreigner cap blocks the next foreigner and nobody else", () => {
    const rule: ForeignRule = { kind: "foreignCap", max: 2, basis: "nationality" };
    const squad = [player("Brazil"), player("Chile"), player("Argentina")];
    expect(registrationBlock(squad, player("Uruguay"), [rule], ctx("Argentina"))).toMatch(/2 foreign players/);
    expect(registrationBlock(squad, player("Argentina"), [rule], ctx("Argentina"))).toBeNull();
    // A player already on the squad (a re-signing) never takes a new slot.
    expect(registrationBlock(squad, squad[0], [rule], ctx("Argentina"))).toBeNull();
  });

  it("a non-EU cap counts only non-EU/EEA nationals, and ACP/UK where the rule says so", () => {
    const spain: ForeignRule = { kind: "nonEuCap", max: 1, acp: true };
    const squad = [player("Brazil")];
    expect(registrationBlock(squad, player("Portugal"), [spain], ctx("Spain"))).toBeNull();
    expect(registrationBlock(squad, player("Norway"), [spain], ctx("Spain"))).toBeNull();
    expect(registrationBlock(squad, player("Ghana"), [spain], ctx("Spain"))).toBeNull();
    expect(registrationBlock(squad, player("Colombia"), [spain], ctx("Spain"))).toMatch(/non-EU/);
    expect(isNonEu("England", { uk: true })).toBe(false);
    expect(isNonEu("England", {})).toBe(true);
    expect(isAcp("Ghana")).toBe(true);
    expect(isAcp("Morocco")).toBe(false);
    expect(isAcp("Jamaica")).toBe(true);
  });
});

describe("minimums are soft", () => {
  const rule: ForeignRule = { kind: "nationalMin", min: 2 };

  it("never block a signing, but flag the players who help", () => {
    const squad = [player("Serbia"), player("Brazil")];
    expect(registrationBlock(squad, player("Brazil"), [rule], ctx("Serbia"))).toBeNull();
    expect(helpsShortMinimum(squad, player("Serbia"), [rule], ctx("Serbia"))).toBe(true);
    expect(helpsShortMinimum(squad, player("Brazil"), [rule], ctx("Serbia"))).toBe(false);
  });

  it("losing a member breaks a minimum the squad only just meets", () => {
    const serbs = [player("Serbia"), player("Serbia")];
    expect(breaksMinimum([...serbs, player("Brazil")], serbs[0], [rule], ctx("Serbia"))).toBe(true);
    expect(breaksMinimum([...serbs, player("Serbia")], serbs[0], [rule], ctx("Serbia"))).toBe(false);
  });
});

describe("isHomegrown", () => {
  const countryOfTid = (tid: number) => (tid === 1 ? "England" : tid === 2 ? "Spain" : "Italy");

  it("counts three seasons aged 15-20 at clubs in the country", () => {
    const p = player("Spain", {
      born: 0,
      career: { seasons: [15, 16, 17, 18, 19, 20].map((season) => ({ season, tid: season <= 17 ? 1 : 3, ovr: 50, apps: 5 })) },
    } as Partial<Player>);
    expect(isHomegrown(p, "England", countryOfTid, 30)).toBe(true);
    expect(isHomegrown(p, "Spain", countryOfTid, 30)).toBe(false);
  });

  it("credits seasons with no record to his own country (generated players)", () => {
    const p = player("England", { born: -30 });
    expect(isHomegrown(p, "England", countryOfTid, 5)).toBe(true);
    expect(isHomegrown(p, "Spain", countryOfTid, 5)).toBe(false);
  });

  it("counts Welsh training for England's rule, as the Premier League does", () => {
    const p = player("Wales", { born: -30 });
    expect(isHomegrown(p, "England", countryOfTid, 5)).toBe(true);
    expect(isHomegrown(p, "Spain", countryOfTid, 5)).toBe(false);
  });

  it("registers a Swiss player as EU", () => {
    expect(isNonEu("Switzerland", {})).toBe(false);
  });

  it("drives a 'trained' cap like Mexico's", () => {
    const rule: ForeignRule = { kind: "foreignCap", max: 1, basis: "trained" };
    const mx = (nationality: string) => player(nationality, { born: -30 });
    // A Mexican-born player raised at home is not counted; an Argentine is.
    const squad = [mx("Argentina")];
    expect(registrationBlock(squad, mx("Mexico"), [rule], ctx("Mexico"))).toBeNull();
    expect(registrationBlock(squad, mx("Colombia"), [rule], ctx("Mexico"))).toMatch(/not trained/);
  });
});

describe("the shipped table", () => {
  it("has an entry for every shipped country, explicit empties included", () => {
    for (const country of new Set(worldCompetitions().map((c) => c.country))) {
      expect(LEAGUE_FOREIGN_RULES[country], country).toBeDefined();
    }
  });

  it("a league's own rules override the table, and France's second tier differs", () => {
    const comps = worldCompetitions();
    const fra1 = comps.find((c) => c.country === "France" && c.tier === 1)!;
    const fra2 = comps.find((c) => c.country === "France" && c.tier === 2)!;
    expect(competitionForeignRules(fra1)[0]).toMatchObject({ kind: "nonEuCap", max: 4 });
    expect(competitionForeignRules(fra2)[0]).toMatchObject({ kind: "nonEuCap", max: 2 });
    expect(competitionForeignRules({ ...fra1, foreignRules: [] })).toEqual([]);
  });

  it("a league the player added takes no shipped rules, even named after a real country", () => {
    const arg = worldCompetitions().find((c) => c.country === "Argentina" && c.tier === 1)!;
    expect(competitionForeignRules(arg).length).toBeGreaterThan(0);
    expect(competitionForeignRules({ ...arg, nationalities: { __REST__: 100 } })).toEqual([]);
  });
});

describe("on a real world", () => {
  const league = makeLeague(0, 1);
  const byPid = new Map(league.players.map((p) => [p.pid, p]));
  const comps = new Map(league.competitions.map((c) => [c.id, c]));
  const argClub = league.teams.find((t) => comps.get(t.compId)!.country === "Argentina" && comps.get(t.compId)!.tier === 1)!;
  const foreigner = (pid: number) => byPid.get(pid)!.nationality !== "Argentina";

  it("blocks a foreign free agent at a club at its cap, and a league without rules never checks", () => {
    const rules = worldRules(league.teams, league.competitions, (pid) => byPid.get(pid), league.season);
    // Fill the Argentine club's foreign slots to the cap with invented foreigners.
    const extra = Array.from({ length: 6 }, () => player("Brazil", { born: 0, pos: "CM" }));
    const players = [...league.players, ...extra];
    const lookup = new Map(players.map((p) => [p.pid, p]));
    const roster = [...argClub.roster.filter((pid) => !foreigner(pid)).slice(0, 18), ...extra.map((p) => p.pid)];
    const r = worldRules(league.teams, league.competitions, (pid) => lookup.get(pid), league.season);
    expect(r.block(argClub.tid, roster, player("Chile", { born: 0 }))).toMatch(/6 foreign/);
    expect(r.block(argClub.tid, roster, byPid.get(argClub.roster.find((pid) => !foreigner(pid))!)!)).toBeNull();

    const scot = league.teams.find((t) => comps.get(t.compId)!.country === "Scotland")!;
    expect(rules.standings(scot.tid, scot.roster)).toEqual([]);
  });

  it("signFreeAgent refuses the user a foreigner his league's cap has no room for", () => {
    const extra = Array.from({ length: 6 }, () => player("Brazil", { born: 0, pos: "CM" }));
    const target = player("Chile", { born: 0, pos: "CM", contract: { salary: 0, expiresSeason: 0 } } as Partial<Player>);
    const teams = league.teams.map((t) => t.tid === argClub.tid
      ? { ...t, roster: [...t.roster.filter((pid) => !foreigner(pid)).slice(0, 18), ...extra.map((p) => p.pid)], budget: 1e12 }
      : t);
    const players = [...league.players, ...extra, target];
    const out = signFreeAgent(teams, players, argClub.tid, target.pid, league.season, "offseason", [], undefined, league.competitions);
    expect(out.teams).toBe(teams);
    const home = player("Argentina", { born: 0, pos: "CM", contract: { salary: 0, expiresSeason: 0 } } as Partial<Player>);
    const ok = signFreeAgent(teams, [...players, home], argClub.tid, home.pid, league.season, "offseason", [], undefined, league.competitions);
    expect(ok.teams.find((t) => t.tid === argClub.tid)!.roster).toContain(home.pid);
  });

  it("the academy is no way round a cap", () => {
    const extra = Array.from({ length: 6 }, () => player("Brazil", { born: 0, pos: "CM" }));
    const kid = player("Chile", { born: league.season - 19, pos: "CM", contract: { salary: 0, expiresSeason: 0 } } as Partial<Player>);
    const teams = league.teams.map((t) => t.tid === argClub.tid
      ? { ...t, roster: [...t.roster.filter((pid) => !foreigner(pid)).slice(0, 18), ...extra.map((p) => p.pid)], academyRoster: [], budget: 1e12 }
      : t);
    const players = [...league.players, ...extra, kid];
    const blocked = signToAcademy(teams, players, argClub.tid, kid.pid, league.season, "offseason", [], undefined, league.competitions);
    expect(blocked.teams).toBe(teams);
    // With no competitions passed (no rules checked), the same kid signs: the refusal above is the cap's.
    const open = signToAcademy(teams, players, argClub.tid, kid.pid, league.season, "offseason", [], undefined, []);
    expect(open.teams.find((t) => t.tid === argClub.tid)!.academyRoster).toContain(kid.pid);
  });

  it("the trim never takes a club below a minimum it met", () => {
    const serbClub = league.teams.find((t) => comps.get(t.compId)!.country === "Serbia" && comps.get(t.compId)!.tier === 1)!;
    // Pad the roster with strong foreigners so the trim would rather keep them.
    const extra = Array.from({ length: 12 }, (_, i) => player("Brazil", { born: 0, ovr: 95, pos: (["GK", "CB", "FB", "DM", "CM", "AM", "W", "ST"] as const)[i % 8] }));
    const serbs = serbClub.roster.filter((pid) => byPid.get(pid)!.nationality === "Serbia");
    expect(serbs.length).toBeGreaterThanOrEqual(13);
    const teams = league.teams.map((t) => t.tid === serbClub.tid ? { ...t, roster: [...t.roster, ...extra.map((p) => p.pid)] } : t);
    const players = [...league.players, ...extra];
    const trimmed = trimRosterSurplus(teams, players, -99, league.season, [], league.progressionModel, league.competitions)
      .find((t) => t.tid === serbClub.tid)!;
    const lookup = new Map(players.map((p) => [p.pid, p]));
    expect(trimmed.roster.filter((pid) => lookup.get(pid)!.nationality === "Serbia").length).toBeGreaterThanOrEqual(13);
  });
});
