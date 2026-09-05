import { NavLink } from "react-router-dom";
import { useLeague } from "../context/LeagueContext.js";
import { isSpectator } from "../../core/spectator.js";

interface SidebarProps {
  /** Drawer open state (only affects the mobile off-canvas presentation). */
  open: boolean;
  /** Called when a nav link is tapped, so the mobile drawer can close itself. */
  onNavigate: () => void;
}

export function Sidebar({ open, onNavigate }: SidebarProps) {
  const { league } = useLeague();
  // Nobody manages a club, so every link under Team is a page about a club that
  // does not exist. They are hidden rather than disabled: a greyed-out Roster
  // would imply a squad you could get to, and there is never going to be one.
  const spectating = !!league && isSpectator(league);
  return (
    <nav
      className={`sidebar d-flex flex-column${open ? " open" : ""}`}
      aria-label="Primary"
    >
      <div className="nav-section">League</div>
      <NavLink to="/dashboard" className="nav-link" onClick={onNavigate}>Dashboard</NavLink>
      <NavLink to="/standings" className="nav-link" onClick={onNavigate}>Standings</NavLink>
      <NavLink to="/cup" className="nav-link" onClick={onNavigate}>Continental Cup</NavLink>
      <NavLink to="/shield" className="nav-link" onClick={onNavigate}>Continental Shield</NavLink>
      <NavLink to="/domestic-cup" className="nav-link" onClick={onNavigate}>Domestic Cup</NavLink>
      <NavLink to="/champions-cups" className="nav-link" onClick={onNavigate}>Champions Cups</NavLink>
      <NavLink to="/promotion-playoffs" className="nav-link" onClick={onNavigate}>Promotion Playoffs</NavLink>
      <NavLink to="/power-rankings" className="nav-link" onClick={onNavigate}>Power Rankings</NavLink>
      {/* Your club's fixture list, not the world's — so it has nothing to show
          without a club, despite sitting under League. */}
      {!spectating && (
        <NavLink to="/schedule" className="nav-link" onClick={onNavigate}>Schedule</NavLink>
      )}
      <NavLink to="/leaders" className="nav-link" onClick={onNavigate}>Stat Leaders</NavLink>
      <NavLink to="/awards" className="nav-link" onClick={onNavigate}>Awards</NavLink>
      <NavLink to="/season-history" className="nav-link" onClick={onNavigate}>Season History</NavLink>
      <NavLink to="/history" className="nav-link" onClick={onNavigate}>Club History</NavLink>
      <NavLink to="/frivolities" className="nav-link" onClick={onNavigate}>Frivolities</NavLink>
      <NavLink to="/season-preview" className="nav-link" onClick={onNavigate}>Season Preview</NavLink>
      <NavLink to="/news" className="nav-link" onClick={onNavigate}>News Feed</NavLink>
      {/*
        The watchlist is a note to yourself about players anywhere in the world,
        not an instruction to a club — which is why `switchClub` deliberately
        keeps it across a move. It survives here too, and moves up into League,
        since a spectator following prospects is exactly what it is for and the
        section it normally lives in is about to disappear.
      */}
      {spectating && (
        <NavLink to="/watchlist" className="nav-link" onClick={onNavigate}>Watchlist</NavLink>
      )}

      {!spectating && (
        <>
          <div className="nav-section">Team</div>
          <NavLink to="/manager" className="nav-link" onClick={onNavigate}>Manager</NavLink>
          <NavLink to="/roster" className="nav-link" onClick={onNavigate}>Roster</NavLink>
          <NavLink to="/transfers" className="nav-link" onClick={onNavigate}>Transfers</NavLink>
          <NavLink to="/watchlist" className="nav-link" onClick={onNavigate}>Watchlist</NavLink>
          <NavLink to="/incoming-offers" className="nav-link" onClick={onNavigate}>Incoming Offers</NavLink>
          <NavLink to="/loans" className="nav-link" onClick={onNavigate}>Loans</NavLink>
          <NavLink to="/finance" className="nav-link" onClick={onNavigate}>Finance</NavLink>
          <NavLink to="/youth-intake" className="nav-link" onClick={onNavigate}>Youth Intake</NavLink>
          <NavLink to="/free-agents" className="nav-link" onClick={onNavigate}>Free Agents</NavLink>
          <NavLink to="/academy" className="nav-link" onClick={onNavigate}>Academy</NavLink>
        </>
      )}

      <div className="nav-section">National Teams</div>
      {/*
        The first three run a country you manage; the rest are the world's
        international football, which is as watchable as any league. A spectator
        manages no country either (`createLeagueState` forces it null), so those
        three go with the Team block.
      */}
      {!spectating && (
        <>
          <NavLink to="/national-teams/my-squad" className="nav-link" onClick={onNavigate}>My Squad</NavLink>
          <NavLink to="/national-teams/player-pool" className="nav-link" onClick={onNavigate}>Player Pool</NavLink>
          <NavLink to="/national-teams/federation" className="nav-link" onClick={onNavigate}>Federation</NavLink>
        </>
      )}
      <NavLink to="/national-teams/world-cup" className="nav-link" onClick={onNavigate}>World Cup</NavLink>
      <NavLink to="/national-teams/qualifying" className="nav-link" onClick={onNavigate}>Qualifying</NavLink>
      <NavLink to="/national-teams/confederation-cups" className="nav-link" onClick={onNavigate}>Confederation Cups</NavLink>
      <NavLink to="/national-teams/rosters" className="nav-link" onClick={onNavigate}>Rosters</NavLink>
      <NavLink to="/national-teams/schedule" className="nav-link" onClick={onNavigate}>Schedule</NavLink>
      <NavLink to="/national-teams/power-rankings" className="nav-link" onClick={onNavigate}>Power Rankings</NavLink>
      <NavLink to="/national-teams/leaders" className="nav-link" onClick={onNavigate}>Stat Leaders</NavLink>
      <NavLink to="/national-teams/history" className="nav-link" onClick={onNavigate}>History</NavLink>

      {league?.godMode && (
        <>
          <div className="nav-section nav-section--god">God Mode</div>
          <NavLink to="/god-mode" className="nav-link nav-link--god" onClick={onNavigate}>Sandbox Tools</NavLink>
        </>
      )}

      <div className="nav-section">Help</div>
      <NavLink to="/manual" className="nav-link" onClick={onNavigate}>Manual</NavLink>
      <NavLink to="/changelog" className="nav-link" onClick={onNavigate}>Changelog</NavLink>
      <a
        href="https://discord.gg/6nHkCZn3Mp"
        className="nav-link"
        target="_blank"
        rel="noopener noreferrer"
        onClick={onNavigate}
      >
        Join the Discord
      </a>
    </nav>
  );
}
