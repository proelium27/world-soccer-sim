import { useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useLeague } from "../context/LeagueContext.js";
import { ClubLink } from "../components/ClubLink.js";
import { usePlayerMap } from "../usePlayerMap.js";
import { HelpHint } from "../components/HelpHint.js";
import type { ContinentalAwards, WorldAwardEntry } from "../../core/worldAwards.js";
import { competitionRegion } from "../../core/competitions.js";
import type { AwardWinner } from "../../core/awardWinners.js";
import type { Player, Position, SeasonStats } from "../../core/players/types.js";
import type { LeagueStore } from "../../core/leagueState.js";
import { farewellIndex } from "../../core/players/retirements.js";
import { playerNameIndex } from "../../core/players/playerNames.js";
import { TOTS_SLOTS } from "../../core/awards.js";
import { TOTS_KEEPER_SAVE_PCT_BASELINE } from "../../core/constants.js";
import { TOTS_LAYOUT } from "../pitchLayout.js";
import { getRatingColor } from "../utils/ratingColor.js";
import { PlayerRatingsTooltip } from "../components/PlayerRatingsTooltip.js";
import { Flag } from "../components/Flag.js";
import { GoldenBootIcon } from "../components/GoldenBootIcon.js";
import { CompetitionSelect } from "../components/CompetitionSelect.js";
import { seasonYear } from "../format.js";
import { shortName } from "../playerName.js";
import { isCustomAwardFormula } from "../../core/awardFormula.js";

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
 * The season stats the Ballon d'Or shortlist shows beside the score: the end
 * product its formula actually weighs. The position awards name their own (see
 * PositionAwardKind).
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

/**
 * A worldwide award's shortlist: the winner and the players behind him, with
 * the score broken into the parts that made it up — so a win off the back of a
 * cup run or a World Cup reads differently from a pure league season.
 *
 * Used for the player-of-the-year shortlist. The position awards have their own
 * layout (PositionAward), built around the one stat each is decided on.
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
 * What a position award is actually decided on, beyond the parts every award
 * shares. Each kind names its own stats, because printing goals and assists
 * next to a Goalkeeper of the Year would suggest the thing he was judged on,
 * and it isn't.
 */
interface PositionAwardKind {
  /** What `breakdown.work` is called for this award. */
  workLabel: string;
  /** Four headline figures for the winner's strip. */
  strip: (s: SeasonStats) => { label: string; value: string; sub?: string }[];
  /** The one number the shortlist ranks the award's own work by. */
  keyStat: { label: string; value: (s: SeasonStats) => string };
  /** Keepers almost never score, so their breakdown leaves the row out. */
  showScoring: boolean;
}

const perGame = (n: number, s: SeasonStats) =>
  s.appearances > 0 ? (n / s.appearances).toFixed(1) : "—";

/** Save percentage as the award reads it: saves over shots on target faced. */
function savePct(s: SeasonStats): string {
  const faced = s.saves + s.goalsAgainst;
  return faced > 0 ? `${((s.saves / faced) * 100).toFixed(1)}%` : "—";
}

const KEEPER_KIND: PositionAwardKind = {
  workLabel: "Shot-stopping",
  strip: (s) => [
    {
      label: "Save %",
      value: savePct(s),
      sub: `${Math.round(TOTS_KEEPER_SAVE_PCT_BASELINE * 100)}% is an average keeper`,
    },
    { label: "Saves / game", value: perGame(s.saves, s), sub: `${s.saves} in ${s.appearances} games` },
    { label: "Conceded / game", value: perGame(s.goalsAgainst, s), sub: `${s.goalsAgainst} in total` },
    { label: "Avg rating", value: s.avgRating.toFixed(2) },
  ],
  keyStat: { label: "Save %", value: savePct },
  showScoring: false,
};

const DEFENDER_KIND: PositionAwardKind = {
  workLabel: "Defending",
  strip: (s) => [
    {
      label: "Tkl + Int / game",
      value: perGame(s.tackles + s.interceptions, s),
      sub: `${s.appearances} games`,
    },
    { label: "Tackles", value: String(s.tackles), sub: `${perGame(s.tackles, s)} a game` },
    { label: "Interceptions", value: String(s.interceptions), sub: `${perGame(s.interceptions, s)} a game` },
    { label: "Avg rating", value: s.avgRating.toFixed(2), sub: `${s.goals}G ${s.assists}A` },
  ],
  keyStat: { label: "Tkl+Int / g", value: (s) => perGame(s.tackles + s.interceptions, s) },
  showScoring: true,
};

