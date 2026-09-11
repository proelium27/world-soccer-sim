import { useMemo, type ReactNode } from "react";
import { useLeague } from "../../context/LeagueContext.js";
import { Flag } from "../../components/Flag.js";
import { DivisionBadge } from "../../components/DivisionBadge.js";
import type { StoredTeam } from "../../../core/teams/clubs.js";
import type { Competition } from "../../../core/competitions.js";
import type {
  IntlGroup, InternationalState, IntlTournament, IntlQualifyingCampaign,
} from "../../../core/international/index.js";
import { groupTable } from "../../../core/international/index.js";
import { INTL_TOURNAMENT_NAME, INTL_CYCLE_YEARS } from "../../../core/constants.js";
import { EmptyState } from "../../components/EmptyState.js";

/** Knockout round names, deepest first, for a bracket of up to five rounds (a 48-nation World Cup's). */
export const KO_ROUND_NAMES = ["Round of 32", "Round of 16", "Quarter-finals", "Semi-finals", "Final"];

/** Rounds in a 32-nation World Cup's bracket, the depth a caller with no total gets. */
const DEFAULT_KO_ROUNDS = 4;

/**
 * What to call knockout round `round` of a bracket that has `totalRounds` of
 * them. Named backwards from the final, because brackets differ in depth: the
 * World Cup's is four rounds at 32 nations and five at 48, while a
 * confederation cup's can be two, whose round 0 is the semi-finals rather than
 * the quarters. With no total supplied it assumes a 32-nation World Cup.
 */
export function koRoundName(round: number, totalRounds: number = DEFAULT_KO_ROUNDS): string {
  const fromFinal = totalRounds - 1 - round;
  return KO_ROUND_NAMES[KO_ROUND_NAMES.length - 1 - fromFinal] ?? `Round ${round + 1}`;
}

export function NationName({ nation }: { nation: string }) {
  return (
    <span className="text-nowrap">
      {/* No flag tooltip: the name is right here, and these render in bulk. */}
      <Flag nationality={nation} tip={false} /> {nation}
    </span>
  );
}

/**
 * Shared chrome for every National Teams page: the section heading and the
 * page's own title, then its content. Navigation between the tabs is the
 * sidebar's job — the pages carry no link strip of their own.
 */
/**
 * The shell all eleven National Teams pages render inside.
 *
 * The section name is an eyebrow above the page title, not a heading over it.
 * It used to be `<h4>National Teams</h4>` above `<h5>{title}</h5>`, which set
 * the one word that is identical on all eleven pages LARGER than the word that
 * says which of the eleven you are looking at — so the loudest thing on every
 * screen in the section carried no information. Same treatment the sidebar
 * already gives its own group labels.
 */
export function NationalTeamsLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="container-fluid p-3">
      <div className="page-eyebrow">National Teams</div>
      <h4 className="mb-3">{title}</h4>
      {children}
    </div>
  );
}

/** A normalized group-standings row, keyed by nation so live and archived tables render the same. */
export interface StandingRow {
  nation: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  gd: number;
  points: number;
}

/** Convert a live (nid-keyed) group into normalized nation-keyed standings. */
export function liveGroupRows(group: IntlGroup, nations: string[]): StandingRow[] {
  return groupTable(group).map((r) => ({
    nation: nations[r.nid],
    played: r.played,
    won: r.won,
    drawn: r.drawn,
    lost: r.lost,
    gf: r.gf,
    ga: r.ga,
    gd: r.gd,
    points: r.points,
  }));
}

/**
 * A settled qualifier gets the full `.row-selected` treatment, wash and all: it
 * is a fact about that nation. A zone gets a leading bar and no wash, the same
 * call the club standings make and for the same reason — a zone can span most
 * of a short table (three rows of five, in a confederation with a big
 * allocation), and washing that much of it turns the table into a green block
 * instead of marking anything.
 */
function rowClass(highlighted: boolean | undefined, zone: RowMark | undefined): string | undefined {
  if (highlighted) return "row-selected";
  if (zone === "through") return "row-through";
  if (zone === "contending") return "row-contending";
  return undefined;
}

/** How a group row is marked: settled fact, or a zone that is still being played for. */
export type RowMark = "through" | "contending" | null;

/**
 * One group's standings table.
 *
 * Two ways to mark rows, and they answer different questions. `highlight` marks
 * nations by name, for a campaign that has finished and whose qualifiers are
 * known. `zoneAt` marks *finishing positions*, for one still being played: a
 * position whose occupant is certain to go through is "through", and one
 * competing with the other groups' for a shared pool of places is
 * "contending". Pass one or the other, never both.
 *
 * The distinction is the point. A group winner always qualifies, but a
 * runner-up is ranked against every other runner-up in his confederation, so
 * mid-campaign the truthful statement is about the place, not the nation.
 *
 * `compact` drops the W/D/L columns for the denser qualifying view.
 */
