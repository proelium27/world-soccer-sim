import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Player } from "../../core/players/types.js";
import { useLeague } from "../context/LeagueContext.js";
import { ClubLink } from "../components/ClubLink.js";
import { PotHelp } from "../components/HelpHint.js";
import { transferWindowState } from "../../core/transfers/window.js";
import {
  inboundOfferCandidates, currentInboundOffers, type InboundOffer,
} from "../../core/transfers/inboundOffers.js";
import { scoutCommentary, type ScoutCommentary } from "../../core/transfers/scoutCommentary.js";
import { WINTER_WINDOW_OPEN_MATCHDAY } from "../../core/calendar.js";
import { currency, formatWeeklyWage, talksCollapsedMessage } from "../format.js";
import { Flag } from "../components/Flag.js";
import { OfferAmountInput } from "../components/OfferAmountInput.js";
import { ClauseEditor } from "../components/ClauseEditor.js";
import type { ProposedClause } from "../../core/transfers/clauses.js";
import { clausesAreValid } from "../../core/transfers/clauses.js";
import { buyerAcceptsClauses } from "../../core/transfers/inboundOffers.js";
import { PlayerRatingsTooltip } from "../components/PlayerRatingsTooltip.js";
import { PotDisplay } from "../components/PotDisplay.js";
import { SortableTh, useTableSort, sortRows } from "../components/SortableTable.js";

function scoutCommentaryText(commentary: ScoutCommentary, playerName: string): string {
  switch (commentary.tone) {
    case "good":
      return `That's a great deal for ${playerName}, take it!`;
    case "bad":
      return `Their evaluation of ${playerName} is clearly different than ours. This isn't worth discussing.`;
    case "counter":
      return `Maybe try to counter at ${currency.format(commentary.suggested)} and see how it goes.`;
  }
}

type OfferSortKey = "default" | "name" | "pos" | "age" | "ovr" | "pot" | "wage" | "offer";

interface OfferRowProps {
  pid: number;
  buyerTid: number;
  /** The buying club, already rendered - a link, so the reader can go and look at them. */
  buyerName: ReactNode;
  playerName: string;
  offerFee: number;
  negotiation: InboundOffer | undefined;
  disabled: boolean;
  commentary: ScoutCommentary | null;
  onAccept: (pid: number, clauses: ProposedClause[]) => void;
  onReject: (pid: number) => void;
  onCounter: (pid: number, amount: number, clauses: ProposedClause[]) => void;
}

function OfferRow({
  pid, buyerTid, buyerName, playerName, offerFee, negotiation, disabled, commentary,
  onAccept, onReject, onCounter,
}: OfferRowProps) {
  const [draft, setDraft] = useState(() => String(Math.round(offerFee * 1.2)));
  const [clauses, setClauses] = useState<ProposedClause[]>([]);
  const { league } = useLeague();
  // Add-ons ride on top of the cash, so accepting with them attached asks the
  // buyer for more than he offered. He only wears it while the whole package
  // stays under what the player is worth to him — checked here so the button
  // greys out rather than doing nothing when clicked.
  const clausesAcceptable = useMemo(
    () => (league ? buyerAcceptsClauses(league, pid, clauses) : true),
    [league, pid, clauses],
  );

  if (negotiation?.status === "accepted") {
    return <span className="text-success">Sold to {buyerName}</span>;
  }
  if (negotiation?.status === "rejected") {
    return <span className="text-danger">Rejected</span>;
  }
  if (negotiation?.status === "collapsed") {
    return <span className="text-danger">{talksCollapsedMessage(pid)}</span>;
  }

  const lastAsk = negotiation?.asks.at(-1);
  const bestAsk = negotiation && negotiation.asks.length > 0 ? Math.min(...negotiation.asks) : null;
  const draftValue = Number(draft);
  const notImproving = bestAsk !== null && draftValue >= bestAsk;
  const askValid = draft !== "" && Number.isFinite(draftValue) && draftValue > 0 && !notImproving;

  // Quick-pick asks between the buyer's offer and the ceiling your last ask allows.
  const ceiling = bestAsk ?? Math.round(offerFee * 1.3);
  const quickAmounts = [
    Math.round(offerFee * 1.05),
    Math.round((offerFee + ceiling) / 2),
    Math.round(ceiling * 0.95),
  ].filter((amt) => amt > offerFee && amt < ceiling);

  return (
    <div className="d-flex flex-column gap-1">
      <div>
        <strong>{currency.format(offerFee)}</strong> from {buyerName}
        {lastAsk !== undefined && (
          <small className="text-muted d-block">
            Your ask: {currency.format(lastAsk)}
            {notImproving && <> &middot; ask must be lower than your last ask</>}
          </small>
        )}
        {commentary && (
          <small className="text-muted d-block fst-italic">
            Scout: {scoutCommentaryText(commentary, playerName)}
          </small>
        )}
      </div>
      <div className="d-flex gap-1 align-items-center">
        <button
          className="btn btn-sm btn-success"
          disabled={disabled || !clausesAreValid(clauses, offerFee) || !clausesAcceptable}
          title={
            clausesAcceptable
              ? undefined
              : "They won't take those add-ons on top of this offer. Counter instead."
          }
          onClick={() => onAccept(pid, clauses)}
        >
          Accept {currency.format(offerFee)}
        </button>
        <OfferAmountInput
          value={draft}
          onChange={setDraft}
          quickAmounts={quickAmounts}
          disabled={disabled}
        />
        <button
          className="btn btn-sm btn-primary"
          disabled={disabled || !askValid}
          title={notImproving ? "Must ask less than your previous ask" : undefined}
          onClick={() => onCounter(pid, draftValue, clauses)}
        >
          Counter
        </button>
        <button
          className="btn btn-sm btn-outline-danger"
          disabled={disabled}
          onClick={() => onReject(pid)}
        >
          Reject
        </button>
      </div>
      {/* The buying club is the one that would owe on anything agreed here. */}
      <ClauseEditor
        pid={pid}
        obligorTid={buyerTid}
        baseFee={offerFee}
        value={clauses}
        onChange={setClauses}
        disabled={disabled}
        direction="selling"
      />
    </div>
  );
}

