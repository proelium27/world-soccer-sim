import { useMemo, useState } from "react";
import { useLeague } from "../context/LeagueContext.js";
import { ClubLink } from "../components/ClubLink.js";
import { ClubCrest } from "../components/ClubCrest.js";
import { EmptyState } from "../components/EmptyState.js";
import { Flag } from "../components/Flag.js";
import { HelpHint } from "../components/HelpHint.js";
import { seasonYear } from "../format.js";
import { competitionAbbrev } from "../../core/competitions.js";
import {
  seasonSummaries, type SeasonInternationalWin, type SeasonSummaryRow,
} from "../../core/seasonSummary.js";
import type { Competition } from "../../core/competitions.js";

/**
 * Which set of champions the country columns are showing. The two are
 * alternatives rather than one list, because showing both at once means a
 * column per country twice over — around 2,000px of table on the shipped world,
 * against ~1,300 for either on its own.
 */
type View = "leagues" | "cups";

/**
 * A short code for the confederation whose championship a nation won, so the
 * International column can name three winners on one line.
 *
 * The full names ("European Championship", "Africa Cup of Nations") are far too
 * long to sit three-across in a table cell, and the confederation cups of one
 * offseason are all played at once — so without a label the cell is three flags
 * with nothing to say which is which. The code carries that; the cell's title
 * carries the full name and the final score.
 */
const CONFEDERATION_CODE: Record<string, string> = {
  Europe: "EUR",
  "South America": "SAM",
  Africa: "AFR",
  Asia: "ASI",
  "North America": "NAM",
  Oceania: "OCE",
};

/** "WC" for the World Cup, else the confederation's code. */
function internationalCode(win: SeasonInternationalWin): string {
  if (!win.confederation) return "WC";
  return CONFEDERATION_CODE[win.confederation]
    ?? win.confederation.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase();
}

function internationalTitle(win: SeasonInternationalWin): string {
  const beat = win.runnerUp ? ` beat ${win.runnerUp}` : "";
  const score = win.score ? ` ${win.score}` : "";
  return `${win.name}: ${win.nation}${beat}${score}`;
}

