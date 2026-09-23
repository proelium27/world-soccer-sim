/**
 * Foreign-player registration rules: the real league rules on who a club may
 * register, only where a real league has one, in the shape it really has.
 * docs/club-reputation.md, Part A5.
 *
 * They bind every club, the user's included, on every acquisition path (free
 * agency, transfer buys, loans in). They are rules, not preferences: nothing
 * here scales a valuation. A club that may register a player values him like
 * anyone else, and the player's own view of the club (`clubAppealFor`) is a
 * separate thing.
 *
 * Two kinds, and the difference is load-bearing:
 *  - **Caps are hard.** A club at a cap cannot sign another player the cap
 *    counts. Nobody is ever removed for being over one: a save that arrives over
 *    a cap (an existing save, or youth intake, which is exempt) is simply frozen
 *    for that kind of signing until it is back under.
 *  - **Minimums are soft.** A club short of a minimum prefers an eligible
 *    candidate but is never blocked, or a freshly generated world could
 *    deadlock with nobody eligible to sign. Trimming never takes a club below a
 *    minimum it currently meets.
 *
 * Pure and rng-free.
 */
import type { Player } from "./players/types.js";
import type { Competition } from "./competitions.js";
import { confederationOf } from "./international/confederations.js";

export type ForeignRule =
  /** At most `max` players counted as foreign. `basis` says what foreign means. */
  | { kind: "foreignCap"; max: number; basis: "nationality" | "trained" }
  /** At most `max` non-EU/EEA players. `acp`: ACP-agreement nationals count as EU. `uk`: so do UK nationals. */
  | { kind: "nonEuCap"; max: number; acp?: boolean; uk?: boolean }
  /** At least `min` players trained in the country (`isHomegrown`). Soft. */
  | { kind: "homegrownMin"; min: number }
  /** At least `min` players of the country's own nationality. Soft. */
  | { kind: "nationalMin"; min: number };

/** Seasons at clubs in the country, aged 15-20, that make a player homegrown there. */
export const HOMEGROWN_SEASONS = 3;
export const HOMEGROWN_AGE_MIN = 15;
export const HOMEGROWN_AGE_MAX = 20;

/**
 * Each shipped country's rules, from the league's current regulations
 * (researched 2026-09-22; the sources are in docs/club-reputation.md, A5).
 * Applied to every division of the country: the second tier is known to match
 * for Germany, and France's second tier is the one known exception (below). For
 * the rest the lower divisions' rules were not found and the top flight's are
 * assumed.
 *
 * Squad-list rules are scaled to the game's 25-man squad where the real list
 * differs. Rules the game has no mechanism for are not modelled: matchday and
 * on-pitch limits (Brazil's matchday limit is applied to the squad), Italy's
 * two new non-EU signings a season (a limit on arrivals, not on the squad),
 * and salary floors (the Netherlands, Belgium, work permits).
 */
export const LEAGUE_FOREIGN_RULES: Record<string, ForeignRule[]> = {
  // Premier League: 25 over-21s, at most 17 not homegrown (8 homegrown).
  England: [{ kind: "homegrownMin", min: 8 }],
  // LaLiga: 3 non-EU in the first team; ACP (Cotonou) nationals count as EU.
  Spain: [{ kind: "nonEuCap", max: 3, acp: true }],
  // Serie A: 25-man list needs 4 club-trained + 4 Italy-trained.
  Italy: [{ kind: "homegrownMin", min: 8 }],
  // Bundesliga: at least 12 Germans under contract; 8 locally trained.
  Germany: [{ kind: "nationalMin", min: 12 }, { kind: "homegrownMin", min: 8 }],
  // Ligue 1: at most 4 non-EU; ACP nationals and UK nationals tolerated.
  France: [{ kind: "nonEuCap", max: 4, acp: true, uk: true }],
  // Liga Portugal: at least 8 locally trained. No foreign cap.
  Portugal: [{ kind: "homegrownMin", min: 8 }],
  // Pro League: at least 6 Belgian-trained on the match sheet.
  Belgium: [{ kind: "homegrownMin", min: 6 }],
  // Süper Lig: at most 14 foreigners on the A list (2025-26).
  Turkey: [{ kind: "foreignCap", max: 14, basis: "nationality" }],
  // Eredivisie: no quota (only a salary floor for non-EU players).
  Netherlands: [],
  // Scottish Premiership: no league quota.
  Scotland: [],
  // Super League Greece: at most 6 non-EU over-23s (2025-26).
  Greece: [{ kind: "nonEuCap", max: 6 }],
  // Serbian SuperLiga: at least 15 of the 30-man list Serbian (13 of 25).
  Serbia: [{ kind: "nationalMin", min: 13 }],
  // Brasileirão: at most 9 foreigners in the match squad.
  Brazil: [{ kind: "foreignCap", max: 9, basis: "nationality" }],
  // Liga Profesional: at most 6 foreign contracts.
  Argentina: [{ kind: "foreignCap", max: 6, basis: "nationality" }],
  // Liga MX: at most 9 players not trained in Mexico.
  Mexico: [{ kind: "foreignCap", max: 9, basis: "trained" }],
  // MLS: 8 international slots per club.
  "United States": [{ kind: "foreignCap", max: 8, basis: "nationality" }],
};