export function IncomingOffers() {
  const {
    league, acceptInboundOfferAction, rejectInboundOfferAction, counterInboundOfferAction, simming,
  } = useLeague();
  const { sort, toggle } = useTableSort<OfferSortKey>("default", "desc");

  const candidates = useMemo(
    () => (league ? inboundOfferCandidates(league) : []),
    [league],
  );

  if (!league) {
    return <p className="p-3">Loading...</p>;
  }

  const userTeam = league.teams.find((t) => t.tid === league.meta.userTid);
  if (!userTeam) {
    return <p className="p-3">Team not found.</p>;
  }

  const ws = transferWindowState(league);

  const commentaryFor = (p: Player, offerFee: number): ScoutCommentary | null =>
    ws.open
      ? scoutCommentary(p, offerFee, userTeam.scoutingSpend, league.lid, ws.season, ws.window)
      : null;

  const negotiations = currentInboundOffers(league);
  const negotiationByPid = new Map(negotiations.map((n) => [n.pid, n]));

  // Talks that outlived this render's candidate list (e.g. the buyer's
  // valuation shifted) still need a row somewhere, as long as they're open.
  const listedPids = new Set(candidates.map((c) => c.player.pid));
  const orphaned = negotiations.filter(
    (n) => !listedPids.has(n.pid) && n.status === "open",
  );

  // Accepting an offer sells the player and drops him off the roster, so his
  // candidate row would just vanish. Keep it in place (showing "Sold to <club>")
  // for the rest of the window instead.
  const soldRows = negotiations.flatMap((n) => {
    if (n.status !== "accepted" || listedPids.has(n.pid)) return [];
    const player = league.players.find((pl) => pl.pid === n.pid);
    return player
      ? [{ player, buyerTid: n.buyerTid, openingOffer: n.offers.at(-1) ?? 0 }]
      : [];
  });
  const offerOf = (c: { player: Player; openingOffer: number }) =>
    negotiationByPid.get(c.player.pid)?.offers.at(-1) ?? c.openingOffer;
  const displayCandidates = sortRows([...soldRows, ...candidates], sort, {
    name: (c) => c.player.name,
    pos: (c) => c.player.pos,
    age: (c) => league.season - c.player.born,
    ovr: (c) => c.player.ovr,
    pot: (c) => c.player.potential,
    wage: (c) => c.player.contract.salary,
    offer: (c) => offerOf(c),
  });

  // An accepted offer sells the player and drops him off the roster, so he
  // falls out of both `candidates` and `orphaned` with no other confirmation
  // on this page — surface completed sales explicitly instead.
  const soldThisWindow = league.transfers.filter(
    (t) => ws.open && t.season === ws.season && t.window === ws.window && t.fromTid === userTeam.tid,
  );

  return (
    <div className="container-fluid p-3">
      <h4>Incoming Offers</h4>

      {!ws.open ? (
        <div className="alert alert-secondary mb-3">
          <strong>Transfer window closed.</strong> The winter window opens once
          matchday {WINTER_WINDOW_OPEN_MATCHDAY - 1} is played and closes after
          the deadline; the summer window runs through the offseason and August.
        </div>
      ) : (
        <p>
          Other clubs sometimes come in for your players during an open
          window. Accept, counter for more, or reject. A rejection or a
          walked-away counter ends talks for that player for the rest of this
          window.
          {league.phase === "regular" && (
            <> The buyer covers the player&apos;s season wages on top of any fee.</>
          )}
        </p>
      )}

      {ws.open && displayCandidates.length === 0 && orphaned.length === 0 && (
        <p className="text-muted">No offers for your players right now.</p>
      )}

      {displayCandidates.length > 0 && (
        <table className="table table-striped table-sm align-middle">
          <thead>
            <tr>
              <SortableTh sortKey="name" sort={sort} onSort={toggle} defaultDir="asc">Name</SortableTh>
              <SortableTh sortKey="pos" sort={sort} onSort={toggle} defaultDir="asc">Pos</SortableTh>
              <SortableTh sortKey="age" sort={sort} onSort={toggle} className="text-end" defaultDir="asc">Age</SortableTh>
              <SortableTh sortKey="ovr" sort={sort} onSort={toggle} className="text-end">Ovr</SortableTh>
              <SortableTh sortKey="pot" sort={sort} onSort={toggle} className="text-end">Pot <PotHelp /></SortableTh>
              <SortableTh sortKey="wage" sort={sort} onSort={toggle} className="text-end">Wage</SortableTh>
              <SortableTh sortKey="offer" sort={sort} onSort={toggle}>Offer</SortableTh>
            </tr>
          </thead>
          <tbody>
            {displayCandidates.map((c) => {
              const p = c.player;
              const negotiation = negotiationByPid.get(p.pid);
              const buyerTid = negotiation?.buyerTid ?? c.buyerTid;
              const offerFee = negotiation?.offers.at(-1) ?? c.openingOffer;
              return (
                <tr key={p.pid}>
                  <td>
                    <PlayerRatingsTooltip player={p}>
                      <Link to={`/player/${p.pid}`}>{p.name}</Link>
                    </PlayerRatingsTooltip>{" "}
                    <Flag nationality={p.nationality} />
                  </td>
                  <td>{p.pos}</td>
                  <td className="text-end">{league.season - p.born}</td>
                  <td className="text-end">{p.ovr}</td>
                  <td className="text-end"><PotDisplay player={p} /></td>
                  <td className="text-end">{formatWeeklyWage(p.contract.salary)}</td>
                  <td>
                    <OfferRow
                      pid={p.pid}
                      buyerTid={buyerTid}
                      buyerName={<ClubLink tid={buyerTid} />}
                      playerName={p.name}
                      offerFee={offerFee}
                      negotiation={negotiation}
                      disabled={simming}
                      commentary={commentaryFor(p, offerFee)}
                      onAccept={acceptInboundOfferAction}
                      onReject={rejectInboundOfferAction}
                      onCounter={counterInboundOfferAction}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {orphaned.length > 0 && (
        <div className="card mb-3">
          <div className="card-body">
            <h5 className="card-title">Other Offers</h5>
            <table className="table table-sm align-middle">
              <tbody>
                {orphaned.map((n) => {
                  const p = league.players.find((pl) => pl.pid === n.pid);
                  if (!p) return null;
                  return (
                    <tr key={n.pid}>
                      <td>
                        <PlayerRatingsTooltip player={p}>{p.name}</PlayerRatingsTooltip>{" "}
                        <Flag nationality={p.nationality} /> ({p.pos})
                      </td>
                      <td>
                        <OfferRow
                          pid={n.pid}
                          buyerTid={n.buyerTid}
                          buyerName={<ClubLink tid={n.buyerTid} />}
                          playerName={p.name}
                          offerFee={n.offers.at(-1) ?? 0}
                          negotiation={n}
                          disabled={simming}
                          commentary={commentaryFor(p, n.offers.at(-1) ?? 0)}
                          onAccept={acceptInboundOfferAction}
                          onReject={rejectInboundOfferAction}
                          onCounter={counterInboundOfferAction}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {soldThisWindow.length > 0 && (
        <div className="card mb-3">
          <div className="card-body">
            <h5 className="card-title">Sold This Window</h5>
            <ul className="mb-0">
              {soldThisWindow.map((t, i) => {
                const p = league.players.find((pl) => pl.pid === t.pid);
                return (
                  <li key={i}>
                    {p ? <Link to={`/player/${p.pid}`}>{p.name}</Link> : `Player ${t.pid}`}{" "}
                    {p && <Flag nationality={p.nationality} />} &rarr; <ClubLink tid={t.toTid} season={t.season} /> for{" "}
                    {currency.format(t.fee)}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
