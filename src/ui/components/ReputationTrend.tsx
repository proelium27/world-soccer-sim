/**
 * A club's reputation as a whole number, with how far its last offseason moved
 * it (see core/teams/reputation.ts). Club History and the club Database both
 * render it through this, so the two pages can't show the same club
 * differently. A change is left off when nothing recorded the season before,
 * and a move that rounds to nothing reads as steady rather than as +0.0.
 */
export function ReputationTrend({ value, change }: { value: number; change: number | null }) {
  const moved = change !== null && Math.abs(change) >= 0.05;
  return (
    <span className="text-nowrap">
      {Math.round(value)}
      {moved && (
        <span
          className={`small ms-1 ${change! > 0 ? "text-success" : "text-danger"}`}
          title="How much the last offseason moved it"
        >
          {change! > 0 ? "+" : "−"}{Math.abs(change!).toFixed(1)}
        </span>
      )}
    </span>
  );
}
