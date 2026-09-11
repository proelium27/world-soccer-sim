import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useLeague } from "../../context/LeagueContext.js";
import type { Player } from "../../../core/players/types.js";
import { FORMATIONS, FORMATION_IDS, type FormationId } from "../../../core/lineup/formations.js";
import { resolveXI } from "../../../core/lineup/resolveXI.js";
import { swapStarters } from "../../../core/lineup/swapStarters.js";
import { editableSquad, displaySquad } from "../../../core/international/index.js";
import { INTL_SQUAD_SIZE, INTL_MIN_KEEPERS } from "../../../core/constants.js";
import { PitchField } from "../../components/PitchField.js";
import { getRatingColor } from "../../utils/ratingColor.js";
import { InjuryBadge } from "../../components/InjuryBadge.js";
import { SuspensionBadge } from "../../components/SuspensionBadge.js";
import { PositionBadge } from "../../components/PositionBadge.js";
import { PlayerRatingsTooltip } from "../../components/PlayerRatingsTooltip.js";
import { sortByPosThenOvr } from "../Roster.js";
import {
  PlayerViewCells, PlayerViewHeaders, PlayerViewSwitch, performanceSeason,
  performanceSeasonOptions, usePlayerView, viewTableClass,
} from "../../playerViews.js";
import { NationalTeamsLayout, NationName, useClubIndex, ClubCell } from "./shared.js";

const DRAG_MIME = "application/x-soccer-gm-pid";

/**
 * Pick your country's eleven.
 *
 * Built to the same shape as the club Roster page, and on the same components:
 * `PitchField` for the eleven, then a table of the XI and one of the
 * substitutes, dragging between any of them. That is deliberate rather than
 * convenient — picking a team is the same act whoever you are picking it for,
 * and the chips carry the same position, slot fit, injury and suspension marks
 * they do for your club, because those are facts about the player.
 *
 * What it does *not* carry is the club half: no contracts, no transfer list,
 * nobody to release. `PitchField` takes those as optional props and simply
 * isn't given them here (see PitchFieldProps).
 *
 * Calling players up lives on its own page. It is a different job — searching
 * a national pool of hundreds — and mixing it in here made this one a data
 * dump instead of a team sheet.
 */
