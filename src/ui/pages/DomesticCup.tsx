import { useState } from "react";
import { useLeague } from "../context/LeagueContext.js";
import { HelpHint } from "../components/HelpHint.js";
import { ClubCrest } from "../components/ClubCrest.js";
import { ClubLink } from "../components/ClubLink.js";
import { seasonYear } from "../format.js";
import type { CupTie } from "../../core/cup/types.js";
import type { DomesticCupState, DomesticCupRound } from "../../core/domesticCup/types.js";
import {
  domesticRoundName, domesticFinalists, clubDomesticRunLabel, pendingRound,
  clubsInPendingRound,
} from "../../core/domesticCup/cup.js";
import { EmptyState } from "../components/EmptyState.js";

/** A round's ties if it has been played, otherwise the draw waiting to be played. */
type Slot =
  | { kind: "played"; tie: CupTie }
  | { kind: "pending"; home: number; away: number };

function roundSlots(round: DomesticCupRound): Slot[] {
  if (round.ties.length > 0) return round.ties.map((tie) => ({ kind: "played" as const, tie }));
  return round.pairings.map((p) => ({ kind: "pending" as const, home: p.home, away: p.away }));
}

export function DomesticCup() {
  const { league } = useLeague();
  const [countrySel, setCountrySel] = useState<string | null>(null);
  const [seasonSel, setSeasonSel] = useState<number | "current">("current");

  if (!league) return <p className="p-3">Loading...</p>;

  const current = league.domesticCups ?? [];
  const history = league.domesticCupHistory ?? [];
  const userTid = league.meta.userTid;
  const userTeam = league.teams.find((t) => t.tid === userTid);
  const userCountry = league.competitions.find((c) => c.id === userTeam?.compId)?.country;

  // Every country that has a cup in any season on file, so a save that picked
  // domestic cups up mid-dynasty still lists them.
  const countries = [...new Set([...current, ...history].map((c) => c.country))];

  if (countries.length === 0) {
    return (
      <div className="container-fluid p-3">
        <h4>Domestic Cup</h4>
        <EmptyState headline="Domestic cups start next season in this save.">
          <p>
            Every country runs one, and every club in the country is in it: a straight knockout
            across all of its divisions, drawn out of the hat round by round rather than seeded
            into a fixed bracket.
          </p>
          <p>
            That is where the upsets come from. A lower-division club really can draw a top-flight
            one at home, and win.
          </p>
        </EmptyState>
      </div>
    );
  }

  const country = countrySel ?? (userCountry && countries.includes(userCountry) ? userCountry : countries[0]);
  const countryHistory = history.filter((c) => c.country === country).sort((a, b) => b.season - a.season);
  const countryCurrent = current.find((c) => c.country === country);

  const cup: DomesticCupState | undefined =
    seasonSel === "current"
      ? countryCurrent ?? countryHistory[0]
      : countryHistory.find((h) => h.season === seasonSel) ?? countryCurrent;

  // The season this bracket belongs to, so every club on it links to what that
  // club did that year rather than to today.
  const shownSeason = cup?.season;
  const teamColors = (tid: number): [string, string] =>
    league.teams.find((t) => t.tid === tid)?.colors ?? ["#888888", "#888888"];
  const tierOf = (tid: number): number | undefined => {
    const t = league.teams.find((x) => x.tid === tid);
    return league.competitions.find((c) => c.id === t?.compId)?.tier;
  };

  const teamCell = (tid: number, isWinner: boolean) => (
    <span className={`cup-team${isWinner ? " cup-team-winner" : ""}${tid === userTid ? " cup-team-user" : ""}`}>
      <ClubCrest tid={tid} colors={teamColors(tid)} size={16} />
      <span className="cup-team-name">
        <ClubLink tid={tid} season={shownSeason} />
      </span>
      {tierOf(tid) === 2 && <span className="cup-team-tier">D2</span>}
    </span>
  );

  const renderTie = (slot: Slot) => {
    if (slot.kind === "pending") {
      return (
        <>
          <div className="cup-tie-row">{teamCell(slot.home, false)}</div>
          <div className="cup-tie-row">{teamCell(slot.away, false)}</div>
        </>
      );
    }
    const t = slot.tie;
    const rowClass = (tid: number) =>
      `cup-tie-row ${t.winner === tid ? "cup-tie-row--won" : "cup-tie-row--out"}`;
    return (
      <>
        <div className={rowClass(t.home)}>
          {teamCell(t.home, t.winner === t.home)}
          <span className="cup-tie-score">{t.homeGoals}</span>
        </div>
        <div className={rowClass(t.away)}>
          {teamCell(t.away, t.winner === t.away)}
          <span className="cup-tie-score">{t.awayGoals}</span>
        </div>
        {(t.wentToExtraTime || t.wentToPens) && (
          <div className="cup-tie-note">
            {t.wentToPens ? `${t.homePens}-${t.awayPens} on pens` : "after extra time"}
          </div>
        )}
      </>
    );
  };

  const finalists = cup ? domesticFinalists(cup) : [];
  const userRun = cup ? clubDomesticRunLabel(cup, userTid) : null;
  const waiting = cup ? pendingRound(cup) : null;
  // Still in it = drawn into (or given a bye in) the round that hasn't been
  // played yet. A club whose furthest round is already played is out.
  const userStillIn = waiting !== null && clubsInPendingRound(cup!).includes(userTid);

  return (
    <div className="container-fluid p-3">
      <h4>
        Domestic Cup
        <HelpHint>
          Every country runs its own knockout cup alongside the league, and every division is in
          it, so a lower-division club can knock out a champion. There are no seeds and no bracket: the
          survivors go back in the hat after every round and the home side is drawn at random. Ties
          are one match: level after 90 minutes goes to extra time, then penalties. Win this, your
          league and your continental cup (the Continental Cup, or the Americas Cup for a club in
          the Americas) in the same season and you have the treble. If your club
          reaches the final, the sim pauses so you can play it.
        </HelpHint>
      </h4>

      <div className="mb-3 d-flex gap-2 flex-wrap">
        <select
          className="form-select form-select-sm"
          style={{ width: "auto" }}
          value={country}
          onChange={(e) => setCountrySel(e.target.value)}
        >
          {countries.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select
          className="form-select form-select-sm"
          style={{ width: "auto" }}
          value={seasonSel}
          onChange={(e) => setSeasonSel(e.target.value === "current" ? "current" : Number(e.target.value))}
        >
          {countryCurrent && (
            <option value="current">Current Season ({seasonYear(league.season)})</option>
          )}
          {countryHistory.map((h) => (
            <option key={h.season} value={h.season}>{seasonYear(h.season)}</option>
          ))}
        </select>
      </div>

      {!cup ? (
        <p className="text-muted">No cup for this season.</p>
      ) : (
        <>
          <div className="mb-2">
            <strong>{cup.name}</strong>{" "}
            <span className="text-muted small">
              {cup.teams.length} clubs · {cup.totalRounds} rounds
            </span>
          </div>

          {cup.championTid !== null ? (
            <div className="cup-champion-banner mb-3">
              <span className="cup-champion-label">Winners</span>{" "}
              <ClubCrest tid={cup.championTid} colors={teamColors(cup.championTid)} size={22} />{" "}
              <strong><ClubLink tid={cup.championTid} season={shownSeason} /></strong>
            </div>
          ) : finalists.includes(userTid) ? (
            <div className="alert alert-warning py-2 mb-3">
              Your club has reached the final! Sim on to play it.
            </div>
          ) : userRun ? (
            <p className="text-muted small mb-3">
              {userStillIn
                ? "Your club is still in this cup."
                : `Your club went out in the ${userRun.toLowerCase()}.`}
            </p>
          ) : null}

          {/* Open draw: every round is redrawn from the hat, so these are
              columns of results, not a bracket tree. See the CSS note. */}
          <div className="cup-bracket cup-bracket--rounds">
            {cup.rounds.map((round) => {
              const slots = roundSlots(round);
              const isFinal = round.round === cup.totalRounds - 1;
              return (
                <div className="cup-round" key={round.round}>
                  <div className="cup-round-title">
                    <span>{domesticRoundName(cup, round.round)}</span>
                    <span className="cup-round-count">{slots.length}</span>
                  </div>
                  <div className="cup-round-body">
                    {slots.map((slot, i) => (
                      <div className={`cup-tie${isFinal ? " cup-tie--final" : ""}`} key={i}>
                        {renderTie(slot)}
                      </div>
                    ))}
                    {round.byes.length > 0 && (
                      <div className="cup-byes">
                        {round.byes.length} clubs enter in the next round
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {cup.championTid === null && cup.rounds.length < cup.totalRounds && (
            <p className="text-muted small mt-3">
              The next round is drawn once this one is played.
            </p>
          )}
        </>
      )}
    </div>
  );
}
