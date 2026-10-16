import { useMemo } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useLeague } from "../context/LeagueContext.js";
import { ClubLink } from "../components/ClubLink.js";
import { EmptyState } from "../components/EmptyState.js";
import { countriesOf } from "../../core/competitions.js";
import { isSpectator } from "../../core/spectator.js";
import {
  continentalCupOf,
  cupPagePath,
  currentMatchdayOf,
  fixtureAction,
  fixturesFor,
  openingMatchday,
  type FixtureRow,
  type FixtureSource,
} from "../scheduleFixtures.js";
import type { CupCompetitionId } from "../../core/constants.js";
import type { LeagueStore } from "../../core/leagueState.js";

const CONTINENTAL: { id: CupCompetitionId; name: string }[] = [
  { id: "continental", name: "Continental Cup" },
  { id: "shield", name: "Continental Shield" },
  { id: "americas", name: "Americas Cup" },
];

/** A source as a <select> value, and back. */
function sourceKey(s: FixtureSource): string {
  switch (s.kind) {
    case "club": return "club";
    case "league": return `league:${s.compId}`;
    case "continental": return `cont:${s.competition}`;
    case "domestic": return `dom:${s.country}`;
  }
}

function parseSource(key: string, userTid: number): FixtureSource {
  const [kind, rest] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
  if (kind === "league") return { kind: "league", compId: Number(rest) };
  if (kind === "cont") return { kind: "continental", competition: rest as CupCompetitionId };
  if (kind === "dom") return { kind: "domestic", country: rest };
  return { kind: "club", tid: userTid };
}

function cupBadge(row: FixtureRow): string {
  const comp = row.kind === "domestic"
    ? "Domestic cup"
    : row.competition === "shield" ? "Shield"
      : row.competition === "americas" ? "Americas Cup" : "Cup";
  return `${comp} · ${row.label}`;
}

/** The last column: replay, watch, or sim up to it, depending on where the row sits in the season. */
function RowAction({ row, currentMatchday }: { row: FixtureRow; currentMatchday: number | null }) {
  const { simAction, simLiveAction, simming } = useLeague();
  const location = useLocation();
  const action = fixtureAction(row, currentMatchday);
  switch (action.kind) {
    case "replay":
      return <Link to={`/watch/${action.playedIndex}`}>Watch it back</Link>;
    case "watch":
      return (
        <button
          type="button"
          className="btn btn-sm btn-primary py-0"
          disabled={simming}
          onClick={() => simLiveAction({
            tid: row.home, key: row.kind, returnTo: location.pathname + location.search,
          })}
        >
          Watch
        </button>
      );
    case "simTo":
      return (
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary py-0"
          disabled={simming}
          title={`Plays everything up to matchday ${action.throughMatchday}, then stops`}
          onClick={() => simAction({ matchday: action.throughMatchday })}
        >
          Sim to
        </button>
      );
    default:
      return null;
  }
}

function Score({ row }: { row: FixtureRow }) {
  if (!row.result) return <>v</>;
  const text = `${row.result.homeGoals} - ${row.result.awayGoals}`;
  return row.kind === "league" && row.playedIndex !== null
    ? <Link to={`/box-score/${row.playedIndex}`}>{text}</Link>
    : <Link to={cupPagePath(row)}>{text}</Link>;
}

