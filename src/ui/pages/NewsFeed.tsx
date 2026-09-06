import { useMemo, useState } from "react";
import { useLeague } from "../context/LeagueContext.js";
import { ClubLink } from "../components/ClubLink.js";
import { unpackPositionChange, type NewsEvent, type NewsEventType } from "../../core/newsEvents.js";
import { buildSeasonTimeline, type FeedItem } from "../newsFeedTimeline.js";
import { seasonAwardNews, type AwardNews } from "../../core/awardNews.js";
import { trophyNewsBySeason } from "../../core/trophyNews.js";
import { promotionNewsBySeason } from "../../core/promotionNews.js";
import { seasonContinentalNews } from "../../core/continentalNews.js";
import { TOTS_SLOTS } from "../../core/awards.js";
import { NEWS_FEED_SEASON_LIMIT } from "../../core/constants.js";
import type { CompletedTransfer } from "../../core/transfers/negotiation.js";
import { isFreeAgentTid } from "../../core/transfers/negotiation.js";
import { clubDisplayName, currency, seasonYear } from "../format.js";
import { Flag } from "../components/Flag.js";
import { PlayerRefLink, usePlayerRefs } from "../components/PlayerRefLink.js";
import { NationName } from "./nationalTeams/shared.js";

type ClubFilter = "all" | "user";

// No emoji: the project rule is that the UI carries none (real icons are
// hand-written inline SVG). The first four used to and no longer do.
const EVENT_LABEL: Record<NewsEventType, string> = {
  hattrick: "Hat-trick",
  standoutRating: "Standout performance",
  goalMilestoneSeason: "Season milestone",
  goalMilestoneCareer: "Career milestone",
  positionChange: "Position change",
};

const AWARD_LABEL: Record<AwardNews["kind"], string> = {
  ballonDOr: "Ballon d'Or",
  worldTeamOfYear: "World Team of the Year",
  goalkeeperOfYear: "Goalkeeper of the Year",
  defenderOfYear: "Defender of the Year",
  playerOfSeason: "Player of the Season",
  goldenBoot: "Golden Boot",
  teamOfSeason: "Team of the Season",
};

/** "1st", "2nd", "3rd" — the Ballon d'Or podium is the only place this is needed. */
function ordinal(n: number): string {
  const suffix = n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th";
  return `${n}${suffix}`;
}

/**
 * The right-hand column for an honour: what distinguishes this row from the
 * others carrying the same label. For an XI place that is the slot he was
 * picked in, which is the award itself; for the Ballon d'Or it is where he
 * finished. A one-per-competition award has nothing to add, since the club
 * beside it already says which league.
 */
function awardDetail(a: AwardNews): string {
  if (a.slot !== undefined) return TOTS_SLOTS[a.slot] ?? "";
  if (a.kind === "ballonDOr") return a.placing === 1 ? "winner" : ordinal(a.placing ?? 0);
  return "";
}

/**
 * Bound one season's rows.
 *
 * The feed is append-only and persisted forever, so an uncapped season grows
 * for the life of the save — this is the same failure that froze /transfers
 * (see NEWS_FEED_SEASON_LIMIT), arriving on a page that grows faster.
 *
 * Two properties matter. The user's own club's news is never dropped, whatever
 * the season holds, which is the same guarantee the transfer list makes. And
 * the surviving rows keep the timeline's own order rather than being re-ranked,
 * so a capped season still reads chronologically — hence the index carried
 * through the partition and the sort back at the end.
 */
export function capSeason(
  items: FeedItem[],
  involvesUser: (item: FeedItem) => boolean,
): { rows: FeedItem[]; hidden: number } {
  if (items.length <= NEWS_FEED_SEASON_LIMIT) return { rows: items, hidden: 0 };
  const mine: { i: number; item: FeedItem }[] = [];
  const rest: { i: number; item: FeedItem }[] = [];
  items.forEach((item, i) => (involvesUser(item) ? mine : rest).push({ i, item }));
  // A season can legitimately be all-yours and over the cap; the user's own
  // news is never the thing that gets cut, so the budget can go negative and
  // slice(0, <=0) correctly takes none of the rest.
  const budget = NEWS_FEED_SEASON_LIMIT - mine.length;
  const kept = [...mine, ...rest.slice(0, Math.max(0, budget))].sort((a, b) => a.i - b.i);
  return { rows: kept.map((k) => k.item), hidden: items.length - kept.length };
}

