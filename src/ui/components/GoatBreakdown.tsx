import type { GoatComponent } from "../../core/frivolities/goat.js";

/*
 * The wording and the expanded arithmetic behind a GOAT score.
 *
 * Shared by the world board on Frivolities and a club's own board on Club
 * History, so one score can't be explained two ways.
 */

/**
 * The parts a GOAT score is made of, in the order they're shown.
 *
 * Order and membership come from the data (`row.components`), not this table —
 * this only supplies wording. A component with no entry here still shows, under
 * its key, rather than silently vanishing from a total it contributes to.
 */
const PART_LABELS: Record<string, { label: string; help: string }> = {
  peak: { label: "Peak", help: "highest rating reached" },
  prime: { label: "Prime", help: "years spent near that peak" },
  longevity: { label: "Career", help: "seasons played and sustained match rating" },
  awards: { label: "Awards", help: "individual honours" },
  trophies: { label: "Trophies", help: "titles won with club and country" },
  production: { label: "Extras", help: "goals, assists and caps" },
};

/** Wording for each line of arithmetic inside a component. */
const TERM_LABELS: Record<string, string> = {
  peakOvr: "rating above 70 at his peak",
  primeOvr: "rating above 70, added up across every season",
  seasons: "seasons played",
  rating: "match rating above 6.0, scaled by how much he played",
  ballonDOr: "Ballon d'Or",
  playerOfSeason: "Player of the Season",
  worldXI: "World Team of the Year",
  goalkeeperOfYear: "Goalkeeper of the Year",
  defenderOfYear: "Defender of the Year",
  goldenBoot: "Golden Boot",
  teamOfSeason: "Team of the Season",
  worldCups: "World Cup",
  cupTitles: "Continental Cup",
  shieldTitles: "Continental Shield",
  domesticCupTitles: "domestic cup",
  leagueTitles: "league title",
  goals: "goals",
  assists: "assists",
  caps: "caps",
  topFinishes: "top-four finishes",
  topFlightSeasons: "seasons in the top flight",
  ppgSurplus: "points per game above 1.40, added up across every season",
  secondTierTitles: "second-tier title",
  trebles: "treble (league, Continental Cup and domestic cup in one season)",
};

export function partLabel(key: string): string {
  return PART_LABELS[key]?.label ?? key;
}

/** A number that reads cleanly whether it's a count of trophies or a rating surplus. */
function termCount(count: number): string {
  return Number.isInteger(count) ? String(count) : count.toFixed(2);
}

/** Term points are exact, so show the decimal rather than a figure that won't multiply out. */
function termPoints(points: number): string {
  return Number.isInteger(points) ? String(points) : points.toFixed(1);
}

/**
 * The full working behind one row's score: every component, every term, and the
 * `count x weight = points` that produced it.
 */
/**
 * The expanded score breakdown, exported for `test/ui/goatBreakdown.test.tsx`.
 *
 * Worth testing directly because a term reaching the UI with no entry in
 * TERM_LABELS falls back to its raw key, which renders as a plausible-looking
 * label rather than an error. That is invisible to a typecheck: the map is a
 * Record<string, string> and any key type-checks against it.
 */
export function GoatBreakdown({ components, score }: { components: GoatComponent[]; score: number }) {
  return (
    <div className="small">
      <div className="text-muted mb-2">
        How this score was worked out. Every line is how many, times what each one is worth.
        Each part is rounded to a whole number, so its lines can add up a fraction off.
      </div>
      <div className="row g-3">
        {components.filter((c) => c.terms.length > 0).map((c) => (
          <div key={c.key} className="col-12 col-md-6 col-lg-4">
            <div className="d-flex justify-content-between border-bottom mb-1">
              <strong>{partLabel(c.key)}</strong>
              <strong>{c.points}</strong>
            </div>
            {c.terms.map((t) => (
              <div key={t.key} className="d-flex justify-content-between gap-2 text-muted">
                <span>
                  {TERM_LABELS[t.key] ?? t.key}: {termCount(t.count)} x {t.weight}
                </span>
                <span className="text-nowrap">{termPoints(t.points)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="d-flex justify-content-between border-top mt-2 pt-1">
        <strong>Total</strong>
        <strong>{score}</strong>
      </div>
    </div>
  );
}
