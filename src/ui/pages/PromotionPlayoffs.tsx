import { useState } from "react";
import { useLeague } from "../context/LeagueContext.js";
import { HelpHint } from "../components/HelpHint.js";
import { ClubCrest } from "../components/ClubCrest.js";
import { ClubLink } from "../components/ClubLink.js";
import { seasonYear, ordinal } from "../format.js";
import type { CupTie } from "../../core/cup/types.js";
import type { PromotionPlayoff } from "../../core/promotionPlayoff.js";
import { PLAYOFF_ROUND_FINAL } from "../../core/promotionPlayoff.js";
import { competitionOf } from "../../core/competitions.js";
import { EmptyState } from "../components/EmptyState.js";

/**
 * Every playoff the save holds a record of, newest first.
 *
 * Two sources, for the same reason the Cup page reads `cup` and `cupHistory`:
 * `league.promotionPlayoffs` holds the set decided by the season that has just
 * ended and not yet rolled over, and the offseason then writes those same
 * records onto the season-history entry. A season can only ever appear in one
 * of the two, so this is a concatenation rather than a merge.
 */
function allPlayoffs(
  live: PromotionPlayoff[],
  history: { promotionPlayoffs?: PromotionPlayoff[] }[],
): PromotionPlayoff[] {
  return [...live, ...history.flatMap((h) => h.promotionPlayoffs ?? [])]
    .sort((a, b) => b.season - a.season);
}

