import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useLeague } from "../context/LeagueContext.js";
import { usePlayerMap } from "../usePlayerMap.js";
import { SKILL_KEYS, POSITIONS, type Position, type PlayerRatings } from "../../core/players/types.js";
import { NATIONALITIES } from "../../core/players/nationalities.js";
import { SKILL_LABELS } from "../components/PlayerRatingsTooltip.js";
import { TeamIdentityEditor, type EditableTeam } from "../components/TeamIdentityEditor.js";
import type { NewPlayerSpec } from "../../core/godMode.js";
import { SortableTh, useTableSort, sortRows } from "../components/SortableTable.js";
import { BackLink } from "../components/BackLink.js";
import { ClubCrest } from "../components/ClubCrest.js";
import { Flag } from "../components/Flag.js";
import { manageableNations } from "../../core/international/index.js";
import { isSpectator } from "../../core/spectator.js";
import { NationName } from "./nationalTeams/shared.js";
import { currencyCompact } from "../format.js";

const NATION_NAMES = Object.keys(NATIONALITIES);
const flatRatings = (v: number): PlayerRatings =>
  Object.fromEntries(SKILL_KEYS.map((k) => [k, v])) as PlayerRatings;

type Tab = "club" | "nation" | "create" | "roster" | "finance";

export function GodMode() {
  const league = useLeague().league;
  const [tab, setTab] = useState<Tab>("club");
  if (!league || !league.godMode) return null;

  return (
    <div className="container-fluid py-3" style={{ maxWidth: 900 }}>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h1 className="h4 m-0">God Mode</h1>
        <BackLink fallback="/roster" className="small" />
      </div>
      <p className="text-secondary small">
        Sandbox tools — edits ignore fees, budgets, roster caps, and depth floors.
      </p>

      <ul className="nav nav-tabs mb-3">
        {(["club", "nation", "create", "roster", "finance"] as Tab[]).map((t) => (
          <li key={t} className="nav-item">
            <button className={`nav-link ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
              {t === "club" ? "Switch Club"
                : t === "nation" ? "Switch Country"
                : t === "create" ? "Create Player"
                : t === "roster" ? "Roster Builder" : "Club Finances"}
            </button>
          </li>
        ))}
      </ul>

      {tab === "club" && <SwitchClub />}
      {tab === "nation" && <SwitchCountry />}
      {tab === "create" && <CreatePlayer />}
      {tab === "roster" && <RosterBuilder />}
      {tab === "finance" && <ClubFinances />}
    </div>
  );
}

// --- Section A: Switch Club ---
/**
 * Take charge of any club in the world, immediately.
 *
 * This is the job-offer flow with its two gates removed — that a club asked,
 * and that it is the offseason — and nothing else. It deliberately routes
 * through the same `switchClub` handover rather than just reassigning
 * `meta.userTid`, because several `StoredTeam` fields are user-only by
 * convention (the youth academy above all) and a club handed to the AI with
 * them still populated ends up in a state nothing in the game unwinds.
 */
function SwitchClub() {
  const { league, godModeSwitchClubAction, simming } = useLeague();
  const navigate = useNavigate();
  const [tid, setTid] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);

  // Clubs grouped under their competition: a picker over 400-odd clubs sorted
  // by name alone gives no sense of which league a club plays in, which is the
  // first thing you'd want to know before taking the job.
  const byComp = useMemo(() => {
    if (!league) return [];
    return league.competitions.map((c) => ({
      comp: c,
      clubs: league.teams
        .filter((t) => t.compId === c.id)
        .sort((a, b) => a.name.localeCompare(b.name)),
    })).filter((g) => g.clubs.length > 0);
  }, [league]);

  if (!league) return null;

  const current = league.teams.find((t) => t.tid === league.meta.userTid);
  const target = tid === null ? null : league.teams.find((t) => t.tid === tid) ?? null;
  const compName = (compId: number) =>
    league.competitions.find((c) => c.id === compId)?.name ?? "Unknown league";

  const take = async () => {
    if (target === null) return;
    await godModeSwitchClubAction(target.tid);
    navigate("/roster");
  };

  return (
    <div>
      <div className="d-flex align-items-center gap-2 mb-3">
        {current && (
          <ClubCrest tid={current.tid} colors={[...current.colors] as [string, string]} size={28} />
        )}
        <div>
          <div className="fw-semibold">{current?.name ?? "No club"}</div>
          {/* A spectator save has no club to name, and this is the one way into
              one — God Mode is guardrail-free by definition, so it is also the
              single exception to "a spectator save never gets a club". Taking
              one here is safe: `switchClub` guards the handover on finding a
              departing club, so with none there is simply nothing to unwind. */}
          <div className="text-muted small">
            {current
              ? `${compName(current.compId)}, the club you manage now`
              : "You're spectating. Taking a club here ends that for good."}
          </div>
        </div>
      </div>

      <div className="mb-3" style={{ maxWidth: 420 }}>
        <label className="form-label form-label-sm">Take charge of</label>
        <select
          className="form-select form-select-sm"
          value={tid ?? ""}
          onChange={(e) => {
            setTid(e.target.value === "" ? null : Number(e.target.value));
            setConfirming(false);
          }}
        >
          <option value="">Pick a club…</option>
          {byComp.map((g) => (
            <optgroup key={g.comp.id} label={g.comp.name}>
              {g.clubs.map((t) => (
                <option key={t.tid} value={t.tid} disabled={t.tid === league.meta.userTid}>
                  {t.name}{t.tid === league.meta.userTid ? " (current club)" : ""}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {target && target.tid !== league.meta.userTid && (
        <div className="gm-panel" style={{ maxWidth: 560 }}>
          <div className="gm-panel-title d-flex align-items-center gap-2">
            <ClubCrest tid={target.tid} colors={[...target.colors] as [string, string]} size={22} />
            {target.name}
          </div>
          <div className="text-muted small mb-2">
            {compName(target.compId)}, {target.roster.length} players,{" "}
            {currencyCompact.format(target.budget)} in the bank, hype {Math.round(target.hype)}
          </div>
          <ul className="small text-secondary mb-3">
            <li>{current?.name ?? "Your club"} goes straight to the AI, and its youth academy graduates onto the senior squad on the way out.</li>
            <li>You know what these players are but not what they&apos;ll become: the squad turns up unscouted, same as any new job.</li>
            <li>Any transfer talks, incoming bids and loan listings you were holding are dropped.</li>
            {league.phase !== "offseason" && (
              <li>The season is under way, so you pick up {target.name} mid-campaign and the board judges you on how it finishes.</li>
            )}
          </ul>
          {confirming ? (
            <div className="d-flex align-items-center gap-2">
              <button className="btn btn-sm btn-warning" disabled={simming} onClick={take}>
                Yes, take over {target.name}
              </button>
              <button className="btn btn-sm btn-outline-secondary" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button
              className="btn btn-sm btn-warning"
              disabled={simming}
              onClick={() => setConfirming(true)}
            >
              Take over this club
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// --- Section A2: Switch Country ---
/**
 * Take charge of any national team in the world, immediately.
 *
 * The national twin of Switch Club above, and the same shape of thing: the
 * federation flow with its one gate — that somebody asked — taken off. It is a
 * much smaller operation than the club version for a structural reason, not by
 * omission: a national team owns no money, no contracts and no academy, so
 * there is nothing to hand over. `takeNationalJob` closes your old spell, hands
 * that country's eleven back so the AI picks its own again, and opens a new
 * spell here. Your club job is untouched either way.
 *
 * The list is built from `manageableNations`, so it only ever offers countries
 * that can really field a squad in this world — the same call the action gates
 * on, rather than a second opinion about who exists.
 */
function SwitchCountry() {
  const { league, godModeTakeNationalJobAction, leaveNationalJobAction, simming } = useLeague();
  const navigate = useNavigate();
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<string | null>(null);

  // Every nation in the world with a deep enough pool, a keeper in it and a
  // confederation to qualify through. Walks the whole player pool, so it is
  // held behind a memo rather than recomputed as the search box is typed into.
  const nations = useMemo(
    () => (league ? manageableNations(league.players) : []),
    [league],
  );
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? nations.filter((n) => n.toLowerCase().includes(q)) : nations;
  }, [nations, filter]);

  if (!league) return null;

  const current = league.nationalManager.nation;
  // A spectator manages nobody at all, and a country taken here would never be
  // judged by its federation — reviewNationalCampaign sits a spectator save out
  // entirely. So this is refused rather than half-working, and the way in is
  // the tab next door.
  const spectating = isSpectator(league);

  const take = async () => {
    if (picked === null) return;
    await godModeTakeNationalJobAction(picked);
    navigate("/national-teams/federation");
  };

  const stepDown = async () => {
    await leaveNationalJobAction();
    setPicked(null);
  };

  if (spectating) {
    return (
      <div className="text-muted small" style={{ maxWidth: 560 }}>
        You&apos;re spectating, so there&apos;s no manager here for a federation to appoint.
        Take a club on the Switch Club tab first and the countries will open up.
      </div>
    );
  }

  if (nations.length === 0) {
    return (
      <div className="text-muted small" style={{ maxWidth: 560 }}>
        No country in this world has enough players born into it to field a squad, so
        there&apos;s no national job to take. Worlds with more leagues in them generate
        deeper pools.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3">
        <div className="fw-semibold">
          {current ? <NationName nation={current} /> : "No country"}
        </div>
        <div className="text-muted small">
          {current
            ? "The country you manage now, alongside your club"
            : "You manage a club only. Take a country here without waiting to be asked."}
        </div>
      </div>

      <input
        type="search"
        className="form-control form-control-sm mb-2"
        style={{ maxWidth: 340 }}
        placeholder="Search countries"
        aria-label="Search countries"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {/* A list rather than a <select>, for the reason New League's picker
          gives: an <option> can't hold the flag. */}
      <div className="list-group mb-3" style={{ maxWidth: 420, maxHeight: 260, overflowY: "auto" }}>
        {shown.map((n) => (
          <button
            type="button"
            key={n}
            disabled={n === current}
            className={`list-group-item list-group-item-action py-1 d-flex align-items-center gap-2${picked === n ? " active" : ""}`}
            onClick={() => setPicked(n)}
          >
            <Flag nationality={n} tip={false} />
            {n}
            {n === current && <span className="ms-auto small">current</span>}
          </button>
        ))}
        {shown.length === 0 && (
          <div className="list-group-item text-muted small">No country by that name.</div>
        )}
      </div>

      {picked !== null && picked !== current && (
        <div className="gm-panel" style={{ maxWidth: 560 }}>
          <div className="gm-panel-title">
            <NationName nation={picked} />
          </div>
          <ul className="small text-secondary mb-3">
            {current && (
              <li>
                Your spell with {current} closes there, and they pick their own eleven again
                from the squad you named.
              </li>
            )}
            <li>
              {picked} starts you on a fresh slate with the federation, and the record goes
              down as a spell like any other.
            </li>
            <li>
              A campaign already under way is inherited as it stands. You take over the squad
              they have, the way a real country changes manager mid-cycle.
            </li>
            <li>Nothing about your club job changes.</li>
          </ul>
          <button className="btn btn-sm btn-warning" disabled={simming} onClick={take}>
            Take charge of {picked}
          </button>
        </div>
      )}

      {current && (
        <div className="mt-3">
          <button
            className="btn btn-sm btn-outline-secondary"
            disabled={simming}
            onClick={stepDown}
          >
            Step down as {current} manager
          </button>
          <div className="text-muted small mt-1">
            Back to club football only. You can take a country again from here whenever you want.
          </div>
        </div>
      )}
    </div>
  );
}

// --- Section B: Create Player ---
function CreatePlayer() {
  const { league, createPlayerAction } = useLeague();
  // Starts empty, with "New Player" as a placeholder rather than a value. It
  // used to be the value, and a created player keeps his name forever: one that
  // was never typed over ends up on the all-time boards as "New Player", which
  // is what a real save was found doing.
  const [name, setName] = useState("");
  const [nationality, setNationality] = useState(NATION_NAMES[0]);
  const [pos, setPos] = useState<Position>("ST");
  const [age, setAge] = useState(20);
  const [heightCm, setHeightCm] = useState(180);
  const [potential, setPotential] = useState(70);
  const [salary, setSalary] = useState(1_000_000);
  const [contractLength, setContractLength] = useState(4);
  const [ratings, setRatings] = useState<PlayerRatings>(flatRatings(50));
  const [tid, setTid] = useState<number | "fa">("fa");
  const [created, setCreated] = useState<string | null>(null);

  if (!league) return null;

  // Trailing spaces would survive into every board he ever appears on.
  const trimmedName = name.trim();

  const submit = async () => {
    if (!trimmedName) return;
    const spec: NewPlayerSpec = {
      name: trimmedName, nationality, pos, heightCm, age, ratings, potential,
      contract: { salary, expiresSeason: league.season + contractLength },
      tid: tid === "fa" ? null : tid,
    };
    await createPlayerAction(spec);
    setCreated(trimmedName);
  };

  return (
    <div>
      <div className="row g-2 mb-3">
        <div className="col-12 col-md-6">
          <label className="form-label form-label-sm">Name</label>
          <input
            className="form-control form-control-sm"
            placeholder="New Player"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="col-12 col-md-6">
          <label className="form-label form-label-sm">Nationality</label>
          <select className="form-select form-select-sm" value={nationality} onChange={(e) => setNationality(e.target.value)}>
            {NATION_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className="col-6 col-md-3">
          <label className="form-label form-label-sm">Position</label>
          <select className="form-select form-select-sm" value={pos} onChange={(e) => setPos(e.target.value as Position)}>
            {POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="col-6 col-md-3">
          <label className="form-label form-label-sm">Age</label>
          <input type="number" className="form-control form-control-sm" value={age} onChange={(e) => setAge(Number(e.target.value))} />
        </div>
        <div className="col-6 col-md-3">
          <label className="form-label form-label-sm">Height (cm)</label>
          <input type="number" className="form-control form-control-sm" value={heightCm} onChange={(e) => setHeightCm(Number(e.target.value))} />
        </div>
        <div className="col-6 col-md-3">
          <label className="form-label form-label-sm">Potential</label>
          <input type="number" className="form-control form-control-sm" value={potential} onChange={(e) => setPotential(Number(e.target.value))} />
        </div>
        <div className="col-6 col-md-3">
          <label className="form-label form-label-sm">Season wage (£)</label>
          <input type="number" className="form-control form-control-sm" value={salary} onChange={(e) => setSalary(Number(e.target.value))} />
        </div>
        <div className="col-6 col-md-3">
          <label className="form-label form-label-sm">Contract length (seasons)</label>
          <input type="number" className="form-control form-control-sm" value={contractLength} onChange={(e) => setContractLength(Number(e.target.value))} />
        </div>
        <div className="col-12 col-md-6">
          <label className="form-label form-label-sm">Place on</label>
          <select
            className="form-select form-select-sm"
            value={tid === "fa" ? "fa" : String(tid)}
            onChange={(e) => setTid(e.target.value === "fa" ? "fa" : Number(e.target.value))}
          >
            <option value="fa">Free agent</option>
            {[...league.teams].sort((a, b) => a.name.localeCompare(b.name)).map((t) => (
              <option key={t.tid} value={t.tid}>{t.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="gm-panel-title">Ratings</div>
      <div className="gm-ratings-grid mb-3">
        {SKILL_KEYS.map((key) => (
          <div key={key}>
            <label className="form-label form-label-sm m-0">{SKILL_LABELS[key]}</label>
            <input
              type="number" min={0} max={100} className="form-control form-control-sm"
              value={ratings[key]}
              onChange={(e) => setRatings((r) => ({ ...r, [key]: Number(e.target.value) }))}
            />
          </div>
        ))}
      </div>

      <div className="d-flex align-items-center gap-3">
        <button className="btn btn-sm btn-warning" onClick={submit} disabled={!trimmedName}>
          Create Player
        </button>
        {created && <span className="text-success small">Created {created}.</span>}
      </div>
    </div>
  );
}

// --- Section C: Roster Builder ---
function RosterBuilder() {
  const { league, movePlayerToClubAction, releasePlayerGodModeAction } = useLeague();
  const [tid, setTid] = useState<number | null>(null);
  const [filter, setFilter] = useState("");
  const { sort, toggle } = useTableSort<"default" | "name" | "pos" | "ovr">("default", "desc");
  const playerById = usePlayerMap(league?.players);
  // Every club's rostered/academy pids, used to sort free agents to the top.
  const rosteredPids = useMemo(() => {
    const pids = new Set<number>();
    for (const t of league?.teams ?? []) {
      for (const pid of t.roster) pids.add(pid);
      for (const pid of t.academyRoster) pids.add(pid);
    }
    return pids;
  }, [league?.teams]);
  if (!league) return null;

  const teamsSorted = [...league.teams].sort((a, b) => a.name.localeCompare(b.name));
  const selectedTid = tid ?? league.meta.userTid;
  const club = league.teams.find((t) => t.tid === selectedTid);

  const rosterPlayers = sortRows(
    (club?.roster ?? [])
      .map((pid) => playerById.get(pid))
      .filter((p): p is NonNullable<typeof p> => p != null),
    sort,
    { name: (p) => p.name, pos: (p) => p.pos, ovr: (p) => p.ovr },
  );

  // Hoisted out of the filter chain below: `roster.includes` per player made the
  // scan O(players x squad), and `filter.toLowerCase()` was being recomputed
  // once per player. The whole list re-derives on every keystroke in the search
  // box, so both showed up directly in this page's interaction latency.
  const clubRosterPids = new Set(club?.roster ?? []);
  const needle = filter.trim().toLowerCase();

  const addable = league.players
    .filter((p) => !clubRosterPids.has(p.pid))
    .filter((p) => needle === "" || p.name.toLowerCase().includes(needle))
    .sort((a, b) => {
      const aFa = rosteredPids.has(a.pid) ? 1 : 0;
      const bFa = rosteredPids.has(b.pid) ? 1 : 0;
      return aFa - bFa || b.ovr - a.ovr;
    })
    .slice(0, 100);

  return (
    <div>
      <div className="mb-3" style={{ maxWidth: 340 }}>
        <label className="form-label form-label-sm">Club</label>
        <select className="form-select form-select-sm" value={selectedTid} onChange={(e) => setTid(Number(e.target.value))}>
          {teamsSorted.map((t) => <option key={t.tid} value={t.tid}>{t.name}</option>)}
        </select>
      </div>

      <table className="table table-sm align-middle">
        <thead><tr>
          <SortableTh sortKey="name" sort={sort} onSort={toggle} defaultDir="asc">Player</SortableTh>
          <SortableTh sortKey="pos" sort={sort} onSort={toggle} defaultDir="asc">Pos</SortableTh>
          <SortableTh sortKey="ovr" sort={sort} onSort={toggle}>OVR</SortableTh>
          <th className="text-end">Actions</th>
        </tr></thead>
        <tbody>
          {rosterPlayers.map((p) => {
            const pid = p.pid;
            return (
              <tr key={pid}>
                <td><Link to={`/player/${pid}`}>{p.name}</Link></td>
                <td>{p.pos}</td>
                <td>{p.ovr}</td>
                <td className="text-end">
                  <select
                    className="form-select form-select-sm d-inline-block me-2" style={{ width: "auto" }}
                    value="" onChange={(e) => movePlayerToClubAction(pid, Number(e.target.value))}
                  >
                    <option value="" disabled>Move to…</option>
                    {teamsSorted.filter((t) => t.tid !== selectedTid).map((t) => (
                      <option key={t.tid} value={t.tid}>{t.name}</option>
                    ))}
                  </select>
                  <button className="btn btn-sm btn-outline-danger" onClick={() => releasePlayerGodModeAction(pid)}>Release</button>
                </td>
              </tr>
            );
          })}
          {club && club.roster.length === 0 && (
            <tr><td colSpan={4} className="text-muted">Empty roster.</td></tr>
          )}
        </tbody>
      </table>

      <div className="gm-panel">
        <div className="gm-panel-title">Add a player to {club?.name}</div>
        <input
          className="form-control form-control-sm mb-2" placeholder="Filter by name…"
          value={filter} onChange={(e) => setFilter(e.target.value)}
        />
        <select
          className="form-select form-select-sm" value=""
          onChange={(e) => movePlayerToClubAction(Number(e.target.value), selectedTid)}
        >
          <option value="" disabled>Select a player to add…</option>
          {addable.map((p) => (
            <option key={p.pid} value={p.pid}>
              {p.name} — {p.pos} {p.ovr}{rosteredPids.has(p.pid) ? "" : " (free agent)"}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

// --- Section D: Club Finances & Identity ---
function ClubFinances() {
  const { league, setClubFinancesAction, customizeTeamsAction } = useLeague();
  const [tid, setTid] = useState<number | null>(null);
  const [budget, setBudget] = useState<number | null>(null);
  const [hype, setHype] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const [savingIdentity, setSavingIdentity] = useState(false);
  if (!league) return null;

  const teamsSorted = [...league.teams].sort((a, b) => a.name.localeCompare(b.name));
  const selectedTid = tid ?? league.meta.userTid;
  const club = league.teams.find((t) => t.tid === selectedTid)!;
  // Fall back to the club's live values until the user edits a field.
  const budgetVal = budget ?? club.budget;
  const hypeVal = hype ?? club.hype;

  const pickClub = (newTid: number) => {
    setTid(newTid);
    setBudget(null);
    setHype(null);
    setSaved(false);
  };

  const saveFinance = async () => {
    await setClubFinancesAction(selectedTid, budgetVal, hypeVal);
    setSaved(true);
  };

  const identityTeams: EditableTeam[] = league.teams.map((t) => ({
    tid: t.tid, compId: t.compId, name: t.name, abbrev: t.abbrev,
    colors: [...t.colors] as [string, string],
  }));

  return (
    <div>
      <div className="mb-3" style={{ maxWidth: 340 }}>
        <label className="form-label form-label-sm">Club</label>
        <select className="form-select form-select-sm" value={selectedTid} onChange={(e) => pickClub(Number(e.target.value))}>
          {teamsSorted.map((t) => <option key={t.tid} value={t.tid}>{t.name}</option>)}
        </select>
      </div>

      <div className="row g-2 mb-2" style={{ maxWidth: 480 }}>
        <div className="col-6">
          <label className="form-label form-label-sm">Budget (£)</label>
          <input type="number" className="form-control form-control-sm" value={budgetVal} onChange={(e) => { setBudget(Number(e.target.value)); setSaved(false); }} />
        </div>
        <div className="col-6">
          <label className="form-label form-label-sm">Hype (0–100)</label>
          <input type="number" min={0} max={100} className="form-control form-control-sm" value={hypeVal} onChange={(e) => { setHype(Number(e.target.value)); setSaved(false); }} />
        </div>
      </div>
      <div className="d-flex align-items-center gap-3 mb-4">
        <button className="btn btn-sm btn-warning" onClick={saveFinance}>Save finances</button>
        {saved && <span className="text-success small">Saved.</span>}
      </div>

      <div className="gm-panel-title">Club Identity (all competitions)</div>
      <TeamIdentityEditor
        initialTeams={identityTeams}
        competitions={league.competitions}
        userTid={league.meta.userTid}
        saveLabel="Save identities"
        savingLabel="Saving…"
        saving={savingIdentity}
        onSave={async (teams) => {
          setSavingIdentity(true);
          try {
            await customizeTeamsAction(league.lid, teams);
          } finally {
            setSavingIdentity(false);
          }
        }}
        onCancel={() => { /* no-op: editor is embedded, nothing to close */ }}
      />
    </div>
  );
}
