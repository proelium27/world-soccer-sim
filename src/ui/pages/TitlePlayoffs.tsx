import { Fragment, useState } from "react";
import { useLeague } from "../context/LeagueContext.js";
import { HelpHint } from "../components/HelpHint.js";
import { ClubCrest } from "../components/ClubCrest.js";
import { ClubLink } from "../components/ClubLink.js";
import { EmptyState } from "../components/EmptyState.js";
import { seasonYear, ordinal } from "../format.js";
import type { CupTie } from "../../core/cup/types.js";
import type { TitlePlayoff } from "../../core/titlePlayoff.js";
import { titlePlayoffRoundNames, titlePlayoffNextRoundName } from "../../core/titlePlayoff.js";
import { competitionOf, competitionTitlePlayoff } from "../../core/competitions.js";

/**
 * Every title playoff the save holds a record of, newest first — the live set
 * the season just ended decided, plus everything already archived onto a season
 * entry. Same two sources, for the same reason, as the promotion playoff page.
 */
function allTitlePlayoffs(
  live: TitlePlayoff[],
  history: { titlePlayoffs?: TitlePlayoff[] }[],
): TitlePlayoff[] {
  return [...live, ...history.flatMap((h) => h.titlePlayoffs ?? [])]
    .sort((a, b) => b.season - a.season);
}

/** One line under the league name saying how its playoff works. */
function formatSummary(format: TitlePlayoff["format"]): string {
  switch (format) {
    case "two-legged":
      return "two legs a round; a level tie goes to the higher-placed club, except in the final";
    case "conference":
      return "top nine in each conference: a wild card, a best-of-three first round (games 1 and 3 at the higher seed), then one-off games to the final";
    case "conference-single":
      return "top eight in each conference, one-off games at the higher seed through each conference's bracket, then the two conference winners in a final";
    case "zones":
      return "top eight in each zone, first against eighth across the zones, one-off games and a neutral final";
    default:
      return "one-off ties, better-placed club at home";
  }
}

/**
 * The letter a split league's seeds carry: "E" for the Eastern Conference, "A"
 * for Zone A. Short on purpose — a seed sits in front of a club name in a
 * narrow bracket column, where "(1st, Eastern Conference)" wrapped onto three
 * lines and left the name itself cut to six letters.
 */
function halfCode(name: string | undefined, index: number): string {
  const trimmed = name?.trim();
  if (!trimmed) return String.fromCharCode(65 + index);
  const zone = /^Zone\s+(\S+)$/i.exec(trimmed);
  return zone ? zone[1] : trimmed[0].toUpperCase();
}