export function PromotionPlayoffs() {
  const { league } = useLeague();
  const [countrySel, setCountrySel] = useState<string | null>(null);
  const [seasonSel, setSeasonSel] = useState<number | null>(null);

  if (!league) return <p className="p-3">Loading...</p>;

  const playoffs = allPlayoffs(league.promotionPlayoffs ?? [], league.seasonHistory);
  const userTid = league.meta.userTid;
  const userTeam = league.teams.find((t) => t.tid === userTid);
  const userCountry = league.competitions.find((c) => c.id === userTeam?.compId)?.country;

  const intro = (
    <HelpHint>
      In most countries the last promotion place at each step of the pyramid is played for rather
      than won in the table, and there are two ways of doing it. The <strong>English</strong> way
      puts the four clubs below the automatic places into a bracket: two-legged semi-finals, then
      a one-off final at a neutral ground, and the winner goes up. Finishing higher only gets you
      the tie against the lowest-placed club, so it is close to a lottery on purpose.
      The <strong>German</strong> way is a straight shoot-out between the divisions: the club that
      just missed out below plays the lowest club that just survived above, home and away, and the
      winner has the place next season. Lose it from above and you go down; hold on and nobody
      moves at all. Countries with a third division play one at each boundary, so there is a way
      up whichever tier you are in. Either way it&apos;s played the moment the season ends, before
      anyone retires or moves on, and you can set which one each country uses when you start a
      save.
    </HelpHint>
  );

  if (playoffs.length === 0) {
    return (
      <div className="container-fluid p-3">
        <h4>Promotion Playoffs{intro}</h4>
        <EmptyState headline="No playoffs have been decided yet.">
          <p>
            They are played the moment the season ends, before anyone retires or moves on, and
            they settle the last promotion place at each step of a country&apos;s pyramid.
          </p>
          <p>
            Which shape a country uses is set when you start a save. Most play the English way,
            where the four clubs below the automatic places contest two-legged semi-finals and a
            final. Germany plays a one-off tie between the club above the line and the club below
            it, so the incumbent can hold on.
          </p>
        </EmptyState>
      </div>
    );
  }

  const countries = [...new Set(playoffs.map((p) => p.country))].sort();
  const country = countrySel ?? (userCountry && countries.includes(userCountry) ? userCountry : countries[0]);
  const forCountry = playoffs.filter((p) => p.country === country);
  // A country settles one place per promotion link, so a three-division pyramid
  // decides two in the same summer. They are shown together rather than behind a
  // third dropdown — there are at most a handful, they are one season's
  // business, and each card names its own two divisions.
  const seasons = [...new Set(forCountry.map((p) => p.season))];
  const season = seasons.find((s) => s === seasonSel) ?? seasons[0];
  const tierOf = (p: PromotionPlayoff) => competitionOf(league.competitions, p.d1CompId).tier;
  const shown = forCountry
    .filter((p) => p.season === season)
    .sort((a, b) => tierOf(a) - tierOf(b));

  const teamColors = (tid: number): [string, string] =>
    league.teams.find((t) => t.tid === tid)?.colors ?? ["#888888", "#888888"];

  const teamCell = (tid: number, won: boolean) => (
    <span className={`cup-team${won ? " cup-team-winner" : ""}${tid === userTid ? " cup-team-user" : ""}`}>
      <ClubCrest tid={tid} colors={teamColors(tid)} size={16} />
      <span className="cup-team-name">
        <ClubLink tid={tid} season={season} />
      </span>
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
          // Both legs are stored from this tie's `home` perspective, so they
          // read left-to-right the same way the aggregate above does. The
          // second leg was played at the away club's ground, which finished
          // higher — the English convention, and cosmetic here, since each
          // club hosts once and extra time takes no home bonus.
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

  const renderPlayoff = (playoff: PromotionPlayoff) => {
    const semis = playoff.ties.filter((t) => t.round !== PLAYOFF_ROUND_FINAL);
    const decider = playoff.ties.find((t) => t.round === PLAYOFF_ROUND_FINAL);
    const d1 = competitionOf(league.competitions, playoff.d1CompId);
    const d2 = competitionOf(league.competitions, playoff.d2CompId);
    const userEntered = playoff.teams.includes(userTid);
    const german = playoff.format === "german";
    // German: teams[0] is the incumbent from above, so the challenger going up
    // and the incumbent holding on are two different results, not one with a
    // nicer name. Everything the card says about the outcome keys off this.
    const challengerWon = german && playoff.winnerTid === playoff.teams[1];
    const promotedTid = german
      ? (challengerWon ? playoff.teams[1] : null)
      : playoff.winnerTid;

    return (
      <section key={playoff.d2CompId} className="mb-4">
        <div className="mb-2">
          <strong>{german ? `${d1.name} v ${d2.name}` : d2.name}</strong>{" "}
          <span className="text-muted small">
            {german
              ? `the last place in ${d1.name} · ${playoff.autoPromoted} up and `
                + `${playoff.autoRelegated} down automatically`
              : `the last place in ${d1.name} · ${playoff.autoPromoted} promoted automatically`}
          </span>
        </div>

        {playoff.winnerTid !== null && (
          <div className="cup-champion-banner mb-3">
            <span className="cup-champion-label">
              {promotedTid === null ? "Stayed up" : "Promoted"}
            </span>{" "}
            <ClubCrest tid={playoff.winnerTid} colors={teamColors(playoff.winnerTid)} size={22} />{" "}
            <strong><ClubLink tid={playoff.winnerTid} season={playoff.season} /></strong>{" "}
            <span className="text-muted small">
              from {ordinal(playoff.positions[playoff.teams.indexOf(playoff.winnerTid)])}
              {german && ` in ${playoff.winnerTid === playoff.teams[0] ? d1.name : d2.name}`}
            </span>
          </div>
        )}

        {userEntered && (
          <p className="text-muted small mb-3">
            {playoff.winnerTid === userTid
              ? (promotedTid === userTid ? "You went up through the playoffs." : "You held on to your place.")
              : (german && playoff.teams[0] === userTid
                ? "You lost the playoff and went down."
                : "Your club was in this playoff and missed out.")}
          </p>
        )}

        <div className="cup-bracket cup-bracket--rounds">
          {semis.length > 0 && (
            <div className="cup-round">
              <div className="cup-round-title">
                <span>Semi-finals</span>
                <span className="cup-round-count">{semis.length}</span>
              </div>
              <div className="cup-round-body">
                {semis.map((t, i) => <div className="cup-tie" key={i}>{renderTie(t)}</div>)}
              </div>
            </div>
          )}
          {decider && (
            <div className="cup-round">
              <div className="cup-round-title">
                <span>{german ? "Playoff" : "Final"}</span>
                {/* The English final is at a neutral ground; the German tie is
                    home and away, so it gets no neutral marker. */}
                {!german && <span className="cup-round-count" title="Neutral ground">N</span>}
              </div>
              <div className="cup-round-body">
                <div className="cup-tie cup-tie--final">{renderTie(decider)}</div>
              </div>
            </div>
          )}
        </div>

        <table className="table table-sm table-dark mt-3" style={{ maxWidth: 420 }}>
          <thead>
            <tr><th>Pos</th><th>Club</th>{german && <th>Division</th>}</tr>
          </thead>
          <tbody>
            {playoff.teams.map((tid, i) => (
              <tr key={tid} className={tid === userTid ? "team-highlight" : undefined}>
                <td>{playoff.positions[i]}</td>
                <td>
                  <ClubCrest tid={tid} colors={teamColors(tid)} size={16} />{" "}
                  <ClubLink tid={tid} season={playoff.season} />
                </td>
                {/* Only the German tie mixes divisions, and there a bare
                    position is ambiguous: "16th" and "3rd" are in different
                    tables. Compared against the link's own upper tier rather
                    than against 1, since a D3-D2 tie reads [2, 3]. */}
                {german && (
                  <td className="text-muted small">
                    {playoff.tiers[i] === d1.tier ? d1.name : d2.name}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    );
  };

  return (
    <div className="container-fluid p-3">
      <h4>Promotion Playoffs{intro}</h4>

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
          {seasons.map((s) => (
            <option key={s} value={s}>{seasonYear(s)}</option>
          ))}
        </select>
      </div>

      {shown.map(renderPlayoff)}
    </div>
  );
}
