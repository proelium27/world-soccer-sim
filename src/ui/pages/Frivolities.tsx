import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useLeague } from "../context/LeagueContext.js";
import { computeRecordBook, type TeamSeasonRecord, type TransferRecord } from "../../core/frivolities/records.js";
import {
  computePlayerBios, type BioRow, type NameCount, type NationalityRow, type OneClubMan,
} from "../../core/frivolities/bios.js";
import { computeClubTrivia, type ClubRecordRow, type ClubSpendRow } from "../../core/frivolities/clubs.js";
import type { CareerRow } from "../../core/frivolities/careers.js";
import {
  allTimeLeaderBoards, ALL_TIME_LEADER_LIMIT, ALL_TIME_OVERVIEW_LIMIT,
  type AllTimeLeaderRow, type LeaderScope,
} from "../../core/frivolities/leaders.js";
import {
  allTimeInternationalBoards, cappedNationalities, intlStatOf,
  INTL_ALL_TIME_KEYS, INTL_ALL_TIME_LIMIT, INTL_OVERVIEW_LIMIT, type IntlAllTimeKey,
} from "../../core/frivolities/international.js";
import {
  playerGoatRanking, teamGoatRanking,
  type PlayerGoatRow, type TeamGoatRow,
} from "../../core/frivolities/goat.js";
import {
  computeAwardTrivia, sortAwardRows, awardXIForClub, AWARD_KEYS,
  type AwardCareerRow, type AwardKey, type AwardTally, type AwardXISlot,
  type BallonDOrSeason, type ClubAwardRow, type NationAwardRow, type RollOfHonourRow,
} from "../../core/frivolities/honours.js";
import { layoutSlots } from "../pitchLayout.js";
import { ALL_TIME_STAT_KEYS, type AllTimeStatKey } from "../../core/frivolities/stats.js";
import { STAT_LABELS, formatStat } from "../statLabels.js";
import { ClubLink } from "../components/ClubLink.js";
import { Flag } from "../components/Flag.js";
import { Panel, Empty, ClubCell, PlayerCell, RankTable } from "../components/boards.js";
import { GoatBreakdown, partLabel } from "../components/GoatBreakdown.js";
import { currency, seasonYear } from "../format.js";
import { isSpectator } from "../../core/spectator.js";
import { shortName } from "../playerName.js";

type Tab = "goat" | "awards" | "records" | "leaders" | "international" | "bios" | "clubs";

const TAB_LABELS: Record<Tab, string> = {
  goat: "GOAT",
  awards: "Awards",
  records: "Records",
  leaders: "All-Time Leaders",
  international: "International",
  bios: "Player Bios",
  clubs: "Club Records",
};


