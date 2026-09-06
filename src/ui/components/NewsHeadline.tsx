/**
 * One line of the Dashboard's news panel.
 *
 * Lifted out of `Dashboard.tsx` unchanged so the spectator dashboard can show
 * the same panel without a second copy of it — a headline that reads two ways
 * depending on which dashboard you are looking at is exactly the drift that
 * having one renderer prevents.
 *
 * Deliberately *not* merged with the News Feed page's renderer, which is a
 * richer thing (it carries icons, grouping and per-item detail this panel has
 * no room for). That duplication predates this and is left alone.
 */
import { Link } from "react-router-dom";
import type { FeedItem } from "../newsFeedTimeline.js";
import type { Player } from "../../core/players/types.js";
import type { StoredTeam } from "../../core/teams/clubs.js";
import type { Competition } from "../../core/competitions.js";
import { isFreeAgentTid } from "../../core/transfers/negotiation.js";
import { unpackPositionChange } from "../../core/newsEvents.js";
import { currency } from "../format.js";

export interface NewsHeadlineContext {
  teamByTid: Map<number, StoredTeam>;
  playerByPid: Map<number, Player>;
  competitions: Competition[];
}

export function newsHeadlineNode(item: FeedItem, ctx: NewsHeadlineContext): React.ReactNode {
  const { teamByTid, playerByPid, competitions } = ctx;
  const playerLink = (player: Player | undefined): React.ReactNode =>
    player ? <Link to={`/player/${player.pid}`}>{player.name}</Link> : "A player";

  if (item.kind === "transfer") {
    const t = item.data;
    const player = playerByPid.get(t.pid);
    const to = teamByTid.get(t.toTid);
    // A free-agent signing (fromTid is the sentinel) reads as a free move, not
    // a club-to-club transfer with a phantom "?" origin.
    if (isFreeAgentTid(t.fromTid)) {
      return (
        <>
          {playerLink(player)} signs for {to?.name ?? "?"} on a free
        </>
      );
    }
    const from = teamByTid.get(t.fromTid);
    return (
      <>
        {playerLink(player)} moves from {from?.name ?? "?"} to {to?.name ?? "?"} ({currency.format(t.fee)})
      </>
    );
  }
  if (item.kind === "continental") {
    const c = item.data;
    return (
      <>
        {c.country} {c.to > c.from ? "earns" : "loses"} a Continental Cup place ({c.from} to {c.to})
      </>
    );
  }
  if (item.kind === "trophy") {
    const t = item.data;
    const winner = t.tid !== undefined
      ? teamByTid.get(t.tid)?.name ?? "A club"
      : t.nation ?? "A nation";
    return <>{winner} win the {t.name}</>;
  }
  if (item.kind === "promotion") {
    const p = item.data;
    const up = teamByTid.get(p.tid)?.name ?? "A club";
    const beaten = teamByTid.get(p.runnerUpTid)?.name ?? "the other finalist";
    // Name the division. A country settles one place per step of its pyramid,
    // so two of these land in the same feed and "win the promotion playoff"
    // alone does not say which one was at stake.
    const into = competitions.find((c) => c.id === p.d1CompId)?.name;
    // A German tie the incumbent held on to is the one case where the winner
    // keeps his place rather than taking one.
    if (!p.promoted) {
      return (
        <>
          {up} survive the playoff{into ? ` and stay in ${into}` : ""}, beating {beaten} {p.score}
        </>
      );
    }
    return (
      <>
        {up} win the playoff {p.score} against {beaten} to go up to {into ?? "the division above"}
      </>
    );
  }
  if (item.kind === "award") {
    const a = item.data;
    const who = playerLink(playerByPid.get(a.pid));
    const comp = competitions.find((c) => c.id === a.compId)?.name;
    switch (a.kind) {
      case "ballonDOr":
        return a.placing === 1
          ? <>{who} wins the Ballon d'Or</>
          : <>{who} finishes {a.placing === 2 ? "2nd" : "3rd"} in the Ballon d'Or</>;
      case "worldTeamOfYear":
        return <>{who} makes the World Team of the Year</>;
      case "goalkeeperOfYear":
        return <>{who} is Goalkeeper of the Year</>;
      case "defenderOfYear":
        return <>{who} is Defender of the Year</>;
      case "playerOfSeason":
        return <>{who} is {comp ?? "his league"} Player of the Season</>;
      case "goldenBoot":
        return <>{who} wins the {comp ?? "league"} Golden Boot</>;
      case "teamOfSeason":
        return <>{who} makes the {comp ?? "league"} Team of the Season</>;
    }
  }
  const e = item.data;
  const player = playerByPid.get(e.pid);
  switch (e.type) {
    case "hattrick":
      return <>{playerLink(player)} scores a hat-trick ({e.detail} goals)</>;
    case "standoutRating":
      return <>{playerLink(player)} is the standout performer ({(e.detail / 10).toFixed(1)} rating)</>;
    case "goalMilestoneSeason":
      return <>{playerLink(player)} reaches {e.detail} goals this season</>;
    case "goalMilestoneCareer":
      return <>{playerLink(player)} reaches {e.detail} career goals</>;
    case "positionChange": {
      const { from, to } = unpackPositionChange(e.detail);
      return <>{playerLink(player)} is now a {to}, after playing at {from}</>;
    }
  }
}