export function NTMySquad() {
  const {
    league, setNationalLineupAction,
    setNationalFormationAction, autoPickNationalXIAction, simming,
  } = useLeague();
  const [dragOverSlotIndex, setDragOverSlotIndex] = useState<number | null>(null);
  const [dragOverPid, setDragOverPid] = useState<number | null>(null);
  const [selectedPid, setSelectedPid] = useState<number | null>(null);
  const [showDepthChart, setShowDepthChart] = useState(false);
  const [view, setView] = usePlayerView();
  const seasonOptions = useMemo(
    () => (league ? performanceSeasonOptions(league) : []),
    [league],
  );
  const defaultSeason = useMemo(() => (league ? performanceSeason(league) : 0), [league]);
  const [pickedSeason, setPickedSeason] = useState<number | null>(null);
  const season = pickedSeason !== null && seasonOptions.includes(pickedSeason)
    ? pickedSeason
    : defaultSeason;

  const byPid = useMemo(
    () => new Map((league?.players ?? []).map((p) => [p.pid, p])),
    [league?.players],
  );
  const clubByPid = useClubIndex(league?.teams);

  const nation = league?.nationalManager.nation ?? null;

  const shown = useMemo(() => {
    if (!league || !nation) return null;
    const editable = editableSquad(league.international, nation);
    const found = editable ?? displaySquad(league.international, nation);
    return found ? { found, locked: editable === null } : null;
  }, [league, nation]);

  /*
    Memoized, and not merely for tidiness: dragging fires `setDragOverSlotIndex`
    on every dragover event, so anything left in the render body re-runs for
    every pixel of a drag — re-resolving the XI through selectXI's pairwise
    assignment and its improvement loop each time. Roster.tsx carries the same
    warning for the same reason.
  */
  const derived = useMemo(() => {
    const squad = shown?.found.squad;
    if (!squad) return null;
    const named = squad.pids
      .map((pid) => byPid.get(pid))
      .filter((p): p is Player => p !== undefined);
    const slots = FORMATIONS[squad.formation];
    const xi = resolveXI(named, slots, squad.starters ?? null);
    const xiSet = new Set(xi.map((p) => p.pid));
    return {
      named,
      slots,
      xi,
      xiPids: xi.map((p) => p.pid),
      subs: sortByPosThenOvr(named.filter((p) => !xiSet.has(p.pid))),
      keepers: named.filter((p) => p.pos === "GK").length,
    };
  }, [shown, byPid]);

  if (!league) return <p className="p-3">Loading...</p>;

  if (!nation) {
    return (
      <NationalTeamsLayout title="My Squad">
        <p className="text-muted">
          You don't manage a national team. Countries get in touch over the summer, and
          anything on the table is on the{" "}
          <Link to="/national-teams/federation">Federation</Link> page.
        </p>
      </NationalTeamsLayout>
    );
  }

  if (!shown || !derived) {
    return (
      <NationalTeamsLayout title="My Squad">
        <p className="text-muted">
          <NationName nation={nation} /> haven't named a squad yet. One is picked for you
          the moment a campaign is drawn, at the end of the season, and you can change it
          from here before the first match.
        </p>
      </NationalTeamsLayout>
    );
  }

  const { squad, competition } = shown.found;
  const { locked } = shown;
  const { named, slots, xi, xiPids, subs, keepers } = derived;

  function handleSwap(draggedPid: number, targetPid: number) {
    if (locked) return;
    // Covers bench <-> XI both ways and two starters trading slots; returns null
    // for a no-op or an eleven the keeper rule forbids.
    const next = swapStarters(named, slots, xiPids, draggedPid, targetPid);
    if (!next) return;
    void setNationalLineupAction(next);
  }

  function handleDropOnSlot(slotIndex: number, draggedPid: number) {
    handleSwap(draggedPid, xiPids[slotIndex]);
  }

  // Tap-to-swap for touch devices, where HTML5 drag never fires — the same
  // fallback the club Roster page offers.
  function handleTap(pid: number) {
    if (locked) return;
    if (selectedPid === null) setSelectedPid(pid);
    else if (selectedPid === pid) setSelectedPid(null);
    else {
      handleSwap(selectedPid, pid);
      setSelectedPid(null);
    }
  }

  const squadRow = (p: Player) => (
    <tr
      key={p.pid}
      draggable={!locked}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_MIME, String(p.pid));
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(e) => {
        if (locked) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDragOverPid(p.pid);
      }}
      onDragLeave={() => setDragOverPid(null)}
      onDrop={(e) => {
        if (locked) return;
        e.preventDefault();
        setDragOverPid(null);
        const raw = e.dataTransfer.getData(DRAG_MIME);
        if (raw) handleSwap(Number(raw), p.pid);
      }}
      onDragEnd={() => setDragOverPid(null)}
      className={dragOverPid === p.pid || selectedPid === p.pid ? "table-active" : undefined}
      style={{ cursor: locked ? undefined : "grab" }}
    >
      {/*
        A flex row, not just nowrap: `.pitch-chip-handle` is `display: flex`,
        which inside a table cell is a block and pushes the position onto its
        own line. On the pitch it sits inside the chip's own flex row, which is
        why it behaves there and not here.
      */}
      <td>
        <span className="d-flex align-items-center gap-1">
          {!locked && (
            <button
              type="button"
              className="pitch-chip-handle"
              aria-label={selectedPid === p.pid ? "Cancel move" : "Move player"}
              title="Drag onto a shirt, or tap this and then another player to swap them"
              onClick={() => handleTap(p.pid)}
            >
              &#8942;&#8942;
            </button>
          )}
          <PositionBadge player={p} />
        </span>
      </td>
      <td>
        <PlayerRatingsTooltip player={p}>
          <Link to={`/player/${p.pid}`}>{p.name}</Link>
        </PlayerRatingsTooltip>
        {p.injury && <> <InjuryBadge player={p} /></>}
        {<SuspensionBadge player={p} />}
      </td>
      <td className="small text-muted"><ClubCell club={clubByPid.get(p.pid)} competitions={league.competitions} /></td>
      <td className="text-end">{league.season - p.born}</td>
      {view === "overview" ? (
        <>
          <td className="text-end fw-semibold" style={{ color: getRatingColor(p.ovr) }}>{p.ovr}</td>
          <td className="text-end">{p.intl?.caps ?? 0}</td>
          <td className="text-end">{p.intl?.goals ?? 0}</td>
        </>
      ) : (
        <PlayerViewCells view={view} player={p} season={season} />
      )}
    </tr>
  );

  const squadTable = (rows: Player[]) => (
    <div className="table-responsive mb-3">
      <table className={`table table-sm table-striped align-middle mb-0${viewTableClass(view)}`}>
        <thead>
          <tr>
            <th>Pos</th>
            <th>Player</th>
            <th>Club</th>
            <th className="text-end">Age</th>
            {view === "overview" ? (
              <>
                <th className="text-end">Ovr</th>
                <th className="text-end">Caps</th>
                <th className="text-end">Intl G</th>
              </>
            ) : (
              <PlayerViewHeaders view={view} />
            )}
          </tr>
        </thead>
        <tbody>{rows.map(squadRow)}</tbody>
      </table>
    </div>
  );

  return (
    <NationalTeamsLayout title="My Squad">
      <div className="d-flex flex-wrap align-items-baseline gap-2 mb-2">
        <h5 className="mb-0"><NationName nation={nation} /></h5>
        <span className="text-muted small">
          {locked ? "last named for" : "picking for"} {competition}
        </span>
        <span className="text-muted small ms-auto">
          {named.length} of {INTL_SQUAD_SIZE} called up
          {keepers <= INTL_MIN_KEEPERS && <>, only {keepers} keeper</>}
          {" · "}
          <Link to="/national-teams/player-pool">Call someone up</Link>
        </span>
      </div>

      {locked ? (
        <p className="text-muted small mb-3">
          Nothing to pick for right now. Your squad is named for you when a campaign is
          drawn at the end of a season, and you can change it from here before the first
          match of that summer.
        </p>
      ) : (
        <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
          <select
            className="form-select form-select-sm w-auto"
            aria-label="Formation"
            value={squad.formation}
            disabled={simming}
            onChange={(e) => setNationalFormationAction(e.target.value as FormationId)}
          >
            {FORMATION_IDS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <button
            className="btn btn-outline-primary btn-sm"
            disabled={simming}
            onClick={() => autoPickNationalXIAction()}
          >
            Best XI
          </button>
          <div className="form-check form-switch ms-2 mb-0">
            <input
              className="form-check-input"
              type="checkbox"
              role="switch"
              id="national-depth-chart"
              checked={showDepthChart}
              onChange={(e) => setShowDepthChart(e.target.checked)}
            />
            <label className="form-check-label small" htmlFor="national-depth-chart">
              Depth Chart
            </label>
          </div>
          <span className="text-muted small">
            Drag anyone onto a shirt, or tap two handles to swap them.
          </span>
        </div>
      )}

      <PitchField
        starters={xi}
        slots={slots}
        formation={squad.formation}
        bench={subs}
        showDepthChart={showDepthChart}
        season={league.season}
        dragOverSlotIndex={dragOverSlotIndex}
        setDragOverSlotIndex={setDragOverSlotIndex}
        onDropOnSlot={handleDropOnSlot}
        selectedPid={selectedPid}
        onTapToMove={handleTap}
      />

      <PlayerViewSwitch
        value={view}
        onChange={setView}
        season={season}
        seasons={seasonOptions}
        onSeason={setPickedSeason}
      />

      <h6 className="text-muted text-uppercase small mb-1">Starting XI</h6>
      {squadTable(xi)}

      <h6 className="text-muted text-uppercase small mb-1">Substitutes</h6>
      {subs.length === 0
        ? <p className="text-muted small">Nobody on the bench.</p>
        : squadTable(subs)}
    </NationalTeamsLayout>
  );
}
