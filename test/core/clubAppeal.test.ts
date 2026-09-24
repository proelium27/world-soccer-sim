import { describe, it, expect } from "vitest";
import {
  clubAppealFor, appealScore, appealMultiplier, type AppealClub,
} from "../../src/core/transfers/clubAppeal.js";
import { POSITIONS, type Player, type Position } from "../../src/core/players/types.js";
import type { HomeClub } from "../../src/core/transfers/homePull.js";
import { APPEAL_FORMER_CLUB, APPEAL_LOAN_FACTOR, APPEAL_CONFEDERATION } from "../../src/core/constants.js";

const player = (nationality: string, ovr: number, extra: Partial<Player> = {}) =>
  ({ pid: 1, nationality, ovr, pos: "CM", stats: [], ...extra }) as unknown as Player;

const weakest = (ovr: number) =>
  Object.fromEntries(POSITIONS.map((p) => [p, ovr])) as Record<Position, number>;

const home = (country: string, confederation: HomeClub["confederation"], share = 0.8): HomeClub =>
  ({ country, domesticShare: share, confederation, homeLevel: 80 });

const club = (tid: number, stature: number, h: HomeClub, weakestStarter: number): AppealClub =>
  ({ tid, stature, home: h, posWeakestStarterOvr: weakest(weakestStarter) });

const argentina = home("Argentina", "South America", 0.84);
const spain = home("Spain", "Europe", 0.61);

// A free agent: no club, only the stature he measures offers against.
const freeAgent = (stature = 0.3) => ({ stature });

describe("clubAppealFor", () => {
  it("a squad player takes the club where he would start over a bigger one where he would not", () => {
    const p = player("Brazil", 60);
    const bigBench = club(1, 0.5, spain, 70);  // 10 points short of the XI
    const smallXI = club(2, 0.3, spain, 55);   // walks in
    expect(appealScore(p, smallXI, freeAgent()).score).toBeGreaterThan(appealScore(p, bigBench, freeAgent()).score);
  });

  it("a star picks the bigger club: playing time barely moves him", () => {
    const p = player("Brazil", 88);
    const big = club(1, 0.75, spain, 80);
    const small = club(2, 0.55, spain, 60);
    expect(appealScore(p, big, freeAgent(0.7)).score).toBeGreaterThan(appealScore(p, small, freeAgent(0.7)).score);
  });

  it("between otherwise equal offers, a squad player goes home", () => {
    const p = player("Argentina", 60);
    const atHome = club(1, 0.3, argentina, 60);
    const abroad = club(2, 0.3, spain, 60);
    expect(appealScore(p, atHome, freeAgent()).score).toBeGreaterThan(appealScore(p, abroad, freeAgent()).score);
  });

  it("leaving home costs what arriving home gains", () => {
    const p = player("Argentina", 60);
    const atHome = club(1, 0.3, argentina, 60);
    const abroad = club(2, 0.3, { ...spain, confederation: "South America" }, 60);
    const leaving = clubAppealFor(p, abroad, { stature: 0.3, club: atHome }).lines.find((l) => l.id === "home")!;
    const arriving = clubAppealFor(p, atHome, { stature: 0.3, club: abroad }).lines.find((l) => l.id === "home")!;
    expect(leaving.value).toBeCloseTo(-arriving.value);
    expect(arriving.value).toBeGreaterThan(0);
  });

  it("shows no far-from-home line while APPEAL_CONFEDERATION is off", () => {
    // Switched off after measurement (see the constant); the line stays in the
    // code for a language-corridor version and must not show while it is 0.
    expect(APPEAL_CONFEDERATION).toBe(0);
    const within = club(1, 0.3, home("Uruguay", "South America"), 60);
    const outside = club(2, 0.3, spain, 60);
    const lines = clubAppealFor(player("Argentina", 60), outside, { stature: 0.3, club: within }).lines;
    expect(lines.find((l) => l.id === "confederation")).toBeUndefined();
  });

  it("likes a former club and never refuses to go back to one", () => {
    const p = player("Brazil", 60, { career: { seasons: [{ season: 1, tid: 7, ovr: 55, apps: 20 }] } } as Partial<Player>);
    const former = club(7, 0.3, spain, 60);
    const line = clubAppealFor(p, former, freeAgent()).lines.find((l) => l.id === "formerClub");
    expect(line?.value).toBe(APPEAL_FORMER_CLUB);
  });

  it("refuses a big step down, and a refusal zeroes the multiplier", () => {
    const star = player("Brazil", 90);
    const tiny = club(3, 0.05, spain, 50);
    const a = clubAppealFor(star, tiny, { stature: 0.8 });
    expect(a.refused).toBe(true);
    expect(appealMultiplier(star, tiny, { stature: 0.8 })).toBe(0);
  });

  it("lets a young star go down on loan where he'd refuse a permanent move", () => {
    // 85-rated at a giant (0.9) to a club at 0.6: a drop past his refusal line
    // for good, but a loan counts as half the move.
    const p = player("Brazil", 85);
    const giant = club(1, 0.9, spain, 90);
    const smaller = club(2, 0.6, spain, 70);
    expect(appealScore(p, smaller, { stature: 0.9, club: giant }).refused).toBe(true);
    expect(appealScore(p, smaller, { stature: 0.9, club: giant }, { loan: true }).refused).toBe(false);
  });

  it("scales home and confederation on a loan", () => {
    const p = player("Argentina", 60);
    const atHome = club(1, 0.3, argentina, 60);
    const abroad = club(2, 0.3, spain, 60);
    const full = clubAppealFor(p, atHome, { stature: 0.3, club: abroad }).lines.find((l) => l.id === "home")!.value;
    const loan = clubAppealFor(p, atHome, { stature: 0.3, club: abroad }, { loan: true }).lines.find((l) => l.id === "home")!.value;
    expect(loan).toBeCloseTo(full * APPEAL_LOAN_FACTOR);
  });

  it("the score is the sum of the lines", () => {
    const p = player("Argentina", 62);
    const a = clubAppealFor(p, club(1, 0.4, argentina, 58), { stature: 0.3, club: club(2, 0.3, spain, 66) });
    expect(a.score).toBeCloseTo(a.lines.reduce((s, l) => s + l.value, 0));
  });
});

