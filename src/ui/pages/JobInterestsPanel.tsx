import { useMemo, useState } from "react";
import { ClubLink } from "../components/ClubLink.js";
import { NationName } from "./nationalTeams/shared.js";
import { CompetitionSelect } from "../components/CompetitionSelect.js";
import { ordinal } from "../format.js";
import type { LeagueStore } from "../../core/leagueState.js";
import {
  MANAGER_MAX_INTERESTS, MANAGER_OFFER_BAND, NATIONAL_MAX_INTERESTS, NATIONAL_OFFER_BAND,
} from "../../core/constants.js";
import {
  cachedExpectations, clubInterests, clubOfferTarget, interestOutlook, interestReach,
  managerReputation, type InterestOutlook,
} from "../../core/manager/index.js";
import {
  nationExpectations, nationInterests, nationOfferTarget, nationalReputation,
} from "../../core/nationalManager/index.js";

const OUTLOOK: Record<InterestOutlook, { label: string; className: string }> = {
  "within-reach": { label: "Within reach", className: "bg-success" },
  "long-shot": { label: "A long shot", className: "bg-warning text-dark" },
  "out-of-reach": { label: "Out of reach for now", className: "bg-secondary" },
};

function OutlookBadge({ reach }: { reach: number }) {
  const o = OUTLOOK[interestOutlook(reach)];
  return <span className={`badge ${o.className}`}>{o.label}</span>;
}

/**
 * The jobs the user would like, club and country, with how realistic each one
 * is right now.
 *
 * The realism label is computed with the same target and band the offer
 * generator uses, so "within reach" on this card and a call arriving in the
 * summer can't disagree about what the user's record is worth. It reads the
 * record as it stands today; the review at the end of the season counts that
 * season too, so a good year can move a long shot into reach before it rolls.
 */