/** Per-tier overrides where a lower division's rule is known to differ. */
const TIER_OVERRIDES: Record<string, Record<number, ForeignRule[]>> = {
  // Ligue 2: at most 2 non-EU.
  France: { 2: [{ kind: "nonEuCap", max: 2, acp: true, uk: true }] },
};

/**
 * A competition's rules: its own if the world set any (a custom league in World
 * setup), else the shipped table for its country and tier. A country with no
 * entry has no rules.
 */
export function competitionForeignRules(comp: Competition): ForeignRule[] {
  if (comp.foreignRules) return comp.foreignRules;
  return TIER_OVERRIDES[comp.country]?.[comp.tier] ?? LEAGUE_FOREIGN_RULES[comp.country] ?? [];
}

/** EU and EEA member states, in the game's nationality spellings. */
export const EU_EEA = new Set([
  "Austria", "Belgium", "Bulgaria", "Croatia", "Cyprus", "Czech Republic", "Denmark",
  "Estonia", "Finland", "France", "Germany", "Greece", "Hungary", "Republic of Ireland",
  "Italy", "Latvia", "Lithuania", "Luxembourg", "Malta", "Netherlands", "Poland",
  "Portugal", "Romania", "Slovakia", "Slovenia", "Spain", "Sweden",
  // EEA
  "Iceland", "Norway", "Liechtenstein",
  // A Dutch constituent country: its players hold Dutch passports.
  "Curacao",
]);

const UK = new Set(["England", "Scotland", "Wales", "Northern Ireland"]);

const NORTH_AFRICA = new Set(["Morocco", "Algeria", "Tunisia", "Egypt", "Libya"]);
const CARIBBEAN_ACP = new Set([
  "Antigua and Barbuda", "Bahamas", "Barbados", "Belize", "Cuba", "Dominica",
  "Dominican Republic", "Grenada", "Guyana", "Haiti", "Jamaica", "Saint Kitts and Nevis",
  "Saint Lucia", "Saint Vincent and the Grenadines", "Suriname", "Trinidad and Tobago",
]);

/**
 * ACP-agreement (Cotonou) nations, which Spain and France register as EU.
 * Approximated from the game's confederations: Africa except the North African
 * states, the Caribbean list above, and Oceania except New Zealand. The real
 * membership is a treaty list; this is close to it for the nations the game has.
 */
export function isAcp(nationality: string): boolean {
  if (CARIBBEAN_ACP.has(nationality)) return true;
  const conf = confederationOf(nationality);
  if (conf === "Africa") return !NORTH_AFRICA.has(nationality);
  if (conf === "Oceania") return nationality !== "New Zealand";
  return false;
}

/** Does this player take a non-EU slot under this rule? */
export function isNonEu(nationality: string, rule: { acp?: boolean; uk?: boolean }): boolean {
  if (EU_EEA.has(nationality)) return false;
  if (rule.uk && UK.has(nationality)) return false;
  if (rule.acp && isAcp(nationality)) return false;
  return true;
}

/**
 * Was this player trained in `country`: HOMEGROWN_SEASONS seasons at clubs in
 * the country between ages 15 and 20?
 *
 * A season's club comes from his record (`career.seasons`, then `stats`). A
 * season with no record — before the save began, or unsigned, or in an
 * academy — is credited to his own nationality's country: that is how a
 * generated player was generated, and it is the one approximation here.
 */