export function SeasonHistory() {
  const { league } = useLeague();
  const [view, setView] = useState<View>("leagues");

  // Both memos sit above the `!league` guard — a hook can't follow an early
  // return. The derivation walks every archived cup in the save, so on a long
  // dynasty it is worth not repeating on each render.
  const rows = useMemo(() => (league ? seasonSummaries(league) : []), [league]);
  const nameByTid = useMemo(
    () => new Map((league?.teams ?? []).map((t) => [t.tid, t.name] as const)),
    [league],
  );
  const cupNameByCountry = useMemo(() => {
    const out = new Map<string, string>();
    for (const c of [...(league?.domesticCupHistory ?? []), ...(league?.domesticCups ?? [])]) {
      out.set(c.country, c.name);
    }
    return out;
  }, [league]);

  if (!league) return <p className="p-3">Loading...</p>;

  const userTid = league.meta.userTid;
  const topFlights = league.competitions.filter((c) => c.tier === 1);

  const intro = (
    <HelpHint>
      Every season your save has a champion for, one line each. The country columns hold either
      that season&apos;s league winners or its domestic cup winners, and the toggle swaps them.
      International tournaments are played in the offseason that follows a season, so a World Cup
      sits on the line of the club season it came after. Any club name here is a link to what that
      club did that year.
    </HelpHint>
  );

  if (rows.length === 0) {
    return (
      <div className="container-fluid p-3">
        <h4>Season History{intro}</h4>
        <EmptyState headline="No season has been decided yet.">
          <p>
            This fills in one line per season as you play: every top flight&apos;s champion, the
            Continental Cup and Shield winners, and whoever wins the World Cup or their
            confederation&apos;s championship in the offseason that follows.
          </p>
          <p>
            The first line appears the moment a trophy is lifted. The continental finals are
            played before the season rolls over, so they show up ahead of the league champions.
          </p>
        </EmptyState>
      </div>
    );
  }

  /** A club champion cell: three-letter code linking to that club's season. */
  const clubCell = (tid: number | undefined, season: number) => {
    if (tid === undefined) return <span className="text-muted">—</span>;
    return (
      <ClubLink
        tid={tid}
        season={season}
        variant="abbrev"
        title={nameByTid.get(tid) ?? undefined}
      />
    );
  };

  /**
   * Header for one country column: its flag, its three-letter code.
   *
   * The first one carries `sh-divide`, a rule separating the world's trophies
   * from the countries' own. Without it the dozen three-letter codes read as
   * one undifferentiated wall running off the right of the table.
   */
  const countryHead = (comp: Competition, i: number) => {
    const label = view === "leagues"
      ? comp.name
      : cupNameByCountry.get(comp.country) ?? `${comp.country} Cup`;
    return (
      // The code is shown at every width, not just wide ones. Hiding it to save
      // room reads fine for the twelve shipped countries, whose flags are all
      // distinct art, and leaves an anonymous grey swatch as the only heading
      // for a country the flag set doesn't cover. The table scrolls either way.
      <th key={comp.id} className={`text-center sh-country${i === 0 ? " sh-divide" : ""}`} title={label}>
        <Flag nationality={comp.country} tip={false} /> {competitionAbbrev(comp)}
      </th>
    );
  };

  /** The winner of one country's competition that season, whichever view is on. */
  const countryWinner = (row: SeasonSummaryRow, comp: Competition): number | undefined =>
    view === "leagues"
      ? row.leagueChampions[comp.id]
      : row.domesticCupWinners[comp.country];

  /**
   * A continental cell. These two are the marquee columns, so they carry the
   * crest and the club's full name where the country columns take a code —
   * there are two of them per row rather than a dozen, so they can afford it.
   */
  const continentalCell = (win: SeasonSummaryRow["continentalCup"], season: number) => {
    if (!win) return <span className="text-muted">—</span>;
    const colors = league.teams.find((t) => t.tid === win.tid)?.colors ?? ["#888888", "#888888"];
    return (
      <span className="d-inline-flex align-items-center gap-1 text-nowrap">
        <ClubCrest tid={win.tid} colors={colors} size={16} />
        <ClubLink tid={win.tid} season={season} title={win.name} />
      </span>
    );
  };

  return (
    <div className="container-fluid p-3">
      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
        <h4 className="mb-0">Season History{intro}</h4>
        <ul className="nav nav-pills nav-sm">
          <li className="nav-item">
            <button
              type="button"
              className={`nav-link py-0 px-2${view === "leagues" ? " active" : ""}`}
              onClick={() => setView("leagues")}
            >
              League champions
            </button>
          </li>
          <li className="nav-item">
            <button
              type="button"
              className={`nav-link py-0 px-2${view === "cups" ? " active" : ""}`}
              onClick={() => setView("cups")}
            >
              Domestic cup winners
            </button>
          </li>
        </ul>
      </div>

      <div className="card">
        <div className="card-body p-0">
          <div className="sh-scroll">
            <table className="table table-sm table-striped mb-0 sh-table">
              <thead>
                <tr>
                  <th className="sh-season">Season</th>
                  <th>Continental Cup</th>
                  <th>Continental Shield</th>
                  <th className="sh-intl-col">International</th>
                  {topFlights.map((comp, i) => countryHead(comp, i))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.season}>
                    <th scope="row" className="sh-season">
                      {seasonYear(row.season)}
                      {!row.complete && (
                        <span className="text-muted small ms-1" title="Still being played. The league champions are settled when the season rolls over.">
                          (now)
                        </span>
                      )}
                    </th>
                    <td>{continentalCell(row.continentalCup, row.season)}</td>
                    <td>{continentalCell(row.continentalShield, row.season)}</td>
                    <td className="sh-intl-col">
                      {row.international.length === 0 ? (
                        <span className="text-muted">—</span>
                      ) : (
                        <span className="sh-intl">
                          {row.international.map((win) => (
                            <span
                              key={win.name}
                              className="text-nowrap"
                              title={internationalTitle(win)}
                            >
                              <span className="sh-code">{internationalCode(win)}</span>{" "}
                              <Flag nationality={win.nation} tip={false} /> {win.nation}
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                    {topFlights.map((comp, i) => {
                      const tid = countryWinner(row, comp);
                      const own = tid !== undefined && tid === userTid;
                      return (
                        <td
                          key={comp.id}
                          className={`text-center${i === 0 ? " sh-divide" : ""}${own ? " sh-own" : ""}`}
                        >
                          {clubCell(tid, row.season)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <p className="text-muted small mt-3 mb-0">
        Country columns are three-letter club codes. Hover one for the full name, or click through
        to that club&apos;s season. In the International column <strong>WC</strong> is the World Cup
        and the other codes are confederations (EUR, SAM, AFR, ASI, NAM, OCE); those championships
        are played in the two offseasons of every four that don&apos;t have a World Cup.
      </p>
    </div>
  );
}