/**
 * The rows of a "how he won it" table. With a stored breakdown the league
 * season is split into what the award actually weighs; an entry written before
 * breakdowns existed only knows the coarse split, and says so by having fewer rows.
 */
function awardParts(
  e: WorldAwardEntry,
  kind: PositionAwardKind,
  cupLabel: string,
): { label: string; value: number }[] {
  const rows: { label: string; value: number }[] = [];
  if (e.breakdown) {
    rows.push({ label: "Match rating", value: e.breakdown.rating });
    rows.push({ label: kind.workLabel, value: e.breakdown.work });
    if (kind.showScoring) rows.push({ label: "Goals and assists", value: e.breakdown.scoring });
    rows.push({ label: "Quality and league strength", value: e.breakdown.quality });
  } else {
    rows.push({ label: "League season", value: e.league });
  }
  rows.push({ label: "League title", value: e.title });
  rows.push({ label: `${cupLabel} and domestic cup`, value: e.cup + (e.domesticCup ?? 0) });
  rows.push({ label: "International", value: e.intl });
  return rows;
}

/** A signed difference, with the sign spelled out so it survives without colour. */
function signed(n: number): string {
  const r = Math.round(n * 100) / 100;
  if (r === 0) return "0.00";
  return `${r > 0 ? "+" : "−"}${Math.abs(r).toFixed(2)}`;
}

/**
 * One of the two position awards: who won, the numbers the award is decided
 * on, where his points came from next to the runner-up's, and the shortlist.
 *
 * The "vs 2nd" column is the point of the breakdown. Match rating and overall
 * quality are most of everybody's score, so a winner's own totals barely say
 * anything; the gap to the man behind him says what actually decided it.
 *
 * Renders nothing when the season has no such award, rather than an empty panel
 * saying so. Every season played before these awards existed is in exactly that
 * position, and a permanent "no winner" block on all of them would read as broken.
 */