describe("the reputation line", () => {
  // A club with its stature split into squad and name, so the level line can be apportioned.
  const parted = (tid: number, strength: number, reputation: number): AppealClub => ({
    ...club(tid, strength + reputation, spain, 60),
    statureParts: { strength, reputation, wealth: 0 },
  });
  const unsplit = (c: AppealClub): AppealClub => ({ ...c, statureParts: undefined });
  const lineOf = (a: ReturnType<typeof clubAppealFor>, id: string) => a.lines.find((l) => l.id === id)?.value ?? 0;

  it("level and reputation together equal the unsplit level value, and the score does not move", () => {
    const p = player("Brazil", 80);
    const to = parted(1, 0.4, 0.3);
    const fromClub = parted(2, 0.35, 0.15);
    const split = clubAppealFor(p, to, { stature: 0.5, club: fromClub });
    const whole = clubAppealFor(p, unsplit(to), { stature: 0.5, club: unsplit(fromClub) });
    expect(lineOf(split, "level") + lineOf(split, "reputation")).toBeCloseTo(lineOf(whole, "level"));
    expect(lineOf(split, "reputation")).toBeGreaterThan(0);
    expect(split.score).toBeCloseTo(whole.score);
    expect(split.score).toBeCloseTo(appealScore(p, to, { stature: 0.5, club: fromClub }).score);
  });

  it("a refusal stays whole on the level line", () => {
    const p = player("Brazil", 90);
    const a = clubAppealFor(p, parted(1, 0.05, 0.05), { stature: 0.9, club: parted(2, 0.6, 0.3) });
    expect(a.refused).toBe(true);
    expect(lineOf(a, "level")).toBe(-1);
    expect(lineOf(a, "reputation")).toBe(0);
  });

  it("splits a free agent's stature in the weights' proportion", () => {
    const p = player("Brazil", 80);
    const to = parted(1, 0.4, 0.3);
    const a = clubAppealFor(p, to, freeAgent(0.5));
    const whole = clubAppealFor(p, unsplit(to), freeAgent(0.5));
    expect(lineOf(a, "level") + lineOf(a, "reputation")).toBeCloseTo(lineOf(whole, "level"));
    expect(a.score).toBeCloseTo(whole.score);
  });

  it("shows no reputation line when the name is the same at both clubs", () => {
    const p = player("Brazil", 80);
    const a = clubAppealFor(p, parted(1, 0.5, 0.2), { stature: 0.6, club: parted(2, 0.4, 0.2) });
    expect(lineOf(a, "reputation")).toBe(0);
    expect(lineOf(a, "level")).toBeGreaterThan(0);
  });
});
