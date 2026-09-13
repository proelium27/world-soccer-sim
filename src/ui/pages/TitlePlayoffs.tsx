import { useState } from "react";
import { useLeague } from "../context/LeagueContext.js";
import { HelpHint } from "../components/HelpHint.js";
import { ClubCrest } from "../components/ClubCrest.js";
import { ClubLink } from "../components/ClubLink.js";
import { EmptyState } from "../components/EmptyState.js";
import { seasonYear, ordinal } from "../format.js";
import type { CupTie } from "../../core/cup/types.js";
import type { TitlePlayoff } from "../../core/titlePlayoff.js";
import { TITLE_ROUND_QF, TITLE_ROUND_SF, TITLE_ROUND_FINAL } from "../../core/titlePlayoff.js";
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

const ROUND_NAMES: Record<number, string> = {
  [TITLE_ROUND_QF]: "Quarter-finals",
  [TITLE_ROUND_SF]: "Semi-finals",
  [TITLE_ROUND_FINAL]: "Final",
};

export function TitlePlayoffs() {
  const { league } = useLeague();
  const [countrySel, setCountrySel] = useState<string | null>(null);
  const [seasonSel, setSeasonSel] = useState<number | null>(null);

  if (!league) return <p className="p-3">Loading...</p>;

  const intro = (
    <HelpHint>
      Some leagues don&apos;t give the title to whoever tops the table. Once the last matchday is
      played, the top eight go into a knockout: first against eighth, fourth against fifth, second
      against seventh and third against sixth. The winner is the champion. Finishing higher still
      matters, because you play a weaker side and you get the home leg. Where the ties are one-off
      games the better-placed club is at home; where they are two legs, the better-placed club plays
      the second leg at home. The table still decides prize money, continental places and what your
      board makes of your season.
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
              They are played the moment the season ends. This world holds them in{" "}
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

  const teamColors = (tid: number): [string, string] =>
    league.teams.find((t) => t.tid === tid)?.colors ?? ["#888888", "#888888"];
  const seedOf = (tid: number) => playoff.teams.indexOf(tid) + 1;

  const teamCell = (tid: number, won: boolean) => (
    <span className={`cup-team${won ? " cup-team-winner" : ""}${tid === userTid ? " cup-team-user" : ""}`}>
      <ClubCrest tid={tid} colors={teamColors(tid)} size={16} />
      <span className="cup-team-name">
        <ClubLink tid={tid} season={playoff.season} />
      </span>
      <span className="text-muted small ms-1">({ordinal(seedOf(tid))})</span>
    </span>
  );

  const renderTie = (t: CupTie) => {
    const rowClass = (tid: number) =>
      `cup-tie-row ${t.winner === tid ? "cup-tie-row--won" : "cup-tie-row--out"}`;
    return (
      <>
        <div className={rowClass(t.home)}>
          {teamCell(t.home, t.winner === t.home)}
          <span className="cup-tie-score">{t.homeGoals}</span>
        </div>
        <div className={rowClass(t.away)}>
          {teamCell(t.away, t.winner === t.away)}
          <span className="cup-tie-score">{t.awayGoals}</span>
        </div>
        {t.legs && t.legs.length === 2 && (
          <div className="cup-tie-note">
            {`1st leg ${t.legs[0].homeGoals}-${t.legs[0].awayGoals} · 2nd leg ${t.legs[1].homeGoals}-${t.legs[1].awayGoals} away`}
          </div>
        )}
        {(t.wentToExtraTime || t.wentToPens) && (
          <div className="cup-tie-note">
            {t.wentToPens ? `${t.homePens}-${t.awayPens} on pens` : "after extra time"}
          </div>
        )}
      </>
    );
  };

  const rounds = [TITLE_ROUND_QF, TITLE_ROUND_SF, TITLE_ROUND_FINAL]
    .map((round) => ({ round, ties: playoff.ties.filter((t) => t.round === round) }))
    .filter((r) => r.ties.length > 0);
  const userEntered = playoff.teams.includes(userTid);

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
        <span className="text-muted small">
          {playoff.format === "two-legged" ? "every round over two legs" : "one-off ties, better-placed club at home"}
        </span>
      </div>

      {playoff.winnerTid !== null && (
        <div className="cup-champion-banner mb-3">
          <span className="cup-champion-label">Champions</span>{" "}
          <ClubCrest tid={playoff.winnerTid} colors={teamColors(playoff.winnerTid)} size={22} />{" "}
          <strong><ClubLink tid={playoff.winnerTid} season={playoff.season} /></strong>{" "}
          <span className="text-muted small">from {ordinal(seedOf(playoff.winnerTid))} in the table</span>
        </div>
      )}

      {userEntered && (
        <p className="text-muted small mb-3">
          {playoff.winnerTid === userTid
            ? "You won the title through the playoffs."
            : "Your club was in this playoff and missed out on the title."}
        </p>
      )}

      <div className="cup-bracket cup-bracket--rounds">
        {rounds.map(({ round, ties }) => (
          <div className="cup-round" key={round}>
            <div className="cup-round-title">
              <span>{ROUND_NAMES[round]}</span>
              <span className="cup-round-count">{ties.length}</span>
            </div>
            <div className="cup-round-body">
              {ties.map((t, i) => (
                <div className={`cup-tie${round === TITLE_ROUND_FINAL ? " cup-tie--final" : ""}`} key={i}>
                  {renderTie(t)}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