function PositionAward({
  title,
  blurb,
  entries,
  kind,
  cupLabel,
  subjectOf,
  leagueName,
  season,
}: {
  title: string;
  blurb: string;
  entries: WorldAwardEntry[];
  kind: PositionAwardKind;
  cupLabel: string;
  subjectOf: (pid: number) => AwardSubject | undefined;
  leagueName: (tid: number) => string;
  season: number;
}) {
  if (entries.length === 0) return null;
  const winner = entries[0];
  const runnerUp = entries[1];
  const subject = subjectOf(winner.pid);
  const statsOf = (pid: number) =>
    subjectOf(pid)?.player?.stats.find((s) => s.season === season);
  const stats = statsOf(winner.pid);
  const parts = awardParts(winner, kind, cupLabel);
  const rivalParts = runnerUp ? awardParts(runnerUp, kind, cupLabel) : null;
  // Only compare like with like: an old entry and a new one split differently.
  const comparable = rivalParts !== null && rivalParts.length === parts.length;

  return (
    <div className="card h-100">
      <div className="card-body">
        <h5 className="mb-3 d-flex align-items-center">
          {title}
          <HelpHint>{blurb}</HelpHint>
        </h5>

        {subject ? (
          <div className="mb-3">
            <div className="d-flex align-items-center gap-2 fs-5 fw-semibold">
              <Flag nationality={subject.nationality} />
              <SubjectName subject={subject} />
              <span className="text-muted small fw-normal">{subject.pos}</span>
            </div>
            <div className="text-muted small mt-1">
              <ClubLink tid={winner.tid} season={season} />
              {leagueName(winner.tid) ? ` · ${leagueName(winner.tid)}` : ""}
            </div>
          </div>
        ) : (
          <p className="text-muted">Not enough qualifying players.</p>
        )}

        {stats && (
          <div className="award-strip">
            {kind.strip(stats).map((f) => (
              <div key={f.label} className="fin-stat">
                <div className="fin-stat-label">{f.label}</div>
                <div className="fin-stat-value">{f.value}</div>
                {f.sub && <div className="fin-stat-sub">{f.sub}</div>}
              </div>
            ))}
          </div>
        )}

        <h6 className="text-muted text-uppercase small mt-3">How he won it</h6>
        <table className="table table-sm award-parts mb-3">
          <thead>
            <tr>
              <th>Points from</th>
              <th className="text-end">Points</th>
              {comparable && <th className="text-end">vs 2nd</th>}
            </tr>
          </thead>
          <tbody>
            {parts.map((p, i) => {
              const diff = comparable ? p.value - rivalParts![i].value : 0;
              return (
                <tr key={p.label}>
                  <td>{p.label}</td>
                  <td className="text-end">{p.value.toFixed(2)}</td>
                  {comparable && (
                    <td
                      className={
                        "text-end " +
                        (Math.abs(diff) < 0.005 ? "text-muted" : diff > 0 ? "text-success" : "text-danger")
                      }
                    >
                      {signed(diff)}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th>Total</th>
              <th className="text-end">{winner.score.toFixed(2)}</th>
              {comparable && <th className="text-end">{signed(winner.score - runnerUp!.score)}</th>}
            </tr>
          </tfoot>
        </table>

        <h6 className="text-muted text-uppercase small">Shortlist</h6>
        <div className="table-responsive">
          <table className="table table-sm table-hover align-middle mb-0">
            <thead>
              <tr>
                <th style={{ width: "2rem" }}>#</th>
                <th>Player</th>
                <th className="d-none d-sm-table-cell">Club</th>
                <th className="text-end">{kind.keyStat.label}</th>
                <th className="text-end">Rtg</th>
                <th className="text-end">Pts</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => {
                const who = subjectOf(e.pid);
                const s = statsOf(e.pid);
                return (
                  <tr key={e.pid}>
                    <td className="text-muted">{i + 1}</td>
                    <td>
                      <span className="d-inline-flex align-items-center gap-2">
                        {who && <Flag nationality={who.nationality} />}
                        {who
                          ? <SubjectName subject={who} />
                          : <Link to={`/player/${e.pid}`}>{`#${e.pid}`}</Link>}
                      </span>
                    </td>
                    <td className="d-none d-sm-table-cell"><ClubLink tid={e.tid} season={season} /></td>
                    <td className="text-end">{s ? kind.keyStat.value(s) : "—"}</td>
                    <td className="text-end">{s ? s.avgRating.toFixed(2) : "—"}</td>
                    <td className="text-end fw-semibold">{e.score.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/**
 * The words for one set of cross-league honours. The world's set and the
 * Americas' own are laid out identically and read off the same stored shape, so
 * this is all that tells them apart on the page.
 */
interface HonoursLabels {
  playerAward: string;
  shortlist: string;
  shortlistHelp: string;
  cup: string;
  keeper: string;
  keeperBlurb: string;
  defender: string;
  defenderBlurb: string;
  team: string;
  empty: string;
}

const WORLD_LABELS: HonoursLabels = {
  playerAward: "Ballon d'Or",
  shortlist: "Ballon d'Or shortlist",
  shortlistHelp:
    "Every league is scored on one scale, so a big season in a weaker league doesn't outrank a big season in a strong one just because its opponents were easier. Cup and international football count too, because they're the only places players from different leagues actually meet. Anything done at a club in the Americas counts for a fraction of the same thing in Europe; those players have awards of their own.",
  cup: "Continental Cup",
  keeper: "Goalkeeper of the Year",
  keeperBlurb:
    "The Ballon d'Or is scored on goals and assists, so a keeper never gets near it. This one's his. It's the Team of the Season formula on the Ballon d'Or's worldwide scale: his match rating and overall, plus his save percentage against an average keeper's. The table under each winner shows where his points came from next to the runner-up's, so you can see what actually decided it. Trophies, cup runs and international football count exactly as much as they do for the Ballon d'Or.",
  defender: "Defender of the Year",
  defenderBlurb:
    "Centre-backs and full-backs, on the Ballon d'Or's worldwide scale. On top of their match rating, overall, goals and assists, they get credit for tackles and interceptions per game, so a defender isn't rewarded just for how much defending his club left him to do. Centre-backs get a bit more for it than full-backs. Trophies, cup runs and international football count the same as they do for the Ballon d'Or.",
  team: "World Team of the Year",
  empty:
    "No worldwide awards for this season. Saves from before they existed can only reconstruct them for seasons whose players are still around.",
};

const AMERICAS_LABELS: HonoursLabels = {
  playerAward: "Americas Player of the Year",
  shortlist: "Americas Player of the Year shortlist",
  shortlistHelp:
    "The Ballon d'Or's formula, run over the leagues of the Americas alone: every league there on one scale, with the Americas Cup and international football counting too.",
  cup: "Americas Cup",
  keeper: "Americas Goalkeeper of the Year",
  keeperBlurb:
    "The best keeper in the Americas: his match rating and overall, plus his save percentage against an average keeper's, with the Americas Cup, titles and international football on top.",
  defender: "Americas Defender of the Year",
  defenderBlurb:
    "Centre-backs and full-backs in the Americas: match rating, overall, goals and assists, plus tackles and interceptions per game, with the Americas Cup, titles and international football on top.",
  team: "Americas Team of the Year",
  empty: "No Americas awards for this season. They started with the first season the Americas' leagues finished after they were added.",
};

const NO_HONOURS: ContinentalAwards = { ballonDOr: [], worldTeamOfYear: [] };

export function Awards() {
  const { league } = useLeague();
  const playersByPid = usePlayerMap(league?.players);
  const [season, setSeason] = useState<number | null>(null);
  const [scope, setScope] = useState<"world" | "americas" | "league">("world");
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
  const world = entry.world ?? NO_HONOURS;
  // The Americas tab is offered wherever the world has a league there. The two
  // sets share one layout, so the page picks which set and which words to show
  // and everything below reads `shown`.
  const hasAmericas = league.competitions.some((c) => competitionRegion(c) === "americas");
  const shownScope = scope === "americas" && !hasAmericas ? "world" : scope;
  const shown: ContinentalAwards =
    shownScope === "americas" ? (entry.world?.americas ?? NO_HONOURS) : world;
  const labels = shownScope === "americas" ? AMERICAS_LABELS : WORLD_LABELS;
  const winner = shown.ballonDOr[0];
  const winnerSubject = winner ? subjectOf(winner.pid) : undefined;
  const winnerStats = winnerSubject?.player?.stats.find((s) => s.season === activeSeason);
  // Both empty on a season played before these awards existed, which is every
  // season already on an existing save — they are never backfilled, so those
  // seasons show the Ballon d'Or and the World XI alone (see WorldAwards).
  const bestKeepers = shown.goalkeeperOfYear ?? [];
  const bestDefenders = shown.defenderOfYear ?? [];

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
      {/* Shown whether or not God Mode is still on: the formula stays in force
          after the switch goes off, and winners that look odd should say why. */}
      {isCustomAwardFormula(league.awardFormula) && (
        <p className="text-muted small">
          This save uses award formulas edited in God Mode. Seasons finished before the change kept
          the winners they had.
        </p>
      )}
      <div className="mb-3 d-flex gap-2 align-items-center flex-wrap">
        <div className="btn-group" role="group">
          <button
            type="button"
            className={`btn btn-sm ${scope === "world" ? "btn-primary" : "btn-outline-primary"}`}
            onClick={() => setScope("world")}
          >
            World
          </button>
          {hasAmericas && (
            <button
              type="button"
              className={`btn btn-sm ${shownScope === "americas" ? "btn-primary" : "btn-outline-primary"}`}
              onClick={() => setScope("americas")}
            >
              Americas
            </button>
          )}
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

      {shownScope !== "league" ? (
        shown.ballonDOr.length === 0 ? (
          <p className="text-muted">{labels.empty}</p>
        ) : (
          <>
            <div className="row g-3 mb-4">
              <div className="col-md-6">
                <AwardCard
                  title={labels.playerAward}
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
                        <span>{labels.cup}</span>
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
              {labels.shortlist}
              <HelpHint>{labels.shortlistHelp}</HelpHint>
            </h5>
            <WorldAwardTable
              entries={shown.ballonDOr}
              subjectOf={subjectOf}
              leagueName={leagueName}
              season={activeSeason}
            />

            <div className="row g-3 mt-2">
              {bestKeepers.length > 0 && (
                <div className="col-xl-6">
                  <PositionAward
                    title={labels.keeper}
                    blurb={labels.keeperBlurb}
                    entries={bestKeepers}
                    kind={KEEPER_KIND}
                    cupLabel={labels.cup}
                    subjectOf={subjectOf}
                    leagueName={leagueName}
                    season={activeSeason}
                  />
                </div>
              )}
              {bestDefenders.length > 0 && (
                <div className="col-xl-6">
                  <PositionAward
                    title={labels.defender}
                    blurb={labels.defenderBlurb}
                    entries={bestDefenders}
                    kind={DEFENDER_KIND}
                    cupLabel={labels.cup}
                    subjectOf={subjectOf}
                    leagueName={leagueName}
                    season={activeSeason}
                  />
                </div>
              )}
            </div>

            <h5 className="mt-4">{labels.team}</h5>
            <TeamOfSeasonField
              pids={shown.worldTeamOfYear}
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