function eventDetail(e: NewsEvent): string {
  switch (e.type) {
    case "hattrick":
      return `${e.detail} goals`;
    case "standoutRating":
      return `${(e.detail / 10).toFixed(1)} rating`;
    case "goalMilestoneSeason":
      return `${e.detail} goals this season`;
    case "goalMilestoneCareer":
      return `${e.detail} career goals`;
    case "positionChange": {
      const { from, to } = unpackPositionChange(e.detail);
      return `now plays at ${to}, after coming through at ${from}`;
    }
  }
}

export function NewsFeed() {
  const { league } = useLeague();
  const [clubFilter, setClubFilter] = useState<ClubFilter>("all");
  const [seasonFilter, setSeasonFilter] = useState<"all" | number>("all");

  const playerMap = useMemo(
    () => new Map((league?.players ?? []).map((p) => [p.pid, p])),
    [league?.players],
  );
  const refOf = usePlayerRefs();
  const teamMap = useMemo(
    () => new Map((league?.teams ?? []).map((t) => [t.tid, t])),
    [league?.teams],
  );

  // Bucket both logs by season and build each season's timeline exactly once.
  // league.transfers is append-only and never pruned (and now carries every
  // free-agent arrival, on the order of a thousand a season), so re-scanning
  // the whole array once per displayed season — which this did twice per
  // render, for the item count and again for the rows — grows quadratically
  // with the age of the save. The post-hoc club/season filters below are cheap
  // by comparison and stay out of the memo so toggling them costs nothing.
  const timelinesBySeason = useMemo(() => {
    const transfersBySeason = new Map<number, CompletedTransfer[]>();
    const eventsBySeason = new Map<number, NewsEvent[]>();
    for (const t of league?.transfers ?? []) {
      const bucket = transfersBySeason.get(t.season);
      if (bucket) bucket.push(t);
      else transfersBySeason.set(t.season, [t]);
    }
    for (const e of league?.newsEvents ?? []) {
      const bucket = eventsBySeason.get(e.season);
      if (bucket) bucket.push(e);
      else eventsBySeason.set(e.season, [e]);
    }
    const userTid = league?.meta.userTid ?? -1;

    // Which competition a club was in is asked per season, not of the club
    // today: promotion and relegation move clubs (the user's included), so a
    // live lookup would re-file every past season under the division everyone
    // happens to be in now. Each completed season carries its own snapshot;
    // the season in progress has none yet, so it uses the live teams.
    const historyBySeason = new Map(
      (league?.seasonHistory ?? []).map((h) => [h.season, h.compsByTid]),
    );
    const liveComps: Record<number, number> = {};
    for (const t of league?.teams ?? []) liveComps[t.tid] = t.compId;

    // Honours are derived from the season entry rather than stored as events,
    // so they cost nothing in the save and an existing dynasty shows its whole
    // back catalogue. A season with an entry is one whose awards are settled.
    const awardsBySeason = new Map(
      (league?.seasonHistory ?? []).map((h) => [h.season, seasonAwardNews(h)]),
    );

    // Trophies come from the cup and international records rather than the
    // season entry, and include the cup being played right now — a season's
    // biggest result shouldn't wait for the offseason to be reported.
    const trophiesBySeason = trophyNewsBySeason({
      cup: league?.cup ?? null,
      cupHistory: league?.cupHistory ?? [],
      shield: league?.shield ?? null,
      shieldHistory: league?.shieldHistory ?? [],
      superCups: league?.superCups ?? [],
      superCupHistory: (league?.seasonHistory ?? []).flatMap((h) => h.superCups ?? []),
      international: league?.international ?? null,
    });

    // Cup places changing hands, derived the same way the honours are and for
    // the same reason (see core/continentalNews.ts): it is a function of the
    // archived cups the save already keeps, so it costs nothing to store and an
    // existing dynasty reports every place it ever won or lost.
    const continentalHistories = [league?.cupHistory ?? [], league?.shieldHistory ?? []];
    const continentalBySeason = new Map(
      (league?.seasonHistory ?? []).map((h) => [
        h.season,
        seasonContinentalNews(
          league?.competitions ?? [], league?.teams ?? [], continentalHistories, h.season,
          league?.rollingCoefficients ?? true,
        ),
      ]),
    );

    // Promotion playoffs, from the same two places the page itself reads them:
    // the set the season just ended decided (not yet rolled into history) and
    // everything already archived onto a season entry.
    const promotionsBySeason = promotionNewsBySeason([
      ...(league?.promotionPlayoffs ?? []),
      ...(league?.seasonHistory ?? []).flatMap((h) => h.promotionPlayoffs ?? []),
    ]);

    const out = new Map<number, FeedItem[]>();
    const seasons = new Set([
      ...transfersBySeason.keys(),
      ...eventsBySeason.keys(),
      ...awardsBySeason.keys(),
      ...trophiesBySeason.keys(),
      ...continentalBySeason.keys(),
      ...promotionsBySeason.keys(),
    ]);
    for (const season of seasons) {
      const comps = historyBySeason.get(season) ?? liveComps;
      out.set(season, buildSeasonTimeline(
        transfersBySeason.get(season) ?? [],
        eventsBySeason.get(season) ?? [],
        { userTid, userCompId: comps[userTid], compOf: (tid) => comps[tid] },
        awardsBySeason.get(season) ?? [],
        trophiesBySeason.get(season) ?? [],
        continentalBySeason.get(season) ?? [],
        promotionsBySeason.get(season) ?? [],
      ));
    }
    return out;
  }, [
    league?.transfers,
    league?.newsEvents,
    league?.meta.userTid,
    league?.seasonHistory,
    league?.teams,
    league?.cup,
    league?.cupHistory,
    league?.shield,
    league?.shieldHistory,
    league?.international,
    league?.superCups,
    league?.competitions,
  ]);

  if (!league) {
    return <p className="p-3">Loading...</p>;
  }

  const userTid = league.meta.userTid;
  const userTeam = teamMap.get(userTid);

  // A trophy has a tid only when a club won it; an international one never
  // involves the user's club, so `tid === userTid` reads false for it anyway.
  const involvesUser = (item: FeedItem): boolean => {
    if (item.kind === "transfer") {
      return item.data.fromTid === userTid || item.data.toTid === userTid;
    }
    // Nobody's club gains a Cup place — a country does. The nearest thing to
    // "involves you" is that it was your league's allocation that moved.
    if (item.kind === "continental") return item.data.compId === userTeam?.compId;
    return item.data.tid === userTid;
  };

  const compName = (compId: number | undefined): string | undefined =>
    league.competitions.find((c) => c.id === compId)?.name;

  const passesFilters = (season: number, item: FeedItem): boolean => {
    if (clubFilter === "user" && !involvesUser(item)) return false;
    if (seasonFilter !== "all" && season !== seasonFilter) return false;
    return true;
  };

  // Seasons present across either feed, newest first, for the dropdown.
  const seasons = [...timelinesBySeason.keys()].sort((a, b) => b - a);

  const seasonsToShow = seasonFilter === "all" ? seasons : seasons.filter((s) => s === seasonFilter);

  const teamCell = (tid: number, season?: number) => {
    if (isFreeAgentTid(tid)) {
      return <span className="text-muted">{clubDisplayName(tid, () => undefined)}</span>;
    }
    return (
      <ClubLink
        tid={tid}
        season={season}
        crest
        crestSize={20}
        className="d-inline-flex align-items-center gap-1 text-decoration-none"
      />
    );
  };

  // Old news outlives its subject: a retiree is gone from `playerMap` but his
  // name and career page survive in the archive, which is what `refOf` covers.
  const playerCell = (pid: number) => {
    const p = playerMap.get(pid);
    const ref = refOf(pid);
    return (
      <>
        <PlayerRefLink pid={pid} fallback={`Player ${pid}`} />{" "}
        {ref && <Flag nationality={ref.nationality} />}
        {p && <span className="text-muted small"> ({p.pos})</span>}
      </>
    );
  };

  const totalItems = seasonsToShow.reduce(
    (sum, season) =>
      sum + (timelinesBySeason.get(season) ?? []).filter((item) => passesFilters(season, item)).length,
    0,
  );

  return (
    <div className="container-fluid p-3">
      <h4>News Feed</h4>
      <p className="text-muted">
        Everything your club does, everything that happens in your league, and only the big
        stories from the rest of the world.
      </p>

      <div className="d-flex flex-wrap gap-2 mb-3">
        <select
          className="form-select w-auto"
          value={clubFilter}
          onChange={(e) => setClubFilter(e.target.value as ClubFilter)}
        >
          <option value="all">All clubs</option>
          <option value="user">Only {userTeam?.name ?? "my club"}</option>
        </select>
        <select
          className="form-select w-auto"
          value={String(seasonFilter)}
          onChange={(e) =>
            setSeasonFilter(e.target.value === "all" ? "all" : Number(e.target.value))
          }
        >
          <option value="all">All seasons</option>
          {seasons.map((s) => (
            <option key={s} value={s}>{seasonYear(s)}</option>
          ))}
        </select>
      </div>

      {totalItems === 0 ? (
        <p className="text-muted">
          {league.transfers.length === 0 && league.newsEvents.length === 0
            ? "Nothing has happened in the league yet."
            : "Nothing matches the current filters."}
        </p>
      ) : (
        [...seasonsToShow].sort((a, b) => b - a).map((season) => {
          const all = (timelinesBySeason.get(season) ?? []).filter((item) =>
            passesFilters(season, item),
          );
          if (all.length === 0) return null;
          const { rows: timeline, hidden } = capSeason(all, involvesUser);

          return (
            <div className="card mb-3" key={season}>
              <div className="card-body">
                <h5 className="card-title">
                  {seasonYear(season)}{" "}
                  <span className="text-muted small">
                    ({all.length} {all.length === 1 ? "item" : "items"}
                    {hidden > 0 && `, showing ${timeline.length}`})
                  </span>
                </h5>
                {hidden > 0 && (
                  <p className="text-muted small">
                    {hidden} more {hidden === 1 ? "story" : "stories"} from elsewhere in the world
                    this season. Everything involving {userTeam?.name ?? "your club"} is shown;
                    filter to a single season to narrow this down.
                  </p>
                )}
                <div className="table-responsive">
                  <table className="table table-striped table-sm mb-0 align-middle">
                    <thead>
                      <tr>
                        <th>Event</th>
                        <th>Player</th>
                        <th>Club(s)</th>
                        <th className="text-end">Detail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {timeline.map((item, i) => {
                        const highlighted = involvesUser(item);
                        if (item.kind === "transfer") {
                          const t = item.data;
                          return (
                            <tr key={`t-${t.pid}-${t.season}-${t.window}-${i}`}
                                className={highlighted ? "team-highlight" : undefined}>
                              <td className="text-muted small text-capitalize">
                                {t.loanReturn
                                  ? "loan return"
                                  : t.loanSeasons
                                    ? `${t.window} window loan (${t.loanSeasons} season${t.loanSeasons > 1 ? "s" : ""})`
                                    : isFreeAgentTid(t.fromTid)
                                      ? `${t.window} window free signing`
                                      : `${t.window} window transfer`}
                              </td>
                              <td>{playerCell(t.pid)}</td>
                              <td>
                                <span className="d-inline-flex align-items-center gap-1">
                                  {teamCell(t.fromTid, t.season)} <span className="text-muted">→</span> {teamCell(t.toTid, t.season)}
                                </span>
                              </td>
                              <td className="text-end stat-num">{t.loanReturn ? "—" : currency.format(t.fee)}</td>
                            </tr>
                          );
                        }
                        if (item.kind === "trophy") {
                          const t = item.data;
                          return (
                            <tr key={`w-${season}-${t.kind}-${t.name}-${i}`}
                                className={highlighted ? "team-highlight" : undefined}>
                              <td className="small">{t.name}</td>
                              <td className="text-muted small">
                                {t.runnerUp ? `beat ${t.runnerUp}` : "champions"}
                              </td>
                              {/* A nation is not a club, so it goes in the club
                                  column through NationName rather than teamCell,
                                  which needs a tid. */}
                              <td>
                                {t.tid !== undefined
                                  ? teamCell(t.tid, season)
                                  : <NationName nation={t.nation ?? ""} />}
                              </td>
                              <td className="text-end stat-num">{t.score ?? ""}</td>
                            </tr>
                          );
                        }
                        if (item.kind === "promotion") {
                          const p = item.data;
                          return (
                            <tr key={`p-${p.d2CompId}-${season}-${i}`}
                                className={highlighted ? "team-highlight" : undefined}>
                              {/* Name the division: a country settles one place
                                  per step of its pyramid, so two of these land
                                  in the same season and "promotion playoff"
                                  alone does not say which. */}
                              <td className="small">
                                {p.promoted ? "Promoted" : "Stayed up"} via playoff
                                <span className="text-muted">
                                  {" "}({compName(p.d1CompId) ?? "—"}, from {ordinal(p.position)})
                                </span>
                              </td>
                              <td className="text-muted small">
                                beat {teamCell(p.runnerUpTid, season)}
                              </td>
                              <td>{teamCell(p.tid, season)}</td>
                              <td className="text-end stat-num">{p.score}</td>
                            </tr>
                          );
                        }
                        if (item.kind === "award") {
                          const a = item.data;
                          // The competition names a domestic honour ("Player of
                          // the Season" alone is one of sixteen); the worldwide
                          // ones need no qualifier and get none.
                          const comp = compName(a.compId);
                          return (
                            <tr key={`a-${a.pid}-${season}-${a.kind}-${a.slot ?? a.placing ?? 0}-${i}`}
                                className={highlighted ? "team-highlight" : undefined}>
                              <td className="small">
                                {AWARD_LABEL[a.kind]}
                                {comp && <span className="text-muted"> ({comp})</span>}
                              </td>
                              <td>{playerCell(a.pid)}</td>
                              <td>{a.tid === undefined ? <span className="text-muted">—</span> : teamCell(a.tid, season)}</td>
                              <td className="text-end stat-num">{awardDetail(a)}</td>
                            </tr>
                          );
                        }
                        if (item.kind === "continental") {
                          const c = item.data;
                          const gained = c.to > c.from;
                          return (
                            <tr key={`c-${c.compId}-${season}-${i}`}
                                className={highlighted ? "team-highlight" : undefined}>
                              <td className="small">
                                Continental places
                                <span className="text-muted"> ({gained ? "earned" : "lost"})</span>
                              </td>
                              {/* A country is the subject, not a player, so it
                                  takes the subject column and the club column
                                  carries the league whose allocation moved. */}
                              <td>{c.country}</td>
                              <td>{compName(c.compId) ?? <span className="text-muted">—</span>}</td>
                              <td className="text-end stat-num">{c.from} → {c.to}</td>
                            </tr>
                          );
                        }
                        const e = item.data;
                        return (
                          <tr key={`n-${e.pid}-${e.season}-${e.matchday}-${e.type}-${i}`}
                              className={highlighted ? "team-highlight" : undefined}>
                            <td className="small">{EVENT_LABEL[e.type]} (MD {e.matchday})</td>
                            <td>{playerCell(e.pid)}</td>
                            <td>{teamCell(e.tid, e.season)}</td>
                            <td className="text-end stat-num">{eventDetail(e)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
