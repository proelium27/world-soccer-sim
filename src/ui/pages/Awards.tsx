import { useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useLeague } from "../context/LeagueContext.js";
import { ClubLink } from "../components/ClubLink.js";
import { usePlayerMap } from "../usePlayerMap.js";
import { HelpHint } from "../components/HelpHint.js";
import type { WorldAwardEntry } from "../../core/worldAwards.js";
import type { AwardWinner } from "../../core/awardWinners.js";
import type { Player, Position, SeasonStats } from "../../core/players/types.js";
import type { LeagueStore } from "../../core/leagueState.js";
import { farewellIndex } from "../../core/players/retirements.js";
import { playerNameIndex } from "../../core/players/playerNames.js";
import { TOTS_SLOTS } from "../../core/awards.js";
import { TOTS_LAYOUT } from "../pitchLayout.js";
import { getRatingColor } from "../utils/ratingColor.js";
import { PlayerRatingsTooltip } from "../components/PlayerRatingsTooltip.js";
import { Flag } from "../components/Flag.js";
import { GoldenBootIcon } from "../components/GoldenBootIcon.js";
import { CompetitionSelect } from "../components/CompetitionSelect.js";
import { seasonYear } from "../format.js";
import { shortName } from "../playerName.js";

const SLOTS = TOTS_SLOTS;
const COORDS = TOTS_LAYOUT;

/**
 * A winner as this page needs him — live or long retired.
 *
 * An honours board is the surface a retirement hurts most: these entries are
 * keyed by pid and never change, but the player behind them is deleted from the
 * pool a few seasons later, which used to blank the card out entirely. The
 * archive carries his name, position and the rating he played that season, so
 * the board keeps reading the same. `player` is present only while he's still
 * around, and gates the things only a live record can answer (the attribute
 * tooltip, that season's stat line).
 */
interface AwardSubject {
  pid: number;
  name: string;
  nationality: string;
  pos: Position;
  /**
   * The rating he carried that season, when a source knows it.
   *
   * Undefined for a winner recovered from a farewell list: that row records the
   * season he *retired* in, which for an award won a decade earlier is a
   * different number entirely. Showing it would be a confident wrong answer, so
   * the chip shows no rating instead.
   */
  ovr: number | undefined;
  /** The club he was at that season, if it's on record. */
  tid: number | undefined;
  player: Player | undefined;
  /**
   * Whether there's a profile page behind the name.
   *
   * False for a winner known only from the award itself — the save kept his
   * name and nothing else, so the chip reads the same but doesn't offer a link
   * into a page that would say "player not found".
   */
  linkable: boolean;
}

/**
 * Resolves an award's pid: the live pool first, then the retiree archive, then
 * the winners' names stored on the season itself.
 *
 * That last tier is what a long save actually runs on. The first two both need
 * the player to still exist somewhere, and most award winners eventually don't.
 */
function subjectResolver(
  league: LeagueStore,
  playersByPid: Map<number, Player>,
  season: number,
  winners: AwardWinner[] | undefined,
): (pid: number) => AwardSubject | undefined {
  const winnerByPid = new Map((winners ?? []).map((w) => [w.pid, w]));
  const named = playerNameIndex(league.playerNames);
  const farewell = farewellIndex(league.seasonHistory);
  return (pid) => {
    const player = playersByPid.get(pid);
    if (player) {
      return {
        pid,
        name: player.name,
        nationality: player.nationality,
        pos: player.pos,
        // Present-day ovr, which is what these chips have always shown for a
        // living player. A retiree has no present day, so his archived record
        // supplies the rating he played that season at instead.
        ovr: player.ovr,
        tid: player.stats.find((s) => s.season === season)?.tid,
        player,
        linkable: true,
      };
    }
    const archived = (league.retiredPlayers ?? []).find((a) => a.pid === pid);
    if (!archived) {
      // Neither in the pool nor in the archive: he retired years ago and his
      // career wasn't big enough to keep. The award itself carries his name,
      // which is the whole reason it does — without this the card claimed
      // nobody had qualified for an award that was very much handed out.
      const w = winnerByPid.get(pid);
      if (!w) {
        // Older than the award snapshots themselves: a save written before
        // `awardWinners` existed has pids going back to season 1 with no names
        // for any of them, and migration can only name the ones still in the
        // pool or the archive. The name table and the farewell lists each reach
        // a few more. Neither knows what he was rated *that* season, so both
        // leave `ovr` undefined rather than quoting a different season's figure
        // (see AwardSubject.ovr).
        const n = named.get(pid) ?? farewell.get(pid);
        if (!n) return undefined;
        return {
          pid,
          name: n.name,
          nationality: n.nationality,
          pos: n.pos,
          ovr: undefined,
          tid: undefined,
          player: undefined,
          linkable: false,
        };
      }
      return {
        pid,
        name: w.name,
        nationality: w.nationality,
        pos: w.pos,
        ovr: w.ovr,
        tid: w.tid,
        player: undefined,
        linkable: false,
      };
    }
    const line = archived.seasons.find((s) => s.season === season);
    return {
      pid,
      name: archived.name,
      nationality: archived.nationality,
      pos: archived.pos,
      ovr: line?.ovr ?? archived.finalOvr,
      tid: line?.tid,
      player: undefined,
      linkable: true,
    };
  };
}

