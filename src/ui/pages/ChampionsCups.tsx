import { useState } from "react";
import { useLeague } from "../context/LeagueContext.js";
import { HelpHint } from "../components/HelpHint.js";
import { ClubCrest } from "../components/ClubCrest.js";
import { ClubLink } from "../components/ClubLink.js";
import { seasonYear } from "../format.js";
import type { SuperCupTie } from "../../core/superCup/types.js";
import { superCupChampion } from "../../core/superCup/types.js";
import { superCupRouteLabel, superCupsPending } from "../../core/superCup/superCup.js";
import { EmptyState } from "../components/EmptyState.js";

/**
 * Every super cup the save holds a record of, newest season first.
 *
 * Two sources, the same arrangement the Cup page uses for `cup`/`cupHistory`:
 * `league.superCups` is the set that opened the season in progress, and the
 * rollover copies those onto the season-history entry. A season appears in one
 * or the other, never both, so this is a concatenation rather than a merge.
 */
function allSuperCups(
  live: SuperCupTie[],
  history: { superCups?: SuperCupTie[] }[],
): SuperCupTie[] {
  return [...live, ...history.flatMap((h) => h.superCups ?? [])]
    .sort((a, b) => b.season - a.season);
}

export function ChampionsCups() {
  const { league, playSuperCupsAction } = useLeague();
  const [seasonSel, setSeasonSel] = useState<number | null>(null);

  if (!league) return <p className="p-3">Loading...</p>;

  const userTid = league.meta.userTid;
  const every = allSuperCups(league.superCups ?? [], league.seasonHistory);
  const pending = superCupsPending(league.superCups ?? []);

  const intro = (
    <HelpHint>
      The season opens with the champions cups, played before anyone has a league point on the
      board. Every country holds one between its league champions and its cup winners — and when
      one club won both, the league runners-up take their place, the way the Community Shield
      does it. There&apos;s one more on top of those: the Continental Cup winners against the
      Continental Shield winners, the only match of the year between the two.
      They&apos;re one-off games at a neutral ground, so there&apos;s no home advantage and no
      second leg to fix a bad night — level after 90 minutes goes to extra time and then
      penalties. No prize money rides on any of it. It&apos;s a trophy and bragging rights, which
      is about what the real ones are worth too.
    </HelpHint>
  );

  if (every.length === 0) {
    return (
      <div className="container-fluid p-3">
        <h4>Champions Cups{intro}</h4>
        <EmptyState headline="No champions cups have been played yet.">
          <p>
            They are played in the preseason, so the first ones kick off at the start of next
            season, between the clubs winning things this one.
          </p>
          <p>Each country puts up two clubs, and the continent puts up two more:</p>
          <ul>
            <li>Its league champion against its domestic cup winner.</li>
            <li>The Continental Cup holder against the Continental Shield holder.</li>
            <li>The Continental Cup holder against the Americas Cup holder, in the Intercontinental Cup.</li>
          </ul>
        </EmptyState>
      </div>
    );
  }

  const seasons = [...new Set(every.map((sc) => sc.season))].sort((a, b) => b - a);
  const season = seasonSel !== null && seasons.includes(seasonSel) ? seasonSel : seasons[0];
  const shown = every.filter((sc) => sc.season === season);
  // The one worldwide match leads, then each country's, alphabetically — a
  // stable order, rather than the competition-table order they are built in.
  const ordered = [
    ...shown.filter((sc) => sc.competition === "intercontinental"),
    ...shown.filter((sc) => sc.competition === "continental"),
    ...shown.filter((sc) => sc.competition === "domestic")
      .sort((a, b) => (a.country ?? "").localeCompare(b.country ?? "")),
  ];

  const teamColors = (tid: number): [string, string] =>
    league.teams.find((t) => t.tid === tid)?.colors ?? ["#888888", "#888888"];

  const renderCup = (sc: SuperCupTie) => {
    const champion = superCupChampion(sc);
    const t = sc.tie;
    const involvesUser = sc.teams.includes(userTid);

    const row = (tid: number, i: number) => {
      const won = champion === tid;
      const cls = t === null
        ? "cup-tie-row"
        : `cup-tie-row ${won ? "cup-tie-row--won" : "cup-tie-row--out"}`;
      return (
        <div className={cls} key={tid}>
          <span className={`cup-team${won ? " cup-team-winner" : ""}${tid === userTid ? " cup-team-user" : ""}`}>
            <ClubCrest tid={tid} colors={teamColors(tid)} size={16} />
            <span className="cup-team-name">
              <ClubLink tid={tid} season={sc.season} />
            </span>
          </span>
          <span className="text-muted small me-auto ps-2">{superCupRouteLabel(sc.routes[i])}</span>
          <span className="cup-tie-score">
            {t === null ? "" : (i === 0 ? t.homeGoals : t.awayGoals)}
          </span>
        </div>
      );
    };

    return (
      <div className="col-12 col-md-6 col-xl-4 mb-3" key={`${sc.competition}:${sc.country ?? "world"}`}>
        <div className={`card h-100${involvesUser ? " border-primary" : ""}`}>
          <div className="card-body p-2">
            <div className="fw-semibold mb-2">{sc.name}</div>
            {row(sc.teams[0], 0)}
            {row(sc.teams[1], 1)}
            {t === null && <div className="cup-tie-note">Still to be played</div>}
            {t !== null && (t.wentToExtraTime || t.wentToPens) && (
              <div className="cup-tie-note">
                {t.wentToPens ? `${t.homePens}-${t.awayPens} on pens` : "after extra time"}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const userWon = ordered.find((sc) => superCupChampion(sc) === userTid);

  return (
    <div className="container-fluid p-3">
      <h4>Champions Cups{intro}</h4>

      <div className="mb-3 d-flex gap-2 flex-wrap align-items-center">
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
        {pending && season === league.season && (
          <button className="btn btn-sm btn-primary" onClick={() => void playSuperCupsAction()}>
            Play the champions cups
          </button>
        )}
      </div>

      {userWon && (
        <div className="cup-champion-banner mb-3">
          <span className="cup-champion-label">Winners</span>{" "}
          <ClubCrest tid={userTid} colors={teamColors(userTid)} size={22} />{" "}
          <strong><ClubLink tid={userTid} season={season} /></strong>{" "}
          <span className="text-muted small">{userWon.name}</span>
        </div>
      )}

      <div className="row">{ordered.map(renderCup)}</div>
    </div>
  );
}
