import {
  appealBreakdown, standingLabel, type UserSigningView,
} from "../../core/transfers/userView.js";
import type { RuleStanding } from "../../core/foreignRules.js";

/**
 * How a player feels about joining your club: Keen / Open / Reluctant / Won't
 * talk, with his reasons on hover. Plain text and a title attribute, no extra
 * elements, because it sits on every row of the game's biggest tables.
 */
export function InterestTag({ view }: { view: UserSigningView | null }) {
  if (!view) return null;
  const tone = view.interest === "Keen" ? "text-success"
    : view.interest === "Reluctant" || view.interest === "Won't talk" ? "text-warning" : "text-muted";
  return (
    <span className={`small text-nowrap ${tone}`} title={appealBreakdown(view.appeal)}>
      {view.interest}
    </span>
  );
}

/** Your squad against its league's registration rules, one line. Nothing for a league with none. */
export function RuleCounter({ standings }: { standings: RuleStanding[] }) {
  if (standings.length === 0) return null;
  return (
    <p className="small text-muted mb-2">
      League rules: {standings.map((s) => standingLabel(s)).join(" · ")}
    </p>
  );
}