/** Two panels side by side on wide screens, stacked on mobile. */
function Row({ children }: { children: ReactNode }) {
  return <div className="row g-3 mb-3">{children}</div>;
}
function Col({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return <div className={wide ? "col-12" : "col-12 col-lg-6"}>{children}</div>;
}

// --- GOAT ------------------------------------------------------------------


function GoatTab() {
  const { league } = useLeague();
  const [side, setSide] = useState<"players" | "clubs">("players");
  const players = useMemo(() => (league ? playerGoatRanking(league) : []), [league]);
  const clubs = useMemo(() => (league ? teamGoatRanking(league) : []), [league]);
  if (!league) return null;

  return (
    <>
      <p className="text-secondary small">
        Ranked by a fixed formula weighing peak rating, years spent near that peak, career length
        and match rating, individual awards, trophies, and goals and assists.
      </p>

      <ul className="nav nav-pills nav-sm mb-3">
        {(["players", "clubs"] as const).map((s) => (
          <li key={s} className="nav-item">
            <button
              className={`nav-link ${side === s ? "active" : ""}`}
              onClick={() => setSide(s)}
            >
              {s === "players" ? "Players" : "Clubs"}
            </button>
          </li>
        ))}
      </ul>

      {/* Keyed on `side` so switching boards remounts the table. Without it the
          open-row index carries across, and the Clubs board opens with a row
          already expanded because a player row was open. */}
      {side === "players" ? (
        <Panel
          key="players"
          title="Greatest players of all time"
          note="Click on a row to see the full score breakdown"
        >
          <RankTable
            rows={players}
            headers={[
              "Player", "Club", "Best OVR",
              ...(players[0]?.components ?? []).map((c) => partLabel(c.key)),
              "Score",
            ]}
            render={(r: PlayerGoatRow) => [
              <PlayerCell
                pid={r.career.pid}
                name={r.career.name}
                nationality={r.career.nationality}
                active={r.career.active}
              />,
              <ClubCell tid={r.career.tid} />,
              // Labelled "Best OVR", not "Peak": the Peak column beside it is a
              // score component derived from this, and calling both "peak" made
              // the row unreadable.
              r.career.peakOvr,
              // Columns come from the row's own components, so a component can
              // never count toward the score without appearing here.
              ...r.components.map((c) => <span className="text-muted">{c.points}</span>),
              <strong>{r.score}</strong>,
            ]}
            expand={(r: PlayerGoatRow) => (
              <GoatBreakdown components={r.components} score={r.score} />
            )}
            empty="careers"
          />
        </Panel>
      ) : (
        <Panel
          key="clubs"
          title="Greatest clubs of all time"
          note="Click on a row to see the full score breakdown"
        >
          <RankTable
            rows={clubs}
            headers={[
              "Club", "Titles", "Cups", "Shields", "Dom. cups", "Trebles",
              "Top 4", "Seasons", "PPG", "Score",
            ]}
            render={(r: TeamGoatRow) => [
              <ClubCell tid={r.tid} />,
              r.leagueTitles,
              r.cupTitles,
              r.shieldTitles,
              r.domesticCupTitles,
              r.trebles,
              r.topFinishes,
              r.seasons,
              r.ppg.toFixed(2),
              <strong>{r.score}</strong>,
            ]}
            expand={(r: TeamGoatRow) => (
              <GoatBreakdown components={r.components} score={r.score} />
            )}
            empty="completed seasons"
          />
        </Panel>
      )}
    </>
  );
}

// --- Awards ----------------------------------------------------------------

/** Column wording for each individual award, plus the total that sums them. */
const AWARD_LABELS: Record<AwardKey, string> = {
  total: "Total",
  ballonDOr: "Ballon d'Or",
  worldXI: "World XI",
  goalkeeperOfYear: "Goalkeeper of the Year",
  defenderOfYear: "Defender of the Year",
  playerOfSeason: "Player of the Season",
  goldenBoot: "Golden Boot",
  teamOfSeason: "Team of the Season",
};

/** Short forms, for the board that needs every column at once. */
const AWARD_SHORT: Record<AwardKey, string> = {
  total: "Total",
  ballonDOr: "BdO",
  worldXI: "World XI",
  goalkeeperOfYear: "Keeper",
  defenderOfYear: "Defender",
  playerOfSeason: "POTS",
  goldenBoot: "Boot",
  teamOfSeason: "TOTS",
};

/**
 * The tally columns, in display order, with the total last.
 *
 * One list rather than one per render site: the headers and the cells are built
 * separately and a column added to only one of them silently shifts every
 * number one place along.
 */
const TALLY_COLUMNS: AwardKey[] = [
  "ballonDOr", "worldXI", "goalkeeperOfYear", "defenderOfYear",
  "playerOfSeason", "goldenBoot", "teamOfSeason", "total",
];

/** The parts of a Ballon d'Or score, in the order the entry stores them. */
const BDO_PARTS: { key: "league" | "cup" | "intl" | "title"; label: string; help: string }[] = [
  { key: "league", label: "League season", help: "his domestic season and rating, corrected for how strong his league is" },
  { key: "cup", label: "Continental Cup", help: "his own end product and rating there, plus how far his club went" },
  { key: "intl", label: "International", help: "the campaign played in the offseason right after, plus a World Cup winner's bonus" },
  { key: "title", label: "League title", help: "winning his own league, scaled by how much of it he played" },
];

/** A tally row's numbers, with the ranked one picked out. */
function tallyCells(t: AwardTally, ranked: AwardKey): ReactNode[] {
  return TALLY_COLUMNS
    .map((k) => (
      <span key={k} className={k === ranked ? "fw-bold" : undefined}>
        {t[k] || <span className="text-muted">&ndash;</span>}
      </span>
    ));
}

/** The four parts behind one Ballon d'Or score, and what each of them is. */
function BallonDOrBreakdown({ row }: { row: BallonDOrSeason }) {
  return (
    <div className="small">
      <div className="text-muted mb-2">
        What his score was made of. Every part is on the same scale, so you can see whether a
        season was won at home, in Europe, or with his country.
      </div>
      <div className="row g-3">
        {BDO_PARTS.map((p) => (
          <div key={p.key} className="col-12 col-md-6 col-lg-3">
            <div className="d-flex justify-content-between border-bottom mb-1">
              <strong>{p.label}</strong>
              <strong>{row.entry[p.key].toFixed(2)}</strong>
            </div>
            <div className="text-muted">{p.help}</div>
          </div>
        ))}
      </div>
      <div className="d-flex justify-content-between border-top mt-2 pt-1">
        <strong>Total</strong>
        <strong>{row.entry.score.toFixed(2)}</strong>
      </div>
    </div>
  );
}

const XI_COORDS = layoutSlots("4-3-3");

/** Surname only — a full name doesn't fit in a pitch chip. */
/** How a slot's pick was selected, in words. */
function selectionSummary(pick: AwardXISlot["pick"]): string {
  if (!pick) return "";
  const parts: string[] = [];
  if (pick.worldXI > 0) parts.push(`${pick.worldXI} x World XI`);
  if (pick.teamOfSeason > 0) parts.push(`${pick.teamOfSeason} x Team of the Season`);
  return parts.join(", ");
}

/**
 * A club's all-time award XI on a pitch, with the selections that earned each
 * slot listed underneath.
 *
 * The pitch is the same 4-3-3 both team-of-the-year awards are picked in, which
 * is what lets this be a record rather than an opinion: a slot's occupant is
 * simply whoever this club has had picked there most often.
 */
function ClubAwardXI({ slots }: { slots: AwardXISlot[] }) {
  const picked = slots.filter((s) => s.pick !== null);
  return (
    <>
      <div className="pitch-field">
        <div className="pitch-goal pitch-goal--left" />
        <div className="pitch-goal pitch-goal--right" />
        {slots.map((s) => {
          const coord = XI_COORDS[s.slot];
          return (
            <div
              key={s.slot}
              className="pitch-slot"
              style={{ left: `${coord.x}%`, top: `${coord.y}%` }}
            >
              {s.pick ? (
                <span className={`pitch-chip${s.pos === "GK" ? " pitch-chip--gk" : ""}`}>
                  <Link to={`/player/${s.pick.pid}`} className="pitch-chip-name">
                    {shortName(s.pick.name)}
                  </Link>
                  <span className="pitch-chip-ovr">{s.pick.worldXI + s.pick.teamOfSeason}</span>
                </span>
              ) : (
                <span className="pitch-chip" style={{ opacity: 0.4, cursor: "default" }}>&mdash;</span>
              )}
            </div>
          );
        })}
      </div>

      {picked.length === 0 ? (
        <p className="text-muted small mt-3 mb-0">
          Nobody at this club has been picked in a Team of the Season or a World Team of the Year yet.
        </p>
      ) : (
        <div className="table-responsive mt-3">
          <table className="table table-sm align-middle mb-0">
            <thead>
              <tr>
                <th className="text-muted" style={{ width: "3.5rem" }}>Pos</th>
                <th>Player</th>
                <th>Picked</th>
                <th className="text-end">Seasons</th>
              </tr>
            </thead>
            <tbody>
              {picked.map((s) => (
                <tr key={s.slot}>
                  <td className="text-muted">{s.pos}</td>
                  <td>
                    <PlayerCell
                      pid={s.pick!.pid}
                      name={s.pick!.name}
                      nationality={s.pick!.nationality}
                      active={s.pick!.active}
                    />
                  </td>
                  <td className="small text-secondary">{selectionSummary(s.pick)}</td>
                  <td className="text-end small text-secondary">
                    {s.pick!.seasons.map(seasonYear).join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** Every club in the world, grouped by country then competition. */
function ClubPicker({ tid, onChange }: { tid: number; onChange: (tid: number) => void }) {
  const { league } = useLeague();
  if (!league) return null;
  const countries = [...new Set(league.competitions.map((c) => c.country))];
  return (
    <select
      className="form-select form-select-sm"
      style={{ width: "auto" }}
      value={tid}
      onChange={(e) => onChange(Number(e.target.value))}
      aria-label="Club"
    >
      {countries.map((country) => (
        <optgroup key={country} label={country}>
          {league.competitions
            .filter((c) => c.country === country)
            .flatMap((c) =>
              league.teams
                .filter((t) => t.compId === c.id)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((t) => (
                  <option key={t.tid} value={t.tid}>{t.name} ({c.name})</option>
                )),
            )}
        </optgroup>
      ))}
    </select>
  );
}

function ballonDOrSeasonCells(r: BallonDOrSeason, showFinish: boolean): ReactNode[] {
  return [
    <PlayerCell pid={r.pid} name={r.name} nationality={r.nationality} active={r.active} />,
    <ClubCell tid={r.tid} season={r.season} />,
    seasonYear(r.season),
    ...(showFinish
      ? [r.rank === 1 ? <span className="fw-bold">Won it</span> : `#${r.rank}`]
      : []),
    <strong>{r.entry.score.toFixed(2)}</strong>,
  ];
}

/**
 * Exported for the render harness (`test/ui/frivolitiesAwards.test.tsx`): the
 * tab is reached by a click, and there is no DOM test environment in this repo,
 * so a static render of the page itself would only ever exercise the GOAT tab.
 */
export function AwardsTab() {
  const { league } = useLeague();
  const [rank, setRank] = useState<AwardKey>("total");
  // Defaults to the user's own club, which is the one he wants to see first.
  const [xiTid, setXiTid] = useState<number | null>(null);
  const trivia = useMemo(() => (league ? computeAwardTrivia(league) : null), [league]);
  const ranked = useMemo(
    () => (trivia ? sortAwardRows(trivia.careers, rank) : []),
    [trivia, rank],
  );
  if (!league || !trivia) return null;

  // Whose all-time XI to open on. Your own club, or — with nobody managing one
  // — the first in the world, since the user's tid owns no squad to build one
  // from and the board would open on a permanently empty pitch.
  const shownTid = xiTid
    ?? (isSpectator(league) ? league.teams[0]?.tid ?? -1 : league.meta.userTid);

  if (trivia.seasonsRecorded === 0) {
    return (
      <div className="alert alert-secondary small mb-0">
        No awards have been handed out yet. Finish a season and come back.
      </div>
    );
  }

  return (
    <>
      <p className="text-secondary small">
        Every individual honour the game has ever handed out, added up across careers, clubs and
        countries. Awards are recorded by player when they're won, so a retired player keeps every
        one of them.
      </p>

      <Row>
        <Col wide>
          <Panel
            title="Most decorated careers"
            note="Pick an award to rank by. The Ballon d'Or, the World XI and the Goalkeeper and Defender of the Year are worldwide; Player of the Season, the Golden Boot and the Team of the Season are won league by league."
          >
            <div className="mb-3">
              <select
                className="form-select form-select-sm"
                style={{ width: "auto" }}
                value={rank}
                onChange={(e) => setRank(e.target.value as AwardKey)}
                aria-label="Award to rank by"
              >
                {AWARD_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {k === "total" ? "Every honour" : AWARD_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>
            <RankTable
              rows={ranked}
              headers={[
                "Player", "Club",
                ...TALLY_COLUMNS.map((k) => AWARD_SHORT[k]),
              ]}
              render={(r: AwardCareerRow) => [
                <PlayerCell
                  pid={r.career.pid}
                  name={r.career.name}
                  nationality={r.career.nationality}
                  active={r.career.active}
                />,
                <ClubCell tid={r.career.tid} />,
                ...tallyCells(r.tally, rank),
              ]}
              empty="awards"
            />
          </Panel>
        </Col>
      </Row>

      <Row>
        <Col wide>
          <Panel
            title="Most dominant seasons"
            note="Every season ranked by the Ballon d'Or score it earned, so the best individual season the save has ever seen sits at the top. Click a row for the breakdown."
          >
            <RankTable
              rows={trivia.dominantSeasons}
              headers={["Player", "Club", "Season", "Finish", "Score"]}
              render={(r: BallonDOrSeason) => ballonDOrSeasonCells(r, true)}
              expand={(r: BallonDOrSeason) => <BallonDOrBreakdown row={r} />}
              empty="Ballon d'Or seasons"
            />
          </Panel>
        </Col>
      </Row>

      <Row>
        <Col wide>
          <Panel
            title="Ballon d'Or record"
            note="The whole top ten is kept every season, so a career of near-misses counts. Shares score each finish: a win is 1.00, tenth place 0.10."
          >
            <RankTable
              rows={trivia.ballonDOr}
              headers={["Player", "Club", "Won", "2nd", "3rd", "Top 10", "In a row", "Shares"]}
              render={(r: AwardCareerRow) => [
                <PlayerCell
                  pid={r.career.pid}
                  name={r.career.name}
                  nationality={r.career.nationality}
                  active={r.career.active}
                />,
                <ClubCell tid={r.career.tid} />,
                r.ballon.wins || <span className="text-muted">&ndash;</span>,
                r.ballon.runnerUp || <span className="text-muted">&ndash;</span>,
                r.ballon.third || <span className="text-muted">&ndash;</span>,
                r.ballon.shortlists,
                r.ballon.bestRun > 1 ? r.ballon.bestRun : <span className="text-muted">&ndash;</span>,
                <strong>{r.ballon.shares.toFixed(2)}</strong>,
              ]}
              empty="Ballon d'Or shortlists"
            />
          </Panel>
        </Col>
      </Row>

      <Row>
        <Col>
          <Panel title="Ballon d'Or roll of honour" note="Every winner, newest first.">
            <RankTable
              rows={trivia.rollOfHonour}
              headers={["Season", "Winner", "Score", "Runner-up"]}
              render={(r: RollOfHonourRow) => [
                seasonYear(r.season),
                <PlayerCell
                  pid={r.winner.pid}
                  name={r.winner.name}
                  nationality={r.winner.nationality}
                  active={r.winner.active}
                />,
                r.winner.entry.score.toFixed(2),
                r.runnerUp
                  ? <PlayerCell
                      pid={r.runnerUp.pid}
                      name={r.runnerUp.name}
                      nationality={r.runnerUp.nationality}
                      active={r.runnerUp.active}
                    />
                  : <span className="text-muted">None</span>,
              ]}
              empty="Ballon d'Or winners"
            />
          </Panel>
        </Col>
        <Col>
          <Panel title="Youngest and oldest winners" note="Age in the season he won it.">
            <div className="row g-3">
              <div className="col-12 col-xl-6">
                <div className="text-muted small mb-1">Youngest</div>
                <RankTable
                  rows={trivia.youngestWinners}
                  headers={["Player", "Season", "Age"]}
                  render={(r: BallonDOrSeason) => [
                    <PlayerCell pid={r.pid} name={r.name} nationality={r.nationality} active={r.active} />,
                    seasonYear(r.season),
                    r.age,
                  ]}
                  empty="Ballon d'Or winners"
                />
              </div>
              <div className="col-12 col-xl-6">
                <div className="text-muted small mb-1">Oldest</div>
                <RankTable
                  rows={trivia.oldestWinners}
                  headers={["Player", "Season", "Age"]}
                  render={(r: BallonDOrSeason) => [
                    <PlayerCell pid={r.pid} name={r.name} nationality={r.nationality} active={r.active} />,
                    seasonYear(r.season),
                    r.age,
                  ]}
                  empty="Ballon d'Or winners"
                />
              </div>
            </div>
          </Panel>
        </Col>
      </Row>

      <Row>
        <Col wide>
          <Panel
            title="A club's all-time award XI"
            note="Both team-of-the-year awards are picked position by position, so this is a record rather than an opinion: each slot goes to whoever this club has had picked there most often, with a worldwide place counting for more than a domestic one. A player can only hold one slot."
          >
            <div className="mb-3 d-flex align-items-center gap-2 flex-wrap">
              <ClubPicker tid={shownTid} onChange={setXiTid} />
              <ClubCell tid={shownTid} />
            </div>
            <ClubAwardXI slots={awardXIForClub(trivia, shownTid)} />
          </Panel>
        </Col>
      </Row>

      <Row>
        <Col>
          <Panel
            title="Awards by club"
            note="Credited to the club he was at that season, not the one he plays for now."
          >
            <RankTable
              rows={trivia.clubs}
              headers={["Club", "BdO", "World XI", "POTS", "Boot", "TOTS", "Total"]}
              render={(r: ClubAwardRow) => [
                <ClubCell tid={r.tid} />,
                ...tallyCells(r, "total"),
              ]}
              empty="awards"
            />
          </Panel>
        </Col>
        <Col>
          <Panel title="Awards by country" note="Where the winners were born, wherever they play.">
            <RankTable
              rows={trivia.nations}
              headers={["Country", "BdO", "World XI", "POTS", "Boot", "TOTS", "Total"]}
              render={(r: NationAwardRow) => [
                <span className="d-inline-flex align-items-center gap-1">
                  <Flag nationality={r.nationality} tip={false} />
                  {r.nationality}
                </span>,
                ...tallyCells(r, "total"),
              ]}
              empty="awards"
            />
          </Panel>
        </Col>
      </Row>
    </>
  );
}

// --- Records ---------------------------------------------------------------

function teamSeasonCells(r: TeamSeasonRecord): ReactNode[] {
  return [
    <ClubCell tid={r.tid} season={r.season} />,
    seasonYear(r.season),
    `D${r.tier}`,
    `${r.row.won}-${r.row.drawn}-${r.row.lost}`,
    r.row.points,
    r.ppg.toFixed(2),
  ];
}

function careerCells(c: CareerRow, value: ReactNode, extra?: ReactNode): ReactNode[] {
  return [
    <PlayerCell pid={c.pid} name={c.name} nationality={c.nationality} active={c.active} />,
    <ClubCell tid={c.tid} />,
    ...(extra === undefined ? [] : [extra]),
    value,
  ];
}

function RecordsTab() {
  const { league } = useLeague();
  const book = useMemo(() => (league ? computeRecordBook(league) : null), [league]);
  if (!league || !book) return null;

  const careerHeaders = (last: string, extra?: string) =>
    ["Player", "Club", ...(extra ? [extra] : []), last];

  return (
    <>
      <Row>
        <Col>
          <Panel
            title="Most dominant seasons"
            note="Ranked by points per game, so a season in a smaller league isn't punished for playing fewer matches."
          >
            <RankTable
              rows={book.bestTeamSeasons}
              headers={["Club", "Season", "Div", "W-D-L", "Pts", "PPG"]}
              render={teamSeasonCells}
              empty="completed seasons"
            />
          </Panel>
        </Col>
        <Col>
          <Panel title="Worst team seasons" note="The other end of the same list.">
            <RankTable
              rows={book.worstTeamSeasons}
              headers={["Club", "Season", "Div", "W-D-L", "Pts", "PPG"]}
              render={teamSeasonCells}
              empty="completed seasons"
            />
          </Panel>
        </Col>
      </Row>

      <Row>
        <Col>
          <Panel title="Highest rating ever reached">
            <RankTable
              rows={book.peakRatings}
              headers={careerHeaders("Peak", "Season")}
              render={(c) => careerCells(c, c.peakOvr, seasonYear(c.peakSeason))}
              empty="rated seasons"
            />
          </Panel>
        </Col>
        <Col>
          <Panel title="Longest careers">
            <RankTable
              rows={book.longestCareers}
              headers={careerHeaders("Seasons", "Apps")}
              render={(c) => careerCells(c, c.seasonsPlayed, c.totals.appearances)}
              empty="careers"
            />
          </Panel>
        </Col>
      </Row>

      <Row>
        <Col wide>
          <Panel title="Biggest transfer fees" note="Permanent deals only. Loans and free moves aren't purchases.">
            <RankTable
              rows={book.biggestTransfers}
              headers={["Player", "From", "To", "Season", "Fee"]}
              render={(t: TransferRecord) => [
                <PlayerCell pid={t.pid} name={t.name} nationality={t.nationality} />,
                <ClubCell tid={t.fromTid} season={t.season} />,
                <ClubCell tid={t.toTid} season={t.season} />,
                seasonYear(t.season),
                currency.format(t.fee),
              ]}
              empty="transfers"
            />
          </Panel>
        </Col>
      </Row>
    </>
  );
}

// --- Summary grids ---------------------------------------------------------

/** A club as a crest and its three letters — the compact form the grid cards use. */
function ClubBadge({ tid, season }: { tid: number | null; season?: number }) {
  if (tid == null) return <span className="text-muted small">&mdash;</span>;
  return (
    <ClubLink
      tid={tid}
      season={season}
      variant="abbrev"
      crest
      crestSize={16}
      className="d-inline-flex align-items-center gap-1 small text-decoration-none"
    />
  );
}

/**
 * Whether a career belongs to the user's club, the test both grids highlight on.
 *
 * `clubs` is every club he made league appearances for, so this reads as "he
 * played for you", past or present — the question these boards are for, since
 * an all-time list is mostly people who have already moved on or retired. The
 * `tid` half catches a man on the roster right now who hasn't played a league
 * game for the club yet: he's yours, he's shown wearing your crest, and leaving
 * him plain would read as a bug rather than a distinction.
 */
function isUserPlayer(row: Pick<CareerRow, "clubs" | "tid">, userTid: number): boolean {
  return row.clubs.includes(userTid) || row.tid === userTid;
}

/** One row of a summary card, flattened from whatever board it came from. */
interface CardRow {
  pid: number;
  name: string;
  nationality: string;
  tid: number | null;
  /** Already formatted — a card shows one number and the board decides which. */
  value: string;
  /** An extra muted column before the value, e.g. which season a figure is from. */
  note?: string;
  /** Played for the user's club: drawn with the same wash Standings gives it. */
  highlight?: boolean;
}

/**
 * One board's top ten, as a card that opens the full list.
 *
 * The header is the click target rather than the whole card: the rows carry
 * player links of their own, and a button can't legally contain them.
 *
 * Shared by both grids on this page (all-time leaders and international) so
 * they stay one visual idea rather than drifting into two.
 */
function BoardCard({ title, empty, rows, onOpen }: {
  title: string;
  empty: string;
  rows: CardRow[];
  onOpen: () => void;
}) {
  return (
    <div className="card h-100">
      <button
        type="button"
        onClick={onOpen}
        className={"btn btn-link text-decoration-none w-100 text-start"
          + " d-flex align-items-center justify-content-between px-3 pt-3 pb-1"}
      >
        <span className="text-body text-uppercase small fw-semibold">{title}</span>
        <span className="small">
          Full list
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="ms-1"
            stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
      <div className="card-body pt-1">
        {rows.length === 0 ? <Empty what={empty} /> : (
          <table className="table table-sm align-middle mb-0">
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.pid} className={r.highlight ? "team-highlight" : undefined}>
                  {/* ps-2, not ps-0: a highlighted row draws its leading-edge
                      marker inside this cell, and Bootstrap's !important
                      padding would otherwise beat the marker rule's own
                      padding and sit the line on top of the rank. Uniform
                      across every row so nothing shifts when one lights up. */}
                  <td className="text-muted ps-2" style={{ width: "2rem" }}>{i + 1}</td>
                  {/* No retired badge here, unlike the full board: the cards sit
                      three to a row, and a badge on a name is enough to wrap
                      every row it lands on. */}
                  <td className="text-nowrap">
                    <PlayerCell pid={r.pid} name={r.name} nationality={r.nationality} />
                  </td>
                  <td className="text-end"><ClubBadge tid={r.tid} /></td>
                  {r.note !== undefined && (
                    <td className="text-end text-muted small">{r.note}</td>
                  )}
                  <td className="text-end pe-0 fw-semibold">{r.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/** The grid both summary views lay their cards out on. */
function CardGrid({ children }: { children: ReactNode }) {
  return <div className="row g-3">{children}</div>;
}

/** The button that takes a full board back to its grid. */
function BackToGrid({ onBack }: { onBack: () => void }) {
  return (
    <button type="button" className="btn btn-sm btn-outline-secondary mb-3" onClick={onBack}>
      &larr; All categories
    </button>
  );
}

// --- All-time leaders ------------------------------------------------------

/** One stat's full board, the view a grid card opens into. */
function LeaderBoard({ stat, scope, rows, userTid, onBack }: {
  stat: AllTimeStatKey;
  scope: LeaderScope;
  rows: AllTimeLeaderRow[];
  userTid: number;
  onBack: () => void;
}) {
  return (
    <>
      <BackToGrid onBack={onBack} />
      <Panel
        title={scope === "career"
          ? `Career ${STAT_LABELS[stat]}`
          : `Best season: ${STAT_LABELS[stat]}`}
        note={scope === "single"
          ? "One row per player: his best season, so a single career can't fill the whole board."
          : undefined}
      >
        <RankTable
          rows={rows}
          headers={scope === "career"
            ? ["Player", "Club", "Apps", STAT_LABELS[stat]]
            : ["Player", "Club", "Season", "Apps", STAT_LABELS[stat]]}
          render={(r) => [
            <PlayerCell
              pid={r.career.pid}
              name={r.career.name}
              nationality={r.career.nationality}
              active={r.career.active}
            />,
            <ClubCell tid={r.career.tid} />,
            ...(scope === "single" ? [seasonYear(r.season ?? 0)] : []),
            r.appearances,
            formatStat(stat, r.value),
          ]}
          empty="recorded seasons"
          highlight={(r) => isUserPlayer(r.career, userTid)}
        />
      </Panel>
    </>
  );
}

export function LeadersTab() {
  const { league } = useLeague();
  const [open, setOpen] = useState<AllTimeStatKey | null>(null);
  const [scope, setScope] = useState<LeaderScope>("career");

  // Every board at once, from one walk over the world's careers — the grid
  // shows all fourteen, and asking for them one at a time would rebuild the
  // career list fourteen times over. The full board a card opens into is a
  // slice of the same result, so the two can't disagree.
  const boards = useMemo(
    () => (league ? allTimeLeaderBoards(league, scope) : null),
    [league, scope],
  );
  if (!league || !boards) return null;

  return (
    <>
      <p className="text-secondary small">
        Every club in the world at once, not one league at a time, because a career crosses
        divisions and countries. Retired players are included where the game kept a record
        of them.
      </p>

      <div className="mb-3 d-flex gap-2 flex-wrap align-items-center">
        <select
          className="form-select form-select-sm"
          style={{ width: "auto" }}
          value={scope}
          onChange={(e) => setScope(e.target.value as LeaderScope)}
          aria-label="Career or single season"
        >
          <option value="career">Career</option>
          <option value="single">Single season</option>
        </select>
        {open === null && (
          <span className="text-muted small">
            Top {ALL_TIME_OVERVIEW_LIMIT} in each. Click a category for the top{" "}
            {ALL_TIME_LEADER_LIMIT}. Anyone who has played for you is highlighted.
          </span>
        )}
      </div>

      {open !== null ? (
        <LeaderBoard
          stat={open}
          scope={scope}
          rows={boards[open]}
          userTid={league.meta.userTid}
          onBack={() => setOpen(null)}
        />
      ) : (
        <CardGrid>
          {ALL_TIME_STAT_KEYS.map((k) => (
            <div key={k} className="col-12 col-lg-6 col-xxl-4">
              <BoardCard
                title={STAT_LABELS[k]}
                empty="recorded seasons"
                rows={boards[k].slice(0, ALL_TIME_OVERVIEW_LIMIT).map((r) => ({
                  pid: r.career.pid,
                  name: r.career.name,
                  nationality: r.career.nationality,
                  tid: r.career.tid,
                  value: formatStat(k, r.value),
                  note: scope === "single" ? String(seasonYear(r.season ?? 0)) : undefined,
                  highlight: isUserPlayer(r.career, league.meta.userTid),
                }))}
                onOpen={() => setOpen(k)}
              />
            </div>
          ))}
        </CardGrid>
      )}
    </>
  );
}

// --- International ---------------------------------------------------------

const INTL_STAT_LABELS: Record<IntlAllTimeKey, string> = {
  intlGoals: "Goals",
  caps: "Caps",
  intlTitles: "World Cups",
};

/**
 * What an empty board is missing, per stat.
 *
 * Stat-specific on purpose: before the first World Cup there are plenty of
 * capped players but no winners, so a shared "no capped players yet" would be
 * simply untrue on that board.
 */
const INTL_EMPTY_LABELS: Record<IntlAllTimeKey, string> = {
  intlGoals: "international goals",
  caps: "capped players",
  intlTitles: "World Cup winners",
};

/** One international counter's full board, the view a grid card opens into. */
function IntlBoard({ intlKey, country, rows, userTid, onBack }: {
  intlKey: IntlAllTimeKey;
  country: string;
  rows: CareerRow[];
  userTid: number;
  onBack: () => void;
}) {
  return (
    <>
      <BackToGrid onBack={onBack} />
      <Panel title={country
        ? `${country}: all-time ${INTL_STAT_LABELS[intlKey]}`
        : `All-time ${INTL_STAT_LABELS[intlKey]}`}
      >
        <RankTable
          rows={rows}
          headers={["Player", "Club", "Caps", "Goals", "World Cups"]}
          render={(r: CareerRow) => [
            <PlayerCell pid={r.pid} name={r.name} nationality={r.nationality} active={r.active} />,
            <ClubCell tid={r.tid} />,
            // The ranked column reads bold, so it's obvious which one the order follows.
            <span className={intlKey === "caps" ? "fw-bold" : undefined}>{r.caps}</span>,
            <span className={intlKey === "intlGoals" ? "fw-bold" : undefined}>{r.intlGoals}</span>,
            <span className={intlKey === "intlTitles" ? "fw-bold" : undefined}>
              {r.intlTitles || <span className="text-muted">&ndash;</span>}
            </span>,
          ]}
          empty={INTL_EMPTY_LABELS[intlKey]}
          highlight={(r) => isUserPlayer(r, userTid)}
        />
      </Panel>
    </>
  );
}

export function InternationalTab() {
  const { league } = useLeague();
  const [open, setOpen] = useState<IntlAllTimeKey | null>(null);
  const [country, setCountry] = useState("");

  const countries = useMemo(() => (league ? cappedNationalities(league) : []), [league]);
  // All three counters from one walk over the careers, and one application of
  // the country filter, for the same reason the leaders grid does it.
  const boards = useMemo(
    () => (league ? allTimeInternationalBoards(league, country || null) : null),
    [league, country],
  );
  if (!league || !boards) return null;

  return (
    <>
      <p className="text-secondary small">
        National-team records for every player the save still knows about, retired ones included.
        A country's all-time top scorer is almost always someone who has already hung up his
        boots, so this is the one board that would be close to meaningless without them. Caps and
        goals cover a whole international career, qualifying and World Cups together, exactly as
        they read on a player's profile.
      </p>

      <div className="mb-3 d-flex gap-2 flex-wrap align-items-center">
        <select
          className="form-select form-select-sm"
          style={{ width: "auto" }}
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          aria-label="Country"
        >
          <option value="">Every country</option>
          {countries.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        {open === null && (
          <span className="text-muted small">
            Top {INTL_OVERVIEW_LIMIT} in each. Click a category for the top {INTL_ALL_TIME_LIMIT}.
            {" "}Anyone who has played for you is highlighted.
          </span>
        )}
      </div>

      {open !== null ? (
        <IntlBoard
          intlKey={open}
          country={country}
          rows={boards[open]}
          userTid={league.meta.userTid}
          onBack={() => setOpen(null)}
        />
      ) : (
        <CardGrid>
          {INTL_ALL_TIME_KEYS.map((k) => (
            <div key={k} className="col-12 col-lg-6 col-xxl-4">
              <BoardCard
                title={INTL_STAT_LABELS[k]}
                empty={INTL_EMPTY_LABELS[k]}
                rows={boards[k].slice(0, INTL_OVERVIEW_LIMIT).map((r) => ({
                  pid: r.pid,
                  name: r.name,
                  nationality: r.nationality,
                  tid: r.tid,
                  value: String(intlStatOf(r, k)),
                  highlight: isUserPlayer(r, league.meta.userTid),
                }))}
                onOpen={() => setOpen(k)}
              />
            </div>
          ))}
        </CardGrid>
      )}
    </>
  );
}

// --- Player bios -----------------------------------------------------------

function bioCells(b: BioRow, value: ReactNode): ReactNode[] {
  return [
    <PlayerCell pid={b.pid} name={b.name} nationality={b.nationality} />,
    <ClubCell tid={b.tid} />,
    b.pos,
    value,
  ];
}

function BiosTab() {
  const { league } = useLeague();
  const bios = useMemo(() => (league ? computePlayerBios(league) : null), [league]);
  if (!league || !bios) return null;

  const headers = (last: string) => ["Player", "Club", "Pos", last];

  return (
    <>
      <Row>
        <Col>
          <Panel title="Oldest">
            <RankTable rows={bios.oldest} headers={headers("Age")}
              render={(b) => bioCells(b, b.age)} empty="players" />
          </Panel>
        </Col>
        <Col>
          <Panel title="Youngest">
            <RankTable rows={bios.youngest} headers={headers("Age")}
              render={(b) => bioCells(b, b.age)} empty="players" />
          </Panel>
        </Col>
      </Row>

      <Row>
        <Col wide>
          <Panel
            title="Where everyone comes from"
            note="Every country with a player in the world right now, biggest contingent first."
          >
            <RankTable
              rows={bios.nationalities}
              headers={["Country", "Players", "On a roster", "Avg rating", "Best player"]}
              render={(n: NationalityRow) => [
                <span className="d-inline-flex align-items-center gap-1">
                  <Flag nationality={n.nationality} tip={false} />
                  {n.nationality}
                </span>,
                n.count,
                n.rostered,
                n.avgOvr.toFixed(1),
                n.best
                  ? <PlayerCell pid={n.best.pid} name={n.best.name} nationality={n.best.nationality} />
                  : <span className="text-muted">None</span>,
              ]}
              empty="players"
            />
          </Panel>
        </Col>
      </Row>

      <Row>
        <Col>
          <Panel title="One-club men" note="Players who have only ever played for one club.">
            <RankTable
              rows={bios.oneClubMen}
              headers={["Player", "Club", "Seasons", "Apps"]}
              render={(m: OneClubMan) => [
                <PlayerCell pid={m.career.pid} name={m.career.name}
                  nationality={m.career.nationality} active={m.career.active} />,
                <ClubCell tid={m.tid} />,
                m.career.seasonsPlayed,
                m.career.totals.appearances,
              ]}
              empty="careers"
            />
          </Panel>
        </Col>
      </Row>

      <Row>
        <Col>
          <Panel title="Longest names">
            <RankTable rows={bios.longestNames} headers={headers("Letters")}
              render={(b) => bioCells(b, b.name.length)} empty="players" />
          </Panel>
        </Col>
        <Col>
          <Panel title="Most common names" note="Names shared by more than one player right now.">
            <div className="row g-3">
              <div className="col-6">
                <div className="text-muted small mb-1">First names</div>
                <RankTable rows={bios.commonFirstNames} headers={["Name", "Players"]}
                  render={(n: NameCount) => [n.name, n.count]} empty="repeated first names" />
              </div>
              <div className="col-6">
                <div className="text-muted small mb-1">Surnames</div>
                <RankTable rows={bios.commonSurnames} headers={["Name", "Players"]}
                  render={(n: NameCount) => [n.name, n.count]} empty="repeated surnames" />
              </div>
            </div>
          </Panel>
        </Col>
      </Row>
    </>
  );
}

// --- Club trivia -----------------------------------------------------------

function ClubsTab() {
  const { league } = useLeague();
  const trivia = useMemo(() => (league ? computeClubTrivia(league) : null), [league]);
  if (!league || !trivia) return null;

  if (trivia.seasonsRecorded === 0) {
    return (
      <div className="alert alert-secondary small mb-0">
        Nothing here until you've finished a season. Come back once there's some history to pick over.
      </div>
    );
  }

  return (
    <>
      <p className="text-secondary small">
        Drawn from the {trivia.seasonsRecorded} season{trivia.seasonsRecorded === 1 ? "" : "s"} this
        save has on record.
      </p>

      <Row>
        <Col wide>
          <Panel
            title="Trophy cabinet"
            note="A treble is the top flight, the Continental Cup and the domestic cup in one season. Those three wins are already in the total, so a treble doesn't add to it."
          >
            <RankTable
              rows={trivia.records}
              headers={[
                "Club", "Total Trophies", "D1 Championships", "Continental Cups",
                "Continental Shields", "Domestic Cups", "Trebles",
                "D2 Championships", "Seasons", "Top flight",
              ]}
              render={(r: ClubRecordRow) => [
                <ClubCell tid={r.tid} />,
                <strong>{r.totalTrophies}</strong>,
                r.leagueTitles,
                r.cupTitles,
                r.shieldTitles,
                r.domesticCupTitles,
                r.trebles,
                r.secondTierTitles,
                r.seasons,
                r.topFlightSeasons,
              ]}
              empty="completed seasons"
            />
          </Panel>
        </Col>
      </Row>

      <Row>
        <Col>
          <Panel
            title="Longest wait for a title"
            note="Seasons since a club last won its top flight. A club that's never won counts its whole history."
          >
            <RankTable
              rows={trivia.droughts}
              headers={["Club", "Waiting", "Last won"]}
              render={(r: ClubRecordRow) => [
                <ClubCell tid={r.tid} />,
                `${r.titleDrought} season${r.titleDrought === 1 ? "" : "s"}`,
                r.lastTitleSeason == null
                  ? <span className="text-muted">Never</span>
                  : seasonYear(r.lastTitleSeason),
              ]}
              empty="completed seasons"
            />
          </Panel>
        </Col>
      </Row>

      <Row>
        <Col>
          <Panel title="Biggest spenders" note="All-time gross transfer spend.">
            <RankTable
              rows={trivia.biggestSpenders}
              headers={["Club", "Signings", "Spent"]}
              render={(s: ClubSpendRow) => [
                <ClubCell tid={s.tid} />,
                s.signings,
                currency.format(s.spent),
              ]}
              empty="transfers"
            />
          </Panel>
        </Col>
        <Col>
          <Panel title="Best traders" note="Fees received minus fees paid, across the whole save.">
            <RankTable
              rows={trivia.biggestSellers}
              headers={["Club", "Sales", "Net"]}
              render={(s: ClubSpendRow) => [
                <ClubCell tid={s.tid} />,
                s.sales,
                <span className={s.net >= 0 ? "text-success" : "text-danger"}>
                  {currency.format(s.net)}
                </span>,
              ]}
              empty="transfers"
            />
          </Panel>
        </Col>
      </Row>
    </>
  );
}

// --- Page ------------------------------------------------------------------

export function Frivolities() {
  const { league } = useLeague();
  const [tab, setTab] = useState<Tab>("goat");
  if (!league) return null;

  return (
    <div>
      <h1 className="h4 mb-3">Frivolities</h1>

      <ul className="nav nav-tabs mb-3">
        {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
          <li key={t} className="nav-item">
            <button
              className={`nav-link ${tab === t ? "active" : ""}`}
              onClick={() => setTab(t)}
            >
              {TAB_LABELS[t]}
            </button>
          </li>
        ))}
      </ul>

      {tab === "goat" && <GoatTab />}
      {tab === "awards" && <AwardsTab />}
      {tab === "records" && <RecordsTab />}
      {tab === "leaders" && <LeadersTab />}
      {tab === "international" && <InternationalTab />}
      {tab === "bios" && <BiosTab />}
      {tab === "clubs" && <ClubsTab />}
    </div>
  );
}
