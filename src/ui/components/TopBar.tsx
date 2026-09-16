import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useLeague } from "../context/LeagueContext.js";
import { isIntlStagePending } from "../../core/international/index.js";
import { playoffsPending } from "../../core/playoffStages.js";
import { playoffStageButton, playoffStagesLeft } from "./PlayoffStageCard.js";
import { qualifyingLeg } from "../../core/constants.js";
import {
  intlStageButton,
  intlStageSkipLabel,
  intlStageThroughLabel,
  type PlayableStage,
} from "../intlStageLabels.js";
import { useSportName } from "../sportName.js";
import { useOffseasonAdvance } from "../useOffseasonAdvance.js";
import { isSpectator } from "../../core/spectator.js";
import { seasonYear } from "../format.js";
import { CopyAiPromptButton } from "./CopyAiPromptButton.js";
import { Dropdown } from "./Dropdown.js";
import { SimTargetForm } from "./SimTargetForm.js";
import { JumpSeasonsForm } from "./JumpSeasonsForm.js";
import { LOGO_URL } from "../publicAsset.js";

interface TopBarProps {
  /** Toggle the mobile navigation drawer (rendered as a hamburger, mobile only). */
  onToggleNav: () => void;
}

export function TopBar({ onToggleNav }: TopBarProps) {
  const {
    league, simAction, simLiveAction, intlStageAction, playoffStageAction, jumpSeasonsAction, simming,
    exportJSON, switchLeagueAction, setGodModeAction,
  } = useLeague();
  const { brand } = useSportName();
  const navigate = useNavigate();
  // Shared with the Dashboard's Advance button so the two can't route a given
  // save differently — a spectator has no scouting budget to stop at.
  const advanceOffseason = useOffseasonAdvance();
  // No club, so no match of yours to watch live and no board to be sacked by.
  const spectating = !!league && isSpectator(league);

  // The sidebar pins itself directly beneath this bar (see `.sidebar` in
  // styles.css), which needs the bar's real height rather than a guess: it runs
  // 52px on a phone and 59px on a desktop, and moves again with the user's font
  // size or a browser zoom. Measured here — the bar is the only thing that
  // knows — and republished on resize, since a stale value shows up as a strip
  // of page background between the bar and the pinned column.
  const barRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const bar = barRef.current;
    if (!bar || typeof ResizeObserver === "undefined") return;
    const publish = () => {
      document.documentElement.style.setProperty("--sg-topbar-h", `${bar.offsetHeight}px`);
    };
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(bar);
    return () => {
      ro.disconnect();
      // Back to the stylesheet's fallback, so a page rendered without this bar
      // (the manual's standalone shell) isn't left reading a stale height.
      document.documentElement.style.removeProperty("--sg-topbar-h");
    };
  }, []);

  function handleSwitchLeague() {
    switchLeagueAction();
    navigate("/leagues");
  }

  const isOffseason = league?.phase === "offseason";
  // The menu is phase-aware (see the Dropdown below), so the offseason no
  // longer disables it — only a sim already in flight does, and having no
  // league at all.
  const simDisabled = simming || !league;

  // Derive the matchday bounds from the remaining schedule: the one the club is
  // standing on, and the last one of the season (the "sim to matchday" range).
  const hasSchedule = !!league && league.phase !== "offseason" && league.schedule.length > 0;
  const currentMatchday = hasSchedule
    ? Math.min(...league!.schedule.map((g) => g.matchday))
    : null;
  const lastMatchday = hasSchedule
    ? Math.max(...league!.schedule.map((g) => g.matchday))
    : null;

  let statusText = "";
  if (league) {
    statusText = `${seasonYear(league.season)}`;
    statusText += currentMatchday === null ? " — Offseason" : ` — Matchday ${currentMatchday}`;
  }

  return (
    <>
    <nav ref={barRef} className="navbar navbar-dark app-topbar px-2 px-md-3">
      <button
        className="btn btn-sm mobile-nav-toggle d-md-none"
        type="button"
        aria-label="Open navigation menu"
        onClick={onToggleNav}
      >
        <span aria-hidden="true" className="mobile-nav-toggle-icon" />
      </button>

      <span className="navbar-brand mb-0 h1 d-flex align-items-center gap-2">
        <img src={LOGO_URL} alt="" width="32" height="32" className="rounded" />
        <span className="d-none d-sm-inline">{brand}</span>
      </span>

      <span className="topbar-status text-light">{statusText}</span>

      <div className="d-flex align-items-center gap-2">
        <Dropdown label={simming ? "Simming..." : "Sim"} alignEnd disabled={simDisabled}>
          {isOffseason && league ? (
            <>
              {/*
                The offseason half of the same menu. It carries the actions only —
                the Dashboard's card carries the prose that explains them, and a
                dropdown is the wrong place to repeat it. Same three branches, and
                the same handlers, so a click here does exactly what the card does.
              */}
              {league.manager.sacked ? (
                <li>
                  <button className="dropdown-item" onClick={() => navigate("/manager")}>
                    See who'll have you
                  </button>
                </li>
              ) : playoffsPending(league) ? (
                <>
                  <li>
                    <button
                      className="dropdown-item"
                      onClick={() => playoffStageAction("stage")}
                      disabled={simDisabled}
                    >
                      {playoffStageButton(league)}
                    </button>
                  </li>
                  {playoffStagesLeft(league) > 1 && (
                    <li>
                      <button
                        className="dropdown-item"
                        onClick={() => playoffStageAction("through")}
                        disabled={simDisabled}
                      >
                        Sim through the playoffs
                      </button>
                    </li>
                  )}
                </>
              ) : isIntlStagePending(league.international) ? (
                <>
                  <li>
                    <button
                      className="dropdown-item"
                      onClick={() => intlStageAction("stage")}
                      disabled={simDisabled}
                    >
                      {intlStageButton(
                        league.international.stage as PlayableStage,
                        qualifyingLeg(league.season) + 1,
                        league.international.confederationCups,
                        league.international.tournament,
                      )}
                    </button>
                  </li>
                  {league.international.stage !== "qualifying" && (
                    <li>
                      <button
                        className="dropdown-item"
                        onClick={() => intlStageAction("through")}
                        disabled={simDisabled}
                      >
                        {intlStageThroughLabel(league.international.stage as PlayableStage)}
                      </button>
                    </li>
                  )}
                  {/*
                    Skipping plays the games out anyway — the advance itself runs
                    every stage left unplayed, on the same seeded streams — so this
                    only decides whether you watch, never what happens.
                  */}
                  <li>
                    <button
                      className="dropdown-item"
                      onClick={advanceOffseason}
                      disabled={simDisabled}
                    >
                      {intlStageSkipLabel(league.international.stage as PlayableStage)}
                    </button>
                  </li>
                </>
              ) : (
                <li>
                  <button
                    className="dropdown-item"
                    onClick={advanceOffseason}
                    disabled={simDisabled}
                  >
                    Advance to {seasonYear(league.season + 1)}
                  </button>
                </li>
              )}
            </>
          ) : (
            <>
              <li>
                <button className="dropdown-item" onClick={() => simAction("game")} disabled={simDisabled}>
                  Sim One Game
                </button>
              </li>
              {/*
                Same matchday as "Sim One Game", watched rather than skipped. Sits
                here as well as on the Dashboard because this dropdown is the sim
                control that's reachable from every page.
              */}
              {/* Needs a club: the live viewer replays *your* match. */}
              {!spectating && (
                <li>
                  <button className="dropdown-item" onClick={() => simLiveAction()} disabled={simDisabled}>
                    Watch Next Game
                  </button>
                </li>
              )}
              <li>
                <button className="dropdown-item" onClick={() => simAction("season")} disabled={simDisabled}>
                  Sim to End of Season
                </button>
              </li>
              {currentMatchday !== null && lastMatchday !== null && (
                <>
                  <li><hr className="dropdown-divider" /></li>
                  <li>
                    <SimTargetForm
                      compact
                      current={currentMatchday}
                      last={lastMatchday}
                      disabled={simDisabled}
                      onSim={(matchday) => simAction({ matchday })}
                    />
                  </li>
                </>
              )}
            </>
          )}
        </Dropdown>

        {/*
          Jump ahead, reachable from every page rather than only the Dashboard.

          Its own control beside Sim rather than another item inside it, for the
          reason the Dashboard card it replaced spelled out: Sim advances the
          season a step at a time, while this hands a managed club to the AI for
          years. Folding them together would make the two read as the same kind
          of thing, and they are not. It carries the form, and the form still
          confirms in place before it runs.
        */}
        <Dropdown label="Jump" alignEnd disabled={simDisabled}>
          <li className="px-3 py-2 topbar-jump">
            {league && (
              <JumpSeasonsForm
                season={league.season}
                disabled={simDisabled}
                spectating={spectating}
                onJump={(seasons) => jumpSeasonsAction(seasons)}
              />
            )}
          </li>
        </Dropdown>

        {/* Wide windows: the save controls sit inline. The threshold is xl
            (1200px), not md, because the inline row needs ~1020px alongside the
            brand and season label — below that it wrapped onto a second line,
            costing ~20px of height and truncating the season to "2026 — Match…".
            Found in a 914x514 CrazyGames embed, but it was equally broken in any
            narrow browser window. */}
        <div className="d-none d-xl-flex align-items-center gap-2">
          <button className="btn btn-outline-light btn-sm" onClick={exportJSON} disabled={!league}>
            Export
          </button>
          <button className="btn btn-outline-light btn-sm" onClick={handleSwitchLeague}>
            Switch League
          </button>
          <CopyAiPromptButton
            world={league}
            className="btn btn-outline-light btn-sm"
            title="Copy a paste-ready prompt that teaches an AI this save's team-import format"
          />
          <button
            className={`btn btn-sm ${league?.godMode ? "btn-warning" : "btn-outline-light"}`}
            onClick={() => league && setGodModeAction(!league.godMode)}
            disabled={!league}
            title="Toggle God Mode: unlock guardrail-free editing for this save"
          >
            God Mode{league?.godMode ? ": On" : ""}
          </button>
        </div>

        {/* Narrower than xl: the same controls collapse into an overflow menu. */}
        <Dropdown
          className="d-xl-none"
          buttonClassName="btn btn-outline-light btn-sm topbar-more-toggle"
          ariaLabel="More actions"
          label={<span aria-hidden="true">•••</span>}
          alignEnd
        >
          <li>
            <button className="dropdown-item" onClick={exportJSON} disabled={!league}>
              Export Save
            </button>
          </li>
          <li>
            <button className="dropdown-item" onClick={handleSwitchLeague}>
              Switch League
            </button>
          </li>
          <li>
            <CopyAiPromptButton
              world={league}
              className="dropdown-item"
              copiedLabel="Copied AI Prompt!"
              title="Copy a paste-ready prompt that teaches an AI this save's team-import format"
            />
          </li>
          <li>
            <button
              className="dropdown-item"
              onClick={() => league && setGodModeAction(!league.godMode)}
              disabled={!league}
            >
              {league?.godMode ? "Disable God Mode" : "Enable God Mode"}
            </button>
          </li>
        </Dropdown>
      </div>
    </nav>
    </>
  );
}