export function TitlePlayoffs() {
  const { league } = useLeague();
  const [countrySel, setCountrySel] = useState<string | null>(null);
  const [seasonSel, setSeasonSel] = useState<number | null>(null);

  if (!league) return <p className="p-3">Loading...</p>;

  const intro = (
    <HelpHint>
      Some leagues don&apos;t give the title to whoever tops the table. Once the last matchday is
      played, their best clubs go into a knockout and the winner is the champion. Mexico takes the
      top eight over two legs a round, and a quarter-final or semi-final that&apos;s level on
      aggregate goes to the better-placed club. The US takes the top nine in each conference:
      eighth plays ninth for a wild card, the first round is best of three, and the two conference
      champions meet in the final. Argentina takes the top eight in each zone and pairs first in one
      zone with eighth in the other. The table still decides prize money, continental places and
      what your board makes of your season. The number beside a club is where it finished, with
      its conference or zone&apos;s letter in a split league.
    </HelpHint>
  );

  const playoffs = allTitlePlayoffs(league.titlePlayoffs ?? [], league.seasonHistory);
  const leaguesWithPlayoffs = league.competitions.filter((c) => competitionTitlePlayoff(c) !== "none");

  if (playoffs.length === 0) {
    return (
      <div className="container-fluid p-3">
        <h4>Title Playoffs{intro}</h4>
        {leaguesWithPlayoffs.length === 0 ? (
          <EmptyState headline="No league in this world decides its title with a playoff.">
            <p>Every top flight here crowns whoever finishes first in the table.</p>
          </EmptyState>
        ) : (
          <EmptyState headline="No title playoffs have been played yet.">
            <p>
              They are played a round at a time once the season ends, from the Dashboard. This
              world holds them in{" "}
              {leaguesWithPlayoffs.map((c) => c.name).join(", ")}.
            </p>
          </EmptyState>
        )}
      </div>
    );
  }

  const userTid = league.meta.userTid;
  const userCountry = league.competitions.find(
    (c) => c.id === league.teams.find((t) => t.tid === userTid)?.compId,
  )?.country;
  const countries = [...new Set(playoffs.map((p) => p.country))].sort();
  const country = countrySel ?? (userCountry && countries.includes(userCountry) ? userCountry : countries[0]);
  const forCountry = playoffs.filter((p) => p.country === country);
  const seasons = [...new Set(forCountry.map((p) => p.season))];
  const season = seasons.find((s) => s === seasonSel) ?? seasons[0];
  const playoff = forCountry.find((p) => p.season === season)!;
  const comp = competitionOf(league.competitions, playoff.compId);
  const roundNames = titlePlayoffRoundNames(playoff.format);
  const finalRound = roundNames.length - 1;

  const teamColors = (tid: number): [string, string] =>
    league.teams.find((t) => t.tid === tid)?.colors ?? ["#888888", "#888888"];
  /** Which half a club played in, or -1 for an unsplit league. */
  const halfOf = (tid: number): number =>
    playoff.conferences ? playoff.conferences.findIndex((h) => h.includes(tid)) : -1;
  /** "3rd" in a table, or "3rd, Eastern Conference" in a split one. */
  const placeOf = (tid: number): string => {
    const half = halfOf(tid);
    if (half < 0 || !playoff.conferences) return ordinal(playoff.teams.indexOf(tid) + 1);
    const name = playoff.conferenceNames?.[half] ?? "";
    return `${ordinal(playoff.conferences[half].indexOf(tid) + 1)}, ${name}`;
  };
  /**
   * The seed shown in front of a club: its finishing place, prefixed with its
   * half's letter where that isn't already obvious. Inside a conference's own
   * bracket every club is from that conference, so the letter is dropped there.
   */
  const seedOf = (tid: number, withHalf: boolean): string => {
    const half = halfOf(tid);
    if (half < 0 || !playoff.conferences) return String(playoff.teams.indexOf(tid) + 1);
    const place = String(playoff.conferences[half].indexOf(tid) + 1);
    return withHalf ? `${halfCode(playoff.conferenceNames?.[half], half)}${place}` : place;
  };

  const teamCell = (tid: number, won: boolean, withHalf: boolean) => (
    <span
      className={`cup-team${won ? " cup-team-winner" : ""}${tid === userTid ? " cup-team-user" : ""}`}
      title={placeOf(tid)}
    >
      <span className="tp-seed">{seedOf(tid, withHalf)}</span>
      <ClubCrest tid={tid} colors={teamColors(tid)} size={16} />
      <span className="cup-team-name">
        <ClubLink tid={tid} season={playoff.season} />
      </span>
    </span>
  );

  /**
   * A tie's footnote as unbreakable segments — one per game or leg — so a long
   * note wraps between games rather than through the middle of a scoreline.
   */
  const noteOf = (parts: string[]) => (
    <div className="cup-tie-note">
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && " · "}
          <span className="cup-tie-seg">{p}</span>
        </Fragment>
      ))}
    </div>
  );

  const renderTie = (t: CupTie, withHalf: boolean) => {
    const rowClass = (tid: number) =>
      `cup-tie-row ${t.winner === tid ? "cup-tie-row--won" : "cup-tie-row--out"}`;
    return (
      <>
        <div className={rowClass(t.home)}>
          {teamCell(t.home, t.winner === t.home, withHalf)}
          <span className="cup-tie-score">{t.homeGoals}</span>
        </div>
        <div className={rowClass(t.away)}>
          {teamCell(t.away, t.winner === t.away, withHalf)}
          <span className="cup-tie-score">{t.awayGoals}</span>
        </div>
        {/* A series' score column is games won; each game's scoreline reads
            from the higher seed's side, which is listed first. */}
        {t.series && noteOf(t.series.map((g) =>
          `${g.homeGoals}-${g.awayGoals}${g.homePens !== undefined ? ` (${g.homePens}-${g.awayPens} pens)` : ""}`))}
        {t.legs && t.legs.length === 2 && noteOf([
          `1st leg ${t.legs[0].homeGoals}-${t.legs[0].awayGoals}`,
          `2nd leg ${t.legs[1].homeGoals}-${t.legs[1].awayGoals} away`,
        ])}
        {t.decidedByTablePosition && noteOf(["Level, higher-placed club goes through"])}
        {!t.series && (t.wentToExtraTime || t.wentToPens) && noteOf([
          t.wentToPens
            ? `${t.homePens}-${t.awayPens} on pens${t.wentToExtraTime ? " after extra time" : ""}`
            : "after extra time",
        ])}
      </>
    );
  };

  /**
   * One bracket column. `depth` is how many rounds into the tree it sits, so a
   * tie spans 2^depth grid rows and centres between the two that feed it — the
   * same geometry the Continental Cup draws. `depth` null is a round that feeds
   * the tree without being part of it (the wild card), laid one tie per row
   * against `rows` so its tie lines up with the first-round tie it feeds.
   */
  const bracketRound = (opts: {
    key: string | number;
    title: string;
    ties: CupTie[];
    depth: number | null;
    linked: boolean;
    isFinal: boolean;
    withHalf: boolean;
    rows?: number;
  }) => (
    <div className={`cup-round${opts.linked ? " cup-round--linked" : ""}`} key={opts.key}>
      <div className="cup-round-title">
        <span>{opts.title}</span>
        <span className="cup-round-count">{opts.ties.length}</span>
      </div>
      <div
        className="cup-round-body"
        style={opts.rows ? { gridTemplateRows: `repeat(${opts.rows}, minmax(var(--cup-row, 3.1rem), 1fr))` } : undefined}
      >
        {opts.ties.map((t, i) => (
          <div
            className="cup-slot"
            key={i}
            style={opts.depth === null ? undefined : { gridRow: `span ${2 ** opts.depth}` }}
          >
            <div className={`cup-tie${opts.isFinal ? " cup-tie--final" : ""}`}>
              {renderTie(t, opts.withHalf)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // Ties are stored in bracket order within a round (a round's ties pair off
  // two by two into the next), which is what lets the tree be drawn straight
  // off the list. In a conference playoff each round holds both conferences,
  // first conference first; a tie belongs to the conference of its higher seed.
  const tiesIn = (round: number, half?: number): CupTie[] =>
    playoff.ties.filter((t) => t.round === round && (half === undefined || halfOf(t.home) === half));
  const roundName = (round: number) => roundNames[round] ?? `Round ${round + 1}`;
  const userEntered = playoff.teams.includes(userTid);
  const nextRound = titlePlayoffNextRoundName(playoff);

  const splitByConference = (playoff.format === "conference" || playoff.format === "conference-single")
    && !!playoff.conferences;
  const zoned = playoff.format === "zones" && !!playoff.conferences;
  const treeRounds = [...new Set(playoff.ties.map((t) => t.round))].sort((a, b) => a - b);

  return (
    <div className="container-fluid p-3">
      <h4>Title Playoffs{intro}</h4>

      <div className="mb-3 d-flex gap-2 flex-wrap">
        <select
          className="form-select form-select-sm"
          style={{ width: "auto" }}
          value={country}
          onChange={(e) => { setCountrySel(e.target.value); setSeasonSel(null); }}
        >
          {countries.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          className="form-select form-select-sm"
          style={{ width: "auto" }}
          value={season}
          onChange={(e) => setSeasonSel(Number(e.target.value))}
        >
          {seasons.map((s) => <option key={s} value={s}>{seasonYear(s)}</option>)}
        </select>
      </div>

      <div className="mb-2">
        <strong>{comp.name}</strong>{" "}
        <span className="text-muted small">{formatSummary(playoff.format)}</span>
      </div>

      {playoff.winnerTid !== null && (
        <div className="cup-champion-banner mb-3">
          <span className="cup-champion-label">Champions</span>{" "}
          <ClubCrest tid={playoff.winnerTid} colors={teamColors(playoff.winnerTid)} size={22} />{" "}
          <strong><ClubLink tid={playoff.winnerTid} season={playoff.season} /></strong>{" "}
          <span className="text-muted small">from {placeOf(playoff.winnerTid)}</span>
        </div>
      )}

      {playoff.winnerTid === null ? (
        <p className="text-muted small mb-3">
          Still being played{nextRound ? `, with the ${nextRound.toLowerCase()} up next` : ""}. Each
          round is its own sim, from the Dashboard.
        </p>
      ) : userEntered && (
        <p className="text-muted small mb-3">
          {playoff.winnerTid === userTid
            ? "You won the title through the playoffs."
            : "Your club was in this playoff and missed out on the title."}
        </p>
      )}

      {splitByConference ? (
        <>
          {/* Each conference is its own bracket up to its final, as in MLS, and
              the two conference champions meet below. Stacked rather than side
              by side: four columns each is wider than the page. */}
          {playoff.conferences!.map((_, half) => {
            const roundOne = tiesIn(1, half);
            // Eight a conference with no wild card: three rounds to the
            // conference final, first round unlinked.
            if (playoff.format === "conference-single") {
              return (
                <section key={half} className="mb-4">
                  <div className="page-eyebrow mb-2">
                    {playoff.conferenceNames?.[half] ?? `Conference ${half + 1}`}
                  </div>
                  <div className="cup-bracket cup-bracket--tree">
                    {[0, 1, 2].map((round) => bracketRound({
                      key: round, title: roundName(round), ties: tiesIn(round, half),
                      depth: round, linked: round > 0, isFinal: false, withHalf: false,
                    }))}
                  </div>
                </section>
              );
            }
            return (
              <section key={half} className="mb-4">
                <div className="page-eyebrow mb-2">
                  {playoff.conferenceNames?.[half] ?? `Conference ${half + 1}`}
                </div>
                <div className="cup-bracket cup-bracket--tree">
                  {bracketRound({
                    key: "wild", title: roundName(0), ties: tiesIn(0, half),
                    depth: null, linked: false, isFinal: false, withHalf: false, rows: roundOne.length,
                  })}
                  {bracketRound({
                    key: 1, title: roundName(1), ties: roundOne,
                    depth: 0, linked: false, isFinal: false, withHalf: false,
                  })}
                  {bracketRound({
                    key: 2, title: roundName(2), ties: tiesIn(2, half),
                    depth: 1, linked: true, isFinal: false, withHalf: false,
                  })}
                  {bracketRound({
                    key: 3, title: roundName(3), ties: tiesIn(3, half),
                    depth: 2, linked: true, isFinal: false, withHalf: false,
                  })}
                </div>
              </section>
            );
          })}
          <section>
            <div className="cup-bracket cup-bracket--tree">
              {bracketRound({
                key: "final", title: roundName(finalRound), ties: tiesIn(finalRound),
                depth: 0, linked: false, isFinal: true, withHalf: true,
              })}
            </div>
          </section>
        </>
      ) : (
        <div className="cup-bracket cup-bracket--tree">
          {treeRounds.map((round) => bracketRound({
            key: round, title: roundName(round), ties: tiesIn(round),
            depth: round, linked: round > 0, isFinal: round === finalRound, withHalf: zoned,
          }))}
        </div>
      )}
    </div>
  );
}