export function JobInterestsPanel({
  league,
  simming,
  onClub,
  onNation,
}: {
  league: LeagueStore;
  simming: boolean;
  onClub: (tid: number, on: boolean) => void;
  onNation: (nation: string, on: boolean) => void;
}) {
  const userTid = league.meta.userTid;
  const clubExp = useMemo(() => cachedExpectations(league), [league]);
  const natExp = useMemo(
    () => nationExpectations(
      league.international.powerRankings[league.international.powerRankings.length - 1],
    ),
    [league],
  );

  const ownComp = league.teams.find((t) => t.tid === userTid)?.compId ?? league.competitions[0]?.id ?? 0;
  const [compId, setCompId] = useState<number>(ownComp);
  const [pickTid, setPickTid] = useState<number | "">("");
  const [pickNation, setPickNation] = useState<string>("");

  const clubs = clubInterests(league.manager);
  const nations = nationInterests(league.nationalManager);

  const clubTarget = clubOfferTarget(
    managerReputation(league.manager.stints),
    clubExp.get(userTid)?.prestige ?? 0,
    league.manager.sacked,
  );
  const currentNation = league.nationalManager.nation;
  const nationTarget = nationOfferTarget(
    nationalReputation(league.nationalManager.stints),
    managerReputation(league.manager.stints),
    currentNation ? natExp.get(currentNation)?.prestige ?? 0 : 0,
    false,
  );

  const clubOptions = league.teams
    .filter((t) => t.compId === compId && t.tid !== userTid && !clubs.includes(t.tid))
    .sort((a, b) => a.name.localeCompare(b.name));
  const nationOptions = [...natExp.values()]
    .filter((e) => e.nation !== currentNation && !nations.includes(e.nation))
    .sort((a, b) => a.rank - b.rank);
  const compName = (id: number) => league.competitions.find((c) => c.id === id)?.name ?? "";

  const clubsFull = clubs.length >= MANAGER_MAX_INTERESTS;
  const nationsFull = nations.length >= NATIONAL_MAX_INTERESTS;

  return (
    <div className="card mb-4">
      <div className="card-body">
        <h6 className="card-title">Jobs you'd like</h6>
        <p className="text-muted small">
          Tell the game which clubs and countries you'd love to manage, up to{" "}
          {MANAGER_MAX_INTERESTS} of each. Every summer each one gets its own chance to call,
          on top of the usual offers. Anywhere at your level or below would be glad to have you,
          so a small club you care about is fair game. A bigger job only calls if your record is
          close to good enough for it, and the closer you are the likelier it gets. It won't
          hand you anything, it just makes the call more likely.
        </p>

        <div className="fw-semibold small mb-2">Clubs</div>
        {clubs.length === 0 ? (
          <p className="text-muted small">No clubs picked.</p>
        ) : (
          <ul className="list-unstyled mb-2">
            {clubs.map((tid) => {
              const e = clubExp.get(tid);
              const team = league.teams.find((t) => t.tid === tid);
              return (
                <li key={tid} className="d-flex align-items-center gap-2 mb-2 flex-wrap">
                  <ClubLink tid={tid} crest />
                  <span className="text-muted small">{team ? compName(team.compId) : ""}</span>
                  {e && <OutlookBadge reach={interestReach(e.prestige, clubTarget, MANAGER_OFFER_BAND)} />}
                  <button
                    className="btn btn-outline-secondary btn-sm ms-auto"
                    disabled={simming}
                    onClick={() => onClub(tid, false)}
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="d-flex gap-2 flex-wrap mb-4">
          <CompetitionSelect
            competitions={league.competitions}
            value={compId}
            onChange={(v) => { if (v !== "all") { setCompId(v); setPickTid(""); } }}
          />
          <select
            className="form-select form-select-sm"
            style={{ width: "auto" }}
            aria-label="Club"
            value={pickTid}
            disabled={clubsFull}
            onChange={(e) => setPickTid(e.target.value === "" ? "" : Number(e.target.value))}
          >
            <option value="">Pick a club</option>
            {clubOptions.map((t) => <option key={t.tid} value={t.tid}>{t.name}</option>)}
          </select>
          <button
            className="btn btn-primary btn-sm"
            disabled={simming || clubsFull || pickTid === ""}
            onClick={() => {
              if (pickTid === "") return;
              onClub(pickTid, true);
              setPickTid("");
            }}
          >
            Add
          </button>
          {clubsFull && <span className="text-muted small align-self-center">That's the most you can pick.</span>}
        </div>

        <div className="fw-semibold small mb-2">Countries</div>
        {natExp.size === 0 ? (
          <p className="text-muted small mb-0">
            Federations haven't ranked anyone yet. That happens when your first season ends, and
            you can pick countries from then on.
          </p>
        ) : (
          <>
            {nations.length === 0 ? (
              <p className="text-muted small">No countries picked.</p>
            ) : (
              <ul className="list-unstyled mb-2">
                {nations.map((nation) => {
                  const e = natExp.get(nation);
                  return (
                    <li key={nation} className="d-flex align-items-center gap-2 mb-2 flex-wrap">
                      <NationName nation={nation} />
                      {e && <span className="text-muted small">{ordinal(e.rank)} of {e.nations}</span>}
                      {e
                        ? <OutlookBadge reach={interestReach(e.prestige, nationTarget, NATIONAL_OFFER_BAND)} />
                        : <span className="badge bg-secondary">Not ranked right now</span>}
                      <button
                        className="btn btn-outline-secondary btn-sm ms-auto"
                        disabled={simming}
                        onClick={() => onNation(nation, false)}
                      >
                        Remove
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="d-flex gap-2 flex-wrap">
              <select
                className="form-select form-select-sm"
                style={{ width: "auto" }}
                aria-label="Country"
                value={pickNation}
                disabled={nationsFull}
                onChange={(e) => setPickNation(e.target.value)}
              >
                <option value="">Pick a country</option>
                {nationOptions.map((e) => (
                  <option key={e.nation} value={e.nation}>{ordinal(e.rank)}. {e.nation}</option>
                ))}
              </select>
              <button
                className="btn btn-primary btn-sm"
                disabled={simming || nationsFull || pickNation === ""}
                onClick={() => {
                  if (!pickNation) return;
                  onNation(pickNation, true);
                  setPickNation("");
                }}
              >
                Add
              </button>
              {nationsFull && <span className="text-muted small align-self-center">That's the most you can pick.</span>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