/** Your club's season, every competition in one list. */
function ClubFixtures({ rows, userTid, currentMatchday }: {
  rows: FixtureRow[]; userTid: number; currentMatchday: number | null;
}) {
  let lastPlayedIdx = -1;
  rows.forEach((r, i) => { if (r.result) lastPlayedIdx = i; });
  return (
    <table className="table table-striped table-sm">
      <thead>
        <tr>
          <th className="text-end">MD</th>
          <th>Home</th>
          <th className="text-center">Score</th>
          <th>Away</th>
          <th className="text-center">Poss</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => {
          let outcome: "win" | "loss" | null = null;
          if (row.result) {
            const userIsHome = row.home === userTid;
            const us = userIsHome ? row.result.homeGoals : row.result.awayGoals;
            const them = userIsHome ? row.result.awayGoals : row.result.homeGoals;
            if (us > them) outcome = "win";
            else if (us < them) outcome = "loss";
          }
          const className = [
            outcome === "win" ? "row-win" : outcome === "loss" ? "row-loss" : undefined,
            i === lastPlayedIdx ? "row-current" : undefined,
          ].filter(Boolean).join(" ") || undefined;
          return (
            <tr key={`${row.kind}-${row.home}-${row.away}-${row.matchday}-${i}`} className={className}>
              <td className="text-end">{row.matchday}</td>
              <td>
                <ClubLink tid={row.home} />
                {row.kind !== "league" && (
                  <span className="badge text-bg-secondary ms-2 align-middle" style={{ fontWeight: 400 }}>
                    {cupBadge(row)}
                  </span>
                )}
              </td>
              <td className="text-center"><Score row={row} /></td>
              <td><ClubLink tid={row.away} /></td>
              <td className="text-center text-muted">
                {row.kind === "league" && row.result
                  ? `${Math.round(row.result.possessionHome * 100)}–${Math.round((1 - row.result.possessionHome) * 100)}`
                  : ""}
              </td>
              <td className="text-end"><RowAction row={row} currentMatchday={currentMatchday} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** One competition, a matchday at a time. */
function CompetitionFixtures({ rows, userTid, currentMatchday }: {
  rows: FixtureRow[]; userTid: number; currentMatchday: number | null;
}) {
  const { simAction, simming } = useLeague();
  const matchdays = useMemo(() => [...new Set(rows.map((r) => r.matchday))].sort((a, b) => a - b), [rows]);
  const opening = openingMatchday(rows, currentMatchday);
  // In the URL rather than in state, so coming back from the live viewer (or a
  // box score) lands on the matchday you left.
  const [params, setParams] = useSearchParams();
  const mdParam = params.get("md");
  const picked = mdParam === null ? null : Number(mdParam);
  const setPicked = (d: number) => setParams((p) => {
    const next = new URLSearchParams(p);
    next.set("md", String(d));
    return next;
  }, { replace: true });
  // A pick from another competition, or one the season has moved past, falls
  // back to where this competition is now.
  const md = picked !== null && matchdays.includes(picked) ? picked : opening;
  if (md === null) return <p className="text-muted">No fixtures yet.</p>;

  const i = matchdays.indexOf(md);
  const shown = rows.filter((r) => r.matchday === md);
  const label = shown.find((r) => r.label)?.label;
  const ahead = currentMatchday !== null && md > currentMatchday;
  const today = currentMatchday !== null && md === currentMatchday;

  return (
    <>
      <div className="d-flex flex-wrap gap-2 align-items-center mb-3">
        <div className="btn-group btn-group-sm">
          <button
            type="button" className="btn btn-outline-secondary" aria-label="Previous matchday"
            disabled={i <= 0} onClick={() => setPicked(matchdays[i - 1])}
          >
            &lsaquo;
          </button>
          <select
            className="form-select form-select-sm rounded-0"
            style={{ width: "auto" }}
            aria-label="Matchday"
            value={md}
            onChange={(e) => setPicked(Number(e.target.value))}
          >
            {matchdays.map((d) => (
              <option key={d} value={d}>
                Matchday {d}{d === currentMatchday ? " (next)" : ""}
              </option>
            ))}
          </select>
          <button
            type="button" className="btn btn-outline-secondary" aria-label="Next matchday"
            disabled={i >= matchdays.length - 1} onClick={() => setPicked(matchdays[i + 1])}
          >
            &rsaquo;
          </button>
        </div>
        {label && <span className="text-muted small">{label}</span>}
        {today && (
          <button type="button" className="btn btn-sm btn-outline-secondary" disabled={simming} onClick={() => simAction("game")}>
            Sim matchday
          </button>
        )}
        {ahead && (
          <button
            type="button" className="btn btn-sm btn-outline-secondary" disabled={simming}
            onClick={() => simAction({ matchday: md - 1 })}
          >
            Sim to matchday {md}
          </button>
        )}
      </div>
      <table className="table table-striped table-sm">
        <thead>
          <tr>
            <th className="text-end">Home</th>
            <th className="text-center">Score</th>
            <th>Away</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {shown.map((row, j) => (
            <tr
              key={`${row.home}-${row.away}-${j}`}
              className={row.home === userTid || row.away === userTid ? "fw-semibold" : undefined}
            >
              <td className="text-end"><ClubLink tid={row.home} /></td>
              <td className="text-center" style={{ minWidth: "4rem" }}><Score row={row} /></td>
              <td><ClubLink tid={row.away} /></td>
              <td className="text-end">
                {/* A future matchday has its one Sim button above; one per row would just repeat it. */}
                {!ahead && <RowAction row={row} currentMatchday={currentMatchday} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/**
 * Every view this save can show, as <select> values. A `?view=` that isn't one
 * of them (an old link, a league God Mode removed, "club" on a spectator save)
 * falls back to the default rather than showing an empty page under a select
 * that names something else.
 */
function viewKeys(league: LeagueStore): Set<string> {
  const keys = new Set<string>();
  if (!isSpectator(league)) keys.add("club");
  for (const c of CONTINENTAL) if (continentalCupOf(league, c.id)) keys.add(`cont:${c.id}`);
  for (const c of league.competitions) keys.add(`league:${c.id}`);
  for (const c of league.domesticCups ?? []) keys.add(`dom:${c.country}`);
  return keys;
}

function resolveSource(league: LeagueStore, key: string | null): FixtureSource {
  const userTid = league.meta.userTid;
  if (key !== null && viewKeys(league).has(key)) return parseSource(key, userTid);
  return isSpectator(league)
    ? { kind: "league", compId: league.competitions[0].id }
    : { kind: "club", tid: userTid };
}

export function Schedule() {
  const { league } = useLeague();
  const [params, setParams] = useSearchParams();
  const key = params.get("view");
  // Picking a competition starts it on its own current matchday.
  const setKey = (v: string) => setParams({ view: v }, { replace: true });
  // Scans the whole world's fixtures for a league view, so only when the
  // league or the view changes, not on every render.
  const resolved = useMemo(() => {
    if (!league) return null;
    const source = resolveSource(league, key);
    return { source, rows: fixturesFor(league, source) };
  }, [league, key]);

  if (!league || !resolved) {
    return <p className="p-3">Loading...</p>;
  }

  const userTid = league.meta.userTid;
  const spectating = isSpectator(league);
  const { source, rows } = resolved;
  const currentMatchday = currentMatchdayOf(league);

  const continental = CONTINENTAL.filter((c) => continentalCupOf(league, c.id) !== null);
  const domesticByCountry = new Map((league.domesticCups ?? []).map((c) => [c.country, c.name]));

  return (
    <div className="container-fluid p-3">
      <h4>Schedule</h4>
      <div className="mb-3">
        <select
          className="form-select form-select-sm"
          style={{ width: "auto", display: "inline-block" }}
          aria-label="Competition"
          value={sourceKey(source)}
          onChange={(e) => setKey(e.target.value)}
        >
          {!spectating && <option value="club">Your club</option>}
          {continental.length > 0 && (
            <optgroup label="Continental">
              {continental.map((c) => (
                <option key={c.id} value={`cont:${c.id}`}>{continentalCupOf(league, c.id)?.name ?? c.name}</option>
              ))}
            </optgroup>
          )}
          {countriesOf(league.competitions).map((country) => (
            <optgroup key={country} label={country}>
              {league.competitions.filter((c) => c.country === country).map((c) => (
                <option key={c.id} value={`league:${c.id}`}>{c.name}</option>
              ))}
              {domesticByCountry.has(country) && (
                <option value={`dom:${country}`}>{domesticByCountry.get(country)}</option>
              )}
            </optgroup>
          ))}
        </select>
      </div>
      {rows.length === 0 ? (
        <EmptyState headline="No fixtures">Nothing is scheduled here this season yet.</EmptyState>
      ) : source.kind === "club" ? (
        <ClubFixtures rows={rows} userTid={userTid} currentMatchday={currentMatchday} />
      ) : (
        <CompetitionFixtures rows={rows} userTid={userTid} currentMatchday={currentMatchday} />
      )}
    </div>
  );
}