/**
 * A winner's name, linked to his profile when there is one to link to.
 *
 * A player the save only knows from the award itself has no profile page — not
 * in the pool, not in the retiree archive — so his name renders plainly rather
 * than as a link into "player not found".
 */
function SubjectName({ subject, className }: { subject: AwardSubject; className?: string }) {
  if (!subject.linkable) return <span className={className}>{subject.name}</span>;
  return <Link to={`/player/${subject.pid}`} className={className}>{subject.name}</Link>;
}

function AwardCard({ title, subject, subtitle }: { title: ReactNode; subject: AwardSubject | undefined; subtitle: ReactNode }) {
  return (
    <div className="card h-100">
      <div className="card-body">
        <h6 className="card-title text-muted text-uppercase small d-flex align-items-center gap-1">{title}</h6>
        {subject ? (
          <>
            <div className="d-flex align-items-center gap-2 fs-5 fw-semibold">
              <Flag nationality={subject.nationality} />
              <SubjectName subject={subject} />
            </div>
            <div className="text-muted small mt-1">{subtitle}</div>
          </>
        ) : (
          <p className="text-muted mb-0">Not enough qualifying players.</p>
        )}
      </div>
    </div>
  );
}

function TeamOfSeasonField({
  pids,
  subjectOf,
  userTid,
}: {
  pids: (number | null)[];
  subjectOf: (pid: number) => AwardSubject | undefined;
  userTid: number | undefined;
}) {
  return (
    <div className="pitch-field">
      <div className="pitch-goal pitch-goal--left" />
      <div className="pitch-goal pitch-goal--right" />
      {SLOTS.map((_, i) => {
        const pid = pids[i] ?? null;
        const subject = pid !== null ? subjectOf(pid) : undefined;
        const coord = COORDS[i];
        const isUserPlayer =
          subject !== undefined && userTid !== undefined && subject.tid === userTid;
        // The attribute tooltip needs live ratings, which a retiree doesn't
        // keep — his chip is the same chip without the hover.
        const chip = subject && (
          <span
            className={
              "pitch-chip" +
              (subject.pos === "GK" ? " pitch-chip--gk" : "") +
              (isUserPlayer ? " pitch-chip--user" : "")
            }
            style={subject.ovr !== undefined ? { borderColor: getRatingColor(subject.ovr) } : undefined}
          >
            <SubjectName
              subject={{ ...subject, name: shortName(subject.name) }}
              className="pitch-chip-name"
            />
            {/* No rating rather than a wrong one — see AwardSubject.ovr. */}
            <span className="pitch-chip-ovr">{subject.ovr ?? "–"}</span>
          </span>
        );
        return (
          <div
            key={i}
            className="pitch-slot"
            style={{ left: `${coord.x}%`, top: `${coord.y}%` }}
          >
            {subject ? (
              subject.player ? (
                <PlayerRatingsTooltip player={subject.player}>{chip}</PlayerRatingsTooltip>
              ) : (
                chip
              )
            ) : (
              <span className="pitch-chip" style={{ opacity: 0.4, cursor: "default" }}>—</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The three season stats a shortlist shows beside the score.
 *
 * They differ by award because the awards are decided on different numbers:
 * printing goals and assists next to a Goalkeeper of the Year would suggest the
 * thing he was judged on, and it isn't. Each set is the end product the award's
 * own formula actually weighs.
 */
interface StatColumn {
  label: string;
  value: (s: SeasonStats) => string | number;
}

const RATING_COLUMN: StatColumn = { label: "Rating", value: (s) => s.avgRating.toFixed(2) };

/** The Ballon d'Or's columns: `potyScore` is goals, assists and rating. */
const OUTFIELD_COLUMNS: StatColumn[] = [
  { label: "G", value: (s) => s.goals },
  { label: "A", value: (s) => s.assists },
  RATING_COLUMN,
];

/** `totsScore` pays a keeper for saves and charges him for goals conceded. */
const KEEPER_COLUMNS: StatColumn[] = [
  { label: "Saves", value: (s) => s.saves },
  { label: "Conceded", value: (s) => s.goalsAgainst },
  RATING_COLUMN,
];

/** And pays a defender for tackles and interceptions. */
const DEFENDER_COLUMNS: StatColumn[] = [
  { label: "Tackles", value: (s) => s.tackles },
  { label: "Int", value: (s) => s.interceptions },
  RATING_COLUMN,
];

/**
 * A worldwide award's shortlist: the winner and the players behind him, with
 * the score broken into the parts that made it up — so a win off the back of a
 * cup run or a World Cup reads differently from a pure league season.
 *
 * Shared by all three worldwide awards, which differ here only in which season
 * stats are worth showing.
 */
function WorldAwardTable({
  entries,
  subjectOf,
  leagueName,
  season,
  columns = OUTFIELD_COLUMNS,
}: {
  entries: WorldAwardEntry[];
  subjectOf: (pid: number) => AwardSubject | undefined;
  leagueName: (tid: number) => string;
  season: number;
  columns?: StatColumn[];
}) {
  return (
    <div className="table-responsive">
      <table className="table table-sm table-hover align-middle">
        <thead>
          <tr>
            <th style={{ width: "2.5rem" }}>#</th>
            <th>Player</th>
            <th>Club</th>
            <th className="d-none d-md-table-cell">League</th>
            {columns.map((c) => <th key={c.label} className="text-end">{c.label}</th>)}
            <th className="text-end">Points</th>
            {/* The same total, split into where it came from. */}
            <th className="text-end d-none d-lg-table-cell">From league</th>
            <th className="text-end d-none d-lg-table-cell">From cups</th>
            <th className="text-end d-none d-lg-table-cell">From country</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e, i) => {
            const subject = subjectOf(e.pid);
            // Only a live player keeps the season's own stat line; a retiree's
            // per-season rows are dropped when he's archived, so those columns
            // fall back to the same "—" an un-migrated old save shows.
            const stats = subject?.player?.stats.find((s) => s.season === season);
            return (
              <tr key={e.pid}>
                <td className="text-muted">{i + 1}</td>
                <td>
                  <span className="d-inline-flex align-items-center gap-2">
                    {subject && <Flag nationality={subject.nationality} />}
                    {subject
                      ? <SubjectName subject={subject} />
                      : <Link to={`/player/${e.pid}`}>{`#${e.pid}`}</Link>}
                  </span>
                </td>
                <td><ClubLink tid={e.tid} season={season} /></td>
                <td className="d-none d-md-table-cell text-muted">{leagueName(e.tid)}</td>
                {columns.map((c) => (
                  <td key={c.label} className="text-end">{stats ? c.value(stats) : "—"}</td>
                ))}
                <td className="text-end fw-semibold">{e.score.toFixed(2)}</td>
                <td className="text-end d-none d-lg-table-cell text-muted">{(e.league + e.title).toFixed(2)}</td>
                <td className="text-end d-none d-lg-table-cell text-muted">{(e.cup + (e.domesticCup ?? 0)).toFixed(2)}</td>
                <td className="text-end d-none d-lg-table-cell text-muted">{e.intl.toFixed(2)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One of the two position awards: its winner and the rest of his shortlist.
 *
 * Renders nothing at all when the season has no such award, rather than an
 * empty panel saying so — every season already played on an existing save is in
 * exactly that position, and a permanent "no winner" block on all of them would
 * read as something being broken.
 */
function PositionAward({
  title,
  blurb,
  entries,
  columns,
  subjectOf,
  leagueName,
  season,
  statLine,
}: {
  title: string;
  blurb: string;
  entries: WorldAwardEntry[];
  columns: StatColumn[];
  subjectOf: (pid: number) => AwardSubject | undefined;
  leagueName: (tid: number) => string;
  season: number;
  statLine: (s: SeasonStats) => string;
}) {
  if (entries.length === 0) return null;
  const winner = entries[0];
  const subject = subjectOf(winner.pid);
  const stats = subject?.player?.stats.find((s) => s.season === season);
  return (
    <>
      <h5 className="mt-4">
        {title}
        <HelpHint>{blurb}</HelpHint>
      </h5>
      <div className="row g-3">
        <div className="col-lg-4">
          <AwardCard
            title={title}
            subject={subject}
            subtitle={
              <>
                <ClubLink tid={winner.tid} season={season} />
                {stats ? ` · ${statLine(stats)} · ${stats.avgRating.toFixed(2)} avg rating` : ""}
              </>
            }
          />
        </div>
        <div className="col-lg-8">
          <WorldAwardTable
            entries={entries}
            subjectOf={subjectOf}
            leagueName={leagueName}
            season={season}
            columns={columns}
          />
        </div>
      </div>
    </>
  );
}

export function Awards() {
  const { league } = useLeague();
  const playersByPid = usePlayerMap(league?.players);
  const [season, setSeason] = useState<number | null>(null);
  const [scope, setScope] = useState<"world" | "league">("world");
  const [compIdOverride, setCompIdOverride] = useState<number | null>(null);

  if (!league) {
    return <p className="p-3">Loading...</p>;
  }

  if (league.seasonHistory.length === 0) {
    return (
      <div className="container-fluid p-3">
        <h4>Awards</h4>
        <p>No season's been completed yet. Awards show up once you advance past your first season.</p>
      </div>
    );
  }

  const userTeam = league.teams.find((t) => t.tid === league.meta.userTid);
  const compId = compIdOverride ?? userTeam?.compId ?? league.competitions[0].id;

  const seasonOptions = [...league.seasonHistory.map((h) => h.season)].sort((a, b) => b - a);
  const activeSeason = season ?? seasonOptions[0];
  const entry = league.seasonHistory.find((h) => h.season === activeSeason)!;

  // Winners resolve through the retiree archive and the season's own record of
  // who won, as well as the live pool, so an old season's honours board doesn't
  // empty out as its winners retire and are eventually deleted.
  const subjectOf = subjectResolver(league, playersByPid, activeSeason, entry.awardWinners);

  const divisionAwards = entry.awards[compId];
  const potd = divisionAwards.playerOfSeasonPid !== null ? subjectOf(divisionAwards.playerOfSeasonPid) : undefined;
  const goldenBoot = divisionAwards.goldenBootPid !== null ? subjectOf(divisionAwards.goldenBootPid) : undefined;

  const potdStats = potd?.player?.stats.find((s) => s.season === activeSeason);
  const goldenBootStats = goldenBoot?.player?.stats.find((s) => s.season === activeSeason);

  // Clubs are looked up by the competition they were in *that* season, so a
  // since-relegated or since-promoted club is still labelled with the league it
  // actually won its votes in.
  const leagueName = (tid: number) => {
    const cid = entry.compsByTid[tid];
    return cid === undefined ? "" : league.competitions.find((c) => c.id === cid)?.name ?? "";
  };

  // Falls back to empty rather than throwing on a season-history entry written
  // before worldwide awards existed and not yet migrated.
  const world = entry.world ?? { ballonDOr: [], worldTeamOfYear: [] };
  const winner = world.ballonDOr[0];
  const winnerSubject = winner ? subjectOf(winner.pid) : undefined;
  const winnerStats = winnerSubject?.player?.stats.find((s) => s.season === activeSeason);
  // Both empty on a season played before these awards existed, which is every
  // season already on an existing save — they are never backfilled, so those
  // seasons show the Ballon d'Or and the World XI alone (see WorldAwards).
  const bestKeepers = world.goalkeeperOfYear ?? [];
  const bestDefenders = world.defenderOfYear ?? [];

  return (
    <div className="container-fluid p-3">
      <h4>
        Awards
        <HelpHint>
          End-of-season honours. The world awards judge every league at once — the Ballon d'Or for
          the best player alive, a Goalkeeper and a Defender of the Year, and a World Team of the
          Year — while the league awards pick a Player of the Season, a Golden Boot and a Team of
          the Season inside one competition. Use the dropdown to look back at past seasons.
        </HelpHint>
      </h4>
      <div className="mb-3 d-flex gap-2 align-items-center flex-wrap">
        <div className="btn-group" role="group">
          <button
            type="button"
            className={`btn btn-sm ${scope === "world" ? "btn-primary" : "btn-outline-primary"}`}
            onClick={() => setScope("world")}
          >
            World
          </button>
          <button
            type="button"
            className={`btn btn-sm ${scope === "league" ? "btn-primary" : "btn-outline-primary"}`}
            onClick={() => setScope("league")}
          >
            By league
          </button>
        </div>
        <select
          className="form-select form-select-sm"
          style={{ width: "auto", display: "inline-block" }}
          value={activeSeason}
          onChange={(e) => setSeason(Number(e.target.value))}
        >
          {seasonOptions.map((s) => (
            <option key={s} value={s}>{seasonYear(s)}</option>
          ))}
        </select>
        {scope === "league" && (
          <CompetitionSelect
            competitions={league.competitions}
            value={compId}
            onChange={(v) => setCompIdOverride(v === "all" ? null : v)}
          />
        )}
      </div>

      {scope === "world" ? (
        world.ballonDOr.length === 0 ? (
          <p className="text-muted">
            No worldwide awards for this season. Saves from before they existed can only reconstruct
            them for seasons whose players are still around.
          </p>
        ) : (
          <>
            <div className="row g-3 mb-4">
              <div className="col-md-6">
                <AwardCard
                  title="Ballon d'Or"
                  subject={winnerSubject}
                  subtitle={
                    <>
                      <ClubLink tid={winner.tid} season={entry.season} />
                      {winnerStats
                        ? ` · ${winnerStats.goals}G ${winnerStats.assists}A · ${winnerStats.avgRating.toFixed(2)} avg rating`
                        : ""}
                    </>
                  }
                />
              </div>
              <div className="col-md-6">
                <div className="card h-100">
                  <div className="card-body">
                    <h6 className="card-title text-muted text-uppercase small">How he won it</h6>
                    <div className="small">
                      <div className="d-flex justify-content-between">
                        <span>League season{winner.title > 0 ? " (incl. title)" : ""}</span>
                        <span className="fw-semibold">{(winner.league + winner.title).toFixed(2)}</span>
                      </div>
                      {(winner.domesticCup ?? 0) > 0 && (
                        <div className="d-flex justify-content-between">
                          <span>Domestic cup</span>
                          <span className="fw-semibold">{(winner.domesticCup ?? 0).toFixed(2)}</span>
                        </div>
                      )}
                      <div className="d-flex justify-content-between">
                        <span>Continental Cup</span>
                        <span className="fw-semibold">{winner.cup.toFixed(2)}</span>
                      </div>
                      <div className="d-flex justify-content-between">
                        <span>International</span>
                        <span className="fw-semibold">{winner.intl.toFixed(2)}</span>
                      </div>
                      <hr className="my-2" />
                      <div className="d-flex justify-content-between">
                        <span>Total</span>
                        <span className="fw-semibold">{winner.score.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <h5>
              Ballon d'Or shortlist
              <HelpHint>
                Every league is scored on one scale, so a big season in a weaker league doesn't
                outrank a big season in a strong one just because its opponents were easier. Cup and
                international football count too — they're the only places players from different
                leagues actually meet.
              </HelpHint>
            </h5>
            <WorldAwardTable
              entries={world.ballonDOr}
              subjectOf={subjectOf}
              leagueName={leagueName}
              season={activeSeason}
            />

            <PositionAward
              title="Goalkeeper of the Year"
              blurb="The Ballon d'Or is scored on goals, assists and rating, so no goalkeeper has ever come close to winning one. This is the award that is actually his: same worldwide scale, but judged on the things a keeper does — saves, goals kept out, and how he rated week to week."
              entries={bestKeepers}
              columns={KEEPER_COLUMNS}
              subjectOf={subjectOf}
              leagueName={leagueName}
              season={activeSeason}
              statLine={(st) => `${st.saves} saves · ${st.goalsAgainst} conceded`}
            />

            <PositionAward
              title="Defender of the Year"
              blurb="Centre-backs and full-backs, judged on the work they actually do: tackles, interceptions, goals kept out and their rating, on the same worldwide scale as the Ballon d'Or."
              entries={bestDefenders}
              columns={DEFENDER_COLUMNS}
              subjectOf={subjectOf}
              leagueName={leagueName}
              season={activeSeason}
              statLine={(st) => `${st.tackles} tackles · ${st.interceptions} interceptions`}
            />

            <h5 className="mt-4">World Team of the Year</h5>
            <TeamOfSeasonField
              pids={world.worldTeamOfYear}
              subjectOf={subjectOf}
              userTid={league.meta.userTid}
            />
          </>
        )
      ) : (
      <>
      <div className="row g-3 mb-4">
        <div className="col-md-6">
          <AwardCard
            title="Player of the Season"
            subject={potd}
            subtitle={
              potdStats
                ? `${potdStats.goals}G ${potdStats.assists}A · ${potdStats.avgRating.toFixed(2)} avg rating`
                : ""
            }
          />
        </div>
        <div className="col-md-6">
          <AwardCard
            title={<><GoldenBootIcon /> Golden Boot</>}
            subject={goldenBoot}
            subtitle={goldenBootStats ? `${goldenBootStats.goals} goals in ${goldenBootStats.appearances} appearances` : ""}
          />
        </div>
      </div>

      <h5>Team of the Season</h5>
      <TeamOfSeasonField
        pids={divisionAwards.teamOfSeason}
        subjectOf={subjectOf}
        userTid={league.meta.userTid}
      />
      </>
      )}
    </div>
  );
}