export function isHomegrown(
  player: Player,
  country: string,
  countryOfTid: (tid: number) => string | undefined,
  currentSeason: number,
): boolean {
  const clubBySeason = new Map<number, number>();
  for (const s of player.career?.seasons ?? []) clubBySeason.set(s.season, s.tid);
  for (const s of player.stats ?? []) clubBySeason.set(s.season, s.tid);
  let seasons = 0;
  for (let age = HOMEGROWN_AGE_MIN; age <= HOMEGROWN_AGE_MAX; age++) {
    const season = player.born + age;
    if (season > currentSeason) break;
    const tid = clubBySeason.get(season);
    const where = tid === undefined ? player.nationality : countryOfTid(tid);
    if (where === country && ++seasons >= HOMEGROWN_SEASONS) return true;
  }
  return false;
}

/** What the rules need to classify players at one club's country. */
export interface RuleContext {
  country: string;
  countryOfTid: (tid: number) => string | undefined;
  season: number;
  /**
   * Homegrown answers already worked out this pass, by player then country. A
   * free-agency pass sorts hundreds of candidates for every open slot, so
   * without it each comparison re-walks a career.
   */
  homegrownCache?: WeakMap<Player, Map<string, boolean>>;
}

function homegrownIn(player: Player, ctx: RuleContext): boolean {
  const cache = ctx.homegrownCache;
  const hit = cache?.get(player)?.get(ctx.country);
  if (hit !== undefined) return hit;
  const answer = isHomegrown(player, ctx.country, ctx.countryOfTid, ctx.season);
  if (cache) {
    let byCountry = cache.get(player);
    if (!byCountry) { byCountry = new Map(); cache.set(player, byCountry); }
    byCountry.set(ctx.country, answer);
  }
  return answer;
}

/** Does this player count toward this rule? (For a cap: takes a slot. For a minimum: satisfies it.) */
export function countsToward(player: Player, rule: ForeignRule, ctx: RuleContext): boolean {
  switch (rule.kind) {
    case "foreignCap":
      return rule.basis === "nationality"
        ? player.nationality !== ctx.country
        : !homegrownIn(player, ctx);
    case "nonEuCap":
      return player.nationality !== ctx.country && isNonEu(player.nationality, rule);
    case "homegrownMin":
      return homegrownIn(player, ctx);
    case "nationalMin":
      return player.nationality === ctx.country;
  }
}

export interface RuleStanding {
  rule: ForeignRule;
  /** Players on the squad the rule counts. */
  count: number;
  /** The cap or the minimum. */
  limit: number;
}

/** Where a squad stands against each of its league's rules. */
export function ruleStandings(roster: readonly Player[], rules: readonly ForeignRule[], ctx: RuleContext): RuleStanding[] {
  return rules.map((rule) => ({
    rule,
    count: roster.filter((p) => countsToward(p, rule, ctx)).length,
    limit: rule.kind === "foreignCap" || rule.kind === "nonEuCap" ? rule.max : rule.min,
  }));
}

/**
 * Why this squad may not register `incoming`, or null if it may. Only caps
 * block. A player already on the squad (a re-signing) never takes a new slot.
 */
export function registrationBlock(
  roster: readonly Player[],
  incoming: Player,
  rules: readonly ForeignRule[],
  ctx: RuleContext,
): string | null {
  if (roster.some((p) => p.pid === incoming.pid)) return null;
  for (const rule of rules) {
    if (rule.kind !== "foreignCap" && rule.kind !== "nonEuCap") continue;
    if (!countsToward(incoming, rule, ctx)) continue;
    const count = roster.filter((p) => countsToward(p, rule, ctx)).length;
    if (count >= rule.max) {
      return rule.kind === "nonEuCap"
        ? `The league allows ${rule.max} non-EU players and the squad is full`
        : rule.basis === "trained"
          ? `The league allows ${rule.max} players not trained in the country and the squad is full`
          : `The league allows ${rule.max} foreign players and the squad is full`;
    }
  }
  return null;
}

/**
 * Would adding `incoming` help a squad short of a minimum? For the soft half:
 * a club short of a minimum prefers a candidate this returns true for.
 */