export function GroupStandings({
  rows,
  highlight,
  zoneAt,
  compact,
}: {
  rows: StandingRow[];
  highlight?: (nation: string) => boolean;
  zoneAt?: (position: number) => RowMark;
  compact?: boolean;
}) {
  return (
    <table className="table table-sm mb-0">
      <thead>
        <tr>
          <th style={{ width: compact ? "50%" : "45%" }}>Nation</th>
          <th className="text-end">P</th>
          {!compact && (
            <>
              <th className="text-end">W</th>
              <th className="text-end">D</th>
              <th className="text-end">L</th>
            </>
          )}
          <th className="text-end">GD</th>
          <th className="text-end">Pts</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, position) => (
          <tr key={r.nation} className={rowClass(highlight?.(r.nation), zoneAt?.(position))}>
            <td><NationName nation={r.nation} /></td>
            <td className="text-end">{r.played}</td>
            {!compact && (
              <>
                <td className="text-end">{r.won}</td>
                <td className="text-end">{r.drawn}</td>
                <td className="text-end">{r.lost}</td>
              </>
            )}
            <td className="text-end">{r.gd > 0 ? `+${r.gd}` : r.gd}</td>
            <td className="text-end fw-bold">{r.points}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Group cards from already-normalized standings, the top `advancing` of each
 * shaded. Shared between the World Cup and the confederation cups —
 * whose group sizes differ, but whose card grid does not.
 */
export function GroupCards({
  groups,
  advancing,
  through: knownThrough,
}: {
  groups: StandingRow[][];
  advancing: number;
  /**
   * Who actually went through, once the knockout is seeded. Needed wherever the
   * best third-placed sides go through too (a 24- or 48-nation World Cup),
   * because which thirds made it is a comparison across every group that no
   * single table can show. When given it replaces the top-`advancing` shading.
   */
  through?: ReadonlySet<string>;
}) {
  return (
    <div className="row g-3 mb-3">
      {groups.map((rows, i) => {
        const through = knownThrough ?? new Set(rows.slice(0, advancing).map((r) => r.nation));
        return (
          <div className="col-12 col-lg-6" key={i}>
            <div className="card">
              <div className="card-header py-1 small fw-bold">
                {groups.length === 1 ? "Table" : `Group ${String.fromCharCode(65 + i)}`}
              </div>
              <GroupStandings rows={rows} highlight={(n) => through.has(n)} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** One knockout result, normalized so live ties and archived results render alike. */
export interface KnockoutResultView {
  round: number;
  home: string;
  away: string;
  homeGoals: number;
  awayGoals: number;
  winner: string;
  pens: { home: number; away: number } | null;
  extraTime?: boolean;
}

/** The knockout bracket as one card-column per round. */
export function KnockoutColumns({
  results,
  totalRounds,
}: {
  results: KnockoutResultView[];
  /** How many rounds this bracket has; read off its first round when omitted. */
  totalRounds?: number;
}) {
  const byRound = new Map<number, KnockoutResultView[]>();
  for (const r of results) {
    const list = byRound.get(r.round);
    if (list) list.push(r);
    else byRound.set(r.round, [r]);
  }
  const rounds = [...byRound.entries()].sort((a, b) => a[0] - b[0]);
  if (rounds.length === 0) return <p className="text-muted">The knockout stage hasn't started yet.</p>;
  // Depth from the first round's size rather than from how many rounds have
  // been played, so a bracket half-way through still names its rounds right.
  const firstRound = byRound.get(0)?.length ?? 0;
  const depth = totalRounds ?? (firstRound > 0 ? Math.round(Math.log2(firstRound * 2)) : rounds.length);

  return (
    <div className="row g-3 mb-3">
      {rounds.map(([round, ties]) => (
        <div className="col-12 col-md-4" key={round}>
          <div className="card">
            <div className="card-header py-1 small fw-bold">
              {koRoundName(round, depth)}
            </div>
            <ul className="list-group list-group-flush">
              {ties.map((tie, i) => (
                <li className="list-group-item py-2 small" key={i}>
                  <div className={tie.winner === tie.home ? "fw-bold" : undefined}>
                    <NationName nation={tie.home} /> {tie.homeGoals}
                  </div>
                  <div className={tie.winner === tie.away ? "fw-bold" : undefined}>
                    <NationName nation={tie.away} /> {tie.awayGoals}
                  </div>
                  {tie.pens && (
                    <div className="text-muted">{tie.pens.home}-{tie.pens.away} on penalties</div>
                  )}
                  {tie.extraTime && !tie.pens && <div className="text-muted">after extra time</div>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ))}
    </div>
  );
}

/** A year picker for browsing past editions. `seasons` is newest-first. */
export function SeasonSelect({
  seasons,
  value,
  onChange,
  labelFor,
}: {
  seasons: number[];
  value: number;
  onChange: (season: number) => void;
  labelFor: (season: number) => string;
}) {
  if (seasons.length <= 1) return null;
  return (
    <select
      className="form-select form-select-sm w-auto mb-3"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      {seasons.map((s) => (
        <option key={s} value={s}>{labelFor(s)}</option>
      ))}
    </select>
  );
}

/**
 * Which campaign a "what's happening now" tab should show.
 *
 * While a stage is pending, it's whatever is being played. Otherwise it's the
 * more recent of the two on file — which is *not* simply "the tournament if
 * there is one": once a new cycle's qualifying is drawn, that campaign is newer
 * than the last World Cup and should take over. Qualifying's `season` is the
 * cycle's start, which is still after the previous tournament's, so comparing
 * seasons orders them correctly either way.
 */
export function liveCampaign(intl: InternationalState): {
  tournament: IntlTournament | null;
  qualifying: IntlQualifyingCampaign | null;
  showing: "tournament" | "qualifying" | null;
} {
  const { tournament, qualifying, stage } = intl;
  let showing: "tournament" | "qualifying" | null;
  if (stage === "qualifying") showing = "qualifying";
  // Only the World Cup's own stages force the tournament view. The confederation cup
  // stages run in a *qualifying* offseason, so they fall through to the
  // more-recent-campaign rule below, which picks the live qualifying campaign.
  else if (stage === "groups" || stage === "knockout") showing = "tournament";
  else if (tournament && qualifying) showing = tournament.season >= qualifying.season ? "tournament" : "qualifying";
  else if (tournament) showing = "tournament";
  else if (qualifying) showing = "qualifying";
  else showing = null;

  // Never claim to show a campaign that isn't there.
  if (showing === "tournament" && !tournament) showing = qualifying ? "qualifying" : null;
  if (showing === "qualifying" && !qualifying) showing = tournament ? "tournament" : null;
  return { tournament, qualifying, showing };
}

/** The shared "international hasn't started" empty state, used by every tab. */
export function useHasInternational(): boolean {
  const { league } = useLeague();
  if (!league) return false;
  const intl = league.international;
  return (
    intl.tournament !== null ||
    intl.qualifying !== null ||
    intl.history.length > 0 ||
    intl.qualifyingHistory.length > 0 ||
    intl.confederationCups.length > 0 ||
    intl.confederationCupHistory.length > 0 ||
    intl.powerRankings.length > 0
  );
}

export function IntlEmpty({ footer }: { footer?: ReactNode } = {}) {
  return (
    <NationalTeamsLayout title="Not started yet">
      <EmptyState headline={`The first round of qualifying runs at the end of season 1.`}>
        <p>
          National teams play in the summer, on a {INTL_CYCLE_YEARS}-year cycle. The first three
          offseasons of each cycle play one round of qualifying apiece, where every nation with
          enough players works through its confederation group for a place at the{" "}
          {INTL_TOURNAMENT_NAME}. The fourth offseason, the qualifiers meet in groups of four and
          then a knockout. It's 32 nations unless you change it: the size is on the Qualifying page.
        </p>
        <p>
          You can manage a country alongside your club — pick one when you start a save, or wait
          for a federation to get in touch over the summer. Every other nation picks itself, so
          the rest of your job is developing players worth calling up and watching how they get on.
        </p>
      </EmptyState>
      {footer}
    </NationalTeamsLayout>
  );
}

/** A player's club, and which division that club plays in. */
export interface ClubEntry {
  name: string;
  compId: number;
  /** He's in the club's youth setup rather than its senior squad. */
  academy: boolean;
}

/**
 * pid -> the club he's at, for the Club column both squad pages carry.
 *
 * Shared because those two pages list the same players, and would read as a bug
 * the moment they described one of them differently. Keyed on the teams array,
 * so it rebuilds only when a squad actually moves.
 */
export function useClubIndex(teams: StoredTeam[] | undefined): Map<number, ClubEntry> {
  return useMemo(() => {
    const map = new Map<number, ClubEntry>();
    for (const t of teams ?? []) {
      for (const pid of t.roster) map.set(pid, { name: t.name, compId: t.compId, academy: false });
      for (const pid of t.academyRoster) {
        map.set(pid, { name: t.name, compId: t.compId, academy: true });
      }
    }
    return map;
  }, [teams]);
}

/**
 * A player's club, marked with its division the way Power Rankings marks one.
 *
 * Worth the room here because a national squad is drawn from the whole world.
 * On a club roster every player is at the same club by definition; here the
 * reader genuinely cannot otherwise tell a big-four regular from someone in
 * another country's second division.
 */
export function ClubCell(
  { club, competitions }: { club: ClubEntry | undefined; competitions: Competition[] },
) {
  if (!club) return <span className="text-muted">Free agent</span>;
  return (
    <span className="d-inline-flex align-items-center gap-1 text-nowrap">
      <span>{club.name}{club.academy && " (academy)"}</span>
      <DivisionBadge competitions={competitions} compId={club.compId} />
    </span>
  );
}