export function helpsShortMinimum(
  roster: readonly Player[],
  incoming: Player,
  rules: readonly ForeignRule[],
  ctx: RuleContext,
): boolean {
  for (const rule of rules) {
    if (rule.kind !== "homegrownMin" && rule.kind !== "nationalMin") continue;
    const count = roster.filter((p) => countsToward(p, rule, ctx)).length;
    if (count < rule.min && countsToward(incoming, rule, ctx)) return true;
  }
  return false;
}

/**
 * Would removing `leaving` take a squad below a minimum it currently meets?
 * Trimming must never do that.
 */
export function breaksMinimum(
  roster: readonly Player[],
  leaving: Player,
  rules: readonly ForeignRule[],
  ctx: RuleContext,
): boolean {
  for (const rule of rules) {
    if (rule.kind !== "homegrownMin" && rule.kind !== "nationalMin") continue;
    if (!countsToward(leaving, rule, ctx)) continue;
    const count = roster.filter((p) => countsToward(p, rule, ctx)).length;
    if (count <= rule.min) return true;
  }
  return false;
}

/** A tid -> country lookup for a world, built once per pass. */
export function countryLookup(
  teams: readonly { tid: number; compId: number }[],
  competitions: readonly Competition[],
): (tid: number) => string | undefined {
  const byComp = new Map(competitions.map((c) => [c.id, c.country]));
  const byTid = new Map(teams.map((t) => [t.tid, byComp.get(t.compId)]));
  return (tid) => byTid.get(tid);
}

/** The registration rules for a whole world, built once per pass. */
export interface WorldRules {
  /** Why this club may not register `incoming` (a cap), or null. */
  block(tid: number, rosterPids: readonly number[], incoming: Player): string | null;
  /** Would `incoming` help this club toward a minimum it is short of? */
  helpsMinimum(tid: number, rosterPids: readonly number[], incoming: Player): boolean;
  /** Would losing `leaving` take this club below a minimum it meets? */
  breaksMinimum(tid: number, rosterPids: readonly number[], leaving: Player): boolean;
  /** Where this club stands against each of its league's rules; empty if it has none. */
  standings(tid: number, rosterPids: readonly number[]): RuleStanding[];
  /**
   * The squad counted once, then a cheap per-candidate test: why each candidate
   * would be blocked (null if not), and whether he helps a minimum the squad is
   * short of. For loops over a whole pool against one squad.
   */
  forSquad(tid: number, rosterPids: readonly number[]): {
    block(incoming: Player): string | null;
    helpsMinimum(incoming: Player): boolean;
  };
  /**
   * For a trim that keeps `keptPids` out of `fullPids`: which of the released
   * players must stay so the club does not fall below a minimum it met before
   * the trim. Best rated first; never more than the minimum needs.
   */
  keepForMinimums(tid: number, fullPids: readonly number[], keptPids: ReadonlySet<number>): number[];
}

/**
 * Every acquisition path, and trimming, asks the rules through one of these,
 * so no path can read them differently from another.
 */
export function worldRules(
  teams: readonly { tid: number; compId: number }[],
  competitions: readonly Competition[],
  playerById: (pid: number) => Player | undefined,
  season: number,
): WorldRules {
  const countryOfTid = countryLookup(teams, competitions);
  const compById = new Map(competitions.map((c) => [c.id, c]));
  const homegrownCache = new WeakMap<Player, Map<string, boolean>>();
  const rulesByTid = new Map<number, { rules: ForeignRule[]; ctx: RuleContext }>();
  for (const t of teams) {
    const comp = compById.get(t.compId);
    if (!comp) continue;
    const rules = competitionForeignRules(comp);
    if (rules.length > 0) {
      rulesByTid.set(t.tid, { rules, ctx: { country: comp.country, countryOfTid, season, homegrownCache } });
    }
  }
  const squad = (pids: readonly number[]) => pids.map(playerById).filter((p): p is Player => p != null);
  const hasCap = new Map([...rulesByTid].map(([tid, e]) =>
    [tid, e.rules.some((r) => r.kind === "foreignCap" || r.kind === "nonEuCap")]));
  return {
    block(tid, pids, incoming) {
      const e = rulesByTid.get(tid);
      if (!e || !hasCap.get(tid)) return null;
      // Only a player the cap counts can be blocked by it; checked before the
      // squad is built, since most offers are not to such players.
      if (!e.rules.some((r) => (r.kind === "foreignCap" || r.kind === "nonEuCap") && countsToward(incoming, r, e.ctx))) {
        return null;
      }
      return registrationBlock(squad(pids), incoming, e.rules, e.ctx);
    },
    helpsMinimum(tid, pids, incoming) {
      const e = rulesByTid.get(tid);
      return e ? helpsShortMinimum(squad(pids), incoming, e.rules, e.ctx) : false;
    },
    breaksMinimum(tid, pids, leaving) {
      const e = rulesByTid.get(tid);
      return e ? breaksMinimum(squad(pids), leaving, e.rules, e.ctx) : false;
    },
    standings(tid, pids) {
      const e = rulesByTid.get(tid);
      return e ? ruleStandings(squad(pids), e.rules, e.ctx) : [];
    },
    forSquad(tid, pids) {
      const e = rulesByTid.get(tid);
      if (!e) return { block: () => null, helpsMinimum: () => false };
      const roster = squad(pids);
      const onSquad = new Set(pids);
      const standing = ruleStandings(roster, e.rules, e.ctx);
      const fullCaps = standing.filter((s) =>
        (s.rule.kind === "foreignCap" || s.rule.kind === "nonEuCap") && s.count >= s.limit);
      const shortMins = standing.filter((s) =>
        (s.rule.kind === "homegrownMin" || s.rule.kind === "nationalMin") && s.count < s.limit);
      return {
        block(incoming) {
          if (fullCaps.length === 0 || onSquad.has(incoming.pid)) return null;
          for (const s of fullCaps) {
            if (countsToward(incoming, s.rule, e.ctx)) return registrationBlock(roster, incoming, [s.rule], e.ctx);
          }
          return null;
        },
        helpsMinimum(incoming) {
          return shortMins.some((s) => countsToward(incoming, s.rule, e.ctx));
        },
      };
    },
    keepForMinimums(tid, fullPids, keptPids) {
      const e = rulesByTid.get(tid);
      if (!e) return [];
      const full = squad(fullPids);
      const restored = new Set<number>();
      for (const rule of e.rules) {
        if (rule.kind !== "homegrownMin" && rule.kind !== "nationalMin") continue;
        const members = full.filter((p) => countsToward(p, rule, e.ctx));
        if (members.length < rule.min) continue; // did not meet it before the trim
        let kept = members.filter((p) => keptPids.has(p.pid) || restored.has(p.pid)).length;
        const released = members
          .filter((p) => !keptPids.has(p.pid) && !restored.has(p.pid))
          .sort((a, b) => b.ovr - a.ovr || a.pid - b.pid);
        for (const p of released) {
          if (kept >= rule.min) break;
          restored.add(p.pid);
          kept++;
        }
      }
      return [...restored];
    },
  };
}

/** `worldRules(...).block`, for a path that only needs the hard check. */
export function registrationChecker(
  teams: readonly { tid: number; compId: number }[],
  competitions: readonly Competition[],
  playerById: (pid: number) => Player | undefined,
  season: number,
): (tid: number, rosterPids: readonly number[], incoming: Player) => string | null {
  const rules = worldRules(teams, competitions, playerById, season);
  return (tid, pids, incoming) => rules.block(tid, pids, incoming);
}

/**
 * The one-off check for a single signing on a whole league: why `tid` may not
 * register `incoming` right now, or null. For the user's own paths (a buy, a
 * free-agent signing, a loan in) and for surfacing the reason on screen.
 */
export function leagueRegistrationBlock(
  league: {
    teams: readonly { tid: number; compId: number; roster: readonly number[] }[];
    competitions: readonly Competition[];
    players: readonly Player[];
    season: number;
  },
  tid: number,
  incoming: Player,
): string | null {
  const team = league.teams.find((t) => t.tid === tid);
  const comp = team && league.competitions.find((c) => c.id === team.compId);
  if (!team || !comp || competitionForeignRules(comp).length === 0) return null;
  const byPid = new Map(league.players.map((p) => [p.pid, p]));
  return worldRules(league.teams, league.competitions, (pid) => byPid.get(pid), league.season)
    .block(tid, team.roster, incoming);
}
